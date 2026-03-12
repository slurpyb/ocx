/**
 * Build Command (for Registry Authors)
 *
 * CLI wrapper around the buildRegistry library function.
 */

import { relative, resolve } from "node:path"
import type { Command } from "commander"
import kleur from "kleur"
import { BuildRegistryError, type BuildRegistryResult, buildRegistry } from "../lib/build-registry"
import { runCompleteValidation } from "../lib/validation-runner"
import { outputDryRun } from "../utils/dry-run"
import {
	categorizeValidationErrors,
	createSpinner,
	displayCategorizedErrors,
	handleError,
	logger,
	outputJson,
} from "../utils/index"

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

					const validationResult = await runCompleteValidation(sourcePath, {
						skipDuplicateTargets: false,
					})

					if (!validationResult.success) {
						// Categorize and display errors
						const categorized = categorizeValidationErrors(validationResult.errors)
						displayCategorizedErrors(categorized, (msg) => {
							if (msg.startsWith("✗")) {
								logger.error(msg)
							} else {
								console.log(kleur.red(msg))
							}
						})

						process.exit(1)
					}

					// All validations passed - show success messages
					logger.success("✓ Schema compatibility and structure")
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
