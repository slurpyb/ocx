/**
 * OCX CLI - remove command
 * Remove installed components
 */

import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"

import type { Command } from "commander"
import { LocalConfigProvider } from "../config/provider"
import { readReceipt, writeReceipt } from "../schemas/config"
import { type DryRunResult, outputDryRun } from "../utils/dry-run"
import { NotFoundError, ValidationError } from "../utils/errors"
import { createSpinner, handleError, logger } from "../utils/index"
import { checkFileIntegrity, parseCanonicalId } from "../utils/receipt"

export interface RemoveOptions {
	cwd?: string
	quiet?: boolean
	verbose?: boolean
	json?: boolean
	force?: boolean
	dryRun?: boolean
}

export function registerRemoveCommand(program: Command): void {
	program
		.command("remove")
		.description("Remove installed components")
		.argument("<components...>", "Canonical component IDs to remove")
		.option("--cwd <path>", "Working directory", process.cwd())
		.option("-f, --force", "Force removal even if files have been modified")
		.option("--dry-run", "Show what would be removed without making changes")
		.option("-q, --quiet", "Suppress output")
		.option("-v, --verbose", "Verbose output")
		.option("--json", "Output as JSON")
		.action(async (components: string[], options: RemoveOptions) => {
			try {
				await runRemove(components, options)
			} catch (error) {
				handleError(error, { json: options.json })
			}
		})
}

async function runRemove(canonicalIds: string[], options: RemoveOptions): Promise<void> {
	const cwd = options.cwd ?? process.cwd()
	const provider = await LocalConfigProvider.requireInitialized(cwd)

	// Guard: No components specified
	if (canonicalIds.length === 0) {
		throw new ValidationError("No components specified. Specify at least one component ID.")
	}

	// V2: Read receipt
	const receipt = await readReceipt(provider.cwd)
	if (!receipt || Object.keys(receipt.installed).length === 0) {
		throw new NotFoundError("No components installed.")
	}

	const spin = options.quiet ? null : createSpinner({ text: "Removing components..." })
	spin?.start()

	const removed: string[] = []
	const notFound: string[] = []
	const toRemove: Array<{ canonicalId: string; files: string[] }> = []
	const warnings: string[] = []
	let hasIntegrityIssues = false

	try {
		// First pass: validate all components and check integrity
		for (const canonicalId of canonicalIds) {
			// Guard: Component must exist in receipt
			const entry = receipt.installed[canonicalId]
			if (!entry) {
				notFound.push(canonicalId)
				continue
			}

			// Check file integrity before removal
			const integrity = await checkFileIntegrity(provider.cwd, entry)
			if (!integrity.intact) {
				hasIntegrityIssues = true
				const modifiedFiles = integrity.modified.map((f) => `  - ${f}`).join("\n")

				if (options.force) {
					warnings.push(
						`Component '${canonicalId}' has been modified but will be force-removed:\n${modifiedFiles}`,
					)
				} else {
					warnings.push(
						`Component '${canonicalId}' has been modified. Use --force to remove anyway:\n${modifiedFiles}`,
					)
				}
			}

			// Collect files to remove
			const filePaths = entry.files.map((f) => f.path)
			toRemove.push({ canonicalId, files: filePaths })
		}

		// Handle dry-run mode
		if (options.dryRun) {
			spin?.stop()

			const dryRunResult: DryRunResult = {
				dryRun: true,
				command: "remove",
				wouldPerform: toRemove.flatMap(({ canonicalId, files }) =>
					files.map((filePath) => ({
						action: "delete" as const,
						target: filePath,
						details: { component: canonicalId },
					})),
				),
				validation: {
					passed: !hasIntegrityIssues || Boolean(options.force),
					warnings:
						warnings.length > 0
							? warnings
							: notFound.length > 0
								? [`Components not found: ${notFound.join(", ")}`]
								: undefined,
				},
				summary: `${toRemove.length} component(s), ${toRemove.reduce((sum, item) => sum + item.files.length, 0)} file(s) would be removed`,
			}

			outputDryRun(dryRunResult, {
				json: options.json,
				quiet: options.quiet,
				hints:
					hasIntegrityIssues && !options.force
						? ["Add --force to remove modified files"]
						: undefined,
			})

			return
		}

		// Actual removal: fail fast if integrity issues and not forced
		if (hasIntegrityIssues && !options.force) {
			spin?.fail("File integrity check failed")

			const firstIssue = toRemove.find((item) => {
				const entry = receipt.installed[item.canonicalId]
				return entry && !checkFileIntegrity(provider.cwd, entry)
			})

			if (firstIssue) {
				const entry = receipt.installed[firstIssue.canonicalId]
				if (!entry) {
					throw new ValidationError(`Component '${firstIssue.canonicalId}' not found in receipt`)
				}

				const integrity = await checkFileIntegrity(provider.cwd, entry)
				throw new ValidationError(
					`Component '${firstIssue.canonicalId}' has been modified. Use --force to remove anyway.\n` +
						`Modified files:\n${integrity.modified.map((f) => `  - ${f}`).join("\n")}`,
				)
			}
		}

		// Second pass: actually remove files
		for (const { canonicalId } of toRemove) {
			const entry = receipt.installed[canonicalId]
			if (!entry) continue

			// Remove files
			for (const fileEntry of entry.files) {
				const filePath = join(provider.cwd, fileEntry.path)
				if (existsSync(filePath)) {
					await rm(filePath, { force: true })
					if (options.verbose) {
						logger.info(`  ✓ Removed ${fileEntry.path}`)
					}
				}
			}

			// Remove from receipt
			delete receipt.installed[canonicalId]
			removed.push(canonicalId)
		}

		spin?.succeed(`Removed ${removed.length} component(s)`)

		// Save receipt
		await writeReceipt(provider.cwd, receipt)

		// Output results
		if (options.json) {
			console.log(JSON.stringify({ success: true, removed, notFound }, null, 2))
		} else if (!options.quiet) {
			logger.info("")
			for (const id of removed) {
				const parsed = parseCanonicalId(id)
				logger.success(`✓ Removed ${parsed.namespace}/${parsed.name}@${parsed.revision}`)
			}

			if (notFound.length > 0) {
				logger.info("")
				logger.warn("Not found:")
				for (const id of notFound) {
					logger.warn(`  - ${id}`)
				}
			}

			logger.info("")
			logger.success(`Done! Removed ${removed.length} component(s).`)
		}
	} catch (error) {
		spin?.fail("Failed to remove components")
		throw error
	}
}
