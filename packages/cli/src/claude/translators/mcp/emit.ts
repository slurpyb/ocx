// Translation logic derived from dyoshikawa/rulesync src/features/mcp/{opencode,claudecode}-mcp.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted convertFromOpencodeFormat algorithm; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { join } from "node:path"
import type { EmitResult, TargetContext } from "../../types"
import type { ClaudeMcpFile } from "./types"

/**
 * Write the translated MCP config to disk.
 *
 * Paths per scope:
 *   project → ${projectRoot}/.mcp.json
 *   global  → ${claudeDir}/mcp.json
 *
 * Uses Bun.write() — merges with any existing file so other tools'
 * mcpServers entries are preserved. Only the keys produced by this
 * translator are overwritten.
 */
export async function emit(claude: ClaudeMcpFile, ctx: TargetContext): Promise<EmitResult> {
	const outPath =
		ctx.scope === "project" ? join(ctx.projectRoot, ".mcp.json") : join(ctx.claudeDir, "mcp.json")

	// Merge with existing content so other tools (or other agents) don't lose
	// their mcpServers entries.
	let existing: Record<string, unknown> = {}
	try {
		const raw = await Bun.file(outPath).text()
		const parsed: unknown = JSON.parse(raw)
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			existing = parsed as Record<string, unknown>
		}
	} catch {
		// File absent or unparseable — start fresh.
	}

	const existingServers: Record<string, unknown> =
		existing.mcpServers !== null &&
		typeof existing.mcpServers === "object" &&
		!Array.isArray(existing.mcpServers)
			? (existing.mcpServers as Record<string, unknown>)
			: {}

	const merged = {
		...existing,
		mcpServers: {
			...existingServers,
			...claude.mcpServers,
		},
	}

	await Bun.write(outPath, `${JSON.stringify(merged, null, 2)}\n`)

	return { written: [outPath], skipped: [] }
}
