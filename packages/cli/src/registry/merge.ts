/**
 * OpenCode Config Merge Utilities
 *
 * Matches OpenCode's mergeConfigWithPlugins behavior:
 * - Deep merge objects using remeda's mergeDeep
 * - Concatenate and deduplicate plugin and instructions arrays
 */

import { mergeDeep } from "remeda"
import type { NormalizedOpencodeConfig } from "../schemas/registry"

/**
 * Merge two OpenCode config objects with special array handling.
 *
 * INTERNAL UTILITY - expects pre-validated configs.
 * Validation happens at boundaries (config loading, build step), not here.
 * See: Law 2 (Parse, Don't Validate) - parse at boundary, trust inside.
 *
 * Unlike plain mergeDeep which replaces arrays entirely, this function:
 * - Concatenates `plugin` arrays from both configs
 * - Concatenates `instructions` arrays from both configs
 * - Deduplicates entries in both arrays
 * - Deep merges all other objects
 *
 * This matches OpenCode's internal mergeConfigWithPlugins behavior.
 *
 * @param target - Base config (accumulated so far, pre-validated)
 * @param source - New config to merge in (pre-validated)
 * @returns Merged config with concatenated arrays
 *
 * @example
 * ```typescript
 * const merged = mergeOpencodeConfig(
 *   { plugin: ["npm:a"], mcp: { server1: {...} } },
 *   { plugin: ["npm:b"], agent: { agent1: {...} } }
 * )
 * // Result: { plugin: ["npm:a", "npm:b"], mcp: {...}, agent: {...} }
 * ```
 */
export function mergeOpencodeConfig(
	target: NormalizedOpencodeConfig,
	source: NormalizedOpencodeConfig,
): NormalizedOpencodeConfig {
	const merged = mergeDeep(target, source) as NormalizedOpencodeConfig

	// Concatenate and deduplicate plugin arrays (matching OpenCode behavior)
	if (Array.isArray(target.plugin) && Array.isArray(source.plugin)) {
		merged.plugin = Array.from(new Set([...target.plugin, ...source.plugin]))
	} else if (Array.isArray(target.plugin)) {
		merged.plugin = target.plugin
	} else if (Array.isArray(source.plugin)) {
		merged.plugin = source.plugin
	}

	// Concatenate and deduplicate instructions arrays (matching OpenCode behavior)
	if (Array.isArray(target.instructions) && Array.isArray(source.instructions)) {
		merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
	} else if (Array.isArray(target.instructions)) {
		merged.instructions = target.instructions
	} else if (Array.isArray(source.instructions)) {
		merged.instructions = source.instructions
	}

	return merged
}
