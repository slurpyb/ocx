/**
 * ConfigResolver - Unified Configuration Resolution
 *
 * ISOLATION MODEL:
 * - OCX registries are ISOLATED per scope (profile XOR local, never merged)
 * - OpenCode config (opencode.jsonc) DOES merge (profile → local)
 * - This is for security - prevents registry injection across scopes
 *
 * Resolution order:
 * 1. Global profile ocx.jsonc + opencode.jsonc (if resolved)
 * 2. Apply exclude/include patterns from profile (for opencode.jsonc only)
 * 3. Local .opencode/opencode.jsonc (if not excluded) - merges with profile
 *
 * Follows the 5 Laws of Elegant Defense:
 * - Law 1 (Early Exit): Guard clauses handle edge cases at top
 * - Law 2 (Parse Don't Validate): Async factory parses at boundary, sync getters use trusted state
 * - Law 3 (Atomic Predictability): Pure resolve method, no hidden mutations
 * - Law 4 (Fail Fast): Throws ProfileNotFoundError for missing profiles
 * - Law 5 (Intentional Naming): Names describe exact purpose
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { Glob } from "bun"
import { parse as parseJsonc } from "jsonc-parser"
import { ProfileManager } from "../profile/manager"
import {
	findLocalConfigDir,
	getProfileOcxConfig,
	getProfileOpencodeConfig,
	LOCAL_CONFIG_DIR,
	OCX_CONFIG_FILE,
	OPENCODE_CONFIG_FILE,
} from "../profile/paths"
import type { Profile } from "../profile/schema"
import type { RegistryConfig } from "../schemas/config"

// =============================================================================
// TYPES
// =============================================================================

/**
 * The fully resolved configuration from all sources.
 */
export interface ResolvedConfig {
	/** Registries from active scope only (isolated, not merged) */
	registries: Record<string, RegistryConfig>
	/** Component installation path */
	componentPath: string
	/** Merged OpenCode config */
	opencode: Record<string, unknown>
	/** Discovered instruction files (filtered by exclude/include) */
	instructions: string[]
	/** The resolved profile name, or null if no profile */
	profileName: string | null
}

/**
 * Source of a configuration value for debugging.
 */
export type ConfigSource = "global-profile" | "local-config" | "local-opencode" | "default"

/**
 * Tracks where a configuration value originated.
 */
export interface ConfigOrigin {
	path: string
	source: ConfigSource
}

/**
 * Resolved configuration with origin tracking for debugging.
 */
export interface ResolvedConfigWithOrigin extends ResolvedConfig {
	/** Origin tracking for each setting (for debugging) */
	origins: Map<string, ConfigOrigin>
}

// =============================================================================
// INSTRUCTION FILE DISCOVERY
// =============================================================================

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"] as const

/**
 * Find git root by looking for .git (file or directory).
 * Returns null if not in a git repo.
 */
function detectGitRoot(startDir: string): string | null {
	let currentDir = startDir

	while (true) {
		const gitPath = join(currentDir, ".git")
		if (existsSync(gitPath)) {
			return currentDir
		}

		const parentDir = join(currentDir, "..")
		if (parentDir === currentDir) return null // filesystem root
		currentDir = parentDir
	}
}

/**
 * Discover instruction files by walking UP from projectDir to gitRoot.
 * Returns repo-relative paths, deepest first, alphabetical within each depth.
 */
function discoverInstructionFiles(projectDir: string, gitRoot: string | null): string[] {
	const root = gitRoot ?? projectDir
	const discovered: string[] = []
	let currentDir = projectDir

	// Walk up from projectDir to root
	while (true) {
		// Check for each instruction file (alphabetical order)
		for (const filename of INSTRUCTION_FILES) {
			const filePath = join(currentDir, filename)
			try {
				if (existsSync(filePath) && statSync(filePath).isFile()) {
					// Store as relative to root (POSIX style for glob matching)
					const relativePath = toPosixPath(relative(root, filePath))
					discovered.push(relativePath)
				}
			} catch {
				// Permission denied or broken symlink - skip this file
			}
		}

		// Stop if we've reached the root
		if (currentDir === root) break

		// Move up one directory
		const parentDir = join(currentDir, "..")
		if (parentDir === currentDir) break // filesystem root
		currentDir = parentDir
	}

	// Walk starts at deepest (projectDir) and goes up to root,
	// so discovered array is already in deepest-first order
	return discovered
}

