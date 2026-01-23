/**
 * Registry Command
 *
 * Manage configured registries.
 */

import type { Command } from "commander"
import kleur from "kleur"
import type { RegistryConfig } from "../schemas/config"
import { findOcxConfig, readOcxConfig, writeOcxConfig } from "../schemas/config"
import { handleError, logger, outputJson } from "../utils/index"
import { resolveTargetScope } from "../utils/scope"
import { addCommonOptions, addGlobalOption, addProfileOption } from "../utils/shared-options"

export interface RegistryOptions {
	cwd: string
	json?: boolean
	quiet?: boolean
	global?: boolean
	profile?: string
}

export interface RegistryAddOptions extends RegistryOptions {
	name?: string
	version?: string
}

// =============================================================================
// CORE FUNCTIONS (used by both standard and profile commands)
// =============================================================================

/**
 * Core logic for adding a registry.
 * @param url Registry URL
 * @param options Options including optional name, version
 * @param callbacks Callbacks for reading/writing config
 */
export async function runRegistryAddCore(
	url: string,
	options: RegistryAddOptions,
	callbacks: {
		getRegistries: () => Record<string, RegistryConfig>
		isLocked?: () => boolean
		setRegistry: (name: string, config: RegistryConfig) => Promise<void>
	},
): Promise<{ name: string; url: string; updated: boolean }> {
	// Guard: Check registries aren't locked
	if (callbacks.isLocked?.()) {
		throw new Error("Registries are locked. Cannot add.")
	}

	// Derive name from URL if not provided
	const name = options.name || new URL(url).hostname.replace(/\./g, "-")

	const registries = callbacks.getRegistries()
	const isUpdate = name in registries

	await callbacks.setRegistry(name, {
		url,
		version: options.version,
	})

	return { name, url, updated: isUpdate }
}

/**
 * Core logic for removing a registry.
 * @param name Registry name to remove
 * @param callbacks Callbacks for reading/writing config
 */
export async function runRegistryRemoveCore(
	name: string,
	callbacks: {
		getRegistries: () => Record<string, RegistryConfig>
		isLocked?: () => boolean
		removeRegistry: (name: string) => Promise<void>
	},
): Promise<{ removed: string }> {
	// Guard: Check registries aren't locked
	if (callbacks.isLocked?.()) {
		throw new Error("Registries are locked. Cannot remove.")
	}

	const registries = callbacks.getRegistries()
	if (!(name in registries)) {
		throw new Error(`Registry '${name}' not found.`)
	}

	await callbacks.removeRegistry(name)
	return { removed: name }
}

/**
 * Core logic for listing registries.
 * @param callbacks Callbacks for reading config
 */
export function runRegistryListCore(callbacks: {
	getRegistries: () => Record<string, RegistryConfig>
	isLocked?: () => boolean
}): { registries: Array<{ name: string; url: string; version: string }>; locked: boolean } {
	const registries = callbacks.getRegistries()
	const locked = callbacks.isLocked?.() ?? false

	const list = Object.entries(registries).map(([name, cfg]) => ({
		name,
		url: cfg.url,
		version: cfg.version || "latest",
	}))

	return { registries: list, locked }
}

// =============================================================================
// COMMAND REGISTRATION
// =============================================================================

