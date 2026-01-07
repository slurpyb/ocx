/**
 * Dependency Resolver with topological sort
 * Based on: https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/registry/resolver.ts
 */

import type { RegistryConfig } from "../schemas/config.js"
import {
	type ComponentManifest,
	createQualifiedComponent,
	type NormalizedComponentManifest,
	type NormalizedOpencodeConfig,
	normalizeComponentManifest,
	type OpencodeConfig,
	parseQualifiedComponent,
	type RegistryIndex,
} from "../schemas/registry.js"
import { ConfigError, OCXError, ValidationError } from "../utils/errors.js"
import { fetchComponent } from "./fetcher.js"
import { mergeOpencodeConfig } from "./merge.js"

/**
 * Resolved npm dependency with source tracking.
 * Discriminated union ensures illegal states are unrepresentable (Law 2).
 */
export type ResolvedNpmDependency =
	| { kind: "catalog"; name: string; version: string; catalogKey: string; declaredBy: string }
	| { kind: "pinned"; name: string; version: string; declaredBy: string }
	| { kind: "bare"; name: string; declaredBy: string }

/**
 * Parse a component reference into namespace and component name.
 * - "kdco/researcher" -> { namespace: "kdco", component: "researcher" }
 * - "researcher" (with defaultNamespace) -> { namespace: defaultNamespace, component: "researcher" }
 * - "researcher" (without defaultNamespace) -> throws error
 */
export function parseComponentRef(
	ref: string,
	defaultNamespace?: string,
): { namespace: string; component: string } {
	// Check if it's a qualified reference (contains /)
	if (ref.includes("/")) {
		return parseQualifiedComponent(ref)
	}

	// Bare name - use default namespace if provided
	if (defaultNamespace) {
		return { namespace: defaultNamespace, component: ref }
	}

	throw new ValidationError(`Component '${ref}' must include a namespace (e.g., 'kdco/${ref}')`)
}

/**
 * Resolves a dependency specifier to a ResolvedNpmDependency.
 * Handles catalog:X, pinned (name@version), and bare (name) formats.
 *
 * @throws ValidationError if catalog:X references non-existent catalog entry (Law 1: Early Exit)
 */
export function resolveDependencySpec(
	spec: string,
	catalog: Record<string, string> | undefined,
	declaredBy: string,
): ResolvedNpmDependency {
	// Guard clause: catalog reference
	if (spec.startsWith("catalog:")) {
		const catalogKey = spec.slice(8)
		if (!catalog?.[catalogKey]) {
			const available = catalog ? Object.keys(catalog).join(", ") : "none"
			throw new ValidationError(
				`Catalog reference "${spec}" not found in registry. Available catalog entries: ${available}`,
			)
		}
		return {
			kind: "catalog",
			name: catalogKey,
			version: catalog[catalogKey],
			catalogKey,
			declaredBy,
		}
	}

	// Parse pinned or bare
	const atIndex = spec.lastIndexOf("@")
	if (atIndex > 0) {
		// Pinned: name@version
		const name = spec.slice(0, atIndex)
		const version = spec.slice(atIndex + 1)

		// Guard: version must be non-empty (Law 4: Fail Fast)
		if (!version) {
			throw new ValidationError(
				`Invalid dependency specifier "${spec}": version is empty after "@". Use bare name "${name}" or specify a version.`,
			)
		}
		return { kind: "pinned", name, version, declaredBy }
	}

	// Bare: just the name
	return { kind: "bare", name: spec, declaredBy }
}

export interface ResolvedComponent extends NormalizedComponentManifest {
	/** The namespace this component belongs to */
	namespace: string
	/** The registry name from ocx.jsonc */
	registryName: string
	baseUrl: string
	/** Qualified name (namespace/component) */
	qualifiedName: string
}

export interface ResolvedDependencies {
	/** All components in dependency order (dependencies first) */
	components: ResolvedComponent[]
	/** Install order (component names) */
	installOrder: string[]
	/** Aggregated npm dependencies from all components */
	npmDependencies: ResolvedNpmDependency[]
	/** Aggregated npm dev dependencies from all components */
	npmDevDependencies: ResolvedNpmDependency[]
	/** Merged opencode configuration from all components (deep merged) */
	opencode: OpencodeConfig
}

