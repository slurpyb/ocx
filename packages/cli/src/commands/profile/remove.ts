/**
 * Profile Remove Command
 *
 * Delete a profile (local by default, or global with --global flag).
 * Uses Cargo-style CLI pattern: no interactive confirmation.
 */

import type { Command } from "commander"
import { ProfileManager } from "../../profile/manager"
import { ProfileNotFoundError } from "../../utils/errors"
import { handleError, logger, outputJson } from "../../utils/index"

interface RemoveOptions {
	global?: boolean
	json?: boolean
}

export function registerProfileRemoveCommand(parent: Command): void {
	parent
		.command("remove <name>")
		.alias("rm")
		.description("Delete a profile")
		.option("-g, --global", "Remove global profile (default: local)")
		.option("--json", "Output as JSON")
		.action(async (name: string, options: RemoveOptions) => {
			try {
				const result = await runProfileRemove(name, options)
				if (options.json) {
					outputJson({ success: true, data: result })
				}
			} catch (error) {
				handleError(error, { json: options.json })
			}
		})
}

async function runProfileRemove(
	name: string,
	options: RemoveOptions,
): Promise<{ name: string; scope: "local" | "global" }> {
	const manager = await ProfileManager.requireInitialized()
	const global = options.global ?? false

	// Verify profile exists first (fail fast)
	if (!(await manager.exists(name, global))) {
		throw new ProfileNotFoundError(name)
	}

	await manager.remove(name, global)
	const scope = global ? "global" : "local"
	if (!options.json) {
		logger.success(`Deleted ${scope} profile "${name}"`)
	}

	return { name, scope }
}
