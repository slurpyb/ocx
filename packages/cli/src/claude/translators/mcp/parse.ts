// Translation logic derived from dyoshikawa/rulesync src/features/mcp/{opencode,claudecode}-mcp.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted convertFromOpencodeFormat algorithm; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import type { SourceContext } from "../../types"
import { OpencodeConfigSchema, type OpencodeMcpFile } from "./types"

/**
 * Read ${profileDir}/opencode.jsonc, parse the mcp + tools blocks, and
 * return them as a single-element array. Returns an empty array when the
 * file is absent or has no mcp block.
 */
export async function parse(ctx: SourceContext): Promise<readonly OpencodeMcpFile[]> {
	const filePath = join(ctx.profileDir, "opencode.jsonc")

	let raw: string
	try {
		raw = await Bun.file(filePath).text()
	} catch {
		// File absent — no MCP servers to translate.
		return []
	}

	const parsed: unknown = parseJsonc(raw)

	const result = OpencodeConfigSchema.safeParse(parsed)
	if (!result.success) {
		throw new Error(`[ccx/mcp] Failed to parse ${filePath}: ${result.error.message}`)
	}

	const config = result.data

	// No mcp block → nothing to translate.
	if (!config.mcp || Object.keys(config.mcp).length === 0) {
		return []
	}

	const file: OpencodeMcpFile = {
		mcp: config.mcp,
		tools: config.tools ?? {},
	}

	return [file]
}
