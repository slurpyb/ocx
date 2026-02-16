/**
 * Registry Fetcher with in-memory caching
 * Based on: https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/registry/fetcher.ts
 */

import type { ComponentManifest, McpServer, RegistryIndex } from "../schemas/registry"
import { componentManifestSchema, packumentSchema, registryIndexSchema } from "../schemas/registry"
import {
	NetworkError,
	NotFoundError,
	type RegistryCompatIssue,
	RegistryCompatibilityError,
	ValidationError,
} from "../utils/errors"
import { normalizeRegistryUrl } from "../utils/url"

// In-memory cache for deduplication
const cache = new Map<string, Promise<unknown>>()

/**
 * Fetch with caching - deduplicates concurrent requests
 */
async function fetchWithCache<T>(url: string, parse: (data: unknown) => T): Promise<T> {
	const cached = cache.get(url)
	if (cached) {
		return cached as Promise<T>
	}

	const promise = (async () => {
		let response: Response
		try {
			response = await fetch(url)
		} catch (error) {
			throw new NetworkError(
				`Network request failed for ${url}: ${error instanceof Error ? error.message : String(error)}`,
				{ url },
			)
		}

		if (!response.ok) {
			if (response.status === 404) {
				throw new NotFoundError(`Not found: ${url}`)
			}
			throw new NetworkError(`Failed to fetch ${url}: ${response.status} ${response.statusText}`, {
				url,
				status: response.status,
				statusText: response.statusText,
			})
		}

		let data: unknown
		try {
			data = await response.json()
		} catch (error) {
			throw new NetworkError(
				`Invalid JSON response from ${url}: ${error instanceof Error ? error.message : String(error)}`,
				{ url },
			)
		}

		return parse(data)
	})()

	cache.set(url, promise)

	// Clean up cache on error
	promise.catch(() => cache.delete(url))

	return promise
}

/**
 * Classify registry index format issues from parsed JSON data.
 * Pure function: inspects unknown data and returns a classification or null.
 *
 * Classifications:
 * - `ancient-format`: top-level array (legacy shadcn-style registries)
 * - `missing-metadata`: object with registry-like signals but missing required keys
 * - `invalid-format`: object that doesn't match any recognized pattern
 *
 * Returns null if the data does not match any known incompatible pattern
 * (i.e., it should be handed to the normal schema parser).
 */
export function classifyRegistryIndexIssue(
	data: unknown,
): { issue: RegistryCompatIssue; remediation: string } | null {
	// Guard: non-object data
	if (data === null || data === undefined || typeof data !== "object") {
		return null
	}

	// Ancient format: top-level array (legacy shadcn-style)
	if (Array.isArray(data)) {
		return {
			issue: "ancient-format",
			remediation:
				"This registry uses a legacy array-based format. " +
				"Migrate to the OCX registry specification with a top-level object containing 'author' and 'components' fields.",
		}
	}

	// Check for registry-like signals
	const obj = data as Record<string, unknown>
	const indexSignals = ["components", "$schema", "opencode", "ocx"] as const
	const hasIndexSignal = indexSignals.some((key) => key in obj)

	if (hasIndexSignal) {
		// Has signals but might be missing required keys
		const requiredKeys = ["author", "components"] as const
		const missingKeys = requiredKeys.filter((key) => !(key in obj))
		if (missingKeys.length > 0) {
			return {
				issue: "missing-metadata",
				remediation:
					`Registry index is missing required field(s): ${missingKeys.join(", ")}. ` +
					"Add the missing fields to conform to the OCX registry specification.",
			}
		}
		// Has all signals and required keys — let schema parse normally
		return null
	}

	// Plain object with no recognized signals — invalid format
	return {
		issue: "invalid-format",
		remediation:
			"The registry index does not match any recognized format. " +
			"Ensure it follows the OCX registry specification with 'author' and 'components' fields.",
	}
}

/**
 * Fetch registry index
 */
