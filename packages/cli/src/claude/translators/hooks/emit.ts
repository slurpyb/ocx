// Translation logic derived from dyoshikawa/rulesync src/features/hooks/{opencode,claudecode}-hooks.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; output to a .ccx-fragments file rather than directly to
// settings.json so the pipeline can merge alongside the permissions translator.

import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { EmitResult, TargetContext } from "../../types"
import { emptyEmit } from "../../types"
import type { ClaudeHooksFragment } from "./types"

/**
 * Write the translated hooks fragment to ${claudeDir}/.ccx-fragments/hooks.json.
 *
 * We never write directly to settings.json because the permissions translator
 * writes to the same file. The Phase 4 pipeline merges all .ccx-fragments/*.json
 * files into the final settings.json, keeping each translator pure and
 * parallel-safe.
 *
 * If the translated hooks block is empty (no supported events), we emit nothing
 * and return an empty EmitResult — no fragment file is written.
 */
export async function emit(claude: ClaudeHooksFragment, ctx: TargetContext): Promise<EmitResult> {
	// Nothing to emit when no events survived translation.
	if (Object.keys(claude.hooks).length === 0) {
		return emptyEmit()
	}

	const fragmentsDir = join(ctx.claudeDir, ".ccx-fragments")
	const outPath = join(fragmentsDir, "hooks.json")

	// mkdir -p: create the fragments dir if it doesn't exist yet.
	await mkdir(fragmentsDir, { recursive: true })

	// Write the fragment: { "hooks": { ... } }
	// The Phase 4 merger reads this shape and deep-merges the hooks key into
	// the final settings.json.
	const fragment: { hooks: ClaudeHooksFragment["hooks"] } = {
		hooks: claude.hooks,
	}

	await Bun.write(outPath, `${JSON.stringify(fragment, null, 2)}\n`)

	return { written: [outPath], skipped: [] }
}