/**
 * Normalize a glob pattern by stripping leading "./" for consistent matching.
 * Discovered paths are repo-relative (e.g. "src/AGENTS.md") so patterns
 * with "./" prefix (e.g. "./src/AGENTS.md") need normalization to match.
 */
function normalizePattern(pattern: string): string {
	return pattern.startsWith("./") ? pattern.slice(2) : pattern
}

/**
 * Convert path to POSIX-style (forward slashes) for consistent glob matching.
 * Windows path.relative() returns backslashes which won't match glob patterns.
 */
function toPosixPath(p: string): string {
	return p.replaceAll("\\", "/")
}

/**
 * Filter files using TypeScript/Vite style include/exclude.
 * Include overrides exclude, order is preserved.
 */
function filterByPatterns(files: string[], exclude: string[], include: string[]): string[] {
	return files.filter((file) => {
		// Check include first - include overrides exclude
		for (const pattern of include) {
			const glob = new Glob(normalizePattern(pattern))
			if (glob.match(file)) return true
		}

		// Check exclude
		for (const pattern of exclude) {
			const glob = new Glob(normalizePattern(pattern))
			if (glob.match(file)) return false
		}

		// Not matched by include or exclude - keep it
		return true
	})
}

// =============================================================================
// CONFIG RESOLVER
// =============================================================================

/**
 * Unified configuration resolver that handles the full cascade.
 *
 * Use the static `create()` factory to construct; it parses at the boundary
 * so that `resolve()` and getter methods can be synchronous and pure.
 */
export class ConfigResolver {
	private readonly cwd: string
	private readonly profileName: string | null
	private readonly profile: Profile | null
	private readonly localConfigDir: string | null

	// Cached resolution (computed lazily, memoized)
	private cachedConfig: ResolvedConfig | null = null

	private constructor(
		cwd: string,
		profileName: string | null,
		profile: Profile | null,
		localConfigDir: string | null,
	) {
		this.cwd = cwd
		this.profileName = profileName
		this.profile = profile
		this.localConfigDir = localConfigDir
	}

	/**
	 * Create a ConfigResolver for the given directory.
	 *
	 * Parses configuration at the boundary (Law 2: Parse Don't Validate).
	 * After construction, all getter methods are synchronous.
	 *
	 * @param cwd - Working directory
	 * @param options - Optional profile override
	 * @throws ProfileNotFoundError if explicitly requested profile doesn't exist
	 *         (via options.profile or OCX_PROFILE env var)
	 */
	static async create(cwd: string, options?: { profile?: string }): Promise<ConfigResolver> {
		const manager = ProfileManager.create()

		// Resolve profile using priority: options.profile > OCX_PROFILE env > "default"
		let profileName: string | null = null
		let profile: Profile | null = null

		// Determine if a profile was explicitly requested (Law 4: Fail Fast)
		const explicitProfileRequest = options?.profile ?? process.env.OCX_PROFILE

		if (await manager.isInitialized()) {
			try {
				profileName = await manager.resolveProfile(options?.profile)
				profile = await manager.get(profileName)
			} catch (error) {
				// If user explicitly requested a profile, fail loudly (security)
				if (explicitProfileRequest) {
					throw error
				}
				// Otherwise (just "default" fallback failed), proceed without profile
				profileName = null
				profile = null
			}
		}

		// Find local config directory
		const localConfigDir = findLocalConfigDir(cwd)

		return new ConfigResolver(cwd, profileName, profile, localConfigDir)
	}

