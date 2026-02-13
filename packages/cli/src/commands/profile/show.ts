/**
 * Profile Show Command
 *
 * Display detailed information about a profile.
 * Shows the profile name, file paths, and OCX config contents.
 * Profiles are global-only; local scope is unsupported and produces a hard error.
 */

import type { Command } from "commander"
import { ProfileManager } from "../../profile/manager"
import {
	getProfileAgents,
	getProfileOcxConfig,
	getProfileOpencodeConfig,
} from "../../profile/paths"
import { ConfigError } from "../../utils/errors"
import { handleError } from "../../utils/handle-error"
import { sharedOptions } from "../../utils/shared-options"

interface ProfileShowOptions {
	global?: boolean
	json?: boolean
}

export function registerProfileShowCommand(parent: Command): void {
	parent
		.command("show [name]")
		.description("Display profile contents (use --global; local profiles are unsupported)")
		.option("-g, --global", "Show global profile (required — local profiles are unsupported)")
		.addOption(sharedOptions.json())
		.action(async (name: string | undefined, options: ProfileShowOptions) => {
			try {
				await runProfileShow(name, options)
			} catch (error) {
				handleError(error, { json: options.json })
			}
		})
}

async function runProfileShow(
	name: string | undefined,
	options: ProfileShowOptions,
): Promise<void> {
	// Guard: local scope is unsupported (Law 1: Early Exit, Law 4: Fail Fast)
	if (!options.global) {
		throw new ConfigError(
			"Local profiles are unsupported. Use --global to show a global profile.\n\n" +
				"  ocx profile show [name] --global",
		)
	}

	const manager = await ProfileManager.requireInitialized()

	// Use provided name or resolve profile (flag > env > default)
	const profileName = name ?? (await manager.resolveProfile())
	const profile = await manager.get(profileName)

	if (options.json) {
		console.log(JSON.stringify(profile, null, 2))
		return
	}

	// Human-readable output
	console.log(`Profile: ${profile.name}`)
	console.log(`\nFiles:`)
	console.log(`  ocx.jsonc: ${getProfileOcxConfig(profileName)}`)

	if (profile.opencode) {
		console.log(`  opencode.jsonc: ${getProfileOpencodeConfig(profileName)}`)
	}

	if (profile.hasAgents) {
		console.log(`  AGENTS.md: ${getProfileAgents(profileName)}`)
	}

	console.log(`\nOCX Config:`)
	console.log(JSON.stringify(profile.ocx, null, 2))
}
