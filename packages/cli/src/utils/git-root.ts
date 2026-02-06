/**
 * Git Repository Root Resolution
 *
 * Provides reliable git root detection with worktree support.
 * Follows the 5 Laws of Elegant Defense:
 * - Law 1: Early exits for non-git directories
 * - Law 2: Parsed git output becomes trusted paths
 * - Law 3: Pure functions with no side effects
 * - Law 4: Fails fast with descriptive errors
 * - Law 5: Intentional naming for clarity
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"

/**
 * Resolves the git repository root for the given directory.
 * Supports both regular repos and worktrees.
 *
 * Resolution strategy:
 * 1. Try `git rev-parse --show-toplevel` (handles all cases)
 * 2. Fallback to .git file parsing (worktree without git binary)
 * 3. Fallback to .git directory detection
 * 4. Return cwd if not in a git repo
 *
 * @param cwd - Directory to resolve from
 * @returns Absolute path to git root, or cwd if not in git repo
 */
export async function resolveGitRoot(cwd: string): Promise<string> {
	// Strategy 1: Use git command (most reliable, handles all cases)
	try {
		const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				GIT_DIR: undefined,
				GIT_WORK_TREE: undefined,
			},
		})

		const exitCode = await proc.exited

		if (exitCode === 0) {
			const output = await new Response(proc.stdout).text()
			const gitRoot = output.trim()
			if (gitRoot && isAbsolute(gitRoot)) {
				return gitRoot
			}
		}
	} catch {
		// Git command failed, try fallbacks
	}

	// Strategy 2: Parse .git file (worktree without git binary)
	const gitRoot = findGitRootSync(cwd)
	if (gitRoot) {
		return gitRoot
	}

	// Strategy 3: Not in a git repo, return cwd
	return cwd
}

/**
 * Synchronous git root detection using filesystem traversal.
 * Handles .git directories and .git files (worktrees).
 *
 * @param startDir - Directory to start searching from
 * @returns Absolute path to git root, or null if not found
 */
function findGitRootSync(startDir: string): string | null {
	// Normalize startDir to absolute at entry (Law 2: Parse, Don't Validate)
	let currentDir = resolve(startDir)

	while (true) {
		const gitPath = resolve(currentDir, ".git")

		if (existsSync(gitPath)) {
			try {
				const stats = require("node:fs").statSync(gitPath)

				// Case 1: .git is a directory (regular repo)
				if (stats.isDirectory()) {
					return currentDir
				}

				// Case 2: .git is a file (worktree)
				if (stats.isFile()) {
					const gitFileContent = readFileSync(gitPath, "utf8")
					const match = gitFileContent.match(/^gitdir:\s*(.+)$/m)

					if (match?.[1]) {
						// gitdir points to .git/worktrees/<name>
						// We need to traverse up to find the actual worktree root
						// The .git file is already at the worktree root
						return currentDir
					}
				}
			} catch {
				// Permission denied or other error - continue traversing
			}
		}

		// Move up one directory
		const parentDir = dirname(currentDir)
		if (parentDir === currentDir) {
			// Reached filesystem root
			return null
		}
		currentDir = parentDir
	}
}

/**
 * Synchronous version of resolveGitRoot for use in non-async contexts.
 * Uses only filesystem traversal (no git command).
 *
 * @param cwd - Directory to resolve from
 * @returns Absolute path to git root, or cwd if not in git repo
 */
export function resolveGitRootSync(cwd: string): string {
	// Normalize cwd to absolute at entry (Law 2: Parse, Don't Validate)
	const absoluteCwd = resolve(cwd)
	// Ensure fallback is also absolute
	return findGitRootSync(absoluteCwd) ?? absoluteCwd
}
