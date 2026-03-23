/**
 * Validation Runner
 *
 * Shared validation workflow for both build and validate commands.
 */

import type { Registry } from "../schemas/registry"
import {
	type LoadRegistryErrorKind,
	loadRegistrySource,
	PluginLoadabilityOperationalError,
	type RegistryValidationIssue,
	type ValidateRegistryOptions,
	validateRegistryRules,
	validateRegistrySchema,
} from "./validators"

export type ValidationFailureType = "load" | "schema" | "rules" | "operational"

export interface CompleteValidationResult {
	success: boolean
	errors: string[]
	warnings: string[]
	issues: RegistryValidationIssue[]
	registry?: Registry
	failureType?: ValidationFailureType
	loadErrorKind?: LoadRegistryErrorKind
}

/**
 * Run complete validation workflow: load, validate schema, and run all validators.
 */
export async function runCompleteValidation(
	sourcePath: string,
	options: ValidateRegistryOptions = {},
): Promise<CompleteValidationResult> {
	const loadResult = await loadRegistrySource(sourcePath)
	if (!loadResult.success) {
		return {
			success: false,
			errors: [loadResult.error || "Failed to load registry"],
			warnings: [],
			issues: [],
			failureType: "load",
			loadErrorKind: loadResult.errorKind,
		}
	}

	const schemaResult = validateRegistrySchema(loadResult.data, sourcePath)
	if (!schemaResult.valid) {
		return {
			success: false,
			errors: schemaResult.errors,
			warnings: schemaResult.warnings ?? [],
			issues: schemaResult.issues ?? [],
			failureType: "schema",
		}
	}

	const registry = schemaResult.data
	if (!registry) {
		throw new Error("Registry validation succeeded but returned no parsed data")
	}

	try {
		const rulesResult = await validateRegistryRules(registry, sourcePath, options)

		if (!rulesResult.valid) {
			return {
				success: false,
				errors: rulesResult.errors,
				warnings: rulesResult.warnings ?? [],
				issues: rulesResult.issues ?? [],
				registry,
				failureType: "rules",
			}
		}

		return {
			success: true,
			errors: [],
			warnings: rulesResult.warnings ?? [],
			issues: rulesResult.issues ?? [],
			registry,
		}
	} catch (error) {
		if (error instanceof PluginLoadabilityOperationalError) {
			return {
				success: false,
				errors: [error.message, ...error.details],
				warnings: [],
				issues: [],
				failureType: "operational",
			}
		}

		throw error
	}
}
