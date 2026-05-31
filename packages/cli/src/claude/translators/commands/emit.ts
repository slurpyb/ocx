// Translation logic derived from dyoshikawa/rulesync src/features/commands/{opencode,claudecode}-command.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import matter from "gray-matter"
import type { EmitResult, TargetContext } from "../../types"
import type { ClaudeCommand } from "./types"

/**
 * Serialize a ClaudeCommand frontmatter object to a YAML front-matter block.
 * If the frontmatter has no keys, return just the body (Claude accepts that).
 */
function serialize(cmd: ClaudeCommand): string {
	const hasFields = Object.keys(cmd.frontmatter).length > 0

	if (!hasFields) {
		// No frontmatter at all — Claude accepts bare markdown commands.
		return cmd.body
	}

	// gray-matter.stringify prepends `---\n<yaml>\n---\n` and appends the body.
	// We pass body as the file content and frontmatter as the data object.
	return matter.stringify(cmd.body, cmd.frontmatter)
}

/**
 * Write a single ClaudeCommand into `${claudeDir}/commands/<relativePath>`.
 * Parent directories are created as needed (mirrors source subdirectory
 * structure e.g. "foo/bar.md" → ".claude/commands/foo/bar.md").
 */
export async function emit(claude: ClaudeCommand, ctx: TargetContext): Promise<EmitResult> {
	const destPath = join(ctx.claudeDir, "commands", claude.relativePath)
	const destDir = dirname(destPath)

	await mkdir(destDir, { recursive: true })

	const content = serialize(claude)
	await Bun.write(destPath, content)

	return {
		written: [destPath],
		skipped: [],
	}
}
