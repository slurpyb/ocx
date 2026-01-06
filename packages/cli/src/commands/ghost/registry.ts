/**
 * Ghost Registry Commands
 *
 * Manage registries in the ghost configuration.
 * Thin wrapper around core registry functions using GhostConfigProvider.
 */

import type { Command } from "commander"
import kleur from "kleur"
import { ghostConfigExists, loadGhostConfig, saveGhostConfig } from "../../ghost/config.js"
import { GhostNotInitializedError } from "../../utils/errors.js"
import { handleError, logger, outputJson } from "../../utils/index.js"
import { addOutputOptions } from "../../utils/shared-options.js"
import {
	type RegistryAddOptions,
	type RegistryOptions,
	runRegistryAddCore,
	runRegistryListCore,
	runRegistryRemoveCore,
} from "../registry.js"

/**
 * Ensure ghost mode is initialized before proceeding.
 * Throws GhostNotInitializedError if not.
 */
async function ensureGhostInitialized(): Promise<void> {
	const exists = await ghostConfigExists()
	if (!exists) {
		throw new GhostNotInitializedError()
	}
}

export function registerGhostRegistryCommand(parent: Command): void {
	const registry = parent.command("registry").description("Manage ghost mode registries")

	// ghost registry add <url> [--name <name>]
	const addCmd = registry
		.command("add")
		.description("Add a registry to ghost config")
		.argument("<url>", "Registry URL")
		.option("--name <name>", "Registry alias (defaults to hostname)")

	addOutputOptions(addCmd)

	addCmd.action(async (url: string, options: RegistryAddOptions) => {
		try {
			await ensureGhostInitialized()
			const config = await loadGhostConfig()

			const result = await runRegistryAddCore(url, options, {
				getRegistries: () => config.registries,
				setRegistry: async (name, regConfig) => {
					config.registries[name] = regConfig
					await saveGhostConfig(config)
				},
			})

			if (options.json) {
				outputJson({ success: true, data: result })
			} else if (!options.quiet) {
				if (result.updated) {
					logger.success(`Updated registry: ${result.name} -> ${result.url}`)
				} else {
					logger.success(`Added registry: ${result.name} -> ${result.url}`)
				}
			}
		} catch (error) {
			handleError(error, { json: options.json })
		}
	})

	// ghost registry remove <name>
	const removeCmd = registry
		.command("remove")
		.description("Remove a registry from ghost config")
		.argument("<name>", "Registry name to remove")

	addOutputOptions(removeCmd)

	removeCmd.action(async (name: string, options: RegistryOptions) => {
		try {
			await ensureGhostInitialized()
			const config = await loadGhostConfig()

			const result = await runRegistryRemoveCore(name, {
				getRegistries: () => config.registries,
				removeRegistry: async (regName) => {
					delete config.registries[regName]
					await saveGhostConfig(config)
				},
			})

			if (options.json) {
				outputJson({ success: true, data: result })
			} else if (!options.quiet) {
				logger.success(`Removed registry: ${result.removed}`)
			}
		} catch (error) {
			handleError(error, { json: options.json })
		}
	})

	// ghost registry list
	const listCmd = registry.command("list").description("List configured registries")

	addOutputOptions(listCmd)

	listCmd.action(async (options: RegistryOptions) => {
		try {
			await ensureGhostInitialized()
			const config = await loadGhostConfig()

			const result = runRegistryListCore({
				getRegistries: () => config.registries,
			})

			if (options.json) {
				outputJson({ success: true, data: result })
			} else if (!options.quiet) {
				if (result.registries.length === 0) {
					logger.info("No registries configured.")
					logger.info("Add one with: ocx ghost registry add <url>")
				} else {
					logger.info("Ghost mode registries:")
					for (const reg of result.registries) {
						console.log(`  ${kleur.cyan(reg.name)}: ${reg.url} ${kleur.dim(`(${reg.version})`)}`)
					}
				}
			}
		} catch (error) {
			handleError(error, { json: options.json })
		}
	})
}
