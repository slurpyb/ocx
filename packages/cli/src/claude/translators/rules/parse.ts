// Translation logic derived from dyoshikawa/rulesync src/features/rules/{opencode,claudecode}-rule.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { join } from "node:path"
import matter from "gray-matter"
import type { SourceContext } from "../../types"
import { type OpencodeRulesFile, OpencodeRulesFrontmatterSchema } from "./types"

// ─── Path constants (mirrors rulesync OpenCodeRule.getSettablePaths) ──────────

const ROOT_FILENAME = "AGENTS.md"
const SUB_DIR = join(".opencode", "memories")

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMatter(content: string): {
	frontmatter: Record<string, unknown>
	body: string
} {
	const result = matter(content)
	return { frontmatter: result.data, body: result.content }
}

function stripNullish(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(obj)) {
		if (v !== null && v !== undefined) out[k] = v
	}
	return out
}

async function tryReadText(path: string): Promise<string | null> {
	const f = Bun.file(path)
	if (!(await f.exists())) return null
	return f.text()
}

// ─── parse ────────────────────────────────────────────────────────────────────

/**
 * Read `${profileDir}/AGENTS.md` (root) and any `*.md` files under
 * `${profileDir}/.opencode/memories/` (sub-instructions).
 *
 * Returns an empty array when AGENTS.md is absent — a profile that has no
 * rules file is silently skipped rather than erroring.
 */
export async function parse(ctx: SourceContext): Promise<readonly OpencodeRulesFile[]> {
	const results: OpencodeRulesFile[] = []

	// ── Root AGENTS.md ──────────────────────────────────────────────────────────
	const rootPath = join(ctx.profileDir, ROOT_FILENAME)
	const rootText = await tryReadText(rootPath)

	if (rootText !== null) {
		const { frontmatter: rawFm, body } = parseMatter(rootText)
		const fm = OpencodeRulesFrontmatterSchema.parse(stripNullish(rawFm))
		results.push({
			kind: "root",
			filename: ROOT_FILENAME,
			frontmatter: fm,
			body: body.trim(),
		})
	}

	// ── Sub-instructions under .opencode/memories/ ──────────────────────────────
	const memoriesDir = join(ctx.profileDir, SUB_DIR)
	const memoriesDirHandle = Bun.file(memoriesDir)

	// Bun.file() on a directory isn't listable — use the Node-compatible glob.
	// Bun exposes `Bun.Glob` for this purpose (available in Bun ≥ 1.1).
	const subFiles: string[] = []
	try {
		const glob = new Bun.Glob("*.md")
		for await (const f of glob.scan({ cwd: memoriesDir, onlyFiles: true })) {
			subFiles.push(f)
		}
	} catch {
		// Directory may not exist — treat as empty.
		void memoriesDirHandle
	}

	subFiles.sort() // deterministic ordering

	for (const filename of subFiles) {
		const filePath = join(memoriesDir, filename)
		const text = await tryReadText(filePath)
		if (text === null) continue

		const { frontmatter: rawFm, body } = parseMatter(text)
		const fm = OpencodeRulesFrontmatterSchema.parse(stripNullish(rawFm))
		results.push({
			kind: "sub",
			filename,
			frontmatter: fm,
			body: body.trim(),
		})
	}

	return results
}
