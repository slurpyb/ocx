/**
 * OCX CLI - migrate command
 *
 * Converts legacy ocx.lock state to .ocx/receipt.jsonc format and
 * normalizes deprecated registry config fields.
 *
 * Default: preview/dry-run (no writes). Use --apply to perform migration.
 * Default scope: local (cwd). Use --global for global config path.
 */

import { existsSync, readFileSync } from "node:fs"
import { rename, writeFile } from "node:fs/promises"

import type { Command } from "commander"
import { applyEdits, type ModificationOptions, modify, parse as parseJsonc } from "jsonc-parser"
import {
	findOcxConfig,
	findOcxLock,
	findReceipt,
	readOcxConfig,
	readOcxLock,
	writeReceipt,
} from "../../schemas/config"
import { ConfigError, handleError, logger, ValidationError } from "../../utils/index"
import { getGlobalConfigPath } from "../../utils/paths"
import {
	buildReceiptFromLock,
	type ConfigNormalizationAction,
	detectConfigNormalization,
	type MigrateResult,
	type MigrateScope,
} from "./transform"

export interface MigrateOptions {
	cwd?: string
	global?: boolean
	apply?: boolean
	json?: boolean
	quiet?: boolean
}

export function registerMigrateCommand(program: Command): void {
	program
		.command("migrate")
		.description("Migrate legacy ocx.lock to receipt format (.ocx/receipt.jsonc)")
		.option("--global", "Migrate global config scope")
		.option("--apply", "Apply migration (default is dry-run preview)")
		.option("--json", "Output as JSON")
		.option("-q, --quiet", "Suppress output")
		.option("--cwd <path>", "Working directory")
		.action(async (options: MigrateOptions) => {
			try {
				await runMigrate(options)
			} catch (error) {
				handleError(error, { json: options.json })
			}
		})
}

// =============================================================================
// CORE LOGIC
// =============================================================================

