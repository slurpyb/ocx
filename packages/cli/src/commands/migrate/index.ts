/**
 * OCX CLI - migrate command
 *
 * Converts legacy ocx.lock state to .ocx/receipt.jsonc format and
 * normalizes deprecated registry config fields.
 *
 * Default: preview/dry-run (no writes). Use --apply to perform migration.
 * Default scope: local (cwd). Use --global for global config path + profiles.
 *
 * --global processes:
 *   1) Global root (~/.config/opencode / getGlobalConfigPath())
 *   2) All global profiles under <globalRoot>/profiles/*
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

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
	type TargetResult,
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
		.option("--global", "Migrate global config scope (includes profiles)")
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
	if (options.global) {
		await runGlobalMigrate(options)
		return
	}

	await runSingleTargetMigrate(options, "local", resolveRoot(options), false)
}

// =============================================================================
// GLOBAL MULTI-TARGET MIGRATION
// =============================================================================

/**
 * Run migration across global root and all global profiles.
 *
 * Ordering: root first, then profiles sorted by name.
 * On apply: continues after target failure, exits non-zero with summary.
 */
async function runGlobalMigrate(options: MigrateOptions): Promise<void> {
	const globalRoot = options.cwd ?? getGlobalConfigPath()
	const targets = discoverGlobalTargets(globalRoot)

	// Preview mode: collect results from all targets, no writes
	if (!options.apply) {
		const targetResults: TargetResult[] = []

		for (const { label, path: targetPath } of targets) {
			const result = await analyzeTarget(targetPath, true)
			targetResults.push({ ...result, target: label })
		}

		const aggregated = aggregateResults(targetResults, "global", false)

		if (options.json) {
			console.log(JSON.stringify(aggregated, null, 2))
			return
		}

		if (!options.quiet) {
			logGlobalPreview(targetResults, aggregated)
		}
		return
	}

	// Apply mode: migrate each target, continue on failure
	const targetResults: TargetResult[] = []
	let hasFailure = false

	for (const { label, path: targetPath } of targets) {
		try {
			const result = await applyTarget(targetPath, true)
			targetResults.push({ ...result, target: label })
		} catch (error) {
			hasFailure = true
			const errorMessage = error instanceof Error ? error.message : String(error)
			targetResults.push({
				target: label,
				status: "error",
				count: 0,
				components: [],
				configActions: [],
				error: errorMessage,
			})

			if (!options.json && !options.quiet) {
				logger.error(`[global:${label}] Migration failed: ${errorMessage}`)
			}
		}
	}

	const aggregated = aggregateResults(targetResults, "global", true)

	if (options.json) {
		console.log(JSON.stringify(aggregated, null, 2))
		if (hasFailure) process.exit(1)
		return
	}

	if (!options.quiet) {
		logGlobalApplySummary(targetResults, hasFailure)
	}

	if (hasFailure) process.exit(1)
}

/**
 * Discover all global migration targets: root + profile directories.
 * Returns root first, then profiles sorted alphabetically.
 */
function discoverGlobalTargets(globalRoot: string): Array<{ label: string; path: string }> {
	const targets: Array<{ label: string; path: string }> = []

	// Root target
	targets.push({ label: "root", path: globalRoot })

	// Profile targets
	const profilesDir = join(globalRoot, "profiles")
	if (existsSync(profilesDir) && statSync(profilesDir).isDirectory()) {
		const entries = readdirSync(profilesDir, { withFileTypes: true })
		const profileNames = entries
			.filter((e) => e.isDirectory() && !e.name.startsWith("."))
			.map((e) => e.name)
			.sort()

		for (const name of profileNames) {
			targets.push({ label: `profile:${name}`, path: join(profilesDir, name) })
		}
	}

	return targets
}

/**
 * Analyze a single target for migration state (no writes).
 * Parses lock files to provide accurate component counts in preview.
 */
async function analyzeTarget(
	root: string,
	isFlattened: boolean,
): Promise<Omit<TargetResult, "target">> {
	const configActions = detectConfigActionsForScope(root)
	const receipt = findReceipt(root)

	// Already migrated and no config normalization needed
	if (receipt.exists && configActions.length === 0) {
		return { status: "already_v2", count: 0, components: [], configActions: [] }
	}

	const lockInfo = findOcxLock(root, { isFlattened })

	// No lock, no receipt, no config actions → nothing to do
	if (!lockInfo.exists && !receipt.exists && configActions.length === 0) {
		return { status: "nothing_to_migrate", count: 0, components: [], configActions: [] }
	}

	// Parse lock to get accurate component count for preview
	let components: TargetResult["components"] = []
	if (lockInfo.exists && !receipt.exists) {
		try {
			const lock = await readOcxLock(root, { isFlattened })
			const config = await readOcxConfig(root)
			if (lock && config) {
				const built = buildReceiptFromLock(lock, config, root)
				components = built.components
			}
		} catch {
			// Preview can still proceed with count=0 if parsing fails
			logger.warn(
				`[preview] Could not parse lock/config at "${root}"; component count may be incomplete.`,
			)
		}
	}

	return { status: "preview", count: components.length, components, configActions }
}

/**
 * Apply migration to a single target. Returns the result.
 * Throws on error (caller handles continue-on-failure).
 */
