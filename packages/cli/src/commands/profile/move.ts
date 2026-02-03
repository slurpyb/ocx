/**
 * Profile Move Command
 *
 * Move (rename) a profile atomically (local by default, or global with --global flag).
 * Uses Cargo-style CLI pattern: no interactive confirmation.
 */

import type { Command } from "commander"
import { ProfileManager } from "../../profile/manager"
import { handleError, logger } from "../../utils/index"

interface MoveOptions {
	global?: boolean
}

export function registerProfileMoveCommand(parent: Command): void {
	parent
		.command("move <old-name> <new-name>")
		.alias("mv")
		.description("Move (rename) a profile")
		.option("-g, --global", "Move global profile (default: local)")
		.action(async (oldName: string, newName: string, options: MoveOptions) => {
			try {
				await runProfileMove(oldName, newName, options)
			} catch (error) {
				handleError(error)
			}
		})
}

async function runProfileMove(
	oldName: string,
	newName: string,
	options: MoveOptions,
): Promise<void> {
	const manager = await ProfileManager.requireInitialized()
	const global = options.global ?? false

	const { warnActiveProfile } = await manager.move(oldName, newName, global)

	if (warnActiveProfile) {
		logger.warn(`Moving active profile. Update OCX_PROFILE env var to "${newName}".`)
	}

	const scope = global ? "global" : "local"
	logger.success(`Moved ${scope} profile "${oldName}" → "${newName}"`)
}
