import { ConflictError, ValidationError } from "./errors"

export interface NpmDependency {
	name: string
	version: string
}

export interface MergedNpmDependencies {
	dependencies: Map<string, string>
	devDependencies: Map<string, string>
}

/**
 * Parses an npm dependency spec into name and version.
 * Handles: "lodash", "lodash@4.0.0", "@types/node", "@types/node@1.0.0"
 */
export function parseNpmDependencySpecifier(spec: string): NpmDependency {
	if (!spec?.trim()) {
		throw new ValidationError(`Invalid npm dependency: expected non-empty string, got "${spec}"`)
	}

	const trimmed = spec.trim()
	const lastAt = trimmed.lastIndexOf("@")

	if (lastAt > 0) {
		const name = trimmed.slice(0, lastAt)
		const version = trimmed.slice(lastAt + 1)
		if (!version) {
			throw new ValidationError(`Invalid npm dependency: missing version after @ in "${spec}"`)
		}
		return { name, version }
	}

	return { name: trimmed, version: "*" }
}

/**
 * Merges npm dependency specs using the same behavior as add/install flow:
 * - parse all specs with parseNpmDependencySpecifier
 * - fail loud when the same package appears in both dependencies and devDependencies
 * - last declaration wins inside each field
 */
export function mergeNpmDependencySpecifiers(
	npmDependencies: string[],
	npmDevDependencies: string[],
): MergedNpmDependencies {
	const dependencies = new Map<string, string>()
	const devDependencies = new Map<string, string>()

	for (const spec of npmDependencies) {
		const parsedDependency = parseNpmDependencySpecifier(spec)
		dependencies.set(parsedDependency.name, parsedDependency.version)
	}

	for (const spec of npmDevDependencies) {
		const parsedDependency = parseNpmDependencySpecifier(spec)
		devDependencies.set(parsedDependency.name, parsedDependency.version)
	}

	const conflicts: string[] = []
	for (const dependencyName of dependencies.keys()) {
		if (devDependencies.has(dependencyName)) {
			conflicts.push(dependencyName)
		}
	}

	if (conflicts.length > 0) {
		throw new ConflictError(
			`Package(s) appear in both dependencies and devDependencies: ${conflicts.join(", ")}.\n` +
				"A package cannot be in both fields. Remove from one list manually before adding.",
		)
	}

	return {
		dependencies,
		devDependencies,
	}
}
