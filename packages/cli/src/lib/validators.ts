/**
 * Registry Validation Library
 *
 * Pure validation functions for registry source validation.
 * Shared by both validate command and build command.
 */

import { registrySchema } from "../schemas/registry"

export interface ValidationResult {
	valid: boolean
	errors: string[]
	warnings?: string[]
}

/**
 * Validate a registry source object against the schema.
 *
 * @param registryData - The parsed registry object
 * @param sourcePath - Path to the registry source (for error messages)
 * @returns Validation result
 */
export function validateRegistrySource(
	registryData: unknown,
	sourcePath: string,
): ValidationResult {
	const parseResult = registrySchema.safeParse(registryData)

	if (!parseResult.success) {
		const errors = parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
		return {
			valid: false,
			errors,
		}
	}

	return {
		valid: true,
		errors: [],
	}
}
