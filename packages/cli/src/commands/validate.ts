/**
 * Validate Command (for Registry Authors)
 *
 * Validates a registry source without building it.
 */

import { resolve } from "node:path"
import type { Command } from "commander"
import kleur from "kleur"
import { BuildRegistryError } from "../lib/build-registry"
import { runCompleteValidation } from "../lib/validation-runner"
import type { LoadRegistryErrorKind, RegistryValidationIssue } from "../lib/validators"
import {
	EXIT_CODES,
	NotFoundError,
	OCXError,
	ValidationFailedError,
	type ValidationFailureDetails,
} from "../utils/errors"
import { handleError } from "../utils/handle-error"
import { outputJson } from "../utils/json-output"
import { logger } from "../utils/logger"
import { summarizeValidationErrors } from "../utils/validation-errors"

interface ValidateOptions {
	cwd: string
	json: boolean
	quiet: boolean
	duplicateTargets: boolean
}

function createLoadValidationError(message: string, errorKind?: LoadRegistryErrorKind): Error {
	if (errorKind === "not_found") {
		return new NotFoundError(message)
	}

	if (errorKind === "parse_error") {
		return new OCXError(message, "CONFIG_ERROR", EXIT_CODES.CONFIG)
	}

	return new OCXError(message, "CONFIG_ERROR", EXIT_CODES.CONFIG)
}

function createValidationFailureError(
	errors: string[],
	warnings: string[],
	issues: RegistryValidationIssue[],
	failureType: "schema" | "rules",
): ValidationFailedError {
	const summary = summarizeValidationErrors(errors, {
		schemaErrors: failureType === "schema" ? errors.length : 0,
		issues,
	})

	const details: ValidationFailureDetails = {
		valid: false,
		errors,
		warnings,
		issues,
		summary: {
			valid: false,
			totalErrors: summary.totalErrors,
			schemaErrors: summary.schemaErrors,
			sourceFileErrors: summary.sourceFileErrors,
			circularDependencyErrors: summary.circularDependencyErrors,
			duplicateTargetErrors: summary.duplicateTargetErrors,
			pluginLoadabilityErrors: summary.pluginLoadabilityErrors,
			otherErrors: summary.otherErrors,
		},
	}

	return new ValidationFailedError(details)
}

function outputValidationErrors(errors: string[]): void {
	for (const error of errors) {
		console.log(kleur.red(`  ${error}`))
	}
}

function outputValidationWarnings(warnings: string[]): void {
	for (const warning of warnings) {
		console.log(kleur.yellow(`  ${warning}`))
	}
}

export function registerValidateCommand(program: Command): void {
	program
		.command("validate")
		.description("Validate a registry source (for registry authors)")
		.argument("[path]", "Registry source directory", ".")
		.option("--cwd <path>", "Working directory", process.cwd())
		.option("--json", "Output as JSON", false)
		.option("-q, --quiet", "Suppress output", false)
		.option("--no-duplicate-targets", "Skip duplicate target validation")
		.action(async (path: string, options: ValidateOptions) => {
			try {
				const sourcePath = resolve(options.cwd, path)

				const validationResult = await runCompleteValidation(sourcePath, {
					skipDuplicateTargets: options.duplicateTargets === false,
				})

				if (!validationResult.success) {
					const [firstError = "Registry validation failed"] = validationResult.errors

					if (validationResult.failureType === "load") {
						const loadError = createLoadValidationError(firstError, validationResult.loadErrorKind)
						if (!options.json && options.quiet) {
							const exitCode =
								loadError instanceof OCXError ? loadError.exitCode : EXIT_CODES.GENERAL
							process.exit(exitCode)
						}
						throw loadError
					}

					if (validationResult.failureType === "operational") {
						throw new BuildRegistryError(firstError, validationResult.errors.slice(1))
					}

					const validationError = createValidationFailureError(
						validationResult.errors,
						validationResult.warnings,
						validationResult.issues,
						validationResult.failureType === "schema" ? "schema" : "rules",
					)

					if (options.json) {
						throw validationError
					}

					if (!options.quiet) {
						logger.error(validationError.message)
						outputValidationErrors(validationResult.errors)
						if (validationResult.warnings.length > 0) {
							logger.warn("Validation warnings:")
							outputValidationWarnings(validationResult.warnings)
						}
					}

					process.exit(validationError.exitCode)
				}

				// All validations passed
				if (!options.quiet && !options.json) {
					logger.success("✓ Registry source is valid")
					if (validationResult.warnings.length > 0) {
						logger.warn("Validation warnings:")
						outputValidationWarnings(validationResult.warnings)
					}
				}

				if (options.json) {
					const summary = summarizeValidationErrors([], {
						issues: validationResult.issues,
					})
					outputJson({
						success: true,
						data: {
							valid: true,
							errors: [],
							warnings: validationResult.warnings,
							issues: validationResult.issues,
							summary,
						},
					})
				}
			} catch (error) {
				if (!options.json && options.quiet) {
					const exitCode = error instanceof OCXError ? error.exitCode : EXIT_CODES.GENERAL
					process.exit(exitCode)
				}

				handleError(error, { json: options.json })
			}
		})
}
