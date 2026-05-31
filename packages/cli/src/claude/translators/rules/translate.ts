// Translation logic derived from dyoshikawa/rulesync src/features/rules/{opencode,claudecode}-rule.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import type { ClaudeRulesFile, OpencodeRulesFile } from "./types"

/**
 * Pure OpenCode → Claude transform for a single rules file.
 *
 * Frontmatter remap
 * ─────────────────
 * Root files (AGENTS.md → CLAUDE.md):
 *   • No frontmatter is emitted for root files in either format.
 *   • Body is copied verbatim.
 *
 * Sub-instruction files (.opencode/memories/*.md → .claude/rules/*.md):
 *   • `globs`       → `paths`   (Claude's conditional-inclusion field)
 *   • `description` is dropped  (not part of Claude's sub-rule frontmatter schema)
 *   • All other OpenCode keys are dropped (no equivalents in Claude's schema)
 *
 * Filename
 * ────────
 * AGENTS.md → CLAUDE.md; sub-instruction filenames are preserved as-is.
 */
export function translate(source: OpencodeRulesFile): ClaudeRulesFile {
	if (source.kind === "root") {
		return {
			kind: "root",
			filename: "CLAUDE.md",
			frontmatter: {},
			body: source.body,
		}
	}

	// Sub-instruction: remap globs → paths
	const paths =
		source.frontmatter.globs !== undefined && source.frontmatter.globs.length > 0
			? source.frontmatter.globs
			: undefined

	return {
		kind: "sub",
		filename: source.filename,
		frontmatter: paths !== undefined ? { paths } : {},
		body: source.body,
	}
}
