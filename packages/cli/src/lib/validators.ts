/**
 * Registry Validation Library
 *
 * Pure validation functions for registry source validation.
 * Shared by both validate command and build command.
 */

import { join, posix } from "node:path"
import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import type { Registry } from "../schemas/registry"
import { classifyRegistrySchemaIssue, normalizeFile, registrySchema } from "../schemas/registry"
import {
	PluginLoadabilityOperationalError,
	runPluginLoadabilityValidation,
} from "./plugin-loadability"

export type ValidationIssueSeverity = "error" | "warning"

export type ValidationIssueKind =
	| "schema"
	| "source_file"
	| "circular_dependency"
	| "duplicate_target"
	| "plugin_loadability"

export interface ValidationIssue {
	kind: ValidationIssueKind
	code: string
	severity: ValidationIssueSeverity
	message: string
	rendered: string
	affectedComponents: string[]
	affectedEntrypoints: string[]
}

export type PluginLoadabilityIssueCode =
	| "plugin_entrypoint_missing_file"
	| "plugin_entrypoint_syntax_error"
	| "plugin_static_local_import_unresolved"
	| "plugin_external_dependency_undeclared"
	| "plugin_manifest_dependency_conflict"
	| "plugin_package_spec_invalid"
	| "plugin_package_cross_registry_unsupported"
	| "plugin_package_spec_nondeterministic"
	| "plugin_runtime_entrypoint_import_failed"
	| "plugin_runtime_package_import_failed"

export interface PluginLoadabilityIssue extends ValidationIssue {
	kind: "plugin_loadability"
	code: PluginLoadabilityIssueCode
}

export interface PluginLoadabilityValidationResult {
	valid: boolean
	errors: string[]
	warnings: string[]
	issues: PluginLoadabilityIssue[]
}

export type RegistryValidationIssue = ValidationIssue | PluginLoadabilityIssue

export interface ValidationResult<T = unknown> {
	valid: boolean
	errors: string[]
	warnings?: string[]
	issues?: RegistryValidationIssue[]
	data?: T
}

export type LoadRegistryErrorKind = "not_found" | "parse_error"

export interface LoadRegistryResult {
	success: boolean
	data?: unknown
	error?: string
	errorKind?: LoadRegistryErrorKind
}

/**
 * Format JSONC parse errors into a readable error message.
 */
function formatJsoncParseError(parseErrors: ParseError[]): string {
	if (parseErrors.length === 0) {
		return "Unknown parse error"
	}

	const firstError = parseErrors[0]
	if (!firstError) {
		return "Unknown parse error"
	}

	return `${printParseErrorCode(firstError.error)} at offset ${firstError.offset}`
}

function createIssue(input: {
	kind: ValidationIssueKind
	code: string
	severity?: ValidationIssueSeverity
	message: string
	rendered?: string
	affectedComponents?: string[]
	affectedEntrypoints?: string[]
}): ValidationIssue {
	const severity = input.severity ?? "error"
	return {
		kind: input.kind,
		code: input.code,
		severity,
		message: input.message,
		rendered: input.rendered ?? input.message,
		affectedComponents: input.affectedComponents ?? [],
		affectedEntrypoints: input.affectedEntrypoints ?? [],
	}
}

function toValidationResultFromIssues(issues: RegistryValidationIssue[]): ValidationResult {
	const errors = issues.filter((issue) => issue.severity === "error").map((issue) => issue.rendered)
	const warnings = issues
		.filter((issue) => issue.severity === "warning")
		.map((issue) => issue.rendered)

	return {
		valid: errors.length === 0,
		errors,
		...(warnings.length > 0 ? { warnings } : {}),
		issues,
	}
}

/**
 * Load and parse a registry source file from a directory.
 *
 * Looks for registry.jsonc first, then registry.json.
 * Supports JSONC format with comments and trailing commas.
 */
