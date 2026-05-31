// Translation logic derived from dyoshikawa/rulesync src/features/mcp/{opencode,claudecode}-mcp.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted convertFromOpencodeFormat algorithm; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import type { ClaudeMcpFile, ClaudeMcpServer, OpencodeMcpFile, OpencodeMcpServer } from "./types"

/**
 * Convert a single OpenCode MCP server entry to Claude shape.
 *
 * Algorithm (mirrors rulesync convertFromOpencodeFormat):
 *   - type "local"  → type "stdio"
 *   - type "remote" → type "http"  (Claude streamable-HTTP transport — what
 *     modern remote MCP servers like Cloudflare docs / Linear / Astro use)
 *   - command[0]    → command; command[1..] → args
 *   - environment   → env
 *   - enabled false → disabled: true  (field omitted when enabled)
 *   - top-level tools map split per-server → enabledTools / disabledTools
 *     (server name prefix stripped)
 */
function translateServer(
	serverName: string,
	serverConfig: OpencodeMcpServer,
	tools: Record<string, boolean>,
): ClaudeMcpServer {
	const enabledTools: string[] = []
	const disabledTools: string[] = []
	const prefix = `${serverName}_`

	for (const [toolKey, enabled] of Object.entries(tools)) {
		if (toolKey.startsWith(prefix)) {
			const toolName = toolKey.slice(prefix.length)
			if (enabled) {
				enabledTools.push(toolName)
			} else {
				disabledTools.push(toolName)
			}
		}
	}

	// Conditionally attach tool lists only when non-empty (exactOptionalPropertyTypes)
	const toolProps = {
		...(enabledTools.length > 0 ? { enabledTools } : {}),
		...(disabledTools.length > 0 ? { disabledTools } : {}),
	}

	if (serverConfig.type === "remote") {
		return {
			type: "http",
			url: serverConfig.url,
			...(serverConfig.enabled === false ? { disabled: true as const } : {}),
			...(serverConfig.headers !== undefined ? { headers: serverConfig.headers } : {}),
			...toolProps,
		}
	}

	// local → stdio
	const [command, ...rest] = serverConfig.command
	if (command === undefined) {
		throw new Error(`[ccx/mcp] Server "${serverName}" has an empty command array`)
	}

	return {
		type: "stdio",
		command,
		...(rest.length > 0 ? { args: rest } : {}),
		...(serverConfig.enabled === false ? { disabled: true as const } : {}),
		...(serverConfig.environment !== undefined ? { env: serverConfig.environment } : {}),
		...toolProps,
	}
}

/**
 * Pure transformation: OpenCode MCP file → Claude MCP file.
 * No I/O. Throws if any server has an empty command array.
 */
export function translate(source: OpencodeMcpFile): ClaudeMcpFile {
	const mcpServers: Record<string, ClaudeMcpServer> = {}

	for (const [serverName, serverConfig] of Object.entries(source.mcp)) {
		mcpServers[serverName] = translateServer(serverName, serverConfig, source.tools)
	}

	return { mcpServers }
}
