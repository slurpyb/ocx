/**
 * Ghost Search Command
 *
 * Search for components using ghost mode registries.
 * Thin wrapper around the core search logic using GhostConfigProvider.
 */

import type { Command } from "commander"
import { Option } from "commander"
import { GhostConfigProvider } from "../../config/provider.js"
import { handleError, logger, outputJson } from "../../utils/index.js"
import { addCommonOptions, addVerboseOption } from "../../utils/shared-options.js"
import { runSearchCore } from "../search.js"

interface GhostSearchOptions {
	cwd: string
	json: boolean
	quiet: boolean
	verbose: boolean
	limit: number
}

export function registerGhostSearchCommand(parent: Command): void {
	const cmd = parent
		.command("search")
		.alias("list")
		.description("Search for components using ghost mode registries")
		.argument("[query]", "Search query")
		.addOption(new Option("-l, --limit <n>", "Limit results").default("20"))

	addCommonOptions(cmd)
	addVerboseOption(cmd)

	cmd.action(async (query: string | undefined, options: GhostSearchOptions) => {
		try {
			const limit = parseInt(String(options.limit), 10)
			const provider = await GhostConfigProvider.create(options.cwd)

			// Guard: Check ghost has registries configured
			const registries = provider.getRegistries()
			if (Object.keys(registries).length === 0) {
				if (options.json) {
					outputJson({ success: true, data: { components: [] } })
				} else {
					logger.info("No registries configured in ghost mode.")
					logger.info("Run 'ocx ghost registry add <url>' to add a registry.")
				}
				return
			}

			await runSearchCore(query, { ...options, limit }, provider)
		} catch (error) {
			handleError(error, { json: options.json })
		}
	})
}
