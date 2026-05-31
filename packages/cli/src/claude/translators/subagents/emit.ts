// Translation logic derived from dyoshikawa/rulesync src/features/subagents/{opencode,claudecode}-subagent.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import matter from "gray-matter"
import type { EmitResult, TargetContext } from "../../types"
import type { ClaudeSubagent } from "./types"

// ─── Target path constant ──────────────────────────────────────────────────────
// ctx.claudeDir is already `.claude/` (project) or `~/.claude/` (global).
// The subdir we add here is just `agents/` — DO NOT prefix with `.claude`.
const CLAUDE_AGENTS_DIR = "agents"

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Serialise a Claude subagent back to a markdown string with YAML frontmatter.
 * gray-matter's stringify writes `---\n...\n---\n<body>`.
 */
function stringify(agent: ClaudeSubagent): string {
	return matter.stringify(
		agent.body.length > 0 ? `\n${agent.body}\n` : "",
		agent.frontmatter as Record<string, unknown>,
	)
}

// ─── emit ─────────────────────────────────────────────────────────────────────

/**
 * Write a translated Claude subagent into `${claudeDir}/agents/<relativePath>`.
 *
 * Parent directories are created recursively (mkdir -p equivalent).
 */
export async function emit(claude: ClaudeSubagent, ctx: TargetContext): Promise<EmitResult> {
	// claudeDir already points at `.claude/` (project) or `~/.claude/` (global).
	// We join the agents subdir + the relative path from the source glob.
	const targetPath = join(ctx.claudeDir, CLAUDE_AGENTS_DIR, claude.relativePath)
	const targetDir = dirname(targetPath)

	await mkdir(targetDir, { recursive: true })

	const content = stringify(claude)
	await Bun.write(targetPath, content)

	return {
		written: [targetPath],
		skipped: [],
	}
}