export async function loadRegistrySource(sourcePath: string): Promise<LoadRegistryResult> {
	const jsoncFile = Bun.file(`${sourcePath}/registry.jsonc`)
	const jsonFile = Bun.file(`${sourcePath}/registry.json`)
	const jsoncExists = await jsoncFile.exists()
	const jsonExists = await jsonFile.exists()

	if (!jsoncExists && !jsonExists) {
		return {
			success: false,
			error: "No registry.jsonc or registry.json found in source directory",
			errorKind: "not_found",
		}
	}

	const registryFile = jsoncExists ? jsoncFile : jsonFile
	const fileName = jsoncExists ? "registry.jsonc" : "registry.json"
	const content = await registryFile.text()

	const parseErrors: ParseError[] = []
	const data = parseJsonc(content, parseErrors, { allowTrailingComma: true })

	if (parseErrors.length > 0) {
		const errorDetail = formatJsoncParseError(parseErrors)
		return {
			success: false,
			error: `Invalid JSONC in ${fileName}: ${errorDetail}`,
			errorKind: "parse_error",
		}
	}

	return {
		success: true,
		data,
	}
}

/**
 * Validate a registry's schema compatibility and structure.
 */
export function validateRegistrySchema(
	registryData: unknown,
	_sourcePath: string,
): ValidationResult<Registry> {
	const schemaIssue = classifyRegistrySchemaIssue(registryData)
	if (schemaIssue) {
		const issue = createIssue({
			kind: "schema",
			code: `schema_${schemaIssue.issue}`,
			message: `Schema compatibility issue: ${schemaIssue.issue} - ${schemaIssue.remediation}`,
		})
		return {
			valid: false,
			errors: [issue.rendered],
			issues: [issue],
		}
	}

	return validateRegistrySource(registryData, _sourcePath)
}

/**
 * Validate a registry source object against the schema.
 */
export function validateRegistrySource(
	registryData: unknown,
	_sourcePath: string,
): ValidationResult<Registry> {
	const parseResult = registrySchema.safeParse(registryData)

	if (!parseResult.success) {
		const issues = parseResult.error.errors.map((error) => {
			const message = `${error.path.join(".")}: ${error.message}`
			return createIssue({
				kind: "schema",
				code: "schema_validation_error",
				message,
				affectedComponents: [],
				affectedEntrypoints: [],
			})
		})

		return {
			valid: false,
			errors: issues.map((issue) => issue.rendered),
			issues,
		}
	}

	return {
		valid: true,
		errors: [],
		data: parseResult.data,
		issues: [],
	}
}

/**
 * Validate that all source files referenced in the registry exist.
 */
export async function validateSourceFiles(
	registry: Registry,
	sourcePath: string,
): Promise<ValidationResult> {
	const issues: ValidationIssue[] = []

	for (const component of registry.components) {
		for (const rawFile of component.files) {
			const file = normalizeFile(rawFile, component.type)
			const sourceFilePath = join(sourcePath, "files", file.path)

			if (!(await Bun.file(sourceFilePath).exists())) {
				const rendered = `${component.name}: Source file not found at ${file.path}`
				issues.push(
					createIssue({
						kind: "source_file",
						code: "source_file_missing",
						message: rendered,
						rendered,
						affectedComponents: [component.name],
						affectedEntrypoints: [file.target],
					}),
				)
			}
		}
	}

	return toValidationResultFromIssues(issues)
}

/**
 * Validate that there are no circular dependencies in the registry.
 */
