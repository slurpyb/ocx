// Translation logic derived from dyoshikawa/rulesync src/features/rules/{opencode,claudecode}-rule.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { z } from "zod"

// ─── OpenCode source shapes ────────────────────────────────────────────────────
//
// Root rule: ${profileDir}/AGENTS.md
//   Plain markdown — no frontmatter. OpenCode validates no schema on this file.
//
// Sub-instructions: ${profileDir}/.opencode/memories/*.md
//   Also plain markdown; no defined frontmatter schema in rulesync for these.

export const OpencodeRulesFrontmatterSchema = z.object({
	// OpenCode AGENTS.md carries no defined frontmatter keys.
	// We accept (and forward) any unknown keys so that user-authored frontmatter
	// is preserved rather than silently dropped.
	globs: z.array(z.string()).optional(),
	description: z.string().optional(),
})

export type OpencodeRulesFrontmatter = z.infer<typeof OpencodeRulesFrontmatterSchema>

/**
 * One parsed source file — either the root AGENTS.md or a sub-instruction.
 */
export const OpencodeRulesFileSchema = z.object({
	/**
	 * `root`  → the top-level AGENTS.md
	 * `sub`   → a file under .opencode/memories/
	 */
	kind: z.enum(["root", "sub"]),
	/** Basename of the source file (e.g. "AGENTS.md" or "coding-style.md"). */
	filename: z.string(),
	/** Parsed frontmatter — may be empty object for plain AGENTS.md files. */
	frontmatter: OpencodeRulesFrontmatterSchema,
	/** Markdown body with leading/trailing whitespace trimmed. */
	body: z.string(),
})

export type OpencodeRulesFile = z.infer<typeof OpencodeRulesFileSchema>

// ─── Claude target shapes ──────────────────────────────────────────────────────
//
// Root rule: ${claudeDir}/CLAUDE.md
//   Plain markdown body, no frontmatter.
//
// Sub-instructions: ${claudeDir}/rules/*.md
//   Optional `paths` frontmatter key (glob patterns for conditional inclusion).
//   If absent, the rule applies globally.

export const ClaudeRulesFrontmatterSchema = z.object({
	/**
	 * Glob patterns for conditional rule inclusion.
	 * Maps from OpenCode's `globs` field (or absent when root).
	 */
	paths: z.array(z.string()).optional(),
})

export type ClaudeRulesFrontmatter = z.infer<typeof ClaudeRulesFrontmatterSchema>

export const ClaudeRulesFileSchema = z.object({
	kind: z.enum(["root", "sub"]),
	/** Target filename (e.g. "CLAUDE.md" or "coding-style.md"). */
	filename: z.string(),
	/**
	 * Frontmatter for the Claude file.
	 * For `root` files this is always empty (frontmatter is not emitted).
	 * For `sub` files it carries the optional `paths` array.
	 */
	frontmatter: ClaudeRulesFrontmatterSchema,
	body: z.string(),
})

export type ClaudeRulesFile = z.infer<typeof ClaudeRulesFileSchema>
