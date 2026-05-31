// Translation logic derived from dyoshikawa/rulesync src/features/permissions/{opencode,claudecode}-permissions.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; output to a .ccx-fragments file rather than directly to
// settings.json so the pipeline can merge alongside the hooks translator.

import { z } from "zod"

// ─── OpenCode source shapes ────────────────────────────────────────────────────
//
// OpenCode config: ${profileDir}/opencode.jsonc  (or opencode.json)
// Relevant key:    `permission`
//
// Per-tool value is either:
//   "allow" | "ask" | "deny"           → applies to all patterns ("*")
//   Record<string, "allow"|"ask"|"deny"> → per-pattern map

export const OpencodePermissionActionSchema = z.enum(["allow", "ask", "deny"])
export type OpencodePermissionAction = z.infer<typeof OpencodePermissionActionSchema>

/**
 * A per-tool permission value: either a bare action string (applies to "*"),
 * or an object whose keys are glob patterns and values are actions.
 */
export const OpencodeToolPermissionSchema = z.union([
	OpencodePermissionActionSchema,
	z.record(z.string(), OpencodePermissionActionSchema),
])
export type OpencodeToolPermission = z.infer<typeof OpencodeToolPermissionSchema>

/**
 * The `permission` object extracted from opencode.jsonc.
 * Keys are tool category names (e.g. "bash", "edit", "mcp__server").
 */
export const OpencodePermissionMapSchema = z.record(z.string(), OpencodeToolPermissionSchema)
export type OpencodePermissionMap = z.infer<typeof OpencodePermissionMapSchema>

/**
 * The full (loose) opencode.jsonc schema — only the `permission` key is
 * consumed; all other fields are ignored.
 */
export const OpencodePermissionsFileSchema = z.object({
	permission: OpencodePermissionMapSchema.optional(),
})
export type OpencodePermissionsFile = z.infer<typeof OpencodePermissionsFileSchema>

// ─── Claude target shapes ──────────────────────────────────────────────────────
//
// Output: ${claudeDir}/.ccx-fragments/permissions.json
// Shape:  { "permissions": { "allow": string[], "ask": string[], "deny": string[] } }
//
// Pattern syntax:
//   "Bash(git *)"          — bash with glob pattern
//   "Bash"                 — bash, wildcard ("*") omitted per convention
//   "Read(src/**)"         — read with path pattern
//   "WebFetch(domain:...)" — webfetch domain restriction (pass-through from opencode)
//   "mcp__server__tool"    — MCP tools use double-underscore namespacing (pass-through)

export const ClaudePermissionsBlockSchema = z.object({
	allow: z.array(z.string()),
	ask: z.array(z.string()),
	deny: z.array(z.string()),
})
export type ClaudePermissionsBlock = z.infer<typeof ClaudePermissionsBlockSchema>

/**
 * The fragment written to `.ccx-fragments/permissions.json`.
 */
export const ClaudePermissionsFragmentSchema = z.object({
	permissions: ClaudePermissionsBlockSchema,
})
export type ClaudePermissionsFragment = z.infer<typeof ClaudePermissionsFragmentSchema>