export function registerRegistryCommand(program: Command): void {
	const registry = program.command("registry").description("Manage registries")

	// registry add <url> [--name <name>]
	const addCmd = registry
		.command("add")
		.description("Add a registry")
		.argument("<url>", "Registry URL")
		.option("--name <name>", "Registry alias (defaults to hostname)")
		.option("--version <version>", "Pin to specific version")

	addGlobalOption(addCmd)
	addProfileOption(addCmd)
	addCommonOptions(addCmd)

	addCmd.action(async (url: string, options: RegistryAddOptions, command: Command) => {
		try {
			// Resolve target directory using scope helper
			const isCwdExplicit = command.getOptionValueSource("cwd") === "cli"
			const targetDir = resolveTargetScope({ ...options, isCwdExplicit })

			// Find and read config from target directory
			const found = findOcxConfig(targetDir)
			const configPath = found.path
			const config = await readOcxConfig(targetDir)

			if (!config) {
				const hint = options.global
					? "Run 'ocx init --global' first."
					: options.profile
						? `Run 'ocx profile add ${options.profile}' first.`
						: "Run 'ocx init' first."
				logger.error(`No ocx.jsonc found in target scope. ${hint}`)
				process.exit(1)
			}

			const result = await runRegistryAddCore(url, options, {
				getRegistries: () => config.registries,
				isLocked: () => config.lockRegistries ?? false,
				setRegistry: async (name, regConfig) => {
					config.registries[name] = regConfig
					await writeOcxConfig(targetDir, config, configPath)
				},
			})

			if (options.json) {
				outputJson({ success: true, data: result })
			} else if (!options.quiet) {
				const location = options.global
					? "global"
					: options.profile
						? `profile '${options.profile}'`
						: "local"
				if (result.updated) {
					logger.success(`Updated registry in ${location} config: ${result.name} -> ${result.url}`)
				} else {
					logger.success(`Added registry to ${location} config: ${result.name} -> ${result.url}`)
				}
			}
		} catch (error) {
			handleError(error, { json: options.json })
		}
	})

	// registry remove <name>
	const removeCmd = registry
		.command("remove")
		.description("Remove a registry")
		.argument("<name>", "Registry name")

	addGlobalOption(removeCmd)
	addProfileOption(removeCmd)
	addCommonOptions(removeCmd)

	removeCmd.action(async (name: string, options: RegistryOptions, command: Command) => {
		try {
			// Resolve target directory using scope helper
			const isCwdExplicit = command.getOptionValueSource("cwd") === "cli"
			const targetDir = resolveTargetScope({ ...options, isCwdExplicit })

			// Find and read config from target directory
			const found = findOcxConfig(targetDir)
			const configPath = found.path
			const config = await readOcxConfig(targetDir)

			if (!config) {
				const hint = options.global
					? "Run 'ocx init --global' first."
					: options.profile
						? `Run 'ocx profile add ${options.profile}' first.`
						: "Run 'ocx init' first."
				logger.error(`No ocx.jsonc found in target scope. ${hint}`)
				process.exit(1)
			}

			const result = await runRegistryRemoveCore(name, {
				getRegistries: () => config.registries,
				isLocked: () => config.lockRegistries ?? false,
				removeRegistry: async (regName) => {
					delete config.registries[regName]
					await writeOcxConfig(targetDir, config, configPath)
				},
			})

			if (options.json) {
				outputJson({ success: true, data: result })
			} else if (!options.quiet) {
				const location = options.global
					? "global"
					: options.profile
						? `profile '${options.profile}'`
						: "local"
				logger.success(`Removed registry from ${location} config: ${result.removed}`)
			}
		} catch (error) {
			handleError(error, { json: options.json })
		}
	})

	// registry list
	const listCmd = registry.command("list").description("List configured registries")

	addGlobalOption(listCmd)
	addProfileOption(listCmd)
	addCommonOptions(listCmd)

	listCmd.action(async (options: RegistryOptions, command: Command) => {
		try {
			// Resolve target directory using scope helper
			const isCwdExplicit = command.getOptionValueSource("cwd") === "cli"
			const targetDir = resolveTargetScope({ ...options, isCwdExplicit })

			// Read config from target directory
			const config = await readOcxConfig(targetDir)

			if (!config) {
				const hint = options.global
					? "Run 'ocx init --global' first."
					: options.profile
						? `Run 'ocx profile add ${options.profile}' first.`
						: "Run 'ocx init' first."
				logger.warn(`No ocx.jsonc found in target scope. ${hint}`)
				return
			}

			const result = runRegistryListCore({
				getRegistries: () => config.registries,
				isLocked: () => config.lockRegistries ?? false,
			})

			if (options.json) {
				outputJson({ success: true, data: result })
			} else if (!options.quiet) {
				if (result.registries.length === 0) {
					logger.info("No registries configured.")
				} else {
					const location = options.global
						? " (global)"
						: options.profile
							? ` (profile '${options.profile}')`
							: ""
					logger.info(
						`Configured registries${location}${result.locked ? kleur.yellow(" (locked)") : ""}:`,
					)
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