/**
 * Resolve all dependencies for a set of components across multiple registries
 * Returns components in topological order (dependencies first)
 */
export async function resolveDependencies(
	registries: Record<string, RegistryConfig>,
	componentNames: string[],
	registryIndexes?: Map<string, RegistryIndex>,
): Promise<ResolvedDependencies> {
	const resolved = new Map<string, ResolvedComponent>()
	const visiting = new Set<string>()
	const npmDeps = new Map<string, ResolvedNpmDependency>()
	const npmDevDeps = new Map<string, ResolvedNpmDependency>()
	let opencode: NormalizedOpencodeConfig = {}

	async function resolve(
		componentNamespace: string,
		componentName: string,
		path: string[] = [],
	): Promise<void> {
		const qualifiedName = createQualifiedComponent(componentNamespace, componentName)

		// Already resolved
		if (resolved.has(qualifiedName)) {
			return
		}

		// Cycle detection
		if (visiting.has(qualifiedName)) {
			const cycle = [...path, qualifiedName].join(" → ")
			throw new ValidationError(`Circular dependency detected: ${cycle}`)
		}

		visiting.add(qualifiedName)

		// Look up the registry for this namespace
		const regConfig = registries[componentNamespace]
		if (!regConfig) {
			throw new ConfigError(
				`Registry '${componentNamespace}' not configured. Add it to ocx.jsonc registries.`,
			)
		}

		// Fetch component from the specific registry
		let component: ComponentManifest
		try {
			component = await fetchComponent(regConfig.url, componentName)
		} catch (_err) {
			throw new OCXError(
				`Component '${componentName}' not found in registry '${componentNamespace}'.`,
				"NOT_FOUND",
			)
		}

		// Resolve dependencies first (depth-first)
		for (const dep of component.dependencies) {
			// Parse dependency: bare name = same namespace, "foo/bar" = cross-namespace
			const depRef = parseComponentRef(dep, componentNamespace)
			await resolve(depRef.namespace, depRef.component, [...path, qualifiedName])
		}

		// Normalize the component (expand Cargo-style shorthands)
		const normalizedComponent = normalizeComponentManifest(component)

		// Add to resolved (dependencies are already added)
		resolved.set(qualifiedName, {
			...normalizedComponent,
			namespace: componentNamespace,
			registryName: componentNamespace,
			baseUrl: regConfig.url,
			qualifiedName,
		})
		visiting.delete(qualifiedName)

		// Get catalog from registry index if available
		const catalog = registryIndexes?.get(componentNamespace)?.catalog

		// Collect npm dependencies (resolved through catalog if needed)
		if (component.npmDependencies) {
			for (const dep of component.npmDependencies) {
				const resolved = resolveDependencySpec(dep, catalog, qualifiedName)
				npmDeps.set(resolved.name, resolved)
			}
		}
		if (component.npmDevDependencies) {
			for (const dep of component.npmDevDependencies) {
				const resolved = resolveDependencySpec(dep, catalog, qualifiedName)
				npmDevDeps.set(resolved.name, resolved)
			}
		}

		// Deep merge opencode config (component takes precedence - ShadCN style)
		// Use normalizedComponent to ensure MCP servers are converted from string URLs to full objects
		if (normalizedComponent.opencode) {
			opencode = mergeOpencodeConfig(
				opencode,
				normalizedComponent.opencode as NormalizedOpencodeConfig,
			)
		}
	}

	// Resolve all requested components
	for (const name of componentNames) {
		// Parse qualified component name (must include namespace)
		const ref = parseComponentRef(name)
		await resolve(ref.namespace, ref.component)
	}

	// Convert to array (already in topological order due to depth-first)
	const components = Array.from(resolved.values())
	const installOrder = Array.from(resolved.keys())

	return {
		components,
		installOrder,
		npmDependencies: Array.from(npmDeps.values()),
		npmDevDependencies: Array.from(npmDevDeps.values()),
		opencode,
	}
}
