/**
 * OpenCode Project File Discovery
 *
 * Replicates OpenCode's project-level file discovery to build exclusion list.
 *
 * Reference (sync periodically):
 * - https://github.com/sst/opencode/blob/dev/packages/opencode/src/util/filesystem.ts
 * - https://github.com/sst/opencode/blob/dev/packages/opencode/src/session/system.ts
 * - https://github.com/sst/opencode/blob/dev/packages/opencode/src/config/config.ts
 *
 * Last synced: 2026-01-06
 */

import { exists } from "node:fs/promises"
import { dirname, join } from "node:path"

// From config.ts line 48
const CONFIG_FILES = ["opencode.jsonc", "opencode.json"]

// From system.ts lines 59-63
const RULE_FILES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"]

// From config.ts lines 76-78
const CONFIG_DIRS = [".opencode"]

/**
 * Find all occurrences of a target file/directory walking up the tree.
 * Based on OpenCode's filesystem.ts lines 29-41.
 *
 * @param target - File or directory name to find
 * @param start - Starting directory
 * @param stop - Stop directory (won't traverse past this)
 * @returns Array of absolute paths found
 */
async function findUp(target: string, start: string, stop?: string): Promise<string[]> {
	let current = start
	const result: string[] = []

	while (true) {
		const search = join(current, target)
		if (await exists(search).catch(() => false)) {
			result.push(search)
		}
		if (stop === current) break
		const parent = dirname(current)
		if (parent === current) break
		current = parent
	}

	return result
}

/**
 * Generator that yields all occurrences of target files walking up the tree.
 * Based on OpenCode's filesystem.ts lines 43-56.
 *
 * @param options - Search options
 * @param options.targets - File/directory names to find
 * @param options.start - Starting directory
 * @param options.stop - Stop directory (won't traverse past this)
 */
async function* up(options: {
	targets: string[]
	start: string
	stop?: string
}): AsyncGenerator<string> {
	const { targets, start, stop } = options
	let current = start

	while (true) {
		for (const target of targets) {
			const search = join(current, target)
			if (await exists(search).catch(() => false)) {
				yield search
			}
		}
		if (stop === current) break
		const parent = dirname(current)
		if (parent === current) break
		current = parent
	}
}

/**
 * Discover all OpenCode project files that should be excluded from symlink farm.
 * Only discovers LOCAL (project-level) files, not global config.
 *
 * @param start - Starting directory (usually cwd)
 * @param stop - Stopping directory (usually git root)
 * @returns Set of absolute paths to exclude
 */
export async function discoverProjectFiles(start: string, stop: string): Promise<Set<string>> {
	const excluded = new Set<string>()

	// Find config files (opencode.jsonc, opencode.json)
	for (const file of CONFIG_FILES) {
		const found = await findUp(file, start, stop)
		for (const path of found) {
			excluded.add(path)
		}
	}

	// Find rule files (AGENTS.md, CLAUDE.md, CONTEXT.md)
	for (const file of RULE_FILES) {
		const found = await findUp(file, start, stop)
		for (const path of found) {
			excluded.add(path)
		}
	}

	// Find .opencode directories
	for await (const dir of up({ targets: CONFIG_DIRS, start, stop })) {
		excluded.add(dir)
	}

	return excluded
}
