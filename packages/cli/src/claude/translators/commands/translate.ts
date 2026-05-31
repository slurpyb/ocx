// Translation logic derived from dyoshikawa/rulesync src/features/commands/{opencode,claudecode}-command.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import type { ClaudeCommand, ClaudeCommandFrontmatter, OpencodeCommand } from "./types"

/**
 * Frontmatter remap table (OpenCode → Claude):
 *
 *   description  →  description            (direct carry-through)
 *   model        →  model                  (direct carry-through)
 *   agent        →  (dropped)              OpenCode-specific runtime directive;
 *                                          Claude has no agent field in commands
 *   subtask      →  (dropped)              OpenCode execution-model flag;
 *                                          no Claude equivalent
 *
 * Claude-only fields (allowed-tools, argument-hint, disable-model-invocation)
 * have no OpenCode source and are never set here.
 *
 * Body is passed through unchanged.
 */
export function translate(source: OpencodeCommand): ClaudeCommand {
	const { description, model } = source.frontmatter

	// Build the target frontmatter, omitting undefined fields entirely so that
	// exactOptionalPropertyTypes is satisfied and gray-matter doesn't write
	// `description: null` into YAML output.
	const frontmatter: ClaudeCommandFrontmatter = {
		...(description !== undefined && { description }),
		...(model !== undefined && { model }),
	}

	return {
		relativePath: source.relativePath,
		frontmatter,
		body: source.body,
	}
}
