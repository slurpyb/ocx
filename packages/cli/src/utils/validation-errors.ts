/**
 * Validation Error Utilities
 *
 * Shared utilities for categorizing and displaying validation errors.
 */

export interface StructuredValidationIssueLike {
	kind?: string
	code?: string
	severity?: "error" | "warning"
	rendered?: string
}

export interface CategorizedErrors {
	file: string[]
	circular: string[]
	duplicate: string[]
	pluginLoadability: string[]
}

export interface ValidationErrorSummary {
	valid: boolean
	totalErrors: number
	schemaErrors: number
	sourceFileErrors: number
	circularDependencyErrors: number
	duplicateTargetErrors: number
	pluginLoadabilityErrors: number
	otherErrors: number
}

/**
 * Categorize validation errors by type.
 */
export function categorizeValidationErrors(errors: string[]): CategorizedErrors {
	return {
		file: errors.filter((error) => error.includes("Source file not found")),
		circular: errors.filter((error) => error.includes("Circular dependency")),
		duplicate: errors.filter((error) => error.includes("Duplicate target")),
		pluginLoadability: errors.filter((error) => error.includes("Plugin loadability")),
	}
}

/**
 * Display categorized validation errors with headings.
 */
export function displayCategorizedErrors(
	categorized: CategorizedErrors,
	logFn: (msg: string) => void = console.log,
): void {
	const pluginErrors = categorized.pluginLoadability ?? []

	if (categorized.file.length > 0) {
		logFn("✗ Source files")
		for (const error of categorized.file) {
			logFn(`  ${error}`)
		}
	}

	if (categorized.circular.length > 0) {
		logFn("✗ Circular dependencies")
		for (const error of categorized.circular) {
			logFn(`  ${error}`)
		}
	}

	if (categorized.duplicate.length > 0) {
		logFn("✗ Duplicate targets")
		for (const error of categorized.duplicate) {
			logFn(`  ${error}`)
		}
	}

	if (pluginErrors.length > 0) {
		logFn("✗ Plugin loadability")
		for (const error of pluginErrors) {
			logFn(`  ${error}`)
		}
	}
}

/**
 * Build a stable summary object for validation results.
 */
export function summarizeValidationErrors(
	errors: string[],
	options: {
		schemaErrors?: number
		issues?: StructuredValidationIssueLike[]
	} = {},
): ValidationErrorSummary {
	const categorized = categorizeValidationErrors(errors)
	const schemaErrors = options.schemaErrors ?? 0
	const pluginLoadabilityErrors =
		options.issues
			?.filter((issue) => issue.severity !== "warning")
			.filter((issue) => issue.kind === "plugin_loadability" || issue.code?.startsWith("plugin_"))
			.length ?? categorized.pluginLoadability.length
	const totalErrors = errors.length
	const otherErrors = Math.max(
		0,
		totalErrors -
			schemaErrors -
			categorized.file.length -
			categorized.circular.length -
			categorized.duplicate.length -
			pluginLoadabilityErrors,
	)

	return {
		valid: totalErrors === 0,
		totalErrors,
		schemaErrors,
		sourceFileErrors: categorized.file.length,
		circularDependencyErrors: categorized.circular.length,
		duplicateTargetErrors: categorized.duplicate.length,
		pluginLoadabilityErrors,
		otherErrors,
	}
}
