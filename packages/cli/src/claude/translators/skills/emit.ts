// Translation logic derived from dyoshikawa/rulesync src/features/skills/{opencode,claudecode}-skill.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { chmod, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import matter from "gray-matter"
import type { EmitResult, TargetContext } from "../../types"
import type { ClaudeSkill } from "./types"

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Serialize frontmatter + body back to a SKILL.md string.
 * gray-matter's `stringify` handles YAML frontmatter fencing.
 *
 * We use a plain object for frontmatter so that only defined keys are
 * serialised (exactOptionalPropertyTypes: the caller already omits undefined).
 */
function serializeSkillMd(frontmatter: Record<string, unknown>, body: string): string {
	return matter.stringify(body, frontmatter)
}

/**
 * Ensure the directory at `dirPath` exists (equivalent to `mkdir -p`).
 */
async function ensureDir(dirPath: string): Promise<void> {
	await mkdir(dirPath, { recursive: true })
}

// ─── emit ─────────────────────────────────────────────────────────────────────

/**
 * Write a translated Claude Code skill to disk.
 *
 * Target layout:
 *   ${claudeDir}/skills/<name>/SKILL.md
 *   ${claudeDir}/skills/<name>/<support-file-relative-path>  (verbatim copy)
 *
 * Algorithm:
 *   1. Ensure ${claudeDir}/skills/<name>/ exists (mkdir -p).
 *   2. Serialise frontmatter + body to SKILL.md and write via Bun.write.
 *   3. For each support file:
 *      a. mkdir -p the target subdirectory.
 *      b. Read source bytes via Bun.file().arrayBuffer().
 *      c. Write to target via Bun.write().
 *      d. If a mode was recorded, apply it via fs.chmod().
 */
export async function emit(claude: ClaudeSkill, ctx: TargetContext): Promise<EmitResult> {
	const written: string[] = []

	const skillOutDir = join(ctx.claudeDir, "skills", claude.name)
	await ensureDir(skillOutDir)

	// ── SKILL.md ──────────────────────────────────────────────────────────────
	const skillMdPath = join(skillOutDir, "SKILL.md")

	// Build a plain frontmatter object; omit undefined keys to honour
	// exactOptionalPropertyTypes and produce clean YAML.
	const fmObj: Record<string, unknown> = {
		name: claude.frontmatter.name,
		description: claude.frontmatter.description,
	}
	if (claude.frontmatter["allowed-tools"] !== undefined) {
		fmObj["allowed-tools"] = claude.frontmatter["allowed-tools"]
	}
	if (claude.frontmatter.model !== undefined) {
		fmObj.model = claude.frontmatter.model
	}
	if (claude.frontmatter["disable-model-invocation"] !== undefined) {
		fmObj["disable-model-invocation"] = claude.frontmatter["disable-model-invocation"]
	}
	if (claude.frontmatter.paths !== undefined) {
		fmObj.paths = claude.frontmatter.paths
	}

	const skillMdContent = serializeSkillMd(fmObj, claude.body)
	await Bun.write(skillMdPath, skillMdContent)
	written.push(skillMdPath)

	// ── Support files ─────────────────────────────────────────────────────────
	for (const sf of claude.supportFiles) {
		const targetPath = join(skillOutDir, sf.relativePath)
		const targetDir = dirname(targetPath)

		await ensureDir(targetDir)

		// Read source as raw bytes to preserve binary files (images, scripts, etc.)
		const bytes = await Bun.file(sf.absolutePath).arrayBuffer()
		await Bun.write(targetPath, bytes)

		// Restore executable bits or original permissions when available.
		if (sf.mode !== undefined) {
			try {
				await chmod(targetPath, sf.mode)
			} catch {
				// Non-fatal — permission bits are best-effort.
			}
		}

		written.push(targetPath)
	}

	return { written, skipped: [] }
}
