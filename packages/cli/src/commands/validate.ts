/**
 * Validate Command (for Registry Authors)
 *
 * Validates a registry source without building it.
 */

import { resolve } from "node:path"
import type { Command } from "commander"
import kleur from "kleur"
import { runCompleteValidation } from "../lib/validation-runner"
import {
	categorizeValidationErrors,
	displayCategorizedErrors,
	handleError,
	logger,
} from "../utils/index"

interface ValidateOptions {
	cwd: string
	json: boolean
	quiet: boolean
	strict: boolean
	duplicateTargets: boolean
}

export function registerValidateCommand(program: Command): void {
	program
		.command("validate")
		.description("Validate a registry source (for registry authors)")
		.argument("[path]", "Registry source directory", ".")
		.option("--cwd <path>", "Working directory", process.cwd())
		.option("--json", "Output as JSON", false)
		.option("-q, --quiet", "Suppress output", false)
		.option("--strict", "Exit with code 1 on validation failure (for CI/CD)", false)
		.option("--no-duplicate-targets", "Skip duplicate target validation")
		.action(async (path: string, options: ValidateOptions) => {
			try {
				const sourcePath = resolve(options.cwd, path)

				const validationResult = await runCompleteValidation(sourcePath, {
					skipDuplicateTargets: options.duplicateTargets === false,
				})

				// Report any validation errors
				if (!validationResult.success) {
					if (!options.json) {
						logger.error("Registry validation failed")
						const categorized = categorizeValidationErrors(validationResult.errors)
						displayCategorizedErrors(categorized, (msg) => {
							if (!msg.startsWith("✗")) {
								console.log(kleur.red(msg))
							}
						})
					}
					process.exit(1)
				}

				// All validations passed
				if (!options.quiet && !options.json) {
					logger.success("✓ Registry source is valid")
				}

				if (options.json) {
					console.log(JSON.stringify({ valid: true }, null, 2))
				}
			} catch (error) {
				handleError(error, { json: options.json })
			}
		})
}
