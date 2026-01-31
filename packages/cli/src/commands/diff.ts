/**
 * Diff Command
 *
 * Compare installed components with upstream registry versions.
 * V2: Uses receipt (.ocx/receipt.jsonc) instead of ocx.lock
 */

import { join } from "node:path"

import type { Command } from "commander"
import * as Diff from "diff"
import kleur from "kleur"
import { LocalConfigProvider } from "../config/provider"
import { fetchComponent, fetchFileContent } from "../registry/fetcher"
import { parseCanonicalId, readReceipt } from "../schemas/config"
import { normalizeFile } from "../schemas/registry"
import { handleError, logger, outputJson } from "../utils/index"
import { checkFileIntegrity } from "../utils/receipt"

interface DiffOptions {
	cwd: string
	json: boolean
	quiet: boolean
}

export function registerDiffCommand(program: Command): void {
	program
		.command("diff")
		.description("Compare installed components with upstream")
		.argument("[component]", "Component to diff (optional, diffs all if omitted)")
		.option("--cwd <path>", "Working directory", process.cwd())
		.option("--json", "Output as JSON", false)
		.option("-q, --quiet", "Suppress output", false)
		.action(async (component: string | undefined, options: DiffOptions) => {
			try {
				// V2: Read receipt instead of lock
				const cwd = options.cwd ?? process.cwd()
				const provider = await LocalConfigProvider.requireInitialized(cwd)
				const receipt = await readReceipt(provider.cwd)

				if (!receipt || Object.keys(receipt.installed).length === 0) {
					if (options.json) {
						outputJson({
							success: false,
							error: { code: "NOT_FOUND", message: "No receipt found" },
						})
					} else {
						logger.warn("No components installed. Run 'ocx add' first.")
					}
					return
				}

				const registries = provider.getRegistries()

				// V2: Component names are either canonical IDs or qualified names (namespace/component)
				// If user provides qualified name, find all matching canonical IDs
				const canonicalIds = component
					? findMatchingCanonicalIds(receipt, component)
					: Object.keys(receipt.installed)

				if (canonicalIds.length === 0) {
					if (options.json) {
						outputJson({ success: true, data: { diffs: [] } })
					} else {
						logger.info("No components installed.")
					}
					return
				}

				const results: Array<{ name: string; hasChanges: boolean; diff?: string }> = []

				for (const canonicalId of canonicalIds) {
					const entry = receipt.installed[canonicalId]
					if (!entry) {
						if (component) {
							logger.warn(`Component '${canonicalId}' not found in receipt.`)
						}
						continue
					}

					// Guard: check if files array exists and has items
					if (!entry.files || entry.files.length === 0) {
						logger.warn(`No files recorded for component '${canonicalId}'`)
						continue
					}

					// Check file integrity first
					const integrity = await checkFileIntegrity(provider.cwd, entry)

					// Get registry config
					const registryConfig = registries[entry.namespace]
					if (!registryConfig) {
						logger.warn(
							`Registry '${entry.namespace}' not configured for component '${canonicalId}'.`,
						)
						continue
					}

					try {
						// Fetch upstream component
						const upstream = await fetchComponent(registryConfig.url, entry.name)

						// V2: Diff all files in the component
						const fileDiffs: string[] = []
						let hasAnyChanges = false

						for (const fileEntry of entry.files) {
							// The receipt stores resolved paths (with .opencode/ prefix in local mode)
							// We need to find the matching upstream file by comparing the base target
							const upstreamFile = upstream.files.find((f) => {
								const normalized = normalizeFile(f)
								// Compare the target path (without .opencode/ prefix)
								const receiptBasePath = fileEntry.path.replace(/^\.opencode\//, "")
								return normalized.target === receiptBasePath
							})

							if (!upstreamFile) {
								// File doesn't exist upstream anymore
								fileDiffs.push(`File removed from upstream: ${fileEntry.path}`)
								hasAnyChanges = true
								continue
							}

							const normalized = normalizeFile(upstreamFile)

							// Check if file was modified locally (use integrity check results)
							const fileStatus = integrity.details.find((d) => d.path === fileEntry.path)
							if (!fileStatus) continue

							// Fetch upstream content
							const upstreamContent = await fetchFileContent(
								registryConfig.url,
								entry.name,
								normalized.path,
							)

							// Read local content
							const localPath = join(provider.cwd, fileEntry.path)
							const localFile = Bun.file(localPath)
							if (!(await localFile.exists())) {
								fileDiffs.push(`File missing locally: ${fileEntry.path}`)
								hasAnyChanges = true
								continue
							}
							const localContent = await localFile.text()

							// Compare content
							if (localContent !== upstreamContent) {
								const patch = Diff.createPatch(fileEntry.path, upstreamContent, localContent)
								fileDiffs.push(patch)
								hasAnyChanges = true
							}
						}

						const displayName = `${entry.namespace}/${entry.name}@${entry.revision}`
						if (hasAnyChanges) {
							results.push({
								name: displayName,
								hasChanges: true,
								diff: fileDiffs.join("\n\n"),
							})
						} else {
							results.push({
								name: displayName,
								hasChanges: false,
							})
						}
					} catch (err) {
						logger.warn(`Could not fetch upstream for ${canonicalId}: ${String(err)}`)
					}
				}

				if (options.json) {
					outputJson({ success: true, data: { diffs: results } })
				} else {
					for (const res of results) {
						if (res.hasChanges) {
							console.log(kleur.yellow(`\nDiff for ${res.name}:`))
							console.log(res.diff || "Changes detected (no diff available)")
						} else if (!options.quiet) {
							logger.success(`${res.name}: No changes`)
						}
					}
				}
			} catch (error) {
				handleError(error, { json: options.json })
			}
		})
}

/**
 * Find canonical IDs that match the given component reference.
 * Supports both canonical IDs and qualified names (namespace/component).
 */
function findMatchingCanonicalIds(
	receipt: import("../schemas/config").Receipt,
	componentRef: string,
): string[] {
	// Try as canonical ID first
	if (receipt.installed[componentRef]) {
		return [componentRef]
	}

	// Try as qualified name (namespace/component)
	if (componentRef.includes("/")) {
		const [namespace, name] = componentRef.split("/")
		return Object.keys(receipt.installed).filter((canonicalId) => {
			try {
				const parsed = parseCanonicalId(canonicalId)
				return parsed.namespace === namespace && parsed.name === name
			} catch {
				return false
			}
		})
	}

	// Bare name - not supported for diff
	return []
}