async function runMigrate(options: MigrateOptions): Promise<void> {
	const scope: MigrateScope = options.global ? "global" : "local"
	const root = resolveRoot(options)
	const isFlattened = options.global === true

	// Detect config normalization needs (pre-Zod raw parse)
	const configActions = detectConfigActionsForScope(root)

	// Detect state: receipt exists?
	const receipt = findReceipt(root)

	// Guard: already migrated (receipt exists) and no config normalization needed → safe no-op
	if (receipt.exists && configActions.length === 0) {
		const result: MigrateResult = {
			success: true,
			status: "already_v2",
			scope,
			count: 0,
			components: [],
			configActions: [],
		}

		if (options.json) {
			console.log(JSON.stringify(result, null, 2))
			return
		}

		if (!options.quiet) {
			logger.success(`[${scope}] Already migrated to receipt format (.ocx/receipt.jsonc).`)
		}
		return
	}

	// Detect state: legacy lock exists?
	const lockInfo = findOcxLock(root, { isFlattened })

	// Guard: no lock, no receipt, no config actions → nothing to do
	if (!lockInfo.exists && !receipt.exists && configActions.length === 0) {
		const result: MigrateResult = {
			success: true,
			status: "nothing_to_migrate",
			scope,
			count: 0,
			components: [],
			configActions: [],
		}

		if (options.json) {
			console.log(JSON.stringify(result, null, 2))
			return
		}

		if (!options.quiet) {
			logger.info(`[${scope}] Nothing to migrate. No legacy ocx.lock found.`)
		}
		return
	}

	// Build lock migration plan (if lock exists and receipt doesn't)
	let lockMigrationPlan: {
		newReceipt: import("../../schemas/config").Receipt
		components: MigrateResult["components"]
	} | null = null

	if (lockInfo.exists && !receipt.exists) {
		// Parse legacy lock and config
		const lock = await readOcxLock(root, { isFlattened })
		if (!lock) {
			throw new ValidationError(
				"Failed to parse ocx.lock. The lock file exists but could not be read or contains invalid data.",
			)
		}

		const config = await readOcxConfig(root)
		if (!config) {
			throw new ConfigError(
				"No ocx.jsonc found. The config is required to resolve registry URLs during migration.",
			)
		}

		const { receipt: newReceipt, components } = buildReceiptFromLock(lock, config, root)
		lockMigrationPlan = { newReceipt, components }
	}

	const components = lockMigrationPlan?.components ?? []
	const count = components.length

	// Preview mode (default): show plan, no writes
	if (!options.apply) {
		const result: MigrateResult = {
			success: true,
			status: "preview",
			scope,
			count,
			components,
			configActions,
		}

		if (options.json) {
			console.log(JSON.stringify(result, null, 2))
			return
		}

		if (!options.quiet) {
			if (count > 0) {
				logger.info(`[${scope}] Migration preview: ${count} component(s) would be migrated.`)
				logger.break()

				for (const comp of components) {
					logger.info(`  ${comp.legacyKey} → ${comp.canonicalId}`)
				}
				logger.break()
			}

			if (configActions.length > 0) {
				logger.info(
					`[${scope}] Config normalization: ${configActions.length} deprecated field(s) would be removed.`,
				)
				for (const action of configActions) {
					logger.info(`  registries.${action.registry}.${action.field} → remove`)
				}
				logger.break()
			}

			if (count === 0 && configActions.length === 0) {
				logger.info(`[${scope}] Nothing to migrate.`)
			} else {
				logger.info("No changes made. Run with --apply to perform migration.")
			}
		}
		return
	}

	// Apply mode: write receipt, rename lock → .bak, normalize config
	if (lockMigrationPlan) {
		await writeReceipt(root, lockMigrationPlan.newReceipt)

		const bakPath = resolveBackupPath(lockInfo.path)
		await rename(lockInfo.path, bakPath)

		if (!options.json && !options.quiet) {
			logger.success(
				`[${scope}] Migrated ${count} component(s) to receipt format (.ocx/receipt.jsonc).`,
			)
			logger.break()

			for (const comp of components) {
				logger.success(`  ✓ ${comp.legacyKey} → ${comp.canonicalId}`)
			}

			logger.break()
			logger.info(`Legacy lock backed up to: ${bakPath}`)
		}
	}

	// Apply config normalization
	if (configActions.length > 0) {
		await applyConfigNormalizationToFile(root, configActions)

		if (!options.json && !options.quiet) {
			if (lockMigrationPlan) logger.break()
			logger.success(`[${scope}] Normalized ${configActions.length} deprecated config field(s).`)
			for (const action of configActions) {
				logger.success(`  ✓ registries.${action.registry}.${action.field} removed`)
			}
		}
	}

	const didWrite = lockMigrationPlan !== null || configActions.length > 0
	const result: MigrateResult = {
		success: true,
		status: didWrite ? "migrated" : "already_v2",
		scope,
		count,
		components,
		configActions,
	}

	if (options.json) {
		console.log(JSON.stringify(result, null, 2))
		return
	}

	// If no lock migration and only config actions, summarize
	if (!lockMigrationPlan && configActions.length > 0 && !options.quiet) {
		logger.break()
		logger.success(`[${scope}] Config normalization complete.`)
	}
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Resolve the migration root directory.
 *
 * - Local mode: uses --cwd or process.cwd()
 * - Global mode: uses --cwd if explicit, otherwise getGlobalConfigPath()
 *
 * This allows tests to override the global path via --cwd.
 */
function resolveRoot(options: MigrateOptions): string {
	if (options.global) {
		return options.cwd ?? getGlobalConfigPath()
	}
	return options.cwd ?? process.cwd()
}

/**
 * Resolve a non-colliding backup path for the lock file.
 * Tries `.bak`, then `.bak.1`, `.bak.2`, etc.
 */
function resolveBackupPath(lockPath: string): string {
	const base = `${lockPath}.bak`
	if (!existsSync(base)) return base

	for (let i = 1; i <= 100; i++) {
		const candidate = `${base}.${i}`
		if (!existsSync(candidate)) return candidate
	}

	// Fallback: timestamp-based (effectively unreachable)
	return `${base}.${Date.now()}`
}

/**
 * Read raw config (pre-Zod) to detect deprecated fields.
 * Returns empty actions if no config file is found.
 */
function detectConfigActionsForScope(root: string): ConfigNormalizationAction[] {
	const configInfo = findOcxConfig(root)
	if (!configInfo.exists) return []

	try {
		const raw = readFileSync(configInfo.path, "utf-8")
		const parsed = parseJsonc(raw, [], { allowTrailingComma: true })
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return []

		return detectConfigNormalization(parsed as Record<string, unknown>)
	} catch {
		return []
	}
}

/**
 * Formatting options for jsonc-parser edits during config normalization.
 * Matches the project's standard 2-space tab convention for JSON configs.
 */
const JSONC_EDIT_OPTIONS: ModificationOptions = {
	formattingOptions: {
		tabSize: 2,
		insertSpaces: true,
		eol: "\n",
	},
}

/**
 * Apply config normalization by removing deprecated fields in-place.
 * Uses jsonc-parser's modify/applyEdits to preserve JSONC comments and formatting.
 * Deterministic and idempotent: each action maps to a single property removal.
 */
async function applyConfigNormalizationToFile(
	root: string,
	actions: ConfigNormalizationAction[],
): Promise<void> {
	if (actions.length === 0) return

	const configInfo = findOcxConfig(root)
	if (!configInfo.exists) return

	let content = readFileSync(configInfo.path, "utf-8")

	for (const action of actions) {
		const edits = modify(
			content,
			["registries", action.registry, action.field],
			undefined,
			JSONC_EDIT_OPTIONS,
		)
		content = applyEdits(content, edits)
	}

	await writeFile(configInfo.path, content)
}
