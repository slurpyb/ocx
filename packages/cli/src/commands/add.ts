/**
 * OCX CLI - add command
 * Install components from registries
 */

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import type { Command } from "commander"
import type { ConfigProvider } from "../config/provider.js"
import { LocalConfigProvider } from "../config/provider.js"
import { CLI_VERSION, GITHUB_REPO } from "../constants.js"
import { fetchFileContent, fetchRegistryIndex } from "../registry/fetcher.js"
import type { ResolvedComponent } from "../registry/resolver.js"
import { type ResolvedDependencies, resolveDependencies } from "../registry/resolver.js"
import { type OcxLock, readOcxLock } from "../schemas/config.js"
import type { ComponentFileObject, RegistryIndex } from "../schemas/registry.js"
import { updateOpencodeJsonConfig } from "../updaters/update-opencode-config.js"
import { isContentIdentical } from "../utils/content.js"
import { ConfigError, ConflictError, IntegrityError, ValidationError } from "../utils/errors.js"
import {
	assertPathInside,
	collectCompatIssues,
	createSpinner,
	handleError,
	logger,
	warnCompatIssues,
} from "../utils/index.js"
import {
	addCommonOptions,
	addConfirmationOptions,
	addVerboseOption,
} from "../utils/shared-options.js"

export interface AddOptions {
	yes?: boolean
	dryRun?: boolean
	cwd?: string
	quiet?: boolean
	verbose?: boolean
	json?: boolean
	skipCompatCheck?: boolean
}

export function registerAddCommand(program: Command): void {
	const cmd = program
		.command("add")
		.description("Add components to your project")
		.argument("<components...>", "Components to install")
		.option("--dry-run", "Show what would be installed without making changes")
		.option("--skip-compat-check", "Skip version compatibility checks")

	addCommonOptions(cmd)
	addConfirmationOptions(cmd)
	addVerboseOption(cmd)

	cmd.action(async (components: string[], options: AddOptions) => {
		try {
			const provider = await LocalConfigProvider.create(options.cwd ?? process.cwd())
			await runAddCore(components, options, provider)
		} catch (error) {
			handleError(error, { json: options.json })
		}
	})
}

/**
 * Core add logic that accepts a ConfigProvider.
 * This enables reuse across both standard and ghost modes.
 */