export function validateCircularDependencies(registry: Registry): ValidationResult {
	const issues: ValidationIssue[] = []
	const componentMap = new Map(registry.components.map((component) => [component.name, component]))

	function detectCycle(
		componentName: string,
		visiting: Set<string>,
		visited: Set<string>,
		path: string[],
	): string | null {
		if (visiting.has(componentName)) {
			return [...path, componentName].join(" -> ")
		}

		if (visited.has(componentName)) {
			return null
		}

		const component = componentMap.get(componentName)
		if (!component) {
			return null
		}

		visiting.add(componentName)
		path.push(componentName)

		for (const dependency of component.dependencies) {
			if (dependency.includes("/")) {
				continue
			}

			const cycle = detectCycle(dependency, visiting, visited, path)
			if (cycle) {
				return cycle
			}
		}

		visiting.delete(componentName)
		visited.add(componentName)
		path.pop()

		return null
	}

	const globalVisited = new Set<string>()

	for (const component of registry.components) {
		if (globalVisited.has(component.name)) {
			continue
		}

		const cycle = detectCycle(component.name, new Set(), globalVisited, [])
		if (cycle) {
			const rendered = `Circular dependency detected: ${cycle}`
			issues.push(
				createIssue({
					kind: "circular_dependency",
					code: "circular_dependency_detected",
					message: rendered,
					rendered,
					affectedComponents: cycle.split(" -> "),
				}),
			)
			break
		}
	}

	return toValidationResultFromIssues(issues)
}

/**
 * Validate that there are no duplicate target paths across components.
 */
export function validateDuplicateTargets(registry: Registry): ValidationResult {
	const issues: ValidationIssue[] = []
	const targetMap = new Map<string, { componentName: string; entrypoint: string }>()

	const canonicalizeTargetForComparison = (target: string): string => {
		const normalizedUnicode = target.normalize("NFC")
		const unifiedSeparators = normalizedUnicode.replace(/\\/g, "/")
		const normalizedTarget = posix.normalize(unifiedSeparators)
		return normalizedTarget.replace(/^\.\//, "")
	}

	for (const component of registry.components) {
		for (const rawFile of component.files) {
			const file = normalizeFile(rawFile, component.type)
			const canonicalTarget = canonicalizeTargetForComparison(file.target)
			const existing = targetMap.get(canonicalTarget)

			if (existing) {
				const rendered =
					`Duplicate target "${canonicalTarget}" in components ` +
					`"${existing.componentName}" and "${component.name}"`

				issues.push(
					createIssue({
						kind: "duplicate_target",
						code: "duplicate_target_detected",
						message: rendered,
						rendered,
						affectedComponents: [existing.componentName, component.name],
						affectedEntrypoints: [existing.entrypoint, file.target],
					}),
				)
			} else {
				targetMap.set(canonicalTarget, {
					componentName: component.name,
					entrypoint: file.target,
				})
			}
		}
	}

	return toValidationResultFromIssues(issues)
}

export interface ValidateRegistryOptions {
	skipDuplicateTargets?: boolean
}

/**
 * Typed plugin loadability boundary (single source of truth).
 */
export async function validatePluginLoadability(
	registry: Registry,
	sourcePath: string,
): Promise<PluginLoadabilityValidationResult> {
	return runPluginLoadabilityValidation(registry, sourcePath)
}

/**
 * Validate all post-schema registry rules and return structured issues.
 */
export async function validateRegistryRules(
	registry: Registry,
	sourcePath: string,
	options: ValidateRegistryOptions = {},
): Promise<ValidationResult> {
	const issues: RegistryValidationIssue[] = []

	const filesResult = await validateSourceFiles(registry, sourcePath)
	issues.push(...(filesResult.issues ?? []))

	const circularResult = validateCircularDependencies(registry)
	issues.push(...(circularResult.issues ?? []))

	if (!options.skipDuplicateTargets) {
		const duplicateTargetsResult = validateDuplicateTargets(registry)
		issues.push(...(duplicateTargetsResult.issues ?? []))
	}

	const pluginLoadabilityResult = await validatePluginLoadability(registry, sourcePath)
	issues.push(...pluginLoadabilityResult.issues)

	return toValidationResultFromIssues(issues)
}

/**
 * Validate a registry's structure using a generator that yields errors.
 *
 * Backward-compatible string API used by legacy tests/consumers.
 */
export async function* validateRegistryWithOptions(
	registry: Registry,
	sourcePath: string,
	options: ValidateRegistryOptions = {},
): AsyncGenerator<string, void, undefined> {
	const result = await validateRegistryRules(registry, sourcePath, options)
	for (const error of result.errors) {
		yield error
	}
}

export { PluginLoadabilityOperationalError }
