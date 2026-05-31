// Translation logic derived from dyoshikawa/rulesync src/features/permissions/{opencode,claudecode}-permissions.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; output to a .ccx-fragments file rather than directly to
// settings.json so the pipeline can merge alongside the hooks translator.

import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import type { SourceContext } from "../../types"
import { type OpencodePermissionsFile, OpencodePermissionsFileSchema } from "./types"

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function tryReadText(path: string): Promise<string | null> {
	const f = Bun.file(path)
	if (!(await f.exists())) return null
	return f.text()
}

// ─── parse ────────────────────────────────────────────────────────────────────

/**
 * Read `${profileDir}/opencode.jsonc` (falling back to `opencode.json`),
 * extract the `permission` key, and return a single-element array.
 *
 * Returns an empty array when no opencode config file exists — a profile
 * without a config is silently skipped rather than erroring.
 *
 * Mirrors the rulesync OpencodePermissions.fromFile() strategy:
 *   1. Try opencode.jsonc
 *   2. Fall back to opencode.json
 *   3. Default to empty permission map when key is absent
 */
export async function parse(ctx: SourceContext): Promise<readonly OpencodePermissionsFile[]> {
	const jsoncPath = join(ctx.profileDir, "opencode.jsonc")
	const jsonPath = join(ctx.profileDir, "opencode.json")

	let rawText = await tryReadText(jsoncPath)
	if (rawText === null) {
		rawText = await tryReadText(jsonPath)
	}

	// No opencode config at all — nothing to translate.
	if (rawText === null) return []

	const parsed: unknown = parseJsonc(rawText)

	// Validate only the permission key; all other opencode fields are irrelevant.
	const result = OpencodePermissionsFileSchema.safeParse(parsed)

	if (!result.success) {
		// Config exists but permission block is malformed — skip rather than crash.
		// Consumers can surface warnings via the pipeline report.
		return []
	}

	// Normalise: always return an object even when `permission` key is absent.
	return [result.data]
}
