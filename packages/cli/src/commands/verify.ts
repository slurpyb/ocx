/**
 * OCX CLI - verify command
 * Verify file integrity of installed components
 */

import type { Command } from "commander"
import { LocalConfigProvider } from "../config/provider"
import { type Receipt, readReceipt } from "../schemas/config"
import { parseQualifiedComponent } from "../schemas/registry"
import { ConflictError, EXIT_CODES, NotFoundError, ValidationError } from "../utils/errors"
import { createSpinner, handleError, logger } from "../utils/index"
import { checkFileIntegrity, parseCanonicalId } from "../utils/receipt"
import { addCommonOptions, addVerboseOption } from "../utils/shared-options"

export interface VerifyOptions {
	cwd?: string
	quiet?: boolean
	verbose?: boolean
	json?: boolean
}

export function registerVerifyCommand(program: Command): void {
	const cmd = program
		.command("verify")
		.description("Verify integrity of installed components")
		.argument("[components...]", "Components to verify (optional, verifies all if omitted)")

	addCommonOptions(cmd)
	addVerboseOption(cmd)

	cmd.action(async (components: string[], options: VerifyOptions) => {
		try {
			await runVerify(components, options)
		} catch (error) {
			handleError(error, { json: options.json })
		}
	})
}

// =============================================================================
// SHORTHAND RESOLUTION (Law 2: Parse at boundary)
// =============================================================================

/**
 * Resolve a user-provided component ref to its canonical receipt ID.
 * Supports both canonical IDs (direct lookup) and shorthand refs (namespace/name).
 *
 * @param ref - User-provided component reference (e.g., "kdco/researcher" or full canonical ID)
 * @param receipt - Receipt to search
 * @returns Canonical ID from the receipt
 * @throws NotFoundError if component is not installed
 * @throws ValidationError if multiple matches found (ambiguous shorthand)
 */
function resolveComponentRef(ref: string, receipt: Receipt): string {
	const installedKeys = Object.keys(receipt.installed)

	// Fast path: direct canonical ID match
	if (receipt.installed[ref]) {
		return ref
	}

	// Shorthand path: resolve "registryName/name" against receipt entries
	if (ref.includes("/") && !ref.includes("::")) {
		const { namespace: prefix, component } = parseQualifiedComponent(ref)
		const matchingIds = installedKeys.filter((id) => {
			const parsed = parseCanonicalId(id)
			return parsed.registryName === prefix && parsed.name === component
		})

		if (matchingIds.length === 1) {
			return matchingIds[0] as string
		}

		if (matchingIds.length > 1) {
			throw new ValidationError(
				`Ambiguous component '${ref}'. Found ${matchingIds.length} matches:\n` +
					matchingIds.map((id) => `  - ${id}`).join("\n") +
					"\n\nPlease use the full canonical ID.",
			)
		}
	}

	// No match found
	throw new NotFoundError(`Component '${ref}' is not installed.`)
}

async function runVerify(componentNames: string[], options: VerifyOptions): Promise<void> {
	const cwd = options.cwd ?? process.cwd()
	const provider = await LocalConfigProvider.requireInitialized(cwd)

	// V1: Read receipt
	const receipt = await readReceipt(provider.cwd)
	if (!receipt || Object.keys(receipt.installed).length === 0) {
		if (options.json) {
			console.log(JSON.stringify({ success: true, verified: [], errors: [] }, null, 2))
		} else if (!options.quiet) {
			logger.info("No components installed.")
		}
		return
	}

	// Determine which components to verify
	// Resolve shorthand refs (e.g., "kdco/researcher") to canonical receipt IDs
	let toVerify: string[]
	if (componentNames.length > 0) {
		toVerify = componentNames.map((name) => resolveComponentRef(name, receipt))
	} else {
		toVerify = Object.keys(receipt.installed)
	}

	const spin =
		options.quiet || options.json ? null : createSpinner({ text: "Verifying components..." })
	spin?.start()

	const results: Array<{
		canonicalId: string
		intact: boolean
		modified: string[]
		missing: string[]
	}> = []

	let hasIssues = false

	for (const canonicalId of toVerify) {
		const entry = receipt.installed[canonicalId]
		if (!entry) {
			// Should not reach here after resolution, but guard defensively
			if (componentNames.length > 0) {
				logger.warn(`Component '${canonicalId}' not found in receipt.`)
			}
			continue
		}

		const integrity = await checkFileIntegrity(provider.cwd, entry)

		if (!integrity.intact) {
			hasIssues = true
		}

		results.push({
			canonicalId,
			intact: integrity.intact,
			modified: integrity.modified,
			missing: integrity.missing,
		})
	}

	spin?.succeed(`Verified ${results.length} component(s)`)

	// Output results
	if (options.json) {
		console.log(
			JSON.stringify(
				{
					success: !hasIssues,
					verified: results.filter((r) => r.intact),
					errors: results.filter((r) => !r.intact),
				},
				null,
				2,
			),
		)
		// Exit with non-zero if there are issues (consistent with non-JSON mode)
		if (hasIssues) {
			process.exit(EXIT_CODES.CONFLICT)
		}
	} else if (!options.quiet) {
		logger.info("")
		for (const result of results) {
			if (result.intact) {
				if (options.verbose) {
					logger.success(`✓ ${result.canonicalId} - all files intact`)
				}
			} else {
				logger.error(`✗ ${result.canonicalId} - integrity check failed`)
				for (const path of result.modified) {
					logger.error(`    Modified: ${path}`)
				}
				for (const path of result.missing) {
					logger.error(`    Missing:  ${path}`)
				}
			}
		}

		if (hasIssues) {
			logger.info("")
			logger.warn(
				"Some files have been modified or are missing. " +
					"Review local changes with git, or use 'ocx update --force' to restore.",
			)
			throw new ConflictError("File integrity check failed for one or more components.")
		} else {
			logger.info("")
			logger.success("All components verified successfully.")
		}
	}
}