export async function runAddCore(
	componentNames: string[],
	options: AddOptions,
	provider: ConfigProvider,
): Promise<void> {
	const cwd = provider.cwd
	const lockPath = join(cwd, "ocx.lock")
	const registries = provider.getRegistries()

	// Load or create lock
	let lock: OcxLock = { lockVersion: 1, installed: {} }
	const existingLock = await readOcxLock(cwd)
	if (existingLock) {
		lock = existingLock
	}

	const spin = options.quiet ? null : createSpinner({ text: "Resolving dependencies..." })
	spin?.start()

	try {
		// Resolve all dependencies across all configured registries
		const resolved = await resolveDependencies(registries, componentNames)

		if (options.verbose) {
			logger.info("Install order:")
			for (const name of resolved.installOrder) {
				logger.info(`  - ${name}`)
			}
		}

		// Fetch registry indexes once (Law 2: Parse at boundary)
		const registryIndexes = new Map<string, RegistryIndex>()
		const uniqueBaseUrls = new Map<string, string>() // namespace -> baseUrl

		for (const component of resolved.components) {
			if (!uniqueBaseUrls.has(component.registryName)) {
				uniqueBaseUrls.set(component.registryName, component.baseUrl)
			}
		}

		for (const [namespace, baseUrl] of uniqueBaseUrls) {
			const index = await fetchRegistryIndex(baseUrl)
			registryIndexes.set(namespace, index)
		}

		spin?.succeed(
			`Resolved ${resolved.components.length} components from ${registryIndexes.size} registries`,
		)

		// Version compatibility check (skip if disabled via flag)
		const skipCompat = options.skipCompatCheck
		if (!skipCompat) {
			for (const [namespace, index] of registryIndexes) {
				const issues = collectCompatIssues({
					registry: { opencode: index.opencode, ocx: index.ocx },
					ocxVersion: CLI_VERSION,
				})
				warnCompatIssues(namespace, issues)
			}
		}

		if (options.dryRun) {
			logger.info("")
			logger.info("Dry run - no changes made")
			logResolved(resolved)
			return
		}

		// Phase 1: Fetch all files and perform pre-flight checks (Law 4: Fail Fast)
		// We check ALL conflicts BEFORE writing ANY files to ensure atomic behavior
		const fetchSpin = options.quiet ? null : createSpinner({ text: "Fetching components..." })
		fetchSpin?.start()

		const componentBundles: {
			component: ResolvedComponent
			files: { path: string; content: Buffer }[]
			computedHash: string
		}[] = []

		for (const component of resolved.components) {
			// Fetch component files and compute bundle hash
			const files: { path: string; content: Buffer }[] = []
			for (const file of component.files) {
				const content = await fetchFileContent(component.baseUrl, component.name, file.path)
				files.push({ path: file.path, content: Buffer.from(content) })
			}

			const computedHash = await hashBundle(files)

			// Layer 2 path safety: Verify all target paths are inside cwd (runtime containment)
			for (const file of component.files) {
				const targetPath = join(cwd, file.target)
				assertPathInside(targetPath, cwd)
			}

			// Verify integrity if already in lock (use qualifiedName as key)
			const existingEntry = lock.installed[component.qualifiedName]
			if (existingEntry && existingEntry.hash !== computedHash) {
				fetchSpin?.fail("Integrity check failed")
				throw new IntegrityError(component.qualifiedName, existingEntry.hash, computedHash)
			}

			// Check for file conflicts with components from other namespaces
			for (const file of component.files) {
				const targetPath = join(cwd, file.target)
				if (existsSync(targetPath)) {
					// File exists - check if it's from the same component (re-install) or different (conflict)
					const conflictingComponent = findComponentByFile(lock, file.target)
					if (conflictingComponent && conflictingComponent !== component.qualifiedName) {
						fetchSpin?.fail("File conflict detected")
						throw new ConflictError(
							`File conflict: ${file.target} already exists (installed by '${conflictingComponent}').\n\n` +
								`To resolve:\n` +
								`  1. Remove existing: rm ${file.target}\n` +
								`  2. Or rename it manually and update references\n` +
								`  3. Then run: ocx add ${component.qualifiedName}`,
						)
					}
				}
			}

			componentBundles.push({ component, files, computedHash })
		}

		fetchSpin?.succeed(`Fetched ${resolved.components.length} components`)

		// Phase 2: Pre-flight conflict detection (check ALL files before writing ANY)
		// This ensures atomic behavior: either all files install or none do
		const allConflicts: string[] = []

		for (const { component, files } of componentBundles) {
			for (const file of files) {
				const componentFile = component.files.find((f: ComponentFileObject) => f.path === file.path)
				if (!componentFile) continue

				const targetPath = join(cwd, componentFile.target)
				if (existsSync(targetPath)) {
					const existingContent = await Bun.file(targetPath).text()
					const incomingContent = file.content.toString("utf-8")

					if (!isContentIdentical(existingContent, incomingContent) && !options.yes) {
						allConflicts.push(componentFile.target)
					}
				}
			}
		}

		// Fail fast on conflicts BEFORE any writes (Law 4)
		if (allConflicts.length > 0) {
			logger.error("")
			logger.error("File conflicts detected:")
			for (const conflict of allConflicts) {
				logger.error(`  ✗ ${conflict}`)
			}
			logger.error("")
			logger.error("These files have been modified since installation.")
			logger.error("Use --yes to overwrite, or review the changes first.")
			throw new ConflictError(
				`${allConflicts.length} file(s) have conflicts. Use --yes to overwrite.`,
			)
		}

		// Phase 3: Install all components (no conflicts possible at this point)
		const installSpin = options.quiet ? null : createSpinner({ text: "Installing components..." })
		installSpin?.start()

		for (const { component, files, computedHash } of componentBundles) {
			// Install component
			const installResult = await installComponent(component, files, cwd, {
				yes: options.yes,
				verbose: options.verbose,
			})

			// Log results in verbose mode
			if (options.verbose) {
				for (const f of installResult.skipped) {
					logger.info(`  ○ Skipped ${f} (unchanged)`)
				}
				for (const f of installResult.overwritten) {
					logger.info(`  ✓ Overwrote ${f}`)
				}
				for (const f of installResult.written) {
					logger.info(`  ✓ Wrote ${f}`)
				}
			}

			// Use cached registry index for lockfile version
			const index = registryIndexes.get(component.registryName)
			if (!index) {
				throw new ValidationError(
					`Registry index not found for "${component.registryName}". ` +
						`This is an internal error - please report it at https://github.com/${GITHUB_REPO}/issues`,
				)
			}

			// Update lock with qualifiedName as key (namespace/component format)
			lock.installed[component.qualifiedName] = {
				registry: component.registryName,
				version: index.version,
				hash: computedHash,
				files: component.files.map((f) => f.target),
				installedAt: new Date().toISOString(),
			}
		}

		installSpin?.succeed(`Installed ${resolved.components.length} components`)

		// Apply opencode.json changes (ShadCN-style: component wins, user uses git)
		if (resolved.opencode && Object.keys(resolved.opencode).length > 0) {
			const result = await updateOpencodeJsonConfig(cwd, resolved.opencode)

			if (!options.quiet && result.changed) {
				if (result.created) {
					logger.info(`Created ${join(cwd, "opencode.jsonc")}`)
				} else {
					logger.info(`Updated ${join(cwd, "opencode.jsonc")}`)
				}
			}
		}

		// Update .opencode/package.json with npm dependencies
		const hasNpmDeps = resolved.npmDependencies.length > 0
		const hasNpmDevDeps = resolved.npmDevDependencies.length > 0

		if (hasNpmDeps || hasNpmDevDeps) {
			const npmSpin = options.quiet
				? null
				: createSpinner({ text: "Updating .opencode/package.json..." })
			npmSpin?.start()

			try {
				await updateOpencodeDevDependencies(
					cwd,
					resolved.npmDependencies,
					resolved.npmDevDependencies,
				)
				const totalDeps = resolved.npmDependencies.length + resolved.npmDevDependencies.length
				npmSpin?.succeed(
					`Added ${totalDeps} dependencies to ${join(cwd, ".opencode/package.json")}`,
				)
			} catch (error) {
				npmSpin?.fail("Failed to update .opencode/package.json")
				throw error
			}
		}

		// Save lock file
		await writeFile(lockPath, JSON.stringify(lock, null, 2), "utf-8")

		if (options.json) {
			console.log(
				JSON.stringify(
					{
						success: true,
						installed: resolved.installOrder,
						opencode: !!resolved.opencode,
					},
					null,
					2,
				),
			)
		} else if (!options.quiet) {
			logger.info("")
			logger.success(`Done! Installed ${resolved.components.length} components.`)
		}
	} catch (error) {
		// Only fail the resolve spinner if it's still running (error during resolution)
		// Other spinners handle their own failures
		if (spin && !spin.isSpinning) {
			// Spinner already stopped - error happened after resolution
		} else {
			spin?.fail("Failed to add components")
		}
		throw error
	}
}

