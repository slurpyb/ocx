// Translation logic derived from dyoshikawa/rulesync src/features/subagents/{opencode,claudecode}-subagent.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { basename, extname } from "node:path"
import type { ClaudeSubagent, OpencodeSubagent } from "./types"

// ─── Field remap table ─────────────────────────────────────────────────────────
//
// OpenCode field       │ Claude field        │ Notes
// ─────────────────────┼─────────────────────┼──────────────────────────────────
// name                 │ name                │ Falls back to filename stem
// description          │ description         │ Direct pass-through
// mode                 │ (dropped)           │ Claude infers from agents/ dir
// tools (object)       │ tools (string)      │ Keys where value === true, joined
// permission           │ (dropped)           │ No Claude subagent equivalent
// temperature          │ (dropped)           │ No Claude subagent equivalent
// top_p                │ (dropped)           │ No Claude subagent equivalent
// color                │ (dropped)           │ UI-only, no Claude equivalent
// hidden               │ (dropped)           │ UI-only, no Claude equivalent
// model (passthrough)  │ model               │ Claude accepts model override
//
// Body (agent prompt) passes through verbatim.

/**
 * Convert the OpenCode `tools` object map to a comma-separated allow-list
 * string for Claude.  Only tools explicitly enabled (value === true) are
 * included; disabled tools (false) are silently dropped — Claude has no
 * per-agent disable list in frontmatter.
 *
 * Returns undefined when the map is absent or contains no enabled tools, so
 * the `tools` key is omitted from the emitted frontmatter entirely.
 */
function translateTools(toolsMap: Record<string, boolean> | undefined): string | undefined {
	if (toolsMap === undefined) return undefined

	const enabled = Object.entries(toolsMap)
		.filter(([, v]) => v === true)
		.map(([k]) => k)

	return enabled.length > 0 ? enabled.join(", ") : undefined
}

/**
 * Derive the agent name from the file path stem when `frontmatter.name` is
 * absent.  e.g. "code-reviewer.md" → "code-reviewer",
 * "sub/code-reviewer.md" → "code-reviewer" (basename only, matching rulesync
 * behaviour in opencode-style-subagent.ts toRulesyncSubagent).
 */
function deriveName(relativePath: string, nameOverride: string | undefined): string {
	if (nameOverride !== undefined && nameOverride.length > 0) return nameOverride
	return basename(relativePath, extname(relativePath))
}

// Fields dropped during translation (no Claude subagent equivalent).
const DROPPED_FIELDS = new Set(["mode", "permission", "temperature", "top_p", "color", "hidden"])

/**
 * Pure transformation: one OpenCode subagent → one Claude subagent.
 *
 * Lossy fields (mode, permission, temperature, top_p, color, hidden) are
 * silently dropped.  `model` is forwarded when present in the passthrough bag.
 */
export function translate(source: OpencodeSubagent): ClaudeSubagent {
	const { name, description, tools } = source.frontmatter

	// Build the passthrough bag: all frontmatter keys except those we've handled
	// explicitly (name, description, tools) and those we drop (DROPPED_FIELDS).
	const passthrough: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(source.frontmatter as Record<string, unknown>)) {
		if (k === "name" || k === "description" || k === "tools") continue
		if (DROPPED_FIELDS.has(k)) continue
		passthrough[k] = v
	}

	const translatedTools = translateTools(tools)
	const resolvedName = deriveName(source.relativePath, name)

	// Build frontmatter — omit optional fields entirely when absent
	// (exactOptionalPropertyTypes: no `: undefined` assignments).
	const frontmatter = {
		name: resolvedName,
		...(description !== undefined ? { description } : {}),
		...(translatedTools !== undefined ? { tools: translatedTools } : {}),
		// Forward any remaining passthrough fields (e.g. model) that aren't
		// explicitly excluded above.
		...passthrough,
	}

	return {
		relativePath: source.relativePath,
		frontmatter,
		body: source.body,
	}
}
