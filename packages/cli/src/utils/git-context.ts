/**
 * Git repository context detection utilities.
 *
 * Provides typed detection of git repository context while avoiding
 * pollution from inherited GIT_DIR/GIT_WORK_TREE environment variables.
 */

import { resolve } from "node:path"

/**
 * Represents a valid git repository context with resolved paths.
 */
export interface GitContext {
	/** Absolute path to the .git directory */
	gitDir: string
	/** Absolute path to the working tree root */
	workTree: string
}

/**
 * Detects if cwd is inside a git repository.
 * Clears inherited GIT_DIR/GIT_WORK_TREE to avoid pollution from parent processes.
 *
 * @param cwd - Directory to check for git repository
 * @returns GitContext if in a repo, null otherwise
 *
 * @example
 * ```ts
 * const gitContext = await detectGitRepo(process.cwd())
 * if (!gitContext) {
 *   console.log("Not in a git repository")
 *   return
 * }
 * console.log(`Git dir: ${gitContext.gitDir}`)
 * ```
 */
export async function detectGitRepo(cwd: string): Promise<GitContext | null> {
	// Create clean env without inherited git variables to avoid pollution
	const cleanEnv = { ...process.env }
	delete cleanEnv.GIT_DIR
	delete cleanEnv.GIT_WORK_TREE

	// Detect git directory
	const gitDirProc = Bun.spawn(["git", "rev-parse", "--git-dir"], {
		cwd,
		env: cleanEnv,
		stdout: "pipe",
		stderr: "pipe",
	})

	const gitDirExitCode = await gitDirProc.exited

	// Early exit: not a git repository
	if (gitDirExitCode !== 0) {
		return null
	}

	const gitDirOutput = await new Response(gitDirProc.stdout).text()
	const gitDirRaw = gitDirOutput.trim()

	// Early exit: empty output means something went wrong
	if (!gitDirRaw) {
		return null
	}

	// Detect work tree root
	const workTreeProc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
		cwd,
		env: cleanEnv,
		stdout: "pipe",
		stderr: "pipe",
	})

	const workTreeExitCode = await workTreeProc.exited

	// Early exit: could not determine work tree (bare repo or error)
	if (workTreeExitCode !== 0) {
		return null
	}

	const workTreeOutput = await new Response(workTreeProc.stdout).text()
	const workTree = workTreeOutput.trim()

	// Early exit: empty work tree
	if (!workTree) {
		return null
	}

	// Resolve gitDir to absolute path (it may be relative like ".git")
	const gitDir = resolve(cwd, gitDirRaw)

	return { gitDir, workTree }
}
