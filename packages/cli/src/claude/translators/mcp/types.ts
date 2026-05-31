// Translation logic derived from dyoshikawa/rulesync src/features/mcp/{opencode,claudecode}-mcp.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted convertFromOpencodeFormat algorithm; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { z } from "zod"

// ─── OpenCode-side schemas (source) ──────────────────────────────────────────

export const OpencodeMcpLocalServerSchema = z.object({
	type: z.literal("local"),
	command: z.array(z.string()),
	environment: z.record(z.string(), z.string()).optional(),
	enabled: z.boolean().default(true),
	cwd: z.string().optional(),
})

export const OpencodeMcpRemoteServerSchema = z.object({
	type: z.literal("remote"),
	url: z.string(),
	headers: z.record(z.string(), z.string()).optional(),
	enabled: z.boolean().default(true),
})

export const OpencodeMcpServerSchema = z.discriminatedUnion("type", [
	OpencodeMcpLocalServerSchema,
	OpencodeMcpRemoteServerSchema,
])

// We use z.object (not looseObject) — unknown extra fields on opencode.jsonc
// are fine to drop since we only need the mcp + tools blocks.
export const OpencodeConfigSchema = z
	.object({
		$schema: z.string().optional(),
		mcp: z.record(z.string(), OpencodeMcpServerSchema).optional(),
		tools: z.record(z.string(), z.boolean()).optional(),
	})
	.passthrough()

export type OpencodeMcpLocalServer = z.infer<typeof OpencodeMcpLocalServerSchema>
export type OpencodeMcpRemoteServer = z.infer<typeof OpencodeMcpRemoteServerSchema>
export type OpencodeMcpServer = z.infer<typeof OpencodeMcpServerSchema>
export type OpencodeConfig = z.infer<typeof OpencodeConfigSchema>

/**
 * TSource: a validated snapshot of the mcp + tools blocks from opencode.jsonc.
 * We carry the full mcp map and the top-level tools map together so the
 * translate step can split per-server tool enables/disables in one pass.
 */
export interface OpencodeMcpFile {
	readonly mcp: Record<string, OpencodeMcpServer>
	readonly tools: Record<string, boolean>
}

// ─── Claude-side schemas (target) ────────────────────────────────────────────

export const ClaudeMcpStdioServerSchema = z.object({
	type: z.literal("stdio"),
	command: z.string(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
	disabled: z.literal(true).optional(),
	enabledTools: z.array(z.string()).optional(),
	disabledTools: z.array(z.string()).optional(),
})

// Claude .mcp.json accepts "http" (streamable HTTP — modern default) and
// "sse" (legacy Server-Sent Events) for remote servers.
export const ClaudeMcpHttpServerSchema = z.object({
	type: z.literal("http"),
	url: z.string(),
	headers: z.record(z.string(), z.string()).optional(),
	disabled: z.literal(true).optional(),
	enabledTools: z.array(z.string()).optional(),
	disabledTools: z.array(z.string()).optional(),
})

export const ClaudeMcpSseServerSchema = z.object({
	type: z.literal("sse"),
	url: z.string(),
	headers: z.record(z.string(), z.string()).optional(),
	disabled: z.literal(true).optional(),
	enabledTools: z.array(z.string()).optional(),
	disabledTools: z.array(z.string()).optional(),
})

export const ClaudeMcpServerSchema = z.discriminatedUnion("type", [
	ClaudeMcpStdioServerSchema,
	ClaudeMcpHttpServerSchema,
	ClaudeMcpSseServerSchema,
])

export const ClaudeMcpFileSchema = z.object({
	mcpServers: z.record(z.string(), ClaudeMcpServerSchema),
})

export type ClaudeMcpStdioServer = z.infer<typeof ClaudeMcpStdioServerSchema>
export type ClaudeMcpSseServer = z.infer<typeof ClaudeMcpSseServerSchema>
export type ClaudeMcpServer = z.infer<typeof ClaudeMcpServerSchema>

/**
 * TClaude: the shape written to .mcp.json (project) or mcp.json (global).
 */
export type ClaudeMcpFile = z.infer<typeof ClaudeMcpFileSchema>
