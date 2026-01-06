/**
 * Ghost Config Command
 *
 * Open the ghost configuration file in the user's preferred editor.
 * Uses the editor preference chain: OCX_EDITOR -> EDITOR -> VISUAL -> vi
 */

import type { Command } from "commander"
import { getGhostConfigPath, ghostConfigExists } from "../../ghost/config.js"
import { GhostNotInitializedError } from "../../utils/errors.js"
import { handleError, logger } from "../../utils/index.js"
import { addOutputOptions } from "../../utils/shared-options.js"

interface GhostConfigOptions {
	json?: boolean
	quiet?: boolean
}

/**
 * Resolve the editor to use for opening config files.
 *
 * Security note: We intentionally do NOT validate the editor command.
 * This matches the behavior of Git (GIT_EDITOR), sudo (VISUAL/EDITOR), npm, and
 * other Unix tools. The security model is: if an attacker can modify your
 * environment variables, they already have control of your system.
 * Validating here would provide a false sense of security.
 *
 * @see https://git-scm.com/docs/git-var (GIT_EDITOR behavior)
 */
function resolveEditor(): string {
	return process.env.OCX_EDITOR || process.env.EDITOR || process.env.VISUAL || "vi"
}

export function registerGhostConfigCommand(parent: Command): void {
	const cmd = parent.command("config").description("Open ghost configuration in your editor")

	addOutputOptions(cmd).action(async (options: GhostConfigOptions) => {
		try {
			await runGhostConfig(options)
		} catch (error) {
			handleError(error, { json: options.json })
		}
	})
}

async function runGhostConfig(options: GhostConfigOptions): Promise<void> {
	// Guard: Check if ghost is initialized (Law 1: Early Exit)
	const exists = await ghostConfigExists()
	if (!exists) {
		throw new GhostNotInitializedError()
	}

	const configPath = getGhostConfigPath()

	// JSON mode: just output the path
	if (options.json) {
		console.log(JSON.stringify({ success: true, path: configPath }))
		return
	}

	const editor = resolveEditor()

	if (!options.quiet) {
		logger.info(`Opening ${configPath} in ${editor}...`)
	}

	// Open editor with inherited stdio for interactive use
	const result = Bun.spawnSync([editor, configPath], {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	})

	// Check for editor errors (Law 4: Fail Fast)
	if (result.exitCode !== 0) {
		logger.error(`Editor exited with code ${result.exitCode}`)
		process.exit(result.exitCode)
	}
}
