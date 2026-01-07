/**
 * Pattern Filter Utilities
 *
 * Filters excluded paths based on include/exclude glob patterns
 * for ghost mode symlink farm customization.
 */

import { Glob } from "bun"

/**
 * Check if a path matches any of the pre-compiled glob patterns.
 *
 * @param filePath - The path to test (relative to git root)
 * @param globs - Array of pre-compiled Glob objects
 * @returns true if path matches any pattern
 */
function matchesAnyGlob(filePath: string, globs: Glob[]): boolean {
	return globs.some((g) => g.match(filePath))
}

/**
 * Filter excluded paths based on include/exclude glob patterns.
 *
 * Mental model (TypeScript-style, no double negatives):
 * 1. Start with all excluded paths
 * 2. Include patterns specify which to bring back (remove from exclusions)
 * 3. Exclude patterns filter out exceptions from include results
 *
 * @param excludedPaths - Set of paths currently excluded from symlink farm
 * @param includePatterns - Globs for files to include (remove from exclusions)
 * @param excludePatterns - Globs for exceptions (keep in exclusions)
 * @returns New Set with filtered exclusions
 *
 * @example
 * ```ts
 * const excluded = new Set(["AGENTS.md", ".opencode/skills/foo.md", ".opencode/config.json"])
 *
 * // Include all .md files, but exclude AGENTS.md specifically
 * filterExcludedPaths(excluded, ["**\/*.md"], ["AGENTS.md"])
 * // Returns: Set(["AGENTS.md", ".opencode/config.json"])
 * // (foo.md was included, but AGENTS.md stayed excluded)
 * ```
 */
export function filterExcludedPaths(
	excludedPaths: Set<string>,
	includePatterns?: string[],
	excludePatterns?: string[],
): Set<string> {
	// Law 1: Guard clause - no patterns means no filtering
	if (!includePatterns || includePatterns.length === 0) {
		return new Set(excludedPaths)
	}

	// Pre-compile globs once (patterns are validated at schema boundary)
	const includeGlobs = includePatterns.map((p) => new Glob(p))
	const excludeGlobs = excludePatterns?.map((p) => new Glob(p)) ?? []

	const filteredExclusions = new Set<string>()

	// Law 3: Pure function - iterate and build new Set
	for (const path of excludedPaths) {
		const matchesInclude = matchesAnyGlob(path, includeGlobs)
		const matchesExclude = matchesAnyGlob(path, excludeGlobs)

		// Include pattern matched AND not excepted → remove from exclusions (include it)
		// Otherwise → keep in exclusions
		if (matchesInclude && !matchesExclude) {
			// This path is being included, don't add to exclusions
			continue
		}

		filteredExclusions.add(path)
	}

	return filteredExclusions
}
