// Translation logic derived from dyoshikawa/rulesync src/features/skills/{opencode,claudecode}-skill.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import type { ClaudeSkill, ClaudeSkillFrontmatter, OpencodeSkill } from "./types"

// ─── Frontmatter remap ────────────────────────────────────────────────────────
//
// OpenCode skill frontmatter  →  Claude Code skill frontmatter
//
//   name            →  name             (identity)
//   description     →  description      (identity)
//   allowed-tools   →  allowed-tools    (identity, omitted when absent)
//
// Claude-only fields (model, disable-model-invocation, paths) have no OpenCode
// counterpart — they are not present in OpenCode skills and are therefore not
// emitted here. A round-trip from OpenCode → Claude will never produce them.

function translateFrontmatter(source: OpencodeSkill["frontmatter"]): ClaudeSkillFrontmatter {
	const fm: ClaudeSkillFrontmatter = {
		name: source.name,
		description: source.description,
	}

	if (source["allowed-tools"] !== undefined) {
		fm["allowed-tools"] = source["allowed-tools"]
	}

	return fm
}

// ─── translate ────────────────────────────────────────────────────────────────

/**
 * Pure, synchronous translation from an OpenCode skill to a Claude Code skill.
 *
 * Frontmatter remap is effectively identity for the shared fields (name,
 * description, allowed-tools). Support files are passed through unchanged —
 * only the absolute source path is retained for the emit step to copy from.
 */
export function translate(source: OpencodeSkill): ClaudeSkill {
	return {
		name: source.name,
		frontmatter: translateFrontmatter(source.frontmatter),
		body: source.body,
		supportFiles: source.supportFiles,
	}
}
