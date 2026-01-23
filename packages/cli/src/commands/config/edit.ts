/**
 * Config Edit Command
 *
 * Open configuration file in the user's preferred editor.
 * --global: edit global ocx.jsonc
 * --profile: edit profile ocx.jsonc
 * default: edit local .opencode/ocx.jsonc
 */

import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { Command } from "commander"
import {
	findLocalConfigDir,
	getGlobalConfig,
	getProfileDir,
	LOCAL_CONFIG_DIR,
	OCX_CONFIG_FILE,
} from "../../profile/paths"
import { ConfigError } from "../../utils/errors"
import { handleError, logger } from "../../utils/index"
import { resolveTargetScope } from "../../utils/scope"
import { addCommonOptions, addProfileOption } from "../../utils/shared-options"

interface ConfigEditOptions {
	global?: boolean
	profile?: string
	cwd?: string
}

export function registerConfigEditCommand(parent: Command): void {
	const cmd = parent.command("edit").description("Open configuration file in editor")

	addProfileOption(cmd)
	addCommonOptions(cmd)
	cmd.option("-g, --global", "Edit global ocx.jsonc")

	cmd.action(async (options: ConfigEditOptions, command: Command) => {
		try {
			const isCwdExplicit = command.getOptionValueSource("cwd") === "cli"
			await runConfigEdit(options, isCwdExplicit)
		} catch (error) {
			handleError(error)
		}
	})
}

async function runConfigEdit(options: ConfigEditOptions, isCwdExplicit: boolean): Promise<void> {
	const { global: isGlobal, profile } = options

	// Validate mutual exclusivity using scope helper (throws on conflict)
	resolveTargetScope({ ...options, isCwdExplicit })

	let configPath: string

	if (isGlobal) {
		// Edit global config - must exist
		configPath = getGlobalConfig()
		if (!existsSync(configPath)) {
			throw new ConfigError(
				`Global config not found at ${configPath}.\nRun 'ocx init --global' first.`,
			)
		}
	} else if (profile) {
		// Edit profile config - must exist (don't auto-create profiles via config edit)
		configPath = join(getProfileDir(profile), OCX_CONFIG_FILE)
		if (!existsSync(configPath)) {
			throw new ConfigError(
				`Profile '${profile}' config not found.\nRun 'ocx profile add ${profile}' first.`,
			)
		}
	} else {
		// Edit local config - create if doesn't exist
		const localConfigDir = findLocalConfigDir(options.cwd || process.cwd())
		if (localConfigDir) {
			configPath = join(localConfigDir, OCX_CONFIG_FILE)
		} else {
			// Create .opencode directory if it doesn't exist
			const newConfigDir = join(options.cwd || process.cwd(), LOCAL_CONFIG_DIR)
			await mkdir(newConfigDir, { recursive: true })
			configPath = join(newConfigDir, OCX_CONFIG_FILE)

			// Create empty config file if it doesn't exist
			if (!existsSync(configPath)) {
				const defaultConfig = {
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: {},
				}
				await Bun.write(configPath, JSON.stringify(defaultConfig, null, 2))
				logger.info(`Created ${configPath}`)
			}
		}
	}

	const editor = process.env.EDITOR || process.env.VISUAL || "vi"

	const proc = Bun.spawn([editor, configPath], {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	})

	const exitCode = await proc.exited
	if (exitCode !== 0) {
		throw new Error(`Editor exited with code ${exitCode}`)
	}
}
