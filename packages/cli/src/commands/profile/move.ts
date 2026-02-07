/**
 * Profile Move Command
 *
 * Move (rename) a profile atomically (local by default, or global with --global flag).
 * Uses Cargo-style CLI pattern: no interactive confirmation.
 */

import type { Command } from "commander"
import { ProfileManager } from "../../profile/manager"
import { handleError, logger, outputJson } from "../../utils/index"

interface MoveOptions {
	global?: boolean
	json?: boolean
}

export function registerProfileMoveCommand(parent: Command): void {
	parent
		.command("move <old-name> <new-name>")
		.alias("mv")
		.description("Move (rename) a profile")
		.option("-g, --global", "Move global profile (default: local)")
		.option("--json", "Output as JSON")
		.action(async (oldName: string, newName: string, options: MoveOptions) => {
			try {
				const result = await runProfileMove(oldName, newName, options)
				if (options.json) {
					outputJson({ success: true, data: result })
				}
			} catch (error) {
				handleError(error, { json: options.json })
			}
		})
}

async function runProfileMove(
	oldName: string,
	newName: string,
	options: MoveOptions,
): Promise<{ from: string; to: string; scope: "local" | "global"; warnActiveProfile: boolean }> {
	const manager = await ProfileManager.requireInitialized()
	const global = options.global ?? false

	const { warnActiveProfile } = await manager.move(oldName, newName, global)

	if (warnActiveProfile && !options.json) {
		logger.warn(`Moving active profile. Update OCX_PROFILE env var to "${newName}".`)
	}

	const scope = global ? "global" : "local"
	if (!options.json) {
		logger.success(`Moved ${scope} profile "${oldName}" → "${newName}"`)
	}

	return { from: oldName, to: newName, scope, warnActiveProfile }
}