	/**
	 * Resolve the merged configuration.
	 *
	 * Uses memoization - first call computes, subsequent calls return cached result.
	 * Pure function (Law 3: Atomic Predictability) - same instance always returns same result.
	 */
	resolve(): ResolvedConfig {
		// Return cached if available
		if (this.cachedConfig) {
			return this.cachedConfig
		}

		// 1. Get registries from active scope (ISOLATED - never merged)
		const { registries } = this.getRegistriesForScope()

		// 2. Start with default component path
		let componentPath = LOCAL_CONFIG_DIR
		let opencode: Record<string, unknown> = {}

		// 3. Apply profile settings (non-registry)
		if (this.profile) {
			if (this.profile.ocx.componentPath) {
				componentPath = this.profile.ocx.componentPath
			}
			if (this.profile.opencode) {
				opencode = this.deepMerge(opencode, this.profile.opencode)
			}
		}

		// 4. Check exclude/include patterns for opencode.jsonc
		const shouldLoadLocal = this.shouldLoadLocalConfig()

		// 5. Apply local opencode.jsonc if not excluded (opencode DOES merge)
		if (shouldLoadLocal && this.localConfigDir) {
			const localOpencodeConfig = this.loadLocalOpencodeConfig()
			if (localOpencodeConfig) {
				opencode = this.deepMerge(opencode, localOpencodeConfig)
			}
		}

		// 6. Discover instruction files
		const instructions = this.discoverInstructions()

		this.cachedConfig = {
			registries,
			componentPath,
			opencode,
			instructions,
			profileName: this.profileName,
		}

		return this.cachedConfig
	}

	/**
	 * Resolve config with origin tracking for debugging.
	 * Used by `ocx config show --origin`
	 */
	resolveWithOrigin(): ResolvedConfigWithOrigin {
		const origins = new Map<string, ConfigOrigin>()

		// 1. Get registries from active scope (ISOLATED)
		const { registries: scopeRegistries, origin: registryOrigin } = this.getRegistriesForScope()
		const registries: Record<string, RegistryConfig> = {}

		// Copy registries with origin tracking
		for (const [key, value] of Object.entries(scopeRegistries)) {
			registries[key] = value
			// Determine origin path with guard clauses (Law 1: Early Exit)
			let originPath = ""
			if (registryOrigin === "profile") {
				if (!this.profileName) {
					throw new Error("Invariant violation: profile origin requires profileName")
				}
				originPath = getProfileOcxConfig(this.profileName)
			} else if (registryOrigin === "local" && this.localConfigDir) {
				originPath = join(this.localConfigDir, OCX_CONFIG_FILE)
			}
			origins.set(`registries.${key}`, {
				path: originPath,
				source: registryOrigin === "profile" ? "global-profile" : "local-config",
			})
		}

		// 2. Start with default component path
		let componentPath = LOCAL_CONFIG_DIR
		let opencode: Record<string, unknown> = {}

		origins.set("componentPath", { path: "", source: "default" })

		// 3. Apply profile settings (non-registry)
		if (this.profile) {
			if (!this.profileName) {
				throw new Error("Invariant violation: profile requires profileName")
			}
			const profileOcxPath = getProfileOcxConfig(this.profileName)

			if (this.profile.ocx.componentPath) {
				componentPath = this.profile.ocx.componentPath
				origins.set("componentPath", { path: profileOcxPath, source: "global-profile" })
			}

			if (this.profile.opencode) {
				opencode = this.deepMerge(opencode, this.profile.opencode)
				const profileOpencodePath = getProfileOpencodeConfig(this.profileName)
				for (const key of Object.keys(this.profile.opencode)) {
					origins.set(`opencode.${key}`, { path: profileOpencodePath, source: "global-profile" })
				}
			}
		}

		// 4. Check exclude/include patterns for opencode.jsonc
		const shouldLoadLocal = this.shouldLoadLocalConfig()

		// 5. Apply local opencode.jsonc if not excluded (opencode DOES merge)
		if (shouldLoadLocal && this.localConfigDir) {
			const localOpencodeConfig = this.loadLocalOpencodeConfig()
			if (localOpencodeConfig) {
				opencode = this.deepMerge(opencode, localOpencodeConfig)
				const localOpencodePath = join(this.localConfigDir, OPENCODE_CONFIG_FILE)
				for (const key of Object.keys(localOpencodeConfig)) {
					origins.set(`opencode.${key}`, { path: localOpencodePath, source: "local-opencode" })
				}
			}
		}

		// 6. Discover instruction files
		const instructions = this.discoverInstructions()

		return {
			registries,
			componentPath,
			opencode,
			instructions,
			profileName: this.profileName,
			origins,
		}
	}

