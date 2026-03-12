/**
 * Build Command (for Registry Authors)
 *
 * CLI wrapper around the buildRegistry library function.
 */

import { relative, resolve } from "node:path"
import type { Command } from "commander"
import { parse as parseJsonc } from "jsonc-parser"
import kleur from "kleur"
import { BuildRegistryError, type BuildRegistryResult, buildRegistry } from "../lib/build-registry"
import { validateRegistrySource, validateRegistryWithOptions } from "../lib/validators"
import { classifyRegistrySchemaIssue } from "../schemas/registry"
import { outputDryRun } from "../utils/dry-run"
import { createSpinner, handleError, logger, outputJson } from "../utils/index"

interface BuildOptions {
	cwd: string
	out: string
	json: boolean
	quiet: boolean
	dryRun?: boolean
	showValidation: boolean
}

export function registerBuildCommand(program: Command): void {
	program
		.command("build")
		.description("Build a registry from source (for registry authors)")
		.argument("[path]", "Registry source directory", ".")
		.option("--out <dir>", "Output directory", "./dist")
		.option("--cwd <path>", "Working directory", process.cwd())
		.option("--json", "Output as JSON", false)
		.option("-q, --quiet", "Suppress output", false)
		.option("--dry-run", "Validate and show what would be built")
		.option("--show-validation", "Display validation results before building", false)
		.action(async (path: string, options: BuildOptions) => {
			try {
				const sourcePath = resolve(options.cwd, path)
				const outPath = resolve(options.cwd, options.out)

				// Show validation results if requested
				if (options.showValidation && !options.json && !options.quiet) {
					logger.info("Running validation checks...")

					// Read registry file
					const jsoncFile = Bun.file(`${sourcePath}/registry.jsonc`)
					const jsonFile = Bun.file(`${sourcePath}/registry.json`)
					const jsoncExists = await jsoncFile.exists()
					const jsonExists = await jsonFile.exists()

					if (!jsoncExists && !jsonExists) {
						logger.error("No registry.jsonc or registry.json found in source directory")
						process.exit(1)
					}

					const registryFile = jsoncExists ? jsoncFile : jsonFile
					const content = await registryFile.text()
					const registryData = parseJsonc(content, [], { allowTrailingComma: true })

					// Check schema compatibility
					const schemaIssue = classifyRegistrySchemaIssue(registryData)
					if (schemaIssue) {
						logger.error(`✗ Schema compatibility: ${schemaIssue.issue}`)
						console.log(kleur.red(`  ${schemaIssue.remediation}`))
						process.exit(1)
					} else {
						logger.success("✓ Schema compatibility")
					}

					// Validate schema
					const schemaResult = validateRegistrySource(registryData, sourcePath)
					if (!schemaResult.valid) {
						logger.error("✗ Registry schema")
						for (const error of schemaResult.errors) {
							console.log(kleur.red(`  ${error}`))
						}
						process.exit(1)
					} else {
						logger.success("✓ Registry schema")
					}

					// Use the parsed and validated registry data
					const registry = schemaResult.data!

					// Collect all validation errors first
					const validationErrors: string[] = []
					for await (const error of validateRegistryWithOptions(registry, sourcePath, {
						skipDuplicateTargets: false,
					})) {
						validationErrors.push(error)
					}

					// If there are errors, report them and exit
					if (validationErrors.length > 0) {
						// Categorize errors for better reporting
						const fileErrors = validationErrors.filter((e) => e.includes("Source file not found"))
						const circularErrors = validationErrors.filter((e) => e.includes("Circular dependency"))
						const duplicateErrors = validationErrors.filter((e) => e.includes("Duplicate target"))

						if (fileErrors.length > 0) {
							logger.error("✗ Source files")
							for (const error of fileErrors) {
								console.log(kleur.red(`  ${error}`))
							}
						}

						if (circularErrors.length > 0) {
							logger.error("✗ Circular dependencies")
							for (const error of circularErrors) {
								console.log(kleur.red(`  ${error}`))
							}
						}

						if (duplicateErrors.length > 0) {
							logger.error("✗ Duplicate targets")
							for (const error of duplicateErrors) {
								console.log(kleur.red(`  ${error}`))
							}
						}

						process.exit(1)
					}

					// All validations passed - show success messages
					logger.success("✓ Source files")
					logger.success("✓ No circular dependencies")
					logger.success("✓ No duplicate targets")

					console.log("") // Empty line before build starts
				}

				const spinner = createSpinner({
					text: "Building registry...",
					quiet: options.quiet || options.json,
				})
				if (!options.json) spinner.start()

				const result = await buildRegistry({
					source: sourcePath,
					out: outPath,
					dryRun: options.dryRun,
				})

				// Handle dry-run result
				if ("dryRun" in result && result.dryRun) {
					if (!options.json) spinner.stop()
					outputDryRun(result, { json: options.json, quiet: options.quiet })
					return
				}

				// Type narrowing: result is now BuildRegistryResult
				const buildResult = result as BuildRegistryResult

				if (!options.json) {
					const msg = `Built ${buildResult.componentsCount} components to ${relative(options.cwd, outPath)}`
					spinner.succeed(msg)
					if (process.env.NODE_ENV === "test" || !process.stdout.isTTY) {
						logger.success(`Built ${buildResult.componentsCount} components`)
					}
				}

				if (options.json) {
					outputJson({
						success: true,
						data: {
							components: buildResult.componentsCount,
							output: buildResult.outputPath,
						},
					})
				}
			} catch (error) {
				if (error instanceof BuildRegistryError) {
					if (!options.json) {
						logger.error(error.message)
						for (const err of error.errors) {
							console.log(kleur.red(`  ${err}`))
						}
					}
					process.exit(1)
				}
				handleError(error, { json: options.json })
			}
		})
}
