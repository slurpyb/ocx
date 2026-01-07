/**
 * OCX CLI - add command
 * Install components from registries
 */

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import type { Command } from "commander"
import { CLI_VERSION, GITHUB_REPO } from "../constants.js"
import { fetchFileContent, fetchRegistryIndex } from "../registry/fetcher.js"
import type { ResolvedComponent, ResolvedNpmDependency } from "../registry/resolver.js"
import { type ResolvedDependencies, resolveDependencies } from "../registry/resolver.js"
import { type OcxLock, readOcxConfig, readOcxLock } from "../schemas/config.js"
import type { ComponentFileObject, RegistryIndex } from "../schemas/registry.js"
import { updateOpencodeJsonConfig } from "../updaters/update-opencode-config.js"
import { isContentIdentical } from "../utils/content.js"
import {
	ConfigError,
	ConflictError,
	type DependencyConflict,
	DependencyConflictError,
	IntegrityError,
	ValidationError,
} from "../utils/errors.js"
import {
	collectCompatIssues,
	createSpinner,
	handleError,
	logger,
	warnCompatIssues,
} from "../utils/index.js"

interface AddOptions {
	yes?: boolean
	dryRun?: boolean
	cwd?: string
	quiet?: boolean
	verbose?: boolean
	json?: boolean
	skipCompatCheck?: boolean
}

export function registerAddCommand(program: Command): void {
	program
		.command("add")
		.description("Add components to your project")
		.argument("<components...>", "Components to install")
		.option("-y, --yes", "Skip prompts")
		.option("--dry-run", "Show what would be installed without making changes")
		.option("--cwd <path>", "Working directory", process.cwd())
		.option("-q, --quiet", "Suppress output")
		.option("-v, --verbose", "Verbose output")
		.option("--json", "Output as JSON")
		.option("--skip-compat-check", "Skip version compatibility checks")
		.action(async (components: string[], options: AddOptions) => {
			try {
				await runAdd(components, options)
			} catch (error) {
				handleError(error, { json: options.json })
			}
		})
}

