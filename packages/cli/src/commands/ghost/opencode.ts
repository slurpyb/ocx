/**
 * Ghost OpenCode Command
 *
 * Launch OpenCode with ghost mode configuration using symlink farm isolation.
 * Creates a temp directory with symlinks to project files, excluding OpenCode
 * config files, to prevent OpenCode from discovering project-level settings.
 */

import { rmSync } from "node:fs"
import { join } from "node:path"
import type { Command } from "commander"
import {
	getGhostConfigDir,
	getGhostOpencodeConfigPath,
	ghostConfigExists,
	loadGhostOpencodeConfig,
} from "../../ghost/config.js"
import { GhostNotInitializedError } from "../../utils/errors.js"
import { handleError, logger } from "../../utils/index.js"
import { discoverProjectFiles } from "../../utils/opencode-discovery.js"
import { sharedOptions } from "../../utils/shared-options.js"
import { cleanupSymlinkFarm, createSymlinkFarm } from "../../utils/symlink-farm.js"

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

/**
 * Get the git repository root directory.
 * Returns cwd if not in a git repository.
 *
 * @param cwd - Current working directory
 * @returns Git root directory or cwd if not a git repo
 */
async function getGitRoot(cwd: string): Promise<string> {
	const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	})

	const exitCode = await proc.exited
	if (exitCode !== 0) return cwd

	const output = await new Response(proc.stdout).text()
	return output.trim() || cwd
}

async function runGhostOpenCode(args: string[], options: GhostOpenCodeOptions): Promise<void> {
	// Guard: Check ghost mode is initialized (Law 1: Early Exit)
	if (!(await ghostConfigExists())) {
		throw new GhostNotInitializedError()
	}

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

	// Discover project files to exclude and create symlink farm
	const cwd = process.cwd()
	const gitRoot = await getGitRoot(cwd)
	const excludePaths = await discoverProjectFiles(cwd, gitRoot)
	const tempDir = await createSymlinkFarm(cwd, excludePaths)

	// Track cleanup state to prevent double cleanup
	let cleanupDone = false
	const performCleanup = async () => {
		if (cleanupDone) return
		cleanupDone = true
		await cleanupSymlinkFarm(tempDir)
	}

	// Safety net: sync cleanup on exit
	const exitHandler = () => {
		if (!cleanupDone && tempDir) {
			try {
				rmSync(tempDir, { recursive: true, force: true })
			} catch {
				// Best effort cleanup
			}
		}
	}
	process.on("exit", exitHandler)

	// Spawn opencode from the temp directory with config passed via environment
	const proc = Bun.spawn({
		cmd: ["opencode", ...args],
		cwd: tempDir,
		env: {
			...process.env,
			OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig),
			OPENCODE_CONFIG_DIR: ghostConfigDir,
			GIT_WORK_TREE: cwd,
			GIT_DIR: join(gitRoot, ".git"),
		},
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	})

	// Setup signal handlers to forward signals to child process
	const sigintHandler = () => proc.kill("SIGINT")
	const sigtermHandler = () => proc.kill("SIGTERM")

	process.on("SIGINT", sigintHandler)
	process.on("SIGTERM", sigtermHandler)

	try {
		// Wait for child to exit
		const exitCode = await proc.exited

		// Clean up signal handlers after subprocess exits to prevent memory leaks
		process.off("SIGINT", sigintHandler)
		process.off("SIGTERM", sigtermHandler)

		// Cleanup the symlink farm
		await performCleanup()
		process.off("exit", exitHandler)

		process.exit(exitCode)
	} catch (error) {
		// Ensure cleanup happens even on error
		await performCleanup()
		process.off("exit", exitHandler)
		throw error
	}
}
