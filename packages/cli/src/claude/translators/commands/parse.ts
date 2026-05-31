// Translation logic derived from dyoshikawa/rulesync src/features/commands/{opencode,claudecode}-command.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { existsSync } from "node:fs"
import { join } from "node:path"
import matter from "gray-matter"
import type { SourceContext } from "../../types"
import { type OpencodeCommand, OpencodeCommandFrontmatterSchema } from "./types"

/**
 * Glob `${profileDir}/commands/**\/*.md`, parse each file's frontmatter + body,
 * and return a validated OpencodeCommand per file.
 *
 * Commands with no frontmatter block are still returned — body is preserved and
 * frontmatter is treated as empty (Claude allows frontmatter-less commands).
 *
 * Relative paths are preserved so emit() can mirror subdirectory structure.
 */
export async function parse(ctx: SourceContext): Promise<readonly OpencodeCommand[]> {
	const commandsDir = join(ctx.profileDir, "commands")

	// Bun.file().exists() returns false for directories — use node:fs existsSync.
	if (!existsSync(commandsDir)) {
		return []
	}

	const glob = new Bun.Glob("**/*.md")
	const files = await Array.fromAsync(glob.scan({ cwd: commandsDir, onlyFiles: true }))

	const results: OpencodeCommand[] = []

	for (const relativePath of files) {
		const absolutePath = join(commandsDir, relativePath)
		const raw = await Bun.file(absolutePath).text()

		// gray-matter handles files with no frontmatter gracefully:
		// data is {} and content is the full raw string.
		const parsed = matter(raw)

		// Validate — but don't throw on unknown or missing fields (looseObject /
		// passthrough). Malformed types (e.g. description is a number) fall back to
		// the safe-parsed partial so we still emit what we can.
		const result = OpencodeCommandFrontmatterSchema.safeParse(parsed.data)
		const frontmatter = result.success ? result.data : {}

		results.push({
			relativePath,
			frontmatter,
			body: parsed.content.trim(),
		})
	}

	return results
}
