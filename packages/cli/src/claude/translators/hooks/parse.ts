// Translation logic derived from dyoshikawa/rulesync src/features/hooks/{opencode,claudecode}-hooks.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface. Source format is ccx-owned (NOT rulesync's IR).
// Output goes to a .ccx-fragments file rather than directly to settings.json
// so the pipeline can merge alongside the permissions translator.

import { join } from "node:path"
import type { SourceContext } from "../../types"
import { type OpencodeHooksFile, OpencodeHooksFileSchema } from "./types"

/**
 * Read `${profileDir}/.ccx/hooks.json` — the ccx-owned declarative hook source.
 *
 * RATIONALE: OpenCode's runtime has no declarative hooks key — hooks are
 * exclusively expressed as TypeScript plugins under `.opencode/plugins/`. To
 * stay self-reliant (no external IR like rulesync's `.rulesync/hooks.json`),
 * ccx defines its own first-class declarative hook source at this path.
 *
 * The schema mirrors a canonical hook config: an object with a `hooks` key
 * keyed by canonical event name (sessionStart, preToolUse, postToolUse,
 * afterFileEdit, stop, ...), each value an array of `{ type, command, matcher? }`.
 * See `types.ts` for the authoritative schema.
 *
 * Components and profiles in the registry that ship hooks bake this file into
 * the profile dir on install (alongside `opencode.jsonc`).
 *
 * Returns an empty array when:
 * - The file is absent (profile has no hooks)
 * - The file parses but has an empty hooks map
 */
export async function parse(ctx: SourceContext): Promise<readonly OpencodeHooksFile[]> {
	const filePath = join(ctx.profileDir, ".ccx", "hooks.json")

	let raw: string
	try {
		raw = await Bun.file(filePath).text()
	} catch {
		// File absent — no hooks to translate.
		return []
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch (err) {
		throw new Error(
			`[ccx/hooks] Failed to JSON-parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
		)
	}

	const result = OpencodeHooksFileSchema.safeParse(parsed)
	if (!result.success) {
		throw new Error(`[ccx/hooks] Schema validation failed for ${filePath}: ${result.error.message}`)
	}

	const file = result.data

	// Empty hooks block → nothing to translate.
	if (Object.keys(file.hooks).length === 0) {
		return []
	}

	return [file]
}
