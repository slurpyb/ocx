// Translation logic derived from dyoshikawa/rulesync src/features/commands/{opencode,claudecode}-command.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { z } from "zod"

// ─── OpenCode-side schema (source) ────────────────────────────────────────────
//
// OpenCode command frontmatter fields:
//   description  → carried through to Claude as-is
//   agent        → dropped (OpenCode-specific runtime concept; no Claude equivalent)
//   subtask      → dropped (OpenCode-specific execution model; no Claude equivalent)
//   model        → carried through to Claude as-is
//
// looseObject (passthrough) preserves any future unknown keys so we don't
// silently discard data we haven't explicitly handled.

export const OpencodeCommandFrontmatterSchema = z
	.object({
		description: z.string().optional(),
		agent: z.string().optional(),
		subtask: z.boolean().optional(),
		model: z.string().optional(),
	})
	.passthrough()

export type OpencodeCommandFrontmatter = z.infer<typeof OpencodeCommandFrontmatterSchema>

/**
 * TSource — one OpenCode command file, already parsed.
 * `relativePath` preserves subdirectory structure so emit can mirror it.
 */
export interface OpencodeCommand {
	/** Relative path from the commands/ dir, e.g. "foo/bar.md". */
	readonly relativePath: string
	readonly frontmatter: OpencodeCommandFrontmatter
	readonly body: string
}

// ─── Claude-side schema (target) ──────────────────────────────────────────────
//
// Claude command frontmatter fields (from claudecode-command.ts):
//   description              → from OpenCode `description`
//   allowed-tools            → no OpenCode equivalent; omitted unless present in
//                              unknown passthrough fields (won't be)
//   argument-hint            → no OpenCode equivalent; always omitted
//   model                    → from OpenCode `model`
//   disable-model-invocation → no OpenCode equivalent; always omitted

export const ClaudeCommandFrontmatterSchema = z.object({
	description: z.string().optional(),
	"allowed-tools": z.union([z.string(), z.array(z.string())]).optional(),
	"argument-hint": z.string().optional(),
	model: z.string().optional(),
	"disable-model-invocation": z.boolean().optional(),
})

export type ClaudeCommandFrontmatter = z.infer<typeof ClaudeCommandFrontmatterSchema>

/**
 * TClaude — one Claude command file, ready to emit.
 */
export interface ClaudeCommand {
	/** Relative path from the commands/ dir; mirrors the source. */
	readonly relativePath: string
	readonly frontmatter: ClaudeCommandFrontmatter
	readonly body: string
}
