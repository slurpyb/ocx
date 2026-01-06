/**
 * Ghost Add Command
 *
 * Add components using ghost mode configuration.
 * Thin wrapper around the core add logic using GhostConfigProvider.
 */

import type { Command } from "commander"
import { GhostConfigProvider } from "../../config/provider.js"
import { handleError } from "../../utils/index.js"
import {
	addCommonOptions,
	addConfirmationOptions,
	addVerboseOption,
} from "../../utils/shared-options.js"
import { type AddOptions, runAddCore } from "../add.js"

export function registerGhostAddCommand(parent: Command): void {
	const cmd = parent
		.command("add")
		.description("Add components using ghost mode registries")
		.argument("<components...>", "Components to install")
		.option("--dry-run", "Show what would be installed without making changes")
		.option("--skip-compat-check", "Skip version compatibility checks")

	addCommonOptions(cmd)
	addConfirmationOptions(cmd)
	addVerboseOption(cmd)

	cmd.action(async (components: string[], options: AddOptions) => {
		try {
			const provider = await GhostConfigProvider.create(options.cwd ?? process.cwd())
			await runAddCore(components, options, provider)
		} catch (error) {
			handleError(error, { json: options.json })
		}
	})
}
