/**
 * Registry Validation Library
 *
 * Pure validation functions for registry source validation.
 * Shared by both validate command and build command.
 */

import { join } from "node:path"
import type { Registry } from "../schemas/registry"
import { normalizeFile, registrySchema } from "../schemas/registry"

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

/**
 * Validate that all source files referenced in the registry exist.
 *
 * @param registry - The validated registry object
 * @param sourcePath - Path to the registry source directory
 * @returns Validation result with file existence errors
 */
export async function validateSourceFiles(
	registry: Registry,
	sourcePath: string,
): Promise<ValidationResult> {
	const errors: string[] = []

	for (const component of registry.components) {
		for (const rawFile of component.files) {
			const file = normalizeFile(rawFile, component.type)
			const sourceFilePath = join(sourcePath, "files", file.path)

			if (!(await Bun.file(sourceFilePath).exists())) {
				errors.push(`${component.name}: Source file not found at ${file.path}`)
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	}
}