export async function fetchRegistryIndex(baseUrl: string): Promise<RegistryIndex> {
	const url = `${normalizeRegistryUrl(baseUrl)}/index.json`

	return fetchWithCache(url, (data) => {
		// Pre-schema classification: detect known incompatible formats
		const classification = classifyRegistryIndexIssue(data)
		if (classification) {
			throw new RegistryCompatibilityError(
				`Registry at ${url} uses an incompatible format (${classification.issue}). ${classification.remediation}`,
				{
					url,
					issue: classification.issue,
					remediation: classification.remediation,
				},
			)
		}

		const result = registryIndexSchema.safeParse(data)
		if (!result.success) {
			throw new RegistryCompatibilityError(
				`Registry at ${url} returned an unrecognized index format. Ensure it follows the OCX registry specification. Schema error: ${result.error.message}`,
				{
					url,
					issue: "invalid-format",
					remediation:
						"Ensure the registry index follows the OCX registry specification. " +
						`Schema error: ${result.error.message}`,
				},
			)
		}
		return result.data
	})
}

/**
 * Fetch a component from registry and return the latest manifest
 */
export async function fetchComponent(baseUrl: string, name: string): Promise<ComponentManifest> {
	const result = await fetchComponentVersion(baseUrl, name)
	return result.manifest
}

/**
 * Fetch a component from registry with specific or latest version.
 * Returns both the manifest and the resolved version.
 */
export async function fetchComponentVersion(
	baseUrl: string,
	name: string,
	version?: string,
): Promise<{ manifest: ComponentManifest; version: string }> {
	const url = `${normalizeRegistryUrl(baseUrl)}/components/${name}.json`

	return fetchWithCache(`${url}#v=${version ?? "latest"}`, (data) => {
		// 1. Parse as packument
		const packumentResult = packumentSchema.safeParse(data)
		if (!packumentResult.success) {
			throw new ValidationError(
				`Invalid packument format for "${name}": ${packumentResult.error.message}`,
			)
		}

		const packument = packumentResult.data

		// 2. Resolve version (specific or latest)
		const resolvedVersion = version ?? packument["dist-tags"].latest
		const manifest = packument.versions[resolvedVersion]

		if (!manifest) {
			if (version) {
				const availableVersions = Object.keys(packument.versions).join(", ")
				throw new ValidationError(
					`Component "${name}" has no version "${version}". Available: ${availableVersions}`,
				)
			}
			throw new ValidationError(
				`Component "${name}" has no manifest for latest version ${resolvedVersion}`,
			)
		}

		// 3. Validate manifest
		const manifestResult = componentManifestSchema.safeParse(manifest)
		if (!manifestResult.success) {
			throw new ValidationError(
				`Invalid component manifest for "${name}@${resolvedVersion}": ${manifestResult.error.message}`,
			)
		}

		return { manifest: manifestResult.data, version: resolvedVersion }
	})
}

/**
 * Fetch actual file content from registry
 */
export async function fetchFileContent(
	baseUrl: string,
	componentName: string,
	filePath: string,
): Promise<string> {
	const url = `${normalizeRegistryUrl(baseUrl)}/components/${componentName}/${filePath}`

	let response: Response
	try {
		response = await fetch(url)
	} catch (error) {
		throw new NetworkError(
			`Network request failed for ${url}: ${error instanceof Error ? error.message : String(error)}`,
			{ url },
		)
	}

	if (!response.ok) {
		throw new NetworkError(
			`Failed to fetch file ${filePath} for ${componentName} from ${url}: ${response.status} ${response.statusText}`,
			{ url, status: response.status, statusText: response.statusText },
		)
	}

	return response.text()
}

// Re-export types for convenience
export type { ComponentManifest, RegistryIndex, McpServer }

/** @internal Clear cache for testing purposes only */
export function _clearFetcherCacheForTests(): void {
	cache.clear()
}
