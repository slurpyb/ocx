// Translation logic derived from dyoshikawa/rulesync src/features/skills/{opencode,claudecode}-skill.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { z } from "zod"

// ─── Source: OpenCode skill (TSource) ─────────────────────────────────────────
//
// Each skill lives at ${profileDir}/skills/<name>/SKILL.md with optional
// support files (references/, scripts/, etc.) alongside it.

export const OpencodeSkillFrontmatterSchema = z.object({
	name: z.string(),
	description: z.string(),
	"allowed-tools": z.array(z.string()).optional(),
})

export type OpencodeSkillFrontmatter = z.infer<typeof OpencodeSkillFrontmatterSchema>

/**
 * A support file copied verbatim from the skill source directory.
 * `relativePath` is relative to the skill directory root (e.g. "references/foo.md").
 */
export const SupportFileSchema = z.object({
	/** Path relative to the skill directory (never starts with /). */
	relativePath: z.string(),
	/** Absolute path on disk — used for reading bytes. */
	absolutePath: z.string(),
	/** Unix file mode bits (e.g. 0o755). Undefined when stat unavailable. */
	mode: z.number().optional(),
})

export type SupportFile = z.infer<typeof SupportFileSchema>

/**
 * TSource: one parsed OpenCode skill directory.
 */
export const OpencodeSkillSchema = z.object({
	/** Directory name under ${profileDir}/skills/ — becomes the skill id. */
	name: z.string(),
	/** Parsed and validated frontmatter from SKILL.md. */
	frontmatter: OpencodeSkillFrontmatterSchema,
	/** Markdown body of SKILL.md (frontmatter stripped, trimmed). */
	body: z.string(),
	/** All files in the skill directory except SKILL.md itself. */
	supportFiles: z.array(SupportFileSchema),
})

export type OpencodeSkill = z.infer<typeof OpencodeSkillSchema>

// ─── Target: Claude skill (TClaude) ───────────────────────────────────────────
//
// Written to ${claudeDir}/skills/<name>/SKILL.md.
// Claude Code skill frontmatter mirrors OpenCode's but adds optional
// model / disable-model-invocation / paths fields.

export const ClaudeSkillFrontmatterSchema = z.object({
	name: z.string(),
	description: z.string(),
	"allowed-tools": z.array(z.string()).optional(),
	model: z.string().optional(),
	"disable-model-invocation": z.boolean().optional(),
	paths: z.union([z.string(), z.array(z.string())]).optional(),
})

export type ClaudeSkillFrontmatter = z.infer<typeof ClaudeSkillFrontmatterSchema>

/**
 * TClaude: one Claude Code skill ready to be emitted.
 */
export const ClaudeSkillSchema = z.object({
	/** Directory name under ${claudeDir}/skills/ — mirrors source name. */
	name: z.string(),
	/** Translated frontmatter for SKILL.md. */
	frontmatter: ClaudeSkillFrontmatterSchema,
	/** Markdown body for SKILL.md. */
	body: z.string(),
	/** Support files to copy verbatim (relative paths + absolute source paths). */
	supportFiles: z.array(SupportFileSchema),
})

export type ClaudeSkill = z.infer<typeof ClaudeSkillSchema>
