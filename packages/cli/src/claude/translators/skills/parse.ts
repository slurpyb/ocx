// Translation logic derived from dyoshikawa/rulesync src/features/skills/{opencode,claudecode}-skill.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { stat } from "node:fs/promises"
import { join } from "node:path"
import matter from "gray-matter"
import type { SourceContext } from "../../types"
import { type OpencodeSkill, OpencodeSkillFrontmatterSchema, type SupportFile } from "./types"

// ─── Constants ────────────────────────────────────────────────────────────────

const SKILL_FILE_NAME = "SKILL.md"
const SKILLS_SUBDIR = "skills"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMatter(content: string): {
	frontmatter: Record<string, unknown>
	body: string
} {
	const result = matter(content)
	return { frontmatter: result.data, body: result.content }
}

function stripNullish(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(obj)) {
		if (v !== null && v !== undefined) out[k] = v
	}
	return out
}

/**
 * Recursively collect all files under `dirPath`, returning paths relative to
 * `dirPath`. Excludes the main SKILL.md at the root of the skill directory.
 */
async function collectSupportFiles(
	skillDirPath: string,
	relativeBase: string,
): Promise<SupportFile[]> {
	const files: SupportFile[] = []

	let entries: string[]
	try {
		const glob = new Bun.Glob("**/*")
		const collected: string[] = []
		for await (const entry of glob.scan({ cwd: skillDirPath, onlyFiles: true })) {
			collected.push(entry)
		}
		entries = collected
	} catch {
		// Directory might not exist or be unreadable — return empty.
		return []
	}

	entries.sort() // deterministic ordering

	for (const entry of entries) {
		// Skip the main SKILL.md at the skill root (not nested ones)
		if (relativeBase === "" && entry === SKILL_FILE_NAME) continue

		const absolutePath = join(skillDirPath, entry)
		const relativePath = entry

		let mode: number | undefined
		try {
			const s = await stat(absolutePath)
			mode = s.mode
		} catch {
			// stat failure — omit mode, copy will still work
		}

		const file: SupportFile =
			mode !== undefined ? { relativePath, absolutePath, mode } : { relativePath, absolutePath }

		files.push(file)
	}

	return files
}

// ─── parse ────────────────────────────────────────────────────────────────────

/**
 * Scan `${profileDir}/skills/` for skill directories. Each subdirectory that
 * contains a `SKILL.md` is parsed into an `OpencodeSkill`. Directories without
 * SKILL.md are silently skipped.
 *
 * Returns an empty array when the skills directory doesn't exist.
 */
export async function parse(ctx: SourceContext): Promise<readonly OpencodeSkill[]> {
	const skillsRoot = join(ctx.profileDir, SKILLS_SUBDIR)

	// Enumerate immediate subdirectories (skill dirs).
	let skillDirNames: string[]
	try {
		const glob = new Bun.Glob("*/")
		const found: string[] = []
		for await (const entry of glob.scan({ cwd: skillsRoot, onlyFiles: false })) {
			// Bun Glob "**/" returns entries with trailing slash — strip it.
			found.push(entry.replace(/\/$/, ""))
		}
		skillDirNames = found
	} catch {
		// skills/ directory absent — no skills to translate.
		return []
	}

	skillDirNames.sort()

	const results: OpencodeSkill[] = []

	for (const dirName of skillDirNames) {
		const skillDirPath = join(skillsRoot, dirName)
		const skillFilePath = join(skillDirPath, SKILL_FILE_NAME)

		const skillFile = Bun.file(skillFilePath)
		if (!(await skillFile.exists())) {
			// No SKILL.md — skip this directory.
			continue
		}

		const text = await skillFile.text()
		const { frontmatter: rawFm, body } = parseMatter(text)

		const fmResult = OpencodeSkillFrontmatterSchema.safeParse(stripNullish(rawFm))
		if (!fmResult.success) {
			throw new Error(
				`[ccx/skills] Invalid frontmatter in ${skillFilePath}: ${fmResult.error.message}`,
			)
		}

		const supportFiles = await collectSupportFiles(skillDirPath, "")

		results.push({
			name: dirName,
			frontmatter: fmResult.data,
			body: body.trim(),
			supportFiles,
		})
	}

	return results
}