	/**
	 * Check if local config should be loaded based on exclude/include patterns.
	 *
	 * Returns true if local .opencode/ directory is NOT excluded by profile patterns.
	 */
	private shouldLoadLocalConfig(): boolean {
		// If no profile or no exclude patterns, load local config
		if (!this.profile?.ocx.exclude) return true
		if (!this.localConfigDir) return true

		// Get git root for relative path calculation
		const gitRoot = detectGitRoot(this.cwd)
		const root = gitRoot ?? this.cwd

		// Get relative path of local config dir from root (POSIX style for glob matching)
		const relativePath = toPosixPath(relative(root, this.localConfigDir))

		// Check if .opencode directory matches exclude patterns
		const exclude = this.profile.ocx.exclude ?? []
		const include = this.profile.ocx.include ?? []

		// Check include first - include overrides exclude
		for (const pattern of include) {
			const glob = new Glob(normalizePattern(pattern))
			// Match the directory path with trailing content
			if (glob.match(`${relativePath}/`) || glob.match(relativePath)) {
				return true
			}
		}

		// Check exclude
		for (const pattern of exclude) {
			const glob = new Glob(normalizePattern(pattern))
			// Check if pattern matches .opencode directory
			if (glob.match(`${relativePath}/`) || glob.match(`${relativePath}/**`)) {
				return false
			}
		}

		return true
	}

	/**
	 * Get registries for the active scope.
	 *
	 * ISOLATION MODEL: Registries are isolated per scope for security.
	 * - If profile is active: return ONLY profile registries
	 * - If no profile: return ONLY local registries
	 * - Registries are NEVER merged across scopes
	 *
	 * This prevents global/profile registries from injecting into projects.
	 */
	private getRegistriesForScope(): {
		registries: Record<string, RegistryConfig>
		origin: "profile" | "local" | "none"
	} {
		// Profile active = use profile registries ONLY
		if (this.profile) {
			return {
				registries: this.profile.ocx.registries ?? {},
				origin: "profile",
			}
		}

		// No profile = use local registries ONLY
		if (this.localConfigDir) {
			const localConfig = this.loadLocalOcxConfig()
			if (localConfig) {
				return {
					registries: localConfig.registries,
					origin: "local",
				}
			}
		}

		// No registries available
		return { registries: {}, origin: "none" }
	}

	/**
	 * Load local ocx.jsonc configuration.
	 * Returns null if file doesn't exist.
	 * @throws Error if file exists but fails to parse (Fail Fast)
	 */
	private loadLocalOcxConfig(): { registries: Record<string, RegistryConfig> } | null {
		if (!this.localConfigDir) return null

		const configPath = join(this.localConfigDir, OCX_CONFIG_FILE)
		if (!existsSync(configPath)) return null

		try {
			const text = readFileSync(configPath, "utf8")
			const parsed = parseJsonc(text)
			if (!this.isPlainObject(parsed)) {
				throw new Error(`Invalid ocx.jsonc: expected object, got ${typeof parsed}`)
			}
			const registries = parsed.registries
			if (registries !== undefined && !this.isPlainObject(registries)) {
				throw new Error(`Invalid ocx.jsonc: registries must be an object`)
			}
			return {
				registries: (registries as Record<string, RegistryConfig>) ?? {},
			}
		} catch (error) {
			if (error instanceof SyntaxError || (error as Error).message?.includes("Invalid")) {
				throw new Error(`Failed to parse ${configPath}: ${(error as Error).message}`)
			}
			throw error
		}
	}

