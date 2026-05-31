// Translation logic derived from dyoshikawa/rulesync src/features/permissions/{opencode,claudecode}-permissions.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; output to a .ccx-fragments file rather than directly to
// settings.json so the pipeline can merge alongside the hooks translator.

import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { EmitResult, TargetContext } from "../../types"
import type { ClaudePermissionsFragment } from "./types"

// ─── Fragment path ─────────────────────────────────────────────────────────────
//
// The Phase 4 pipeline merges all `.ccx-fragments/*.json` into the final
// settings.json. We never write settings.json directly.

const FRAGMENTS_DIR = ".ccx-fragments"
const FRAGMENT_FILE = "permissions.json"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isEmptyPermissions(fragment: ClaudePermissionsFragment): boolean {
	const { allow, ask, deny } = fragment.permissions
	return allow.length === 0 && ask.length === 0 && deny.length === 0
}

// ─── emit ─────────────────────────────────────────────────────────────────────

/**
 * Write the permissions fragment to `${claudeDir}/.ccx-fragments/permissions.json`.
 *
 * When the translated permissions block is completely empty (no allow, ask, or
 * deny entries), no file is written and the path is reported as skipped.
 * This prevents the Phase 4 merger from injecting a no-op `permissions: {}`
 * into settings.json.
 */
export async function emit(
	claude: ClaudePermissionsFragment,
	ctx: TargetContext,
): Promise<EmitResult> {
	if (isEmptyPermissions(claude)) {
		return { written: [], skipped: [join(ctx.claudeDir, FRAGMENTS_DIR, FRAGMENT_FILE)] }
	}

	const fragmentsDir = join(ctx.claudeDir, FRAGMENTS_DIR)
	await mkdir(fragmentsDir, { recursive: true })

	const outPath = join(fragmentsDir, FRAGMENT_FILE)

	// Write only the keys that are non-empty to keep the fragment minimal.
	// The Phase 4 merger handles absent keys gracefully.
	const { allow, ask, deny } = claude.permissions
	const permissionsOut: Record<string, string[]> = {}
	if (allow.length > 0) permissionsOut.allow = allow
	if (ask.length > 0) permissionsOut.ask = ask
	if (deny.length > 0) permissionsOut.deny = deny

	const content = JSON.stringify({ permissions: permissionsOut }, null, 2)
	await Bun.write(outPath, content)

	return { written: [outPath], skipped: [] }
}
