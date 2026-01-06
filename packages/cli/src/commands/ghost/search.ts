/**
 * Ghost Search Command
 *
 * Search for components using ghost mode registries.
 * Thin wrapper around the core search logic using GhostConfigProvider.
 */

import type { Command } from "commander"
import { InvalidArgumentError, Option } from "commander"
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

/**
 * Parses and validates a positive integer from CLI input.
 * @param value - The string value from CLI
 * @returns The parsed positive integer
 * @throws InvalidArgumentError if value is not a positive integer
 */
function parsePositiveInt(value: string): number {
	const parsed = parseInt(value, 10)
	if (Number.isNaN(parsed) || parsed <= 0) {
		throw new InvalidArgumentError("Must be a positive integer")
	}
	return parsed
}

export function registerGhostSearchCommand(parent: Command): void {
	const cmd = parent
		.command("search")
		.alias("list")
		.description("Search for components using ghost mode registries")
		.argument("[query]", "Search query")
		.addOption(
			new Option("-l, --limit <n>", "Limit results").default(20).argParser(parsePositiveInt),
		)

	addCommonOptions(cmd)
	addVerboseOption(cmd)

	cmd.action(async (query: string | undefined, options: GhostSearchOptions) => {
		try {
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

			await runSearchCore(query, options, provider)
		} catch (error) {
			handleError(error, { json: options.json })
		}
	})
}
