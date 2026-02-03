/**
 * OCX CLI - update command
 * Update installed components from registries
 */

import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import type { Command } from "commander"
import { type ConfigProvider, LocalConfigProvider } from "../config/provider"
import { fetchComponentVersion, fetchFileContent } from "../registry/fetcher"
import { parseCanonicalId, type Receipt, readReceipt, writeReceipt } from "../schemas/config"
import {
	type ComponentFileObject,
	normalizeComponentManifest,
	parseQualifiedComponent,
} from "../schemas/registry"
import { ConfigError, NotFoundError, ValidationError } from "../utils/errors"
import { createSpinner, handleError, logger } from "../utils/index"
import { hashBundle, hashContent } from "../utils/receipt"

// =============================================================================
// TYPES
// =============================================================================

export interface UpdateOptions {
	all?: boolean
	registry?: string
	dryRun?: boolean
	cwd?: string
	quiet?: boolean
	verbose?: boolean
	json?: boolean
}

interface ComponentSpec {
	component: string
}

interface UpdateResult {
	qualifiedName: string
	oldVersion: string
	newVersion: string
	status: "updated" | "up-to-date" | "would-update"
}

// =============================================================================
// COMMAND REGISTRATION
// =============================================================================

export function registerUpdateCommand(program: Command): void {
	program
		.command("update [components...]")
		.description("Update installed components")
		.option("--all", "Update all installed components")
		.option("--registry <name>", "Update all components from a specific registry")
		.option("--dry-run", "Preview changes without applying")
		.option("--cwd <path>", "Working directory", process.cwd())
		.option("-q, --quiet", "Suppress output")
		.option("-v, --verbose", "Verbose output")
		.option("--json", "Output as JSON")
		.action(async (components: string[], options: UpdateOptions) => {
			try {
				await runUpdate(components, options)
			} catch (error) {
				handleError(error, { json: options.json })
			}
		})
}

// =============================================================================
// MAIN UPDATE LOGIC
// =============================================================================

async function runUpdate(componentNames: string[], options: UpdateOptions): Promise<void> {
	const cwd = options.cwd ?? process.cwd()
	const provider = await LocalConfigProvider.requireInitialized(cwd)
	await runUpdateCore(componentNames, options, provider)
}

/**
 * Core update logic shared between local and profile modes.
 * Accepts a ConfigProvider to abstract config source.
 */
