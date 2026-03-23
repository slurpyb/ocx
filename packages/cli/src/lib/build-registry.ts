/**
 * Build Registry Library Function
 *
 * Pure function to build a registry from source.
 * No CLI concerns - just input/output.
 */

import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Registry } from "../schemas/registry"
import { normalizeFile } from "../schemas/registry"
import type { DryRunResult } from "../utils/dry-run"
import {
	ValidationFailedError,
	type ValidationFailureDetails,
	type ValidationFailureSummary,
} from "../utils/errors"
import { summarizeValidationErrors } from "../utils/validation-errors"
import { runCompleteValidation } from "./validation-runner"

export interface BuildRegistryOptions {
	/** Source directory containing registry.jsonc (or registry.json) and files/ */
	source: string
	/** Output directory for built registry */
	out: string
	/** Dry-run mode: validate and show what would be built */
	dryRun?: boolean
}

export interface BuildRegistryResult {
	/** Number of components built */
	componentsCount: number
	/** Absolute path to output directory */
	outputPath: string
}

export class BuildRegistryError extends Error {
	constructor(
		message: string,
		public readonly errors: string[] = [],
	) {
		super(message)
		this.name = "BuildRegistryError"
	}
}

function createValidationSummary(
	errors: string[],
	issues: ValidationFailureDetails["issues"] = [],
	schemaErrors = 0,
): ValidationFailureSummary {
	const summary = summarizeValidationErrors(errors, {
		schemaErrors,
		issues: issues ?? [],
	})

	return {
		valid: false,
		totalErrors: summary.totalErrors,
		schemaErrors: summary.schemaErrors,
		sourceFileErrors: summary.sourceFileErrors,
		circularDependencyErrors: summary.circularDependencyErrors,
		duplicateTargetErrors: summary.duplicateTargetErrors,
		pluginLoadabilityErrors: summary.pluginLoadabilityErrors,
		otherErrors: summary.otherErrors,
	}
}

function toValidationFailureDetails(input: {
	errors: string[]
	warnings: string[]
	issues: ValidationFailureDetails["issues"]
	schemaErrors?: number
}): ValidationFailureDetails {
	return {
		valid: false,
		errors: input.errors,
		warnings: input.warnings,
		issues: input.issues,
		summary: createValidationSummary(input.errors, input.issues, input.schemaErrors ?? 0),
	}
}

function createDryRunActions(registry: Registry, sourcePath: string): DryRunResult["wouldPerform"] {
	const actions: DryRunResult["wouldPerform"] = []

	for (const component of registry.components) {
		actions.push({
			action: "create",
			target: `file:components/${component.name}.json`,
			details: { type: "packument" },
		})

		for (const rawFile of component.files) {
			const file = normalizeFile(rawFile, component.type)
			actions.push({
				action: "create",
				target: `file:components/${component.name}/${file.path}`,
				details: { source: join(sourcePath, "files", file.path) },
			})
		}
	}

	actions.push({
		action: "create",
		target: "file:index.json",
		details: { type: "registry index" },
	})

	actions.push({
		action: "create",
		target: "file:.well-known/ocx.json",
		details: { type: "discovery file" },
	})

	return actions
}

function createBuildValidationDryRunResult(input: {
	sourcePath: string
	outPath: string
	registry: Registry
	validationPassed: boolean
	validationErrors: string[]
	validationWarnings: string[]
	validationIssues: ValidationFailureDetails["issues"]
}): DryRunResult {
	const actions = createDryRunActions(input.registry, input.sourcePath)
	const totalFiles = actions.filter((action) => action.action === "create").length

	return {
		dryRun: true,
		command: "build",
		wouldPerform: actions,
		validation: {
			passed: input.validationPassed,
			...(input.validationErrors.length > 0 ? { errors: input.validationErrors } : {}),
			...(input.validationWarnings.length > 0 ? { warnings: input.validationWarnings } : {}),
			issues: input.validationIssues,
		},
		summary: `Would build ${input.registry.components.length} components, ${totalFiles} files to ${input.outPath}`,
	}
}

