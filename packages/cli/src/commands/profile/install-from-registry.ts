/**
 * Profile Installation from Registry
 *
 * Installs a profile package from a registry, including:
 * - Profile files (ocx.jsonc, opencode.jsonc, AGENTS.md) -> flat in profile dir
 * - Dependencies (agents, skills, etc.) -> profile's .opencode/ subdirectory
 * - Lock file creation for reproducible installs
 */

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { getProfileDir, getProfilesDir } from "../../profile/paths"
import { profileNameSchema } from "../../profile/schema"
import { fetchComponent, fetchFileContent, fetchRegistryIndex } from "../../registry/fetcher"
import { resolveDependencies } from "../../registry/resolver"
import type { RegistryConfig } from "../../schemas/config"
import { normalizeComponentManifest } from "../../schemas/registry"
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors"
import { createSpinner, logger } from "../../utils/index"
import { resolveTargetPath } from "../../utils/paths"

// =============================================================================
// TYPES
// =============================================================================

export interface InstallProfileOptions {
	/** Registry namespace (e.g., "kdco") */
	namespace: string
	/** Component name (e.g., "minimal") */
	component: string
	/** Local profile name (e.g., "work") */
	profileName: string
	/** Overwrite existing files */
	force?: boolean
	/** Resolved registry URL */
	registryUrl: string
	/** All configured registries (for dependency resolution) */
	registries: Record<string, RegistryConfig>
	/** Suppress output */
	quiet?: boolean
}

/**
 * Profile-specific lock file schema.
 * Tracks what was installed from the registry for reproducibility.
 */
export interface ProfileLock {
	/** Lock file format version */
	version: 1
	/** Source profile component info */
	installedFrom: {
		registry: string
		component: string
		version?: string
		hash: string
		installedAt: string
	}
	/** Installed dependencies */
	installed: {
		[qualifiedName: string]: {
			registry: string
			version?: string
			hash: string
			files: string[]
			installedAt: string
		}
	}
}

// =============================================================================
// PROFILE FILE TARGETS (flat in profile dir, not in .opencode/)
// =============================================================================

/** Valid profile file targets (flat, no .opencode/ prefix) */
const PROFILE_FILE_TARGETS = new Set(["ocx.jsonc", "opencode.jsonc", "AGENTS.md"])

/**
 * Check if a file target is a profile file (goes flat in profile dir)
 */
function isProfileFile(target: string): boolean {
	return PROFILE_FILE_TARGETS.has(target)
}

// =============================================================================
// HASHING UTILITIES
// =============================================================================

function hashContent(content: string | Buffer): string {
	return createHash("sha256").update(content).digest("hex")
}

function hashBundle(files: { path: string; content: Buffer }[]): string {
	// Sort files for deterministic hashing
	const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))

	// Create a manifest of file hashes
	const manifestParts: string[] = []
	for (const file of sorted) {
		const hash = hashContent(file.content)
		manifestParts.push(`${file.path}:${hash}`)
	}

	// Hash the manifest itself
	return hashContent(manifestParts.join("\n"))
}

// =============================================================================
// MAIN INSTALLATION FUNCTION
// =============================================================================

/**
 * Install a profile from a registry.
 *
 * Flow:
 * 1. Fetch and validate the profile component manifest
 * 2. Fetch all profile files from registry
 * 3. Resolve and fetch dependencies (if any)
 * 4. Create staging directory for atomic install
 * 5. Write profile files (flat in profile dir)
 * 6. Write dependency files (to .opencode/ in profile)
 * 7. Create ocx.lock in profile directory
 * 8. Move staging dir to final profile location
 *
 * @throws ValidationError if component is not type "ocx:profile"
 * @throws NotFoundError if component doesn't exist
 * @throws ConflictError if profile exists and force is not set
 */