	/**
	 * Load local opencode.jsonc configuration.
	 * Returns null if file doesn't exist.
	 * @throws Error if file exists but fails to parse (Fail Fast)
	 */
	private loadLocalOpencodeConfig(): Record<string, unknown> | null {
		if (!this.localConfigDir) return null

		const configPath = join(this.localConfigDir, OPENCODE_CONFIG_FILE)
		if (!existsSync(configPath)) return null

		try {
			const text = readFileSync(configPath, "utf8")
			const parsed = parseJsonc(text)
			if (!this.isPlainObject(parsed)) {
				throw new Error(`Invalid opencode.jsonc: expected object, got ${typeof parsed}`)
			}
			return parsed
		} catch (error) {
			if (error instanceof SyntaxError || (error as Error).message?.includes("Invalid")) {
				throw new Error(`Failed to parse ${configPath}: ${(error as Error).message}`)
			}
			throw error
		}
	}

	/**
	 * Discover instruction files (AGENTS.md, CLAUDE.md, CONTEXT.md).
	 * Walks up from cwd to git root, filters by exclude/include.
	 * Profile instructions are appended last (highest priority).
	 */
	private discoverInstructions(): string[] {
		const gitRoot = detectGitRoot(this.cwd)
		const discoveredFiles = discoverInstructionFiles(this.cwd, gitRoot)

		// Apply profile exclude/include patterns
		const exclude = this.profile?.ocx.exclude ?? []
		const include = this.profile?.ocx.include ?? []
		const filteredFiles = filterByPatterns(discoveredFiles, exclude, include)

		// Convert to absolute paths
		const root = gitRoot ?? this.cwd
		const projectInstructions = filteredFiles.map((f) => join(root, f))

		// Append profile instructions (profile comes LAST = highest priority)
		const profileInstructionsRaw = this.profile?.opencode?.instructions
		const profileInstructions: string[] = Array.isArray(profileInstructionsRaw)
			? profileInstructionsRaw.filter((x): x is string => typeof x === "string")
			: []

		return [...projectInstructions, ...profileInstructions]
	}

	/**
	 * Deep merge objects (for opencode config).
	 * Arrays are replaced (not concatenated), objects are recursively merged, scalars last-wins.
	 */
	private deepMerge(
		target: Record<string, unknown>,
		source: Record<string, unknown>,
	): Record<string, unknown> {
		const result = { ...target }

		for (const key of Object.keys(source)) {
			const sourceValue = source[key]
			const targetValue = result[key]

			// If both are plain objects, recurse
			if (this.isPlainObject(sourceValue) && this.isPlainObject(targetValue)) {
				result[key] = this.deepMerge(
					targetValue as Record<string, unknown>,
					sourceValue as Record<string, unknown>,
				)
			} else {
				// Arrays and scalars: source wins (last-write-wins)
				result[key] = sourceValue
			}
		}

		return result
	}

	/**
	 * Check if value is a plain object (not array, not null).
	 */
	private isPlainObject(value: unknown): value is Record<string, unknown> {
		return typeof value === "object" && value !== null && !Array.isArray(value)
	}

	// =========================================================================
	// CONVENIENCE GETTERS (for compatibility with existing code)
	// =========================================================================

	/**
	 * Get registries from active scope (isolated, not merged).
	 */
	getRegistries(): Record<string, RegistryConfig> {
		return this.resolve().registries
	}

	/**
	 * Get the component installation path.
	 */
	getComponentPath(): string {
		return this.resolve().componentPath
	}

	/**
	 * Get the resolved profile name, or null if no profile.
	 */
	getProfileName(): string | null {
		return this.profileName
	}

	/**
	 * Get the working directory this resolver was created for.
	 */
	getCwd(): string {
		return this.cwd
	}

	/**
	 * Get the resolved profile, or null if no profile.
	 */
	getProfile(): Profile | null {
		return this.profile
	}
}