/**
 * Writes component files to disk.
 * Pre-flight conflict detection happens before this function is called,
 * so we can safely write all files without additional conflict checks.
 */
async function installComponent(
	component: ResolvedComponent,
	files: { path: string; content: Buffer }[],
	cwd: string,
	_options: { yes?: boolean; verbose?: boolean },
): Promise<{ written: string[]; skipped: string[]; overwritten: string[] }> {
	const result = {
		written: [] as string[],
		skipped: [] as string[],
		overwritten: [] as string[],
	}

	for (const file of files) {
		const componentFile = component.files.find((f: ComponentFileObject) => f.path === file.path)
		if (!componentFile) continue

		const targetPath = join(cwd, componentFile.target)
		const targetDir = dirname(targetPath)

		// Check if file exists
		if (existsSync(targetPath)) {
			// Read existing content and compare
			const existingContent = await Bun.file(targetPath).text()
			const incomingContent = file.content.toString("utf-8")

			if (isContentIdentical(existingContent, incomingContent)) {
				// Content is identical - skip silently
				result.skipped.push(componentFile.target)
				continue
			}

			// Content differs - overwrite (conflicts already checked in pre-flight)
			result.overwritten.push(componentFile.target)
		} else {
			result.written.push(componentFile.target)
		}

		// Create directory if needed
		if (!existsSync(targetDir)) {
			await mkdir(targetDir, { recursive: true })
		}

		await writeFile(targetPath, file.content)
	}

	return result
}

async function hashContent(content: string | Buffer): Promise<string> {
	return createHash("sha256").update(content).digest("hex")
}

async function hashBundle(files: { path: string; content: Buffer }[]): Promise<string> {
	// Sort files for deterministic hashing
	const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))

	// Create a manifest of file hashes
	const manifestParts: string[] = []
	for (const file of sorted) {
		const hash = await hashContent(file.content)
		manifestParts.push(`${file.path}:${hash}`)
	}

	// Hash the manifest itself
	return hashContent(manifestParts.join("\n"))
}

function logResolved(resolved: ResolvedDependencies): void {
	logger.info("")
	logger.info("Would install:")
	for (const component of resolved.components) {
		logger.info(`  ${component.name} (${component.type}) from ${component.registryName}`)
	}

	if (resolved.opencode && Object.keys(resolved.opencode).length > 0) {
		logger.info("")
		logger.info("Would update opencode.json with:")
		for (const key of Object.keys(resolved.opencode)) {
			logger.info(`  ${key}`)
		}
	}

	if (resolved.npmDependencies.length > 0) {
		logger.info("")
		logger.info("Would install npm dependencies:")
		for (const dep of resolved.npmDependencies) {
			logger.info(`  ${dep}`)
		}
	}

	if (resolved.npmDevDependencies.length > 0) {
		logger.info("")
		logger.info("Would install npm dev dependencies:")
		for (const dep of resolved.npmDevDependencies) {
			logger.info(`  ${dep}`)
		}
	}
}