async function applyTarget(
	root: string,
	isFlattened: boolean,
): Promise<Omit<TargetResult, "target">> {
	const configActions = detectConfigActionsForScope(root)
	const receipt = findReceipt(root)

	// Already migrated and no config normalization needed
	if (receipt.exists && configActions.length === 0) {
		return { status: "already_v2", count: 0, components: [], configActions: [] }
	}

	const lockInfo = findOcxLock(root, { isFlattened })

	// No lock, no receipt, no config actions → nothing to do
	if (!lockInfo.exists && !receipt.exists && configActions.length === 0) {
		return { status: "nothing_to_migrate", count: 0, components: [], configActions: [] }
	}

	// Build lock migration plan (if lock exists and receipt doesn't)
	let lockMigrationPlan: {
		newReceipt: import("../../schemas/config").Receipt
		components: TargetResult["components"]
	} | null = null

	if (lockInfo.exists && !receipt.exists) {
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

	// Write receipt and rename lock
	if (lockMigrationPlan) {
		await writeReceipt(root, lockMigrationPlan.newReceipt)
		const bakPath = resolveBackupPath(lockInfo.path)
		await rename(lockInfo.path, bakPath)
	}

	// Apply config normalization
	if (configActions.length > 0) {
		await applyConfigNormalizationToFile(root, configActions)
	}

	const didWrite = lockMigrationPlan !== null || configActions.length > 0
	return {
		status: didWrite ? "migrated" : "already_v2",
		count,
		components,
		configActions,
	}
}

/**
 * Aggregate per-target results into a single MigrateResult.
 * Preserves top-level keys for compatibility.
 */
function aggregateResults(
	targetResults: TargetResult[],
	scope: MigrateScope,
	isApply: boolean,
): MigrateResult {
	const hasError = targetResults.some((t) => t.status === "error")
	const hasMigrated = targetResults.some((t) => t.status === "migrated" || t.status === "preview")
	const allAlready = targetResults.every(
		(t) => t.status === "already_v2" || t.status === "nothing_to_migrate",
	)

	const totalCount = targetResults.reduce((sum, t) => sum + t.count, 0)
	const allComponents = targetResults.flatMap((t) => t.components)
	const allConfigActions = targetResults.flatMap((t) => t.configActions)

	let overallStatus: MigrateResult["status"]
	if (hasError) {
		overallStatus = isApply ? "partial_failure" : "preview"
	} else if (allAlready) {
		// Distinguish between "all already_v2" vs "all nothing_to_migrate"
		const allNothing = targetResults.every((t) => t.status === "nothing_to_migrate")
		overallStatus = allNothing ? "nothing_to_migrate" : "already_v2"
	} else if (isApply) {
		overallStatus = hasMigrated ? "migrated" : "already_v2"
	} else {
		overallStatus = hasMigrated ? "preview" : "already_v2"
	}

	return {
		success: !hasError,
		status: overallStatus,
		scope,
		count: totalCount,
		components: allComponents,
		configActions: allConfigActions,
		targets: targetResults,
	}
}

// =============================================================================
// SINGLE TARGET MIGRATION (preserves existing local behavior)
// =============================================================================

async function runSingleTargetMigrate(
	options: MigrateOptions,
	scope: MigrateScope,
	root: string,
	isFlattened: boolean,
): Promise<void> {
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
// GLOBAL OUTPUT HELPERS
// =============================================================================

function logGlobalPreview(targetResults: TargetResult[], aggregated: MigrateResult): void {
	if (aggregated.status === "nothing_to_migrate") {
		logger.info("[global] Nothing to migrate across all targets.")
		return
	}

	if (aggregated.status === "already_v2") {
		logger.success("[global] All targets already migrated.")
		return
	}

	logger.info(`[global] Migration preview across ${targetResults.length} target(s):`)
	logger.break()

	for (const t of targetResults) {
		const actionsSummary = describeTargetActions(t)
		logger.info(`  ${t.target}: ${actionsSummary}`)
	}

	logger.break()
	logger.info("No changes made. Run with --apply to perform migration.")
}

function logGlobalApplySummary(targetResults: TargetResult[], hasFailure: boolean): void {
	logger.break()

	const migrated = targetResults.filter((t) => t.status === "migrated")
	const already = targetResults.filter(
		(t) => t.status === "already_v2" || t.status === "nothing_to_migrate",
	)
	const failed = targetResults.filter((t) => t.status === "error")

	if (migrated.length > 0) {
		logger.success(`[global] Migrated ${migrated.length} target(s):`)
		for (const t of migrated) {
			logger.success(`  ✓ ${t.target}`)
		}
	}

	if (already.length > 0) {
		logger.info(`[global] ${already.length} target(s) already up to date.`)
	}

	if (failed.length > 0) {
		logger.error(`[global] ${failed.length} target(s) failed:`)
		for (const t of failed) {
			logger.error(`  ✗ ${t.target}: ${t.error}`)
		}
	}

	if (hasFailure) {
		logger.break()
		logger.error("[global] Migration completed with errors. See above for details.")
	}
}

function describeTargetActions(t: TargetResult): string {
	if (t.status === "error") return "error"
	if (t.status === "already_v2") return "already migrated"
	if (t.status === "nothing_to_migrate") return "nothing to migrate"

	const parts: string[] = []
	if (t.count > 0) {
		parts.push(`${t.count} component(s) to migrate`)
	}
	if (t.configActions.length > 0) {
		parts.push(`${t.configActions.length} config field(s) to normalize`)
	}
	if (parts.length === 0) return "nothing to migrate"
	return parts.join(", ")
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
