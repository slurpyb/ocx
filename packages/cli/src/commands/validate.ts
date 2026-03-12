/**
 * Validate Command (for Registry Authors)
 *
 * Validates a registry source without building it.
 */

import { resolve } from "node:path"
import type { Command } from "commander"
import kleur from "kleur"
import {
	loadRegistrySource,
	validateRegistrySchema,
	validateRegistryWithOptions,
} from "../lib/validators"
import { handleError, logger } from "../utils/index"

interface ValidateOptions {
	cwd: string
	json: boolean
	quiet: boolean
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
		.option("--no-duplicate-targets", "Skip duplicate target validation")
		.action(async (path: string, options: ValidateOptions) => {
			try {
				const sourcePath = resolve(options.cwd, path)
				const errors: string[] = []

				// Load registry file
				const loadResult = await loadRegistrySource(sourcePath)
				if (!loadResult.success) {
					errors.push(loadResult.error || "Failed to load registry")

					// Output based on mode
					if (options.json) {
						console.log(JSON.stringify({ valid: false, errors }, null, 2))
					} else if (!options.quiet) {
						logger.error(loadResult.error || "Failed to load registry")
					}
					process.exit(1)
				}

				// Validate schema (compatibility + structure)
				const schemaResult = validateRegistrySchema(loadResult.data, sourcePath)
				if (!schemaResult.valid) {
					errors.push(...schemaResult.errors)

					// Output based on mode
					if (options.json) {
						console.log(JSON.stringify({ valid: false, errors }, null, 2))
					} else if (!options.quiet) {
						logger.error("Registry validation failed")
						for (const error of schemaResult.errors) {
							console.log(kleur.red(`  ${error}`))
						}
					}
					process.exit(1)
				}

				// Use the parsed and validated registry data
				const registry = schemaResult.data!

				// Run all validators using the generator
				for await (const error of validateRegistryWithOptions(registry, sourcePath, {
					skipDuplicateTargets: options.duplicateTargets === false,
				})) {
					errors.push(error)
				}

				// Report any validation errors
				if (errors.length > 0) {
					// Output based on mode
					if (options.json) {
						console.log(JSON.stringify({ valid: false, errors }, null, 2))
					} else if (!options.quiet) {
						logger.error("Registry validation failed")
						for (const error of errors) {
							console.log(kleur.red(`  ${error}`))
						}
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
