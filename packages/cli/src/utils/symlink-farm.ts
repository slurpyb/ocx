/**
 * Symlink Farm Utility
 *
 * Creates a temporary directory with symlinks to all project files
 * except those in the exclusion set. Used by ghost mode to isolate
 * from project-level OpenCode configuration.
 */

import { randomBytes } from "node:crypto"
import { readdir, rename, rm, stat, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"

/** Age threshold for stale ghost sessions (24 hours) */
const STALE_SESSION_THRESHOLD_MS = 24 * 60 * 60 * 1000

/** Age threshold for interrupted deletions (1 hour) */
const REMOVING_THRESHOLD_MS = 60 * 60 * 1000

/** Prefix for ghost temp directories */
export const GHOST_DIR_PREFIX = "ocx-ghost-"

/** Suffix for directories being removed */
export const REMOVING_SUFFIX = "-removing"

/** Marker file to identify ghost temp directories */
export const GHOST_MARKER_FILE = ".ocx-ghost-marker"

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
	const tempDir = join(tmpdir(), `${GHOST_DIR_PREFIX}${suffix}`)

	// Create temp directory manually (mkdtemp adds random suffix, we already have one)
	await Bun.write(join(tempDir, GHOST_MARKER_FILE), "")

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
 * Clean up a symlink farm temp directory using rename-to-removing pattern.
 * This pattern ensures SIGKILL resilience: if the process dies mid-deletion,
 * the -removing directory will be cleaned up on next startup.
 *
 * @param tempDir - Path to the temp directory to remove
 */
export async function cleanupSymlinkFarm(tempDir: string): Promise<void> {
	const removingPath = `${tempDir}${REMOVING_SUFFIX}`

	try {
		await rename(tempDir, removingPath)
	} catch {
		// Directory may already be gone or renamed - that's fine
		return
	}

	await rm(removingPath, { recursive: true, force: true })
}

/**
 * Cleans up orphaned ghost temp directories from interrupted sessions.
 * Uses rename-to-removing pattern for SIGKILL resilience.
 *
 * Scans for:
 * - Directories ending in `-removing` (interrupted deletions, 1 hour threshold)
 * - Directories matching `ocx-ghost-*` (stale sessions, 24 hour threshold)
 *
 * @param tempBase - Base temp directory to scan (defaults to system tmpdir)
 * @returns Count of cleaned directories
 */
export async function cleanupOrphanedGhostDirs(tempBase: string = tmpdir()): Promise<number> {
	let cleanedCount = 0

	// Guard: tempBase must be absolute (Law 1: Early Exit)
	if (!isAbsolute(tempBase)) {
		throw new Error(`tempBase must be an absolute path, got: ${tempBase}`)
	}

	let dirNames: string[]
	try {
		dirNames = await readdir(tempBase)
	} catch {
		// Can't read temp dir - nothing to clean
		return 0
	}

	for (const dirName of dirNames) {
		const dirPath = join(tempBase, dirName)

		// Check for interrupted deletions (ends with -removing)
		const isRemovingDir = dirName.endsWith(REMOVING_SUFFIX)
		const isGhostDir = dirName.startsWith(GHOST_DIR_PREFIX) && !isRemovingDir

		// Skip unrelated entries (Law 1: Early Exit)
		if (!isRemovingDir && !isGhostDir) continue

		// Check if it's a directory and get stats
		let stats: Awaited<ReturnType<typeof stat>>
		try {
			stats = await stat(dirPath)
		} catch {
			// Can't stat - skip this entry
			continue
		}

		// Skip non-directories (Law 1: Early Exit)
		if (!stats.isDirectory()) continue

		// Determine threshold based on directory type
		const threshold = isRemovingDir ? REMOVING_THRESHOLD_MS : STALE_SESSION_THRESHOLD_MS
		const ageMs = Date.now() - stats.mtimeMs

		// Skip if not stale enough (Law 1: Early Exit)
		if (ageMs <= threshold) continue

		// Clean up the stale directory
		try {
			if (isGhostDir) {
				// Use rename-to-removing pattern for normal ghost dirs
				const removingPath = `${dirPath}${REMOVING_SUFFIX}`
				await rename(dirPath, removingPath)
				await rm(removingPath, { recursive: true, force: true })
			} else {
				// Already a -removing dir, just delete it
				await rm(dirPath, { recursive: true, force: true })
			}
			cleanedCount++
		} catch {
			// Best effort cleanup - continue with others
		}
	}

	return cleanedCount
}
