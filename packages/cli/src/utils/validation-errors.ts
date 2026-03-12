/**
 * Validation Error Utilities
 *
 * Shared utilities for categorizing and displaying validation errors.
 */

export interface CategorizedErrors {
	file: string[]
	circular: string[]
	duplicate: string[]
}

/**
 * Categorize validation errors by type.
 *
 * @param errors - Array of validation error messages
 * @returns Object with categorized errors
 */
export function categorizeValidationErrors(errors: string[]): CategorizedErrors {
	return {
		file: errors.filter((e) => e.includes("Source file not found")),
		circular: errors.filter((e) => e.includes("Circular dependency")),
		duplicate: errors.filter((e) => e.includes("Duplicate target")),
	}
}
