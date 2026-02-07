/**
 * Profile Show Command
 *
 * Display detailed information about a profile.
 * Shows the profile name, file paths, and OCX config contents.
 */

import type { Command } from "commander"
import { ProfileManager } from "../../profile/manager"
import {
	getLocalProfileAgents,
	getLocalProfileOcxConfig,
	getLocalProfileOpencodeConfig,
	getProfileAgents,
	getProfileOcxConfig,
	getProfileOpencodeConfig,
} from "../../profile/paths"
import { handleError } from "../../utils/handle-error"
import { sharedOptions } from "../../utils/shared-options"

interface ProfileShowOptions {
	global?: boolean
	json?: boolean
}

export function registerProfileShowCommand(parent: Command): void {
	parent
		.command("show [name]")
		.description("Display profile contents (local by default; use --global for global scope)")
		.option("-g, --global", "Show global profile (default: local)")
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
	const manager = await ProfileManager.requireInitialized()
	const global = options.global ?? false

	// Use provided name or resolve profile (flag > env > default)
	const profileName = name ?? (await manager.resolveProfile(undefined, global))
	const profile = await manager.get(profileName, global)
	const getOcxPath = global ? getProfileOcxConfig : getLocalProfileOcxConfig
	const getOpencodePath = global ? getProfileOpencodeConfig : getLocalProfileOpencodeConfig
	const getAgentsPath = global ? getProfileAgents : getLocalProfileAgents

	if (options.json) {
		console.log(JSON.stringify(profile, null, 2))
		return
	}

	// Human-readable output
	console.log(`Profile: ${profile.name}`)
	console.log(`\nFiles:`)
	console.log(`  ocx.jsonc: ${getOcxPath(profileName)}`)

	if (profile.opencode) {
		console.log(`  opencode.jsonc: ${getOpencodePath(profileName)}`)
	}

	if (profile.hasAgents) {
		console.log(`  AGENTS.md: ${getAgentsPath(profileName)}`)
	}

	console.log(`\nOCX Config:`)
	console.log(JSON.stringify(profile.ocx, null, 2))
}
