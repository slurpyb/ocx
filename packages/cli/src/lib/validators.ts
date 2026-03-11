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

/**
 * Validate that there are no circular dependencies in the registry.
 *
 * @param registry - The validated registry object
 * @returns Validation result with circular dependency errors
 */
export function validateCircularDependencies(registry: Registry): ValidationResult {
	const errors: string[] = []

	function detectCycle(componentName: string, visited: Set<string>, path: string[]): string | null {
		if (visited.has(componentName)) {
			return [...path, componentName].join(" -> ")
		}

		visited.add(componentName)
		path.push(componentName)

		const component = registry.components.find((c) => c.name === componentName)
		if (!component) {
			return null
		}

		for (const dep of component.dependencies) {
			const depName = dep.includes("/") ? dep.split("/")[1] : dep
			const cycle = detectCycle(depName, new Set(visited), [...path])
			if (cycle) {
				return cycle
			}
		}

		return null
	}

	for (const component of registry.components) {
		const cycle = detectCycle(component.name, new Set(), [])
		if (cycle) {
			errors.push(`Circular dependency detected: ${cycle}`)
			break
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	}
}
