// Translation logic derived from dyoshikawa/rulesync src/features/subagents/{opencode,claudecode}-subagent.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { join } from "node:path"
import matter from "gray-matter"
import type { SourceContext } from "../../types"
import { type OpencodeSubagent, OpencodeSubagentFrontmatterSchema } from "./types"

// ─── Path constants ────────────────────────────────────────────────────────────
// In an ocx-managed profile (~/.config/opencode/profiles/<name>/), agents live
// directly under `agents/` — not under `.opencode/agent/` like a project-scoped
// OpenCode install. ccx targets profile dirs, so we use the bare path.
const OPENCODE_AGENT_DIR = "agents"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMatter(content: string): {
	frontmatter: Record<string, unknown>
	body: string
} {
	const result = matter(content)
	return { frontmatter: result.data as Record<string, unknown>, body: result.content }
}

/**
 * Strip null/undefined values so Zod's .passthrough() doesn't carry junk.
 */
function stripNullish(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(obj)) {
		if (v !== null && v !== undefined) out[k] = v
	}
	return out
}

// ─── parse ────────────────────────────────────────────────────────────────────

/**
 * Glob `${profileDir}/.opencode/agent/**\/*.md`, parse frontmatter + body for
 * each file, and return an array of `OpencodeSubagent` records.
 *
 * Files with invalid frontmatter throw rather than being silently skipped,
 * so misconfigured agents surface early in the pipeline.
 *
 * Returns an empty array when the agent dir is absent.
 */
export async function parse(ctx: SourceContext): Promise<readonly OpencodeSubagent[]> {
	const agentDir = join(ctx.profileDir, OPENCODE_AGENT_DIR)

	const relPaths: string[] = []

	try {
		const glob = new Bun.Glob("**/*.md")
		for await (const f of glob.scan({ cwd: agentDir, onlyFiles: true })) {
			relPaths.push(f)
		}
	} catch {
		// Directory absent — no agents to translate.
		return []
	}

	relPaths.sort() // deterministic ordering

	const results: OpencodeSubagent[] = []

	for (const relPath of relPaths) {
		const absPath = join(agentDir, relPath)
		const text = await Bun.file(absPath).text()

		const { frontmatter: rawFm, body } = parseMatter(text)
		const cleaned = stripNullish(rawFm)

		const result = OpencodeSubagentFrontmatterSchema.safeParse(cleaned)
		if (!result.success) {
			throw new Error(`[ccx/subagents] Invalid frontmatter in ${absPath}: ${result.error.message}`)
		}

		results.push({
			relativePath: relPath,
			frontmatter: result.data,
			body: body.trim(),
		})
	}

	return results
}
