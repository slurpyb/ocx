/**
 * Profile Remove Command
 *
 * Delete a profile (global by default, or local if run from project directory).
 * Uses Cargo-style CLI pattern: no interactive confirmation.
 */

import type { Command } from "commander"
import { ProfileManager } from "../../profile/manager"
import { ProfileNotFoundError } from "../../utils/errors"
import { handleError, logger } from "../../utils/index"

export function registerProfileRemoveCommand(parent: Command): void {
	parent
		.command("remove <name>")
		.alias("rm")
		.description("Delete a profile")
		.action(async (name: string) => {
			try {
				await runProfileRemove(name)
			} catch (error) {
				handleError(error)
			}
		})
}

async function runProfileRemove(name: string): Promise<void> {
	const manager = await ProfileManager.requireInitialized()

	// Verify profile exists first (fail fast)
	if (!(await manager.exists(name))) {
		throw new ProfileNotFoundError(name)
	}

	await manager.remove(name)
	logger.success(`Deleted profile "${name}"`)
}
