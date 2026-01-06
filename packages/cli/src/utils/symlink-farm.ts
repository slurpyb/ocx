/**
 * Symlink Farm Utility
 *
 * Creates a temporary directory with symlinks to all project files
 * except those in the exclusion set. Used by ghost mode to isolate
 * from project-level OpenCode configuration.
 */

import { randomBytes } from "node:crypto"
import { readdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"

/**
 * Create a symlink farm in a temp directory.
 *
 * Creates symlinks to all top-level files/directories in sourceDir,
 * excluding any paths in the exclusion set.
 *
 * @param sourceDir - Directory to create symlinks from
 * @param excludePaths - Absolute paths to exclude from symlinking
 * @returns Path to the temp directory
 */
export async function createSymlinkFarm(
	sourceDir: string,
	excludePaths: Set<string>,
): Promise<string> {
	// Guard: sourceDir must be absolute (Law 1: Early Exit)
	if (!isAbsolute(sourceDir)) {
		throw new Error(`sourceDir must be an absolute path, got: ${sourceDir}`)
	}

	const suffix = randomBytes(4).toString("hex")
	const tempDir = join(tmpdir(), `ocx-ghost-${suffix}`)

	// Create temp directory manually (mkdtemp adds random suffix, we already have one)
	await Bun.write(join(tempDir, ".ocx-ghost-marker"), "")

	try {
		const entries = await readdir(sourceDir, { withFileTypes: true })

		for (const entry of entries) {
			const sourcePath = join(sourceDir, entry.name)

			// Skip excluded paths (Law 1: Early Exit)
			if (excludePaths.has(sourcePath)) continue

			const targetPath = join(tempDir, entry.name)
			await symlink(sourcePath, targetPath)
		}

		return tempDir
	} catch (error) {
		// Cleanup on failure (Law 4: Fail Fast)
		await rm(tempDir, { recursive: true, force: true }).catch(() => {})
		throw error
	}
}

/**
 * Clean up a symlink farm temp directory.
 *
 * @param tempDir - Path to the temp directory to remove
 */
export async function cleanupSymlinkFarm(tempDir: string): Promise<void> {
	await rm(tempDir, { recursive: true, force: true })
}
