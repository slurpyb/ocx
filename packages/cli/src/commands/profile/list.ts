/**
 * Profile List Command
 *
 * List all available profiles.
 * Profiles are global-only; local scope is unsupported and produces a hard error.
 * Use --global (required) to list global profiles (~/.config/opencode/profiles/).
 */

import type { Command } from "commander"
import { ProfileManager } from "../../profile/manager"
import { ConfigError } from "../../utils/errors"
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
		.description("List profiles (use --global; local profiles are unsupported)")
		.option("-g, --global", "List global profiles (required — local profiles are unsupported)")
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
	// Guard: local scope is unsupported (Law 1: Early Exit, Law 4: Fail Fast)
	if (!options.global) {
		throw new ConfigError(
			"Local profiles are unsupported. Use --global to list global profiles.\n\n" +
				"  ocx profile list --global",
		)
	}

	const manager = await ProfileManager.requireInitialized()

	const profiles = await manager.list()

	if (options.json) {
		console.log(JSON.stringify({ profiles, initialized: true }, null, 2))
		return
	}

	const heading = "Global profiles:"
	const createHint =
		"No global profiles found. Run 'ocx profile add <name> --global' to create one."

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