export async function runUpdateCore(
	componentNames: string[],
	options: UpdateOptions,
	provider: ConfigProvider,
): Promise<void> {
	const registries = provider.getRegistries()

	// -------------------------------------------------------------------------
	// Guard clauses (Law 1: Early Exit)
	// -------------------------------------------------------------------------

	// Guard: No receipt file (nothing installed yet)
	const receipt = await readReceipt(provider.cwd)
	if (!receipt || Object.keys(receipt.installed).length === 0) {
		throw new ValidationError("Nothing installed yet. Run 'ocx add <component>' first.")
	}

	// Guard: No args and no flags
	const hasComponents = componentNames.length > 0
	const hasAll = options.all === true
	const hasRegistry = options.registry !== undefined
	if (!hasComponents && !hasAll && !hasRegistry) {
		throw new ValidationError(
			"Specify components, use --all, or use --registry <name>.\n\n" +
				"Examples:\n" +
				"  ocx update kdco/agents           # Update specific component\n" +
				"  ocx update --all                 # Update all installed components\n" +
				"  ocx update --registry kdco       # Update all from a registry",
		)
	}

	// Guard: --all with components
	if (hasAll && hasComponents) {
		throw new ValidationError(
			"Cannot specify components with --all.\n" +
				"Use either 'ocx update --all' or 'ocx update <components>'.",
		)
	}

	// Guard: --registry with components
	if (hasRegistry && hasComponents) {
		throw new ValidationError(
			"Cannot specify components with --registry.\n" +
				"Use either 'ocx update --registry <name>' or 'ocx update <components>'.",
		)
	}

	// Guard: --all with --registry
	if (hasAll && hasRegistry) {
		throw new ValidationError(
			"Cannot use --all with --registry.\n" +
				"Use either 'ocx update --all' or 'ocx update --registry <name>'.",
		)
	}

	// -------------------------------------------------------------------------
	// Parse component specs
	// -------------------------------------------------------------------------

	const parsedComponents = componentNames.map(parseComponentSpec)

	// -------------------------------------------------------------------------
	// Determine which components to update
	// -------------------------------------------------------------------------

	const componentsToUpdate = resolveComponentsToUpdate(receipt, parsedComponents, options)

	// Guard: No matching components
	if (componentsToUpdate.length === 0) {
		if (hasRegistry) {
			throw new NotFoundError(`No installed components from registry '${options.registry}'.`)
		}
		throw new NotFoundError("No matching components found to update.")
	}

	// -------------------------------------------------------------------------
	// Fetch and compare
	// -------------------------------------------------------------------------

	const spin = options.quiet ? null : createSpinner({ text: "Checking for updates..." })
	spin?.start()

	const results: UpdateResult[] = []
	const updates: {
		canonicalId: string
		component: ReturnType<typeof normalizeComponentManifest>
		files: { path: string; content: Buffer }[]
		newHash: string
		newVersion: string
		baseUrl: string
		namespace: string
		name: string
	}[] = []

	try {
		for (const spec of componentsToUpdate) {
			const canonicalId = spec.component
			const entry = receipt.installed[canonicalId]
			// Guard: component must exist in receipt (already validated in resolveComponentsToUpdate)
			if (!entry) {
				throw new NotFoundError(`Component '${canonicalId}' not found in receipt.`)
			}

			const namespace = entry.namespace
			const componentName = entry.name

			// Get registry config
			const regConfig = registries[namespace]
			if (!regConfig) {
				throw new ConfigError(
					`Registry '${namespace}' not configured. Component '${canonicalId}' cannot be updated.`,
				)
			}

			// Fetch component (latest version)
			const fetchResult = await fetchComponentVersion(regConfig.url, componentName, undefined)
			const manifest = fetchResult.manifest

			const normalizedManifest = normalizeComponentManifest(manifest)

			// Fetch all files and compute hash
			const files: { path: string; content: Buffer }[] = []
			for (const file of normalizedManifest.files) {
				const content = await fetchFileContent(regConfig.url, componentName, file.path)
				files.push({ path: file.path, content: Buffer.from(content) })
			}

			const newHash = await hashBundle(files)
			const newVersion = `sha256:${newHash}` // Use hash as version/revision

			// Compare hashes
			if (newHash === entry.hash) {
				results.push({
					qualifiedName: canonicalId,
					oldVersion: entry.revision,
					newVersion: newVersion,
					status: "up-to-date",
				})
			} else if (options.dryRun) {
				results.push({
					qualifiedName: canonicalId,
					oldVersion: entry.revision,
					newVersion: newVersion,
					status: "would-update",
				})
			} else {
				results.push({
					qualifiedName: canonicalId,
					oldVersion: entry.revision,
					newVersion: newVersion,
					status: "updated",
				})
				updates.push({
					canonicalId,
					component: normalizedManifest,
					files,
					newHash,
					newVersion: newVersion,
					baseUrl: regConfig.url,
					namespace,
					name: componentName,
				})
			}
		}

		spin?.succeed(`Checked ${componentsToUpdate.length} component(s)`)

		// -------------------------------------------------------------------------
		// Dry-run output
		// -------------------------------------------------------------------------

		if (options.dryRun) {
			outputDryRun(results, options)
			return
		}

		// -------------------------------------------------------------------------
		// Apply updates
		// -------------------------------------------------------------------------

		if (updates.length === 0) {
			if (!options.quiet && !options.json) {
				logger.info("")
				logger.success("All components are up to date.")
			}
			if (options.json) {
				console.log(JSON.stringify({ success: true, updated: [], upToDate: results }, null, 2))
			}
			return
		}

		const installSpin = options.quiet ? null : createSpinner({ text: "Updating components..." })
		installSpin?.start()

		for (const update of updates) {
			// Write files
			for (const file of update.files) {
				const fileObj = update.component.files.find(
					(f: ComponentFileObject) => f.path === file.path,
				)
				if (!fileObj) continue

				const targetPath = join(provider.cwd, fileObj.target)
				const targetDir = dirname(targetPath)

				if (!existsSync(targetDir)) {
					await mkdir(targetDir, { recursive: true })
				}

				await writeFile(targetPath, file.content)

				if (options.verbose) {
					logger.info(`  ✓ Updated ${fileObj.target}`)
				}
			}

			// Update receipt entry - we know it exists because we validated in resolveComponentsToUpdate
			const existingEntry = receipt.installed[update.canonicalId]
			if (!existingEntry) {
				throw new NotFoundError(`Component '${update.canonicalId}' not found in receipt.`)
			}

			// Compute individual file hashes
			const fileHashes: Array<{ path: string; hash: string }> = []
			for (const file of update.files) {
				const componentFile = update.component.files.find(
					(f: ComponentFileObject) => f.path === file.path,
				)
				if (!componentFile) throw new Error(`File ${file.path} not found in component manifest`)
				fileHashes.push({
					path: componentFile.target,
					hash: hashContent(file.content),
				})
			}

			receipt.installed[update.canonicalId] = {
				registryUrl: existingEntry.registryUrl,
				namespace: existingEntry.namespace,
				name: existingEntry.name,
				revision: update.newVersion,
				hash: update.newHash,
				files: fileHashes,
				installedAt: existingEntry.installedAt,
				updatedAt: new Date().toISOString(),
				// Update opencode config if component provides it
				...(update.component.opencode && {
					opencode: update.component.opencode as Record<string, unknown>,
				}),
			}
		}

		installSpin?.succeed(`Updated ${updates.length} component(s)`)

		// Save receipt file
		await writeReceipt(provider.cwd, receipt)

		// -------------------------------------------------------------------------
		// Output results
		// -------------------------------------------------------------------------

		if (options.json) {
			console.log(
				JSON.stringify(
					{
						success: true,
						updated: results.filter((r) => r.status === "updated"),
						upToDate: results.filter((r) => r.status === "up-to-date"),
					},
					null,
					2,
				),
			)
		} else if (!options.quiet) {
			logger.info("")
			for (const result of results) {
				if (result.status === "updated") {
					logger.info(`  ✓ ${result.qualifiedName} (${result.oldVersion} → ${result.newVersion})`)
				} else if (result.status === "up-to-date" && options.verbose) {
					logger.info(`  ○ ${result.qualifiedName} (already up to date)`)
				}
			}
			logger.info("")
			logger.success(`Done! Updated ${updates.length} component(s).`)
		}
	} catch (error) {
		spin?.fail("Failed to check for updates")
		throw error
	}
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Parse a component specifier (just returns the spec as-is).
 * Law 2: Parse at boundary, trust internally.
 *
 * @example
 * parseComponentSpec("kdco/agents") // { component: "kdco/agents" }
 */
function parseComponentSpec(spec: string): ComponentSpec {
	return { component: spec }
}

/**
 * Resolve which components to update based on args and flags.
 * Law 4: Fail fast if component not found in receipt.
 */
function resolveComponentsToUpdate(
	receipt: Receipt,
	parsedComponents: ComponentSpec[],
	options: UpdateOptions,
): ComponentSpec[] {
	const installedComponents = Object.keys(receipt.installed)

	// --all: update all installed components (no version override)
	if (options.all) {
		return installedComponents.map((c) => ({ component: c }))
	}

	// --registry: filter by registry namespace (no version override)
	if (options.registry) {
		return installedComponents
			.filter((canonicalId) => {
				const entry = receipt.installed[canonicalId]
				return entry?.namespace === options.registry
			})
			.map((c) => ({ component: c }))
	}

	// Specific components: validate they exist
	// User provides qualified names like "kdco/agents"
	// We need to find the matching canonical ID in the receipt
	const result: ComponentSpec[] = []
	for (const spec of parsedComponents) {
		const name = spec.component
		// Validate format (must be qualified)
		if (!name.includes("/")) {
			const suggestions = installedComponents
				.map((id) => {
					const parsed = parseCanonicalId(id)
					return `${parsed.namespace}/${parsed.name}`
				})
				.filter((qualified) => qualified.endsWith(`/${name}`))
			if (suggestions.length === 1) {
				throw new ValidationError(
					`Ambiguous component '${name}'. Did you mean '${suggestions[0]}'?`,
				)
			}
			if (suggestions.length > 1) {
				throw new ValidationError(
					`Ambiguous component '${name}'. Found in multiple registries:\n` +
						suggestions.map((s) => `  - ${s}`).join("\n") +
						"\n\nPlease use a fully qualified name (registry/component).",
				)
			}
			throw new ValidationError(
				`Component '${name}' must include a registry prefix (e.g., 'kdco/${name}').`,
			)
		}

		// Find matching canonical ID
		const { namespace, component } = parseQualifiedComponent(name)
		const matchingIds = installedComponents.filter((id) => {
			const parsed = parseCanonicalId(id)
			return parsed.namespace === namespace && parsed.name === component
		})

		if (matchingIds.length === 0) {
			throw new NotFoundError(
				`Component '${name}' is not installed.\nRun 'ocx add ${name}' to install it first.`,
			)
		}

		// Use the first matching canonical ID (there should only be one per namespace/name pair)
		const canonicalId = matchingIds[0]
		if (!canonicalId) {
			throw new Error(`Unexpected: matchingIds has length but first element is undefined`)
		}
		result.push({ component: canonicalId })
	}

	return result
}

/**
 * Output dry-run results.
 */
function outputDryRun(results: UpdateResult[], options: UpdateOptions): void {
	const wouldUpdate = results.filter((r) => r.status === "would-update")
	const upToDate = results.filter((r) => r.status === "up-to-date")

	if (options.json) {
		console.log(JSON.stringify({ dryRun: true, wouldUpdate, upToDate }, null, 2))
		return
	}

	if (!options.quiet) {
		logger.info("")

		if (wouldUpdate.length > 0) {
			logger.info("Would update:")
			for (const result of wouldUpdate) {
				logger.info(`  ${result.qualifiedName} (${result.oldVersion} → ${result.newVersion})`)
			}
		}

		if (upToDate.length > 0 && options.verbose) {
			logger.info("")
			logger.info("Already up to date:")
			for (const result of upToDate) {
				logger.info(`  ${result.qualifiedName}`)
			}
		}

		if (wouldUpdate.length > 0) {
			logger.info("")
			logger.info("Run without --dry-run to apply changes.")
		} else {
			logger.info("All components are up to date.")
		}
	}
}