async function runAdd(componentNames: string[], options: AddOptions): Promise<void> {
	const cwd = options.cwd ?? process.cwd()
	const lockPath = join(cwd, "ocx.lock")

	// Load config
	const config = await readOcxConfig(cwd)
	if (!config) {
		throw new ConfigError("No ocx.jsonc found. Run 'ocx init' first.")
	}

	// Load or create lock
	let lock: OcxLock = { lockVersion: 1, installed: {} }
	const existingLock = await readOcxLock(cwd)
	if (existingLock) {
		lock = existingLock
	}

	const spin = options.quiet ? null : createSpinner({ text: "Resolving dependencies..." })
	spin?.start()

	try {
		// Fetch registry indexes BEFORE resolution (needed for catalog resolution)
		const registryIndexes = new Map<string, RegistryIndex>()
		const failedRegistries = new Set<string>()

		// Fetch registry indexes in parallel
		await Promise.all(
			Object.entries(config.registries).map(async ([namespace, regConfig]) => {
				try {
					const index = await fetchRegistryIndex(regConfig.url)
					registryIndexes.set(namespace, index)
				} catch {
					failedRegistries.add(namespace)
					logger.warn(
						`Could not fetch registry index for ${namespace} - catalog references will not work`,
					)
				}
			}),
		)

		// Resolve all dependencies across all configured registries (with catalog data)
		const resolved = await resolveDependencies(config.registries, componentNames, registryIndexes)

		if (options.verbose) {
			logger.info("Install order:")
			for (const name of resolved.installOrder) {
				logger.info(`  - ${name}`)
			}
		}

		spin?.succeed(
			`Resolved ${resolved.components.length} components from ${registryIndexes.size} registries`,
		)

		// Version compatibility check (skip if disabled via flag or config)
		const skipCompat = options.skipCompatCheck || config.skipCompatCheck
		if (!skipCompat) {
			for (const [namespace, index] of registryIndexes) {
				const issues = collectCompatIssues({
					registry: { opencode: index.opencode, ocx: index.ocx },
					ocxVersion: CLI_VERSION,
				})
				warnCompatIssues(namespace, issues)
			}
		}

		// Check for npm dependency version conflicts (Law 4: Fail Fast)
		const existingDeps = await getExistingDevDependencies(cwd)
		const allResolved = [...resolved.npmDependencies, ...resolved.npmDevDependencies]
		const conflicts = detectVersionConflicts(allResolved, existingDeps)

		if (conflicts.length > 0) {
			if (!options.yes) {
				throw new DependencyConflictError(conflicts)
			}
			// With --yes: warn and continue (last declared wins)
			logger.warn("Dependency version conflicts detected (continuing with --yes):")
			for (const conflict of conflicts) {
				logger.warn(
					`  ${conflict.packageName}: ${conflict.versions.map((v) => v.version).join(" vs ")}`,
				)
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
					logger.info("Created opencode.jsonc")
				} else {
					logger.info("Updated opencode.jsonc")
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
				npmSpin?.succeed(`Added ${totalDeps} dependencies to .opencode/package.json`)
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
			if (dep.kind === "catalog") {
				logger.info(`  ${dep.name}@${dep.version} (from catalog:${dep.catalogKey})`)
			} else if (dep.kind === "pinned") {
				logger.info(`  ${dep.name}@${dep.version}`)
			} else {
				logger.info(`  ${dep.name} (latest)`)
			}
		}
	}

	if (resolved.npmDevDependencies.length > 0) {
		logger.info("")
		logger.info("Would install npm dev dependencies:")
		for (const dep of resolved.npmDevDependencies) {
			if (dep.kind === "catalog") {
				logger.info(`  ${dep.name}@${dep.version} (from catalog:${dep.catalogKey})`)
			} else if (dep.kind === "pinned") {
				logger.info(`  ${dep.name}@${dep.version}`)
			} else {
				logger.info(`  ${dep.name} (latest)`)
			}
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

/**
 * Converts a ResolvedNpmDependency to NpmDependency for package.json.
 * - catalog/pinned: uses the resolved version
 * - bare: uses "*" as version (any version acceptable)
 */
function toNpmDependency(dep: ResolvedNpmDependency): NpmDependency {
	if (dep.kind === "bare") {
		return { name: dep.name, version: "*" }
	}
	return { name: dep.name, version: dep.version }
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
	npmDeps: ResolvedNpmDependency[],
	npmDevDeps: ResolvedNpmDependency[],
): Promise<void> {
	// Guard: no deps to process
	const allDeps = [...npmDeps, ...npmDevDeps]
	if (allDeps.length === 0) return

	const opencodeDir = join(cwd, ".opencode")

	// Ensure directory exists
	await mkdir(opencodeDir, { recursive: true })

	// Convert resolved deps to package.json format
	const parsedDeps = allDeps.map(toNpmDependency)

	// Read → merge → write
	const existing = await readOpencodePackageJson(opencodeDir)
	const updated = mergeDevDependencies(existing, parsedDeps)
	await Bun.write(join(opencodeDir, "package.json"), `${JSON.stringify(updated, null, 2)}\n`)

	// Ensure manifest files are tracked by git
	await ensureManifestFilesAreTracked(opencodeDir)
}

// ============================================================================
// Dependency Conflict Detection
// ============================================================================

/**
 * Reads existing dependencies from .opencode/package.json.
 * Returns empty object if file doesn't exist or is invalid.
 */
async function getExistingDevDependencies(cwd: string): Promise<Record<string, string>> {
	const pkgPath = join(cwd, ".opencode", "package.json")
	try {
		const content = await Bun.file(pkgPath).text()
		const pkg = JSON.parse(content)
		return { ...pkg.dependencies, ...pkg.devDependencies }
	} catch {
		return {} // File doesn't exist or is invalid
	}
}

/**
 * Detects version conflicts between resolved dependencies and existing package.json.
 * Returns conflicts grouped: component conflicts first, then package.json conflicts.
 */
export function detectVersionConflicts(
	resolved: ResolvedNpmDependency[],
	existing: Record<string, string>,
): DependencyConflict[] {
	// Group versions by package name
	const byName = new Map<string, Array<{ version: string; source: string }>>()

	// Collect versions from resolved deps
	for (const dep of resolved) {
		if (dep.kind === "bare") continue // bare deps accept any version
		const entries = byName.get(dep.name) ?? []
		entries.push({
			version: dep.version,
			source: dep.declaredBy + (dep.kind === "catalog" ? ` via catalog:${dep.catalogKey}` : ""),
		})
		byName.set(dep.name, entries)
	}

	// Add existing package.json versions
	for (const [name, version] of Object.entries(existing)) {
		const entries = byName.get(name)
		if (entries) {
			entries.push({ version, source: ".opencode/package.json" })
		}
	}

	// Find conflicts (different versions for same package)
	const conflicts: DependencyConflict[] = []
	for (const [packageName, versions] of byName) {
		const uniqueVersions = [...new Set(versions.map((v) => v.version.trim()))]
		if (uniqueVersions.length > 1) {
			conflicts.push({ packageName, versions })
		}
	}

	// Sort: component conflicts first, then package.json conflicts
	return conflicts.sort((a, b) => {
		const aHasPkgJson = a.versions.some((v) => v.source.includes("package.json"))
		const bHasPkgJson = b.versions.some((v) => v.source.includes("package.json"))
		if (aHasPkgJson && !bHasPkgJson) return 1
		if (!aHasPkgJson && bHasPkgJson) return -1
		return a.packageName.localeCompare(b.packageName)
	})
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
