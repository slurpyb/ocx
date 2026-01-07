/**
 * Ghost OpenCode Command
 *
 * Launch OpenCode with ghost mode configuration using symlink farm isolation.
 * Creates a temp directory with symlinks to project files, excluding OpenCode
 * config files, to prevent OpenCode from discovering project-level settings.
 */

import { renameSync, rmSync } from "node:fs"
import type { Command } from "commander"
import {
	getGhostConfigDir,
	getGhostOpencodeConfigPath,
	ghostConfigExists,
	loadGhostConfig,
	loadGhostOpencodeConfig,
} from "../../ghost/config.js"
import { GhostNotInitializedError } from "../../utils/errors.js"
import { detectGitRepo, handleError, logger } from "../../utils/index.js"
import { discoverProjectFiles } from "../../utils/opencode-discovery.js"
import { filterExcludedPaths } from "../../utils/pattern-filter.js"
import { sharedOptions } from "../../utils/shared-options.js"
import {
	cleanupOrphanedGhostDirs,
	cleanupSymlinkFarm,
	createSymlinkFarm,
	REMOVING_SUFFIX,
} from "../../utils/symlink-farm.js"

interface GhostOpenCodeOptions {
	json?: boolean
	quiet?: boolean
}

export function registerGhostOpenCodeCommand(parent: Command): void {
	parent
		.command("opencode")
		.description("Launch OpenCode with ghost mode configuration")
		.addOption(sharedOptions.json())
		.addOption(sharedOptions.quiet())
		.allowUnknownOption()
		.allowExcessArguments(true)
		.action(async (options: GhostOpenCodeOptions, command: Command) => {
			try {
				// Get all remaining arguments after "opencode"
				const args = command.args
				await runGhostOpenCode(args, options)
			} catch (error) {
				handleError(error, { json: options.json })
			}
		})
}

async function runGhostOpenCode(args: string[], options: GhostOpenCodeOptions): Promise<void> {
	// Guard: Check ghost mode is initialized (Law 1: Early Exit)
	if (!(await ghostConfigExists())) {
		throw new GhostNotInitializedError()
	}

	// Clean up orphaned temp directories from interrupted sessions (SIGKILL resilience)
	await cleanupOrphanedGhostDirs()

	// Load opencode config from opencode.jsonc in ghost config directory
	const openCodeConfig = await loadGhostOpencodeConfig()
	const ghostConfigDir = getGhostConfigDir()

	// Guard: Warn if opencode config is empty/missing (but still proceed)
	// Suppress warning in quiet mode
	if (Object.keys(openCodeConfig).length === 0 && !options.quiet) {
		logger.warn(
			`No opencode.jsonc found at ${getGhostOpencodeConfigPath()}. Run 'ocx ghost add' first.`,
		)
	}

	// Detect git repository context (may be null if not in a git repo)
	const cwd = process.cwd()
	const gitContext = await detectGitRepo(cwd)

	// Discover project files to exclude (use cwd as gitRoot fallback if not in repo)
	const gitRoot = gitContext?.workTree ?? cwd
	const discoveredPaths = await discoverProjectFiles(cwd, gitRoot)

	// Apply user's include/exclude patterns from ghost config
	const ghostConfig = await loadGhostConfig()
	const excludePaths = filterExcludedPaths(
		discoveredPaths,
		ghostConfig.include,
		ghostConfig.exclude,
	)

	const tempDir = await createSymlinkFarm(cwd, excludePaths)

	// Track cleanup state to prevent double cleanup
	let cleanupDone = false
	const performCleanup = async () => {
		if (cleanupDone) return
		cleanupDone = true
		await cleanupSymlinkFarm(tempDir)
	}

	// Safety net: sync cleanup on exit using rename-to-removing pattern
	// This ensures SIGKILL resilience: if rename succeeds but rm is interrupted,
	// the -removing directory will be cleaned up on next startup
	const exitHandler = () => {
		if (!cleanupDone && tempDir) {
			try {
				const removingPath = `${tempDir}${REMOVING_SUFFIX}`
				renameSync(tempDir, removingPath)
				rmSync(removingPath, { recursive: true, force: true })
			} catch {
				// Best effort cleanup
			}
		}
	}
	process.on("exit", exitHandler)

	// Setup signal handlers BEFORE spawn to avoid race condition
	// Use optional chaining since proc is null until spawn completes
	let proc: ReturnType<typeof Bun.spawn> | null = null

	const sigintHandler = () => proc?.kill("SIGINT")
	const sigtermHandler = () => proc?.kill("SIGTERM")

	process.on("SIGINT", sigintHandler)
	process.on("SIGTERM", sigtermHandler)

	// Spawn opencode from the temp directory with config passed via environment
	// Only set GIT_DIR/GIT_WORK_TREE when actually in a git repository
	proc = Bun.spawn({
		cmd: ["opencode", ...args],
		cwd: tempDir,
		env: {
			...process.env,
			OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig),
			OPENCODE_CONFIG_DIR: ghostConfigDir,
			...(gitContext && {
				GIT_WORK_TREE: gitContext.workTree,
				GIT_DIR: gitContext.gitDir,
			}),
		},
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	})

	try {
		// Wait for child to exit
		const exitCode = await proc.exited
		process.exit(exitCode)
	} finally {
		// ALWAYS runs - success, error, or throw
		// Cleanup signal handlers to prevent memory leaks
		process.off("SIGINT", sigintHandler)
		process.off("SIGTERM", sigtermHandler)
		process.off("exit", exitHandler)
		await performCleanup()
	}
}
