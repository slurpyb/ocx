/**
 * Registry Validation Library
 *
 * Pure validation functions for registry source validation.
 * Shared by both validate command and build command.
 */

import { join } from "node:path"
import type { Registry } from "../schemas/registry"
import { normalizeFile, registrySchema } from "../schemas/registry"

export interface ValidationResult<T = unknown> {
	valid: boolean
	errors: string[]
	warnings?: string[]
	data?: T
}

/**
 * Validate a registry source object against the schema.
 *
 * @param registryData - The parsed registry object
 * @param sourcePath - Path to the registry source (for error messages)
 * @returns Validation result with parsed data
 */
export function validateRegistrySource(
	registryData: unknown,
	sourcePath: string,
): ValidationResult<Registry> {
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
		data: parseResult.data,
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

/**
 * Validate that there are no circular dependencies in the registry.
 *
 * Uses depth-first search to detect cycles in the component dependency graph.
 * Only validates same-registry dependencies (bare names without "/").
 *
 * @param registry - The validated registry object
 * @returns Validation result with circular dependency errors
 */
export function validateCircularDependencies(registry: Registry): ValidationResult {
	const errors: string[] = []
	const componentMap = new Map(registry.components.map((c) => [c.name, c]))

	function detectCycle(
		componentName: string,
		visiting: Set<string>,
		visited: Set<string>,
		path: string[],
	): string | null {
		// If we're currently visiting this node, we found a cycle
		if (visiting.has(componentName)) {
			return [...path, componentName].join(" -> ")
		}

		// If already fully visited, no cycle from this path
		if (visited.has(componentName)) {
			return null
		}

		const component = componentMap.get(componentName)
		if (!component) {
			return null
		}

		// Mark as currently visiting
		visiting.add(componentName)
		path.push(componentName)

		// Check all dependencies
		for (const dep of component.dependencies) {
			// Only check same-registry deps (bare names without "/")
			if (dep.includes("/")) {
				continue
			}

			const cycle = detectCycle(dep, visiting, visited, path)
			if (cycle) {
				return cycle
			}
		}

		// Done visiting this node
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
			errors.push(`Circular dependency detected: ${cycle}`)
			// Only report the first cycle found
			break
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	}
}

/**
 * Validate that there are no duplicate target paths across components.
 *
 * @param registry - The validated registry object
 * @returns Validation result with duplicate target errors
 */
export function validateDuplicateTargets(registry: Registry): ValidationResult {
	const errors: string[] = []
	const targetMap = new Map<string, string>()

	for (const component of registry.components) {
		for (const rawFile of component.files) {
			const file = normalizeFile(rawFile, component.type)
			const existingComponent = targetMap.get(file.target)

			if (existingComponent) {
				errors.push(
					`Duplicate target "${file.target}" in components "${existingComponent}" and "${component.name}"`,
				)
			} else {
				targetMap.set(file.target, component.name)
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	}
}
