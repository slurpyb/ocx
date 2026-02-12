/**
 * Dependency invalidation utilities for OCX CLI.
 *
 * When `ocx add` writes dependencies into package.json, upstream OpenCode
 * may skip `npm install` if `@opencode-ai/plugin` already matches. This
 * causes missing deps at runtime.
 *
 * Mitigation: after dependency declarations change, invalidate the adjacent
 * `node_modules` directory so the next OpenCode launch triggers a fresh install.
 */

import { existsSync, lstatSync } from "node:fs"
import { rm, unlink } from "node:fs/promises"
import { join } from "node:path"

import type { DryRunAction } from "./dry-run"

// =============================================================================
// Types
// =============================================================================

export interface DependencyDeltaEntry {
	name: string
	from: string | null
	to: string
}

export interface DependencyDelta {
	changed: boolean
	entries: DependencyDeltaEntry[]
}

export interface DepUpdateResult {
	changed: boolean
	packageDir: string
	delta: DependencyDeltaEntry[]
}

export type InvalidationAction = "removed" | "unlinked" | "none" | "failed"

export interface InvalidationResult {
	success: boolean
	action: InvalidationAction
	error?: { code: string; message: string }
}

/** Injection point for testing: allows overriding the rm implementation. */
export interface InvalidationOptions {
	rmImpl?: (path: string, opts?: { recursive?: boolean; force?: boolean }) => Promise<void>
}

// =============================================================================
// Retryable error codes
// =============================================================================

const RETRYABLE_CODES = new Set(["EBUSY", "ENOTEMPTY"])
const MAX_RETRIES = 3
const BASE_DELAY_MS = 100

// =============================================================================
// Pure functions
// =============================================================================

/**
 * Compute the delta between two dependency maps.
 * Pure function: same inputs always produce same output.
 *
 * Intentionally detects only additions and version changes — removals are
 * excluded because `ocx add` only ever appends deps, never removes them.
 * If removal detection is needed (e.g. for `ocx remove`), use a separate
 * function that iterates `before` keys absent in `after`.
 */
export function computeDependencyDelta(
	before: Record<string, string>,
	after: Record<string, string>,
): DependencyDelta {
	const entries: DependencyDeltaEntry[] = []

	// Detect added or changed deps
	for (const [name, version] of Object.entries(after)) {
		const previousVersion = before[name] ?? null
		if (previousVersion !== version) {
			entries.push({ name, from: previousVersion, to: version })
		}
	}

	return {
		changed: entries.length > 0,
		entries,
	}
}

/**
 * Build a DryRunAction for planned node_modules invalidation.
 * Pure function for dry-run reporting.
 */
export function buildInvalidationDryRunAction(
	packageDir: string,
	deltaEntries: DependencyDeltaEntry[],
): DryRunAction {
	const nodeModulesPath = join(packageDir, "node_modules")
	const changedNames = deltaEntries.map((e) => e.name).join(", ")

	return {
		action: "delete",
		target: nodeModulesPath,
		details: {
			reason: `dependency declarations changed (${changedNames}); invalidating to force reinstall`,
			path: nodeModulesPath,
		},
	}
}

// =============================================================================
// Side-effectful helpers
// =============================================================================

/**
 * Extract error code from an unknown error.
 * Guard clause for type safety at the boundary.
 */
function extractErrorCode(error: unknown): string {
	if (error && typeof error === "object" && "code" in error) {
		return String((error as { code: unknown }).code)
	}
	return "UNKNOWN"
}

/**
 * Extract error message from an unknown error.
 */
function extractErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	return String(error)
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Safely invalidate node_modules in the given packageDir.
 *
 * Behavior:
 * - ENOENT (missing): success/no-op
 * - Symlink: unlink the symlink, leave target intact
 * - Directory: rm -rf with retry on EBUSY/ENOTEMPTY
 * - EPERM/EACCES: immediate failure (non-retryable)
 *
 * Never throws — returns a result object for the caller to inspect.
 */
export async function invalidateNodeModules(
	packageDir: string,
	options?: InvalidationOptions,
): Promise<InvalidationResult> {
	const nodeModulesPath = join(packageDir, "node_modules")
	const removeDir =
		options?.rmImpl ?? ((p: string, opts?: { recursive?: boolean; force?: boolean }) => rm(p, opts))

	// Guard: nothing to do
	if (!existsSync(nodeModulesPath)) {
		return { success: true, action: "none" }
	}

	// Handle symlink: unlink without following
	try {
		const stat = lstatSync(nodeModulesPath)
		if (stat.isSymbolicLink()) {
			await unlink(nodeModulesPath)
			return { success: true, action: "unlinked" }
		}
	} catch (error) {
		const code = extractErrorCode(error)
		// ENOENT: race condition — another concurrent call already removed it
		if (code === "ENOENT") {
			return { success: true, action: "none" }
		}
		return {
			success: false,
			action: "failed",
			error: { code, message: extractErrorMessage(error) },
		}
	}

	// Remove directory with bounded exponential backoff on retryable errors
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			await removeDir(nodeModulesPath, { recursive: true, force: true })
			return { success: true, action: "removed" }
		} catch (error) {
			const code = extractErrorCode(error)

			// ENOENT: race condition — already removed
			if (code === "ENOENT") {
				return { success: true, action: "none" }
			}

			// Non-retryable: fail immediately
			if (!RETRYABLE_CODES.has(code)) {
				return {
					success: false,
					action: "failed",
					error: { code, message: extractErrorMessage(error) },
				}
			}

			// Retryable: backoff unless we've exhausted retries
			if (attempt < MAX_RETRIES) {
				await sleep(BASE_DELAY_MS * 2 ** attempt)
			} else {
				return {
					success: false,
					action: "failed",
					error: { code, message: extractErrorMessage(error) },
				}
			}
		}
	}

	// Unreachable, but TypeScript needs it
	return {
		success: false,
		action: "failed",
		error: { code: "UNKNOWN", message: "exhausted retries" },
	}
}
