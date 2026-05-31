// Translation logic derived from dyoshikawa/rulesync src/features/subagents/{opencode,claudecode}-subagent.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { z } from "zod"

// ─── OpenCode source shapes ────────────────────────────────────────────────────
//
// Source dir: ${profileDir}/.opencode/agent/**/*.md
//
// OpenCode's schema is a looseObject — any extra keys (temperature, top_p,
// model, hidden, tools, permission, color, etc.) are accepted and carried
// through as unknown. We explicitly type only the fields we remap; everything
// else lands in the passthrough bag.

export const OpencodeSubagentFrontmatterSchema = z
	.object({
		/** Name override. When absent, the stem of the filename is used. */
		name: z.string().optional(),
		/** Human-readable description. Maps to Claude `description`. */
		description: z.string().optional(),
		/**
		 * Activation mode. OpenCode values: "primary" | "subagent" | "all".
		 * Default is "subagent" when absent.
		 */
		mode: z.string().default("subagent"),
		/**
		 * Tool enable/disable map — object form used by OpenCode.
		 * e.g. { bash: true, webfetch: false }
		 * Translated to a comma-separated string for Claude.
		 */
		tools: z.record(z.string(), z.boolean()).optional(),
		/**
		 * Permission matrix — no direct Claude subagent equivalent.
		 * Dropped during translation (logged as a warning).
		 */
		permission: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough()

export type OpencodeSubagentFrontmatter = z.infer<typeof OpencodeSubagentFrontmatterSchema>

/**
 * TSource: one parsed OpenCode agent file.
 */
export interface OpencodeSubagent {
	/**
	 * Path of the file relative to the `.opencode/agent/` directory.
	 * Preserved so the emitter can mirror the same structure under
	 * `${claudeDir}/agents/`.
	 */
	readonly relativePath: string
	/** Validated (and passthrough-preserved) frontmatter. */
	readonly frontmatter: OpencodeSubagentFrontmatter
	/** Markdown body — the agent prompt. Trimmed of leading/trailing whitespace. */
	readonly body: string
}

// ─── Claude target shapes ──────────────────────────────────────────────────────
//
// Target dir: ${claudeDir}/agents/**/*.md
//
// Claude subagent frontmatter (from rulesync claudecode-subagent.ts):
//   name        — required string
//   description — optional string
//   model       — optional string
//   tools       — optional string | string[]  (we always emit a comma-string)
//   permissionMode — optional string
//   skills      — optional string | string[]

export const ClaudeSubagentFrontmatterSchema = z
	.object({
		name: z.string(),
		description: z.string().optional(),
		model: z.string().optional(),
		/**
		 * Allowed tools as a comma-separated string.
		 * Claude also accepts an array — we always write string form for
		 * human-readability parity with rulesync's emitter.
		 */
		tools: z.union([z.string(), z.array(z.string())]).optional(),
	})
	.passthrough()

export type ClaudeSubagentFrontmatter = z.infer<typeof ClaudeSubagentFrontmatterSchema>

/**
 * TClaude: one Claude subagent file ready to emit.
 */
export interface ClaudeSubagent {
	/**
	 * Path relative to `${claudeDir}/agents/`.
	 * Mirrors the source relativePath.
	 */
	readonly relativePath: string
	readonly frontmatter: ClaudeSubagentFrontmatter
	readonly body: string
}