// ============================================================================
// NPM Dependency Management
// ============================================================================

interface NpmDependency {
	name: string
	version: string
}

interface OpencodePackageJson {
	name?: string
	private?: boolean
	type?: string
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
}

const DEFAULT_PACKAGE_JSON: OpencodePackageJson = {
	name: "opencode-plugins",
	private: true,
	type: "module",
}

/**
 * Parses an npm dependency spec into name and version.
 * Handles: "lodash", "lodash@4.0.0", "@types/node", "@types/node@1.0.0"
 */
function parseNpmDependency(spec: string): NpmDependency {
	// Guard: invalid input
	if (!spec?.trim()) {
		throw new ValidationError(`Invalid npm dependency: expected non-empty string, got "${spec}"`)
	}

	const trimmed = spec.trim()
	const lastAt = trimmed.lastIndexOf("@")

	// Has version: "lodash@4.0.0" or "@types/node@1.0.0"
	if (lastAt > 0) {
		const name = trimmed.slice(0, lastAt)
		const version = trimmed.slice(lastAt + 1)
		if (!version) {
			throw new ValidationError(`Invalid npm dependency: missing version after @ in "${spec}"`)
		}
		return { name, version }
	}

	// No version: "lodash" or "@types/node" → use "*"
	return { name: trimmed, version: "*" }
}

/**
 * Merges new dependencies into existing package.json structure.
 * Pure function: same inputs always produce same output.
 */
function mergeDevDependencies(
	existing: OpencodePackageJson,
	newDeps: NpmDependency[],
): OpencodePackageJson {
	const merged: Record<string, string> = { ...existing.devDependencies }
	for (const dep of newDeps) {
		merged[dep.name] = dep.version
	}
	return { ...existing, devDependencies: merged }
}

/**
 * Reads .opencode/package.json or returns default structure if missing.
 */
async function readOpencodePackageJson(opencodeDir: string): Promise<OpencodePackageJson> {
	const pkgPath = join(opencodeDir, "package.json")

	// Guard: file doesn't exist - return default
	if (!existsSync(pkgPath)) {
		return { ...DEFAULT_PACKAGE_JSON }
	}

	// Try to parse, fail fast on invalid JSON
	try {
		const content = await Bun.file(pkgPath).text()
		return JSON.parse(content) as OpencodePackageJson
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		throw new ConfigError(`Invalid .opencode/package.json: ${message}`)
	}
}

/**
 * Modifies .opencode/.gitignore to ensure package.json and bun.lock are tracked.
 * Creates the file with sensible defaults if missing.
 */
async function ensureManifestFilesAreTracked(opencodeDir: string): Promise<void> {
	const gitignorePath = join(opencodeDir, ".gitignore")
	const filesToTrack = new Set(["package.json", "bun.lock"])
	const requiredIgnores = ["node_modules"]

	// Read existing lines or start fresh
	let lines: string[] = []
	if (existsSync(gitignorePath)) {
		const content = await Bun.file(gitignorePath).text()
		lines = content
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean)
	}

	// Remove entries that should be tracked (not ignored)
	lines = lines.filter((line) => !filesToTrack.has(line))

	// Ensure required ignores are present
	for (const ignore of requiredIgnores) {
		if (!lines.includes(ignore)) {
			lines.push(ignore)
		}
	}

	await Bun.write(gitignorePath, `${lines.join("\n")}\n`)
}

/**
 * Updates .opencode/package.json with new devDependencies and ensures
 * manifest files are tracked by git.
 */
async function updateOpencodeDevDependencies(
	cwd: string,
	npmDeps: string[],
	npmDevDeps: string[],
): Promise<void> {
	// Guard: no deps to process
	const allDepSpecs = [...npmDeps, ...npmDevDeps]
	if (allDepSpecs.length === 0) return

	const opencodeDir = join(cwd, ".opencode")

	// Ensure directory exists
	await mkdir(opencodeDir, { recursive: true })

	// Parse all deps - fails fast on invalid
	const parsedDeps = allDepSpecs.map(parseNpmDependency)

	// Read → merge → write
	const existing = await readOpencodePackageJson(opencodeDir)
	const updated = mergeDevDependencies(existing, parsedDeps)
	await Bun.write(join(opencodeDir, "package.json"), `${JSON.stringify(updated, null, 2)}\n`)

	// Ensure manifest files are tracked by git
	await ensureManifestFilesAreTracked(opencodeDir)
}

/**
 * Find which component installed a given file path
 */
function findComponentByFile(lock: OcxLock, filePath: string): string | null {
	for (const [qualifiedName, entry] of Object.entries(lock.installed)) {
		if (entry.files.includes(filePath)) {
			return qualifiedName
		}
	}
	return null
}
