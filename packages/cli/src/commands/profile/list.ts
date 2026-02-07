/**
 * Profile List Command
 *
 * List all available profiles in the selected scope.
 * Defaults to local profiles (.opencode/profiles/).
 * Use --global for global profiles (~/.config/opencode/profiles/).
 */

import type { Command } from "commander"
import { ProfileManager } from "../../profile/manager"
import { handleError } from "../../utils/handle-error"
import { sharedOptions } from "../../utils/shared-options"

interface ProfileListOptions {
	global?: boolean
	json?: boolean
}

export function registerProfileListCommand(parent: Command): void {
	parent
		.command("list")
		.alias("ls")
		.description("List profiles (local by default; use --global for global scope)")
		.option("-g, --global", "List global profiles (default: local)")
		.addOption(sharedOptions.json())
		.action(async (options: ProfileListOptions) => {
			try {
				await runProfileList(options)
			} catch (error) {
				handleError(error, { json: options.json })
			}
		})
}

async function runProfileList(options: ProfileListOptions): Promise<void> {
	const manager = await ProfileManager.requireInitialized()
	const global = options.global ?? false

	const profiles = await manager.list(global)

	if (options.json) {
		console.log(JSON.stringify({ profiles, initialized: true }, null, 2))
		return
	}

	const heading = global ? "Global profiles:" : "Local profiles:"
	const createHint = global
		? "No global profiles found. Run 'ocx profile add <name> --global' to create one."
		: "No local profiles found. Run 'ocx profile add <name>' to create one."

	// Guard: Handle empty profiles list
	if (profiles.length === 0) {
		console.log(createHint)
		return
	}

	// Display profiles
	console.log(heading)
	for (const name of profiles) {
		console.log(`  ${name}`)
	}
}
