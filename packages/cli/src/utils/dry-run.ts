/**
 * Shared dry-run utilities for consistent --dry-run output across commands
 */

import { highlight, logger } from "./logger"

/** Individual action that would be performed */
export interface DryRunAction {
	action: "add" | "remove" | "update" | "create" | "delete" | "modify"
	target: string // e.g., "shadcn/button", "registry:kit", "file:button.tsx"
	details?: Record<string, unknown>
}

/** Validation result - REQUIRED, not optional */
export interface DryRunValidation {
	passed: boolean
	errors?: string[] // Fatal issues that would cause failure
	warnings?: string[] // Non-fatal issues (e.g., modified files without --force)
}

/** Base result that all commands return */
export interface DryRunResult {
	dryRun: true
	command: string
	wouldPerform: DryRunAction[]
	validation: DryRunValidation // Required, not optional
	summary?: string
}

/** Output options */
export interface DryRunOutputOptions {
	json?: boolean
	quiet?: boolean
	hints?: string[] // Command-specific hints to show after output
}

/**
 * Output dry-run results with consistent formatting
 * @param result - The dry-run result to display
 * @param options - Output options (json, quiet, hints)
 */
export function outputDryRun(result: DryRunResult, options: DryRunOutputOptions = {}): void {
	// Guard: JSON output takes priority
	if (options.json) {
		console.log(JSON.stringify(result, null, 2))
		return
	}

	// Guard: Quiet mode suppresses all output
	if (options.quiet) {
		return
	}

	// Format text output
	logger.info(highlight.dim("🔍 DRY RUN: No changes will be made"))
	logger.break()

	// Show what would be performed
	const actionCount = result.wouldPerform.length
	if (actionCount === 0) {
		logger.info("No actions would be performed.")
	} else {
		// Group actions by type for cleaner output
		const grouped = groupActionsByType(result.wouldPerform)

		for (const [actionType, actions] of Object.entries(grouped)) {
			const verb = getActionVerb(actionType)
			logger.info(`Would ${verb} ${actions.length} item(s):`)

			for (const action of actions) {
				const detailsText = formatDetails(action.details)
				logger.info(`  • ${highlight.component(action.target)}${detailsText}`)
			}

			logger.break()
		}
	}

	// Show summary if provided
	if (result.summary) {
		logger.info(result.summary)
		logger.break()
	}

	// Show validation errors
	if (result.validation.errors && result.validation.errors.length > 0) {
		logger.error("Would fail with errors:")
		for (const error of result.validation.errors) {
			logger.error(`  • ${error}`)
		}
		logger.break()
	}

	// Show validation warnings
	if (result.validation.warnings && result.validation.warnings.length > 0) {
		logger.warn("Warnings:")
		for (const warning of result.validation.warnings) {
			logger.warn(`  • ${warning}`)
		}
		logger.break()
	}

	// Show command-specific hints
	if (options.hints && options.hints.length > 0) {
		for (const hint of options.hints) {
			logger.info(highlight.dim(hint))
		}
		logger.break()
	}

	// Final instruction
	logger.info(highlight.dim("Run without --dry-run to apply changes."))
}

/**
 * Group actions by their type for organized output
 */
function groupActionsByType(actions: DryRunAction[]): Record<string, DryRunAction[]> {
	const grouped: Record<string, DryRunAction[]> = {}

	for (const action of actions) {
		if (!grouped[action.action]) {
			grouped[action.action] = []
		}
		grouped[action.action]?.push(action)
	}

	return grouped
}

/**
 * Convert action type to human-readable verb
 */
function getActionVerb(actionType: string): string {
	const verbs: Record<string, string> = {
		add: "add",
		remove: "remove",
		delete: "delete",
		update: "update",
		create: "create",
		modify: "modify",
	}

	return verbs[actionType] ?? actionType
}

/**
 * Format action details into readable text
 */
function formatDetails(details?: Record<string, unknown>): string {
	if (!details || Object.keys(details).length === 0) {
		return ""
	}

	const pairs: string[] = []
	for (const [key, value] of Object.entries(details ?? {})) {
		if (value !== undefined && value !== null) {
			pairs.push(`${key}: ${highlight.dim(String(value))}`)
		}
	}

	return pairs.length > 0 ? ` (${pairs.join(", ")})` : ""
}
