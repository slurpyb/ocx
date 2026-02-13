/**
 * OCX CLI - migrate command
 *
 * Converts legacy ocx.lock state to .ocx/receipt.jsonc format.
 * Default: preview/dry-run (no writes). Use --apply to perform migration.
 */

import { existsSync } from "node:fs"
import { rename } from "node:fs/promises"

import type { Command } from "commander"
import {
	findOcxLock,
	findReceipt,
	readOcxConfig,
	readOcxLock,
	writeReceipt,
} from "../../schemas/config"
import { ConfigError, handleError, logger, ValidationError } from "../../utils/index"
import { buildReceiptFromLock, type MigrateResult } from "./transform"

export interface MigrateOptions {
	cwd?: string
	apply?: boolean
	json?: boolean
	quiet?: boolean
}

export function registerMigrateCommand(program: Command): void {
	program
		.command("migrate")
		.description("Migrate legacy ocx.lock to receipt format (.ocx/receipt.jsonc)")
		.option("--apply", "Apply migration (default is dry-run preview)")
		.option("--json", "Output as JSON")
		.option("-q, --quiet", "Suppress output")
		.option("--cwd <path>", "Working directory", process.cwd())
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
	const cwd = options.cwd ?? process.cwd()

	// Detect state: receipt exists?
	const receipt = findReceipt(cwd)

	// Guard: already migrated (receipt exists) → safe no-op
	if (receipt.exists) {
		const result: MigrateResult = {
			success: true,
			status: "already_v2",
			count: 0,
			components: [],
		}

		if (options.json) {
			console.log(JSON.stringify(result, null, 2))
			return
		}

		if (!options.quiet) {
			logger.success("Already migrated to receipt format (.ocx/receipt.jsonc).")
		}
		return
	}

	// Detect state: legacy lock exists?
	const lockInfo = findOcxLock(cwd)

	// Guard: no lock, no receipt → nothing to do
	if (!lockInfo.exists) {
		const result: MigrateResult = {
			success: true,
			status: "nothing_to_migrate",
			count: 0,
			components: [],
		}

		if (options.json) {
			console.log(JSON.stringify(result, null, 2))
			return
		}

		if (!options.quiet) {
			logger.info("Nothing to migrate. No legacy ocx.lock found.")
		}
		return
	}

	// Parse legacy lock and config
	const lock = await readOcxLock(cwd)
	if (!lock) {
		throw new ValidationError(
			"Failed to parse ocx.lock. The lock file exists but could not be read or contains invalid data.",
		)
	}

	const config = await readOcxConfig(cwd)
	if (!config) {
		throw new ConfigError(
			"No ocx.jsonc found. The config is required to resolve registry URLs during migration.",
		)
	}

	// Build receipt from lock (pure transform)
	const { receipt: newReceipt, components } = buildReceiptFromLock(lock, config, cwd)
	const count = components.length

	// Preview mode (default): show plan, no writes
	if (!options.apply) {
		const result: MigrateResult = {
			success: true,
			status: "preview",
			count,
			components,
		}

		if (options.json) {
			console.log(JSON.stringify(result, null, 2))
			return
		}

		if (!options.quiet) {
			logger.info(`Migration preview: ${count} component(s) would be migrated.`)
			logger.break()

			for (const comp of components) {
				logger.info(`  ${comp.legacyKey} → ${comp.canonicalId}`)
			}

			logger.break()
			logger.info("No changes made. Run with --apply to perform migration.")
		}
		return
	}

	// Apply mode: write receipt, rename lock → .bak
	await writeReceipt(cwd, newReceipt)

	// Determine backup path — avoid overwriting existing .bak files
	const bakPath = resolveBackupPath(lockInfo.path)
	await rename(lockInfo.path, bakPath)

	const result: MigrateResult = {
		success: true,
		status: "migrated",
		count,
		components,
	}

	if (options.json) {
		console.log(JSON.stringify(result, null, 2))
		return
	}

	if (!options.quiet) {
		logger.success(`Migrated ${count} component(s) to receipt format (.ocx/receipt.jsonc).`)
		logger.break()

		for (const comp of components) {
			logger.success(`  ✓ ${comp.legacyKey} → ${comp.canonicalId}`)
		}

		logger.break()
		logger.info(`Legacy lock backed up to: ${bakPath}`)
	}
}

// =============================================================================
// HELPERS
// =============================================================================

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