/**
 * Build a registry from source.
 */
export async function buildRegistry(
	options: BuildRegistryOptions,
): Promise<BuildRegistryResult | DryRunResult> {
	const { source: sourcePath, out: outPath } = options

	const validationResult = await runCompleteValidation(sourcePath, {
		skipDuplicateTargets: false,
	})

	if (!validationResult.success) {
		if (validationResult.failureType === "rules") {
			const details = toValidationFailureDetails({
				errors: validationResult.errors,
				warnings: validationResult.warnings,
				issues: validationResult.issues,
			})

			if (options.dryRun && validationResult.registry) {
				return createBuildValidationDryRunResult({
					sourcePath,
					outPath,
					registry: validationResult.registry,
					validationPassed: false,
					validationErrors: validationResult.errors,
					validationWarnings: validationResult.warnings,
					validationIssues: validationResult.issues,
				})
			}

			throw new ValidationFailedError(details)
		}

		const [firstError = "Registry build preflight failed", ...remainingErrors] =
			validationResult.errors
		throw new BuildRegistryError(firstError, remainingErrors)
	}

	const registry = validationResult.registry
	if (!registry) {
		throw new BuildRegistryError("Registry validation succeeded but returned no parsed registry")
	}

	if (options.dryRun) {
		return createBuildValidationDryRunResult({
			sourcePath,
			outPath,
			registry,
			validationPassed: true,
			validationErrors: [],
			validationWarnings: validationResult.warnings,
			validationIssues: validationResult.issues,
		})
	}

	const componentsDir = join(outPath, "components")
	await mkdir(componentsDir, { recursive: true })

	const copyErrors: string[] = []
	const DEFAULT_COMPONENT_VERSION = "1.0.0"

	for (const component of registry.components) {
		const packument = {
			name: component.name,
			versions: {
				[DEFAULT_COMPONENT_VERSION]: component,
			},
			"dist-tags": {
				latest: DEFAULT_COMPONENT_VERSION,
			},
		}

		const packumentPath = join(componentsDir, `${component.name}.json`)
		await Bun.write(packumentPath, JSON.stringify(packument, null, 2))

		for (const rawFile of component.files) {
			const file = normalizeFile(rawFile, component.type)
			const sourceFilePath = join(sourcePath, "files", file.path)
			const destinationPath = join(componentsDir, component.name, file.path)
			const destinationDirectory = dirname(destinationPath)

			if (!(await Bun.file(sourceFilePath).exists())) {
				copyErrors.push(`${component.name}: Source file not found at ${sourceFilePath}`)
				continue
			}

			await mkdir(destinationDirectory, { recursive: true })
			await Bun.write(destinationPath, Bun.file(sourceFilePath))
		}
	}

	if (copyErrors.length > 0) {
		throw new BuildRegistryError(`Build failed with ${copyErrors.length} errors`, copyErrors)
	}

	const index = {
		$schema: registry.$schema,
		name: registry.name,
		version: registry.version,
		author: registry.author,
		...(registry.opencode ? { opencode: registry.opencode } : {}),
		...(registry.ocx ? { ocx: registry.ocx } : {}),
		components: registry.components.map((component) => ({
			name: component.name,
			type: component.type,
			description: component.description,
		})),
	}

	await Bun.write(join(outPath, "index.json"), JSON.stringify(index, null, 2))

	const wellKnownDirectory = join(outPath, ".well-known")
	await mkdir(wellKnownDirectory, { recursive: true })
	await Bun.write(
		join(wellKnownDirectory, "ocx.json"),
		JSON.stringify({ registry: "/index.json" }, null, 2),
	)

	return {
		componentsCount: registry.components.length,
		outputPath: outPath,
	}
}
