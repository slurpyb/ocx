/**
 * Migration module: Legacy ocx.lock → V2 .ocx/receipt.jsonc
 *
 * Isolated transform logic for converting v1.4.6 lock entries into
 * canonical receipt entries. No side effects — pure data transform.
 */

import type { InstalledComponent, OcxConfig, OcxLock, Receipt } from "../../schemas/config"
import { createCanonicalId } from "../../schemas/config"
import { ConfigError } from "../../utils/errors"

// =============================================================================
// TYPES
// =============================================================================

export type MigrateStatus = "nothing_to_migrate" | "already_v2" | "preview" | "migrated"

export interface MigrateResult {
	success: boolean
	status: MigrateStatus
	count: number
	components: Array<{
		legacyKey: string
		canonicalId: string
		name: string
		registryName: string
	}>
}

// =============================================================================
// TRANSFORM (Pure, deterministic)
// =============================================================================

/**
 * Transform a single legacy lock entry into a V2 installed component.
 *
 * Legacy format:
 *   key = "alias/component"
 *   entry = { registry, version, hash, files: string[], installedAt, updatedAt? }
 *
 * V2 format:
 *   key = canonical ID ("registryUrl::registryName/component@revision")
 *   entry = { registryUrl, registryName, name, revision, hash, files: {path,hash}[], ... }
 *
 * @param legacyKey - Legacy qualified key (e.g., "kdco/researcher")
 * @param entry - Legacy installed component entry
 * @param registryUrl - Resolved registry URL from ocx.jsonc config
 * @returns Tuple of [canonicalId, InstalledComponent]
 */
export function transformLegacyEntry(
	legacyKey: string,
	entry: OcxLock["installed"][string],
	registryUrl: string,
): [string, InstalledComponent] {
	// Guard: key must contain slash
	const slashIndex = legacyKey.indexOf("/")
	if (slashIndex === -1) {
		throw new Error(`Invalid legacy key: "${legacyKey}". Expected format: alias/component`)
	}

	const registryName = legacyKey.slice(0, slashIndex)
	const name = legacyKey.slice(slashIndex + 1)

	// Guard: both parts must be non-empty
	if (!registryName || !name) {
		throw new Error(`Invalid legacy key: "${legacyKey}". Both alias and component are required.`)
	}

	const canonicalId = createCanonicalId(registryUrl, registryName, name, entry.version)

	const component: InstalledComponent = {
		registryUrl,
		registryName,
		name,
		revision: entry.version,
		hash: entry.hash,
		files: entry.files.map((filePath) => ({
			path: filePath,
			// Legacy lock doesn't store per-file hashes — use empty string as sentinel
			hash: "",
		})),
		installedAt: entry.installedAt,
		...(entry.updatedAt && { updatedAt: entry.updatedAt }),
		owner: { type: "user" },
	}

	return [canonicalId, component]
}

/**
 * Build a complete V2 receipt from a legacy lock and config.
 *
 * Deterministic: same inputs always produce same output.
 * Entries are sorted by canonical ID for stable JSON output.
 *
 * @param lock - Parsed legacy ocx.lock
 * @param config - Parsed ocx.jsonc with registry URLs
 * @param root - Install root path to record in receipt (optional)
 * @returns Receipt and migration metadata
 */
export function buildReceiptFromLock(
	lock: OcxLock,
	config: OcxConfig,
	root?: string,
): { receipt: Receipt; components: MigrateResult["components"] } {
	const installed: Record<string, InstalledComponent> = {}
	const components: MigrateResult["components"] = []

	// Sort legacy keys for deterministic output
	const sortedKeys = Object.keys(lock.installed).sort()

	for (const legacyKey of sortedKeys) {
		const entry = lock.installed[legacyKey]
		if (!entry) continue

		// Resolve registry URL from config
		const registryConfig = config.registries[entry.registry]
		if (!registryConfig) {
			throw new ConfigError(
				`Registry "${entry.registry}" referenced in lock key "${legacyKey}" ` +
					`is not configured in ocx.jsonc. Add it before migrating.`,
			)
		}

		const [canonicalId, component] = transformLegacyEntry(legacyKey, entry, registryConfig.url)

		installed[canonicalId] = component
		components.push({
			legacyKey,
			canonicalId,
			name: component.name,
			registryName: component.registryName,
		})
	}

	const receipt: Receipt = {
		version: 1,
		...(root && { root }),
		installed,
	}

	return { receipt, components }
}
