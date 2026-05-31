// Translation logic derived from dyoshikawa/rulesync src/features/rules/{opencode,claudecode}-rule.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { join } from "node:path"
import matter from "gray-matter"
import { dump, load } from "js-yaml"
import type { EmitResult, TargetContext } from "../../types"
import type { ClaudeRulesFile } from "./types"

// ─── Path constants (mirrors rulesync ClaudecodeRule.getSettablePaths) ────────

const ROOT_FILENAME = "CLAUDE.md"
const SUB_DIR = "rules"

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Custom yaml engine: disables line-wrap (lineWidth: -1) so glob patterns in
// the `paths` array never get split across lines by js-yaml's default 80-char
// wrapping — matches rulesync's avoidBlockScalars strategy.
const yamlEngine = {
	parse: (s: string) => (load(s) ?? {}) as Record<string, unknown>,
	stringify: (data: object) => dump(data, { lineWidth: -1 }),
}

/**
 * Serialise a Claude rules file to its on-disk string representation.
 *
 * Root files: plain body, no frontmatter block.
 * Sub-instruction files: optional YAML frontmatter (only `paths` when set)
 *   followed by the body.
 */
function serialise(claude: ClaudeRulesFile): string {
	if (claude.kind === "root") {
		return claude.body
	}

	// Sub-instruction: emit frontmatter only when `paths` is defined.
	if (claude.frontmatter.paths !== undefined) {
		return matter.stringify(
			claude.body,
			{ paths: claude.frontmatter.paths },
			{
				engines: { yaml: yamlEngine },
			},
		)
	}

	return claude.body
}

async function ensureDir(path: string): Promise<void> {
	const { mkdir } = await import("node:fs/promises")
	await mkdir(path, { recursive: true })
}

// ─── emit ─────────────────────────────────────────────────────────────────────

/**
 * Write a Claude rules file into the target.
 *
 * Root  → `${claudeDir}/CLAUDE.md`
 * Sub   → `${claudeDir}/rules/<filename>`
 */
export async function emit(claude: ClaudeRulesFile, ctx: TargetContext): Promise<EmitResult> {
	if (claude.kind === "root") {
		const outPath = join(ctx.claudeDir, ROOT_FILENAME)
		await Bun.write(outPath, serialise(claude))
		return { written: [outPath], skipped: [] }
	}

	// Sub-instruction
	const rulesDir = join(ctx.claudeDir, SUB_DIR)
	await ensureDir(rulesDir)

	const outPath = join(rulesDir, claude.filename)
	await Bun.write(outPath, serialise(claude))
	return { written: [outPath], skipped: [] }
}
