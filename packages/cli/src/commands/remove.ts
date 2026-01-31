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
import { NotFoundError, ValidationError } from "../utils/errors"
import { createSpinner, handleError, logger } from "../utils/index"
import { checkFileIntegrity, parseCanonicalId } from "../utils/receipt"

export interface RemoveOptions {
	cwd?: string
	quiet?: boolean
	verbose?: boolean
	json?: boolean
	force?: boolean
}

export function registerRemoveCommand(program: Command): void {
	program
		.command("remove")
		.description("Remove installed components")
		.argument("<components...>", "Canonical component IDs to remove")
		.option("--cwd <path>", "Working directory", process.cwd())
		.option("-f, --force", "Force removal even if files have been modified")
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

	try {
		for (const canonicalId of canonicalIds) {
			// Guard: Component must exist in receipt
			const entry = receipt.installed[canonicalId]
			if (!entry) {
				notFound.push(canonicalId)
				continue
			}

			// Check file integrity before removal
			const integrity = await checkFileIntegrity(provider.cwd, entry)
			if (!integrity.intact && !options.force) {
				spin?.fail("File integrity check failed")
				throw new ValidationError(
					`Component '${canonicalId}' has been modified. Use --force to remove anyway.\n` +
						`Modified files:\n${integrity.modified.map((f) => `  - ${f}`).join("\n")}`,
				)
			}

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