export async function installProfileFromRegistry(options: InstallProfileOptions): Promise<void> {
	const { namespace, component, profileName, force, registryUrl, registries, quiet } = options

	// ==========================================================================
	// Guard: Validate profile name at boundary (Law 2: Parse Don't Validate)
	// ==========================================================================

	const parseResult = profileNameSchema.safeParse(profileName)
	if (!parseResult.success) {
		throw new ValidationError(
			`Invalid profile name: "${profileName}". ` +
				`Profile names must start with a letter and contain only alphanumeric characters, dots, underscores, or hyphens.`,
		)
	}

	const profileDir = getProfileDir(profileName)
	const qualifiedName = `${namespace}/${component}`
	const profileExists = existsSync(profileDir)

	// ==========================================================================
	// Guard: Profile already exists
	// ==========================================================================

	if (profileExists && !force) {
		throw new ConflictError(`Profile "${profileName}" already exists.\nUse --force to overwrite.`)
	}

	// ==========================================================================
	// Phase 1: Fetch and validate the profile component
	// ==========================================================================

	const fetchSpin = quiet ? null : createSpinner({ text: `Fetching ${qualifiedName}...` })
	fetchSpin?.start()

	let manifest: Awaited<ReturnType<typeof fetchComponent>>
	try {
		manifest = await fetchComponent(registryUrl, component)
	} catch (error) {
		fetchSpin?.fail(`Failed to fetch ${qualifiedName}`)
		if (error instanceof NotFoundError) {
			throw new NotFoundError(
				`Profile component "${qualifiedName}" not found in registry.\n\n` +
					`Check the component name and ensure the registry is configured.`,
			)
		}
		throw error
	}

	// Guard: Must be a profile type component
	if (manifest.type !== "ocx:profile") {
		fetchSpin?.fail(`Invalid component type`)
		throw new ValidationError(
			`Component "${qualifiedName}" is type "${manifest.type}", not "ocx:profile".\n\n` +
				`Only profile components can be installed with 'ocx profile add --from'.`,
		)
	}

	// Normalize the manifest (expand Cargo-style shorthands)
	const normalized = normalizeComponentManifest(manifest)

	fetchSpin?.succeed(`Fetched ${qualifiedName}`)

	// ==========================================================================
	// Phase 2: Fetch all profile files
	// ==========================================================================

	const filesSpin = quiet ? null : createSpinner({ text: "Downloading profile files..." })
	filesSpin?.start()

	const profileFiles: { path: string; target: string; content: Buffer }[] = []
	const dependencyFiles: { path: string; target: string; content: Buffer }[] = []

	for (const file of normalized.files) {
		const content = await fetchFileContent(registryUrl, component, file.path)
		const fileEntry = {
			path: file.path,
			target: file.target,
			content: Buffer.from(content),
		}

		// Route files: profile files go flat, others go to .opencode/
		if (isProfileFile(file.target)) {
			profileFiles.push(fileEntry)
		} else {
			dependencyFiles.push(fileEntry)
		}
	}

	filesSpin?.succeed(`Downloaded ${normalized.files.length} files`)

	// ==========================================================================
	// Phase 3: Resolve and fetch dependencies
	// ==========================================================================

	let resolvedDeps: Awaited<ReturnType<typeof resolveDependencies>> | null = null
	const dependencyBundles: {
		qualifiedName: string
		registryName: string
		files: { path: string; target: string; content: Buffer }[]
		hash: string
		version?: string
	}[] = []

	if (manifest.dependencies.length > 0) {
		const depsSpin = quiet ? null : createSpinner({ text: "Resolving dependencies..." })
		depsSpin?.start()

		try {
			// Build dependency refs with namespace
			const depRefs = manifest.dependencies.map((dep) =>
				dep.includes("/") ? dep : `${namespace}/${dep}`,
			)

			resolvedDeps = await resolveDependencies(registries, depRefs)

			// Fetch all dependency files
			for (const depComponent of resolvedDeps.components) {
				const files: { path: string; target: string; content: Buffer }[] = []

				for (const file of depComponent.files) {
					const content = await fetchFileContent(depComponent.baseUrl, depComponent.name, file.path)
					// For dependencies, resolve target for flattened profile mode
					const resolvedTarget = resolveTargetPath(file.target, true)
					files.push({
						path: file.path,
						target: resolvedTarget,
						content: Buffer.from(content),
					})
				}

				const registryIndex = await fetchRegistryIndex(depComponent.baseUrl)

				dependencyBundles.push({
					qualifiedName: depComponent.qualifiedName,
					registryName: depComponent.registryName,
					files,
					hash: hashBundle(files),
					version: registryIndex.version,
				})
			}

			depsSpin?.succeed(`Resolved ${resolvedDeps.components.length} dependencies`)
		} catch (error) {
			depsSpin?.fail("Failed to resolve dependencies")
			throw error
		}
	}

	// ==========================================================================
	// Phase 4: Create staging directory
	// Use profiles directory as parent to ensure same filesystem (avoids EXDEV on rename)
	// ==========================================================================

	const profilesDir = getProfilesDir()
	await mkdir(profilesDir, { recursive: true, mode: 0o700 })
	const stagingDir = await mkdtemp(join(profilesDir, ".staging-"))
	const stagingOpencodeDir = join(stagingDir, ".opencode")

	try {
		await mkdir(stagingOpencodeDir, { recursive: true, mode: 0o700 })

		// ==========================================================================
		// Phase 5: Write profile files (flat in staging dir)
		// ==========================================================================

		const writeSpin = quiet ? null : createSpinner({ text: "Writing profile files..." })
		writeSpin?.start()

		for (const file of profileFiles) {
			const targetPath = join(stagingDir, file.target)
			const targetDir = dirname(targetPath)

			if (!existsSync(targetDir)) {
				await mkdir(targetDir, { recursive: true })
			}

			await writeFile(targetPath, file.content)
		}

		// Also write any embedded dependency files from the profile manifest
		for (const file of dependencyFiles) {
			// Embedded files go to .opencode/ in profile
			// Strip .opencode/ prefix if present to prevent double-nesting
			const target = file.target.startsWith(".opencode/")
				? file.target.slice(".opencode/".length)
				: file.target
			const targetPath = join(stagingOpencodeDir, target)
			const targetDir = dirname(targetPath)

			if (!existsSync(targetDir)) {
				await mkdir(targetDir, { recursive: true })
			}

			await writeFile(targetPath, file.content)
		}

		writeSpin?.succeed(`Wrote ${profileFiles.length + dependencyFiles.length} profile files`)

		// ==========================================================================
		// Phase 6: Write dependency component files (to .opencode/ in staging)
		// ==========================================================================

		if (dependencyBundles.length > 0) {
			const depWriteSpin = quiet ? null : createSpinner({ text: "Writing dependency files..." })
			depWriteSpin?.start()

			let depFileCount = 0
			for (const bundle of dependencyBundles) {
				for (const file of bundle.files) {
					const targetPath = join(stagingOpencodeDir, file.target)
					const targetDir = dirname(targetPath)

					if (!existsSync(targetDir)) {
						await mkdir(targetDir, { recursive: true })
					}

					await writeFile(targetPath, file.content)
					depFileCount++
				}
			}

			depWriteSpin?.succeed(`Wrote ${depFileCount} dependency files`)
		}

		// ==========================================================================
		// Phase 7: Create ocx.lock in staging directory
		// ==========================================================================

		const profileHash = hashBundle(profileFiles.map((f) => ({ path: f.path, content: f.content })))

		// Get registry version for the lock file
		const registryIndex = await fetchRegistryIndex(registryUrl)

		const lock: ProfileLock = {
			version: 1,
			installedFrom: {
				registry: namespace,
				component,
				version: registryIndex.version,
				hash: profileHash,
				installedAt: new Date().toISOString(),
			},
			installed: {},
		}

		// Add dependency entries
		for (const bundle of dependencyBundles) {
			lock.installed[bundle.qualifiedName] = {
				registry: bundle.registryName,
				version: bundle.version,
				hash: bundle.hash,
				files: bundle.files.map((f) => f.target),
				installedAt: new Date().toISOString(),
			}
		}

		await writeFile(join(stagingDir, "ocx.lock"), JSON.stringify(lock, null, "\t"))

		// ==========================================================================
		// Phase 8: Move staging dir to final profile location (atomic swap)
		// ==========================================================================

		const moveSpin = quiet ? null : createSpinner({ text: "Finalizing installation..." })
		moveSpin?.start()

		// Ensure parent directory exists
		const profilesDir = dirname(profileDir)
		if (!existsSync(profilesDir)) {
			await mkdir(profilesDir, { recursive: true, mode: 0o700 })
		}

		// Atomic swap with rollback for force mode
		if (profileExists && force) {
			const backupDir = `${profileDir}.backup-${Date.now()}`
			await rename(profileDir, backupDir)
			try {
				await rename(stagingDir, profileDir)
			} catch (err) {
				// Rollback: restore backup
				await rename(backupDir, profileDir)
				throw err
			}
			// Cleanup backup after successful install (outside try block)
			// Failure here shouldn't trigger rollback since install succeeded
			await rm(backupDir, { recursive: true, force: true })
		} else {
			// No existing profile: simple rename
			await rename(stagingDir, profileDir)
		}

		moveSpin?.succeed("Installation complete")

		// ==========================================================================
		// Summary
		// ==========================================================================

		if (!quiet) {
			logger.info("")
			logger.success(`Installed profile "${profileName}" from ${qualifiedName}`)
			logger.info("")
			logger.info("Profile contents:")
			for (const file of profileFiles) {
				logger.info(`  ${file.target}`)
			}
			if (dependencyBundles.length > 0) {
				logger.info("")
				logger.info("Dependencies:")
				for (const bundle of dependencyBundles) {
					logger.info(`  ${bundle.qualifiedName}`)
				}
			}
		}
	} catch (error) {
		// Cleanup staging directory on failure
		try {
			if (existsSync(stagingDir)) {
				await rm(stagingDir, { recursive: true })
			}
		} catch {
			// Ignore cleanup errors
		}
		throw error
	}
}
