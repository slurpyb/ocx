// Translation logic derived from dyoshikawa/rulesync src/features/hooks/{opencode,claudecode}-hooks.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; source format is ccx-owned (${profileDir}/.ccx/hooks.json),
// NOT rulesync's IR. Output goes to a .ccx-fragments file rather than directly
// to settings.json so the pipeline can merge alongside the permissions translator.

import { z } from "zod"

// ─── Control chars (inlined from rulesync to avoid external dep) ──────────────

const CONTROL_CHARS = ["\n", "\r", "\0"] as const

const hasControlChars = (val: string): boolean => CONTROL_CHARS.some((char) => val.includes(char))

const safeString = z
	.string()
	.refine(
		(val) => !hasControlChars(val),
		"must not contain newline, carriage return, or NUL characters",
	)

// ─── Canonical event names supported by Claude Code ───────────────────────────

/**
 * Canonical camelCase event names that Claude Code supports.
 * Derived from CLAUDE_HOOK_EVENTS in rulesync/src/types/hooks.ts.
 */
export const CLAUDE_SUPPORTED_EVENTS = [
	"sessionStart",
	"sessionEnd",
	"preToolUse",
	"postToolUse",
	"beforeSubmitPrompt",
	"stop",
	"subagentStop",
	"preCompact",
	"permissionRequest",
	"notification",
	"setup",
	"worktreeCreate",
	"worktreeRemove",
] as const

export type ClaudeSupportedEvent = (typeof CLAUDE_SUPPORTED_EVENTS)[number]

/**
 * Canonical → Claude PascalCase event name mapping.
 * Derived from CANONICAL_TO_CLAUDE_EVENT_NAMES in rulesync/src/types/hooks.ts.
 */
export const CANONICAL_TO_CLAUDE_EVENT: Record<string, string> = {
	sessionStart: "SessionStart",
	sessionEnd: "SessionEnd",
	preToolUse: "PreToolUse",
	postToolUse: "PostToolUse",
	beforeSubmitPrompt: "UserPromptSubmit",
	stop: "Stop",
	subagentStop: "SubagentStop",
	preCompact: "PreCompact",
	permissionRequest: "PermissionRequest",
	notification: "Notification",
	setup: "Setup",
	worktreeCreate: "WorktreeCreate",
	worktreeRemove: "WorktreeRemove",
}

/**
 * Events that do not support the matcher field in Claude Code.
 * Derived from CLAUDE_NO_MATCHER_EVENTS in rulesync/src/features/hooks/claudecode-hooks.ts.
 */
export const CLAUDE_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([
	"worktreeCreate",
	"worktreeRemove",
])

// ─── OpenCode-side schemas (source) ──────────────────────────────────────────

/**
 * A single hook definition in canonical form (`${profileDir}/.ccx/hooks.json`).
 */
export const HookDefinitionSchema = z
	.object({
		command: safeString.optional(),
		type: z.enum(["command", "prompt"]).optional(),
		timeout: z.number().optional(),
		matcher: safeString.optional(),
		prompt: safeString.optional(),
		loop_limit: z.number().nullable().optional(),
		name: safeString.optional(),
		description: safeString.optional(),
	})
	.passthrough()

export type HookDefinition = z.infer<typeof HookDefinitionSchema>

const hooksRecordSchema = z.record(z.string(), z.array(HookDefinitionSchema))

/**
 * Shape of .rulesync/hooks.json — the canonical hooks config file that lives
 * in the OpenCode profile directory and drives all tool-specific hook generation.
 */
export const OpencodeHooksFileSchema = z
	.object({
		version: z.number().optional(),
		hooks: hooksRecordSchema,
		// Per-tool override blocks. We only use the claudecode overrides here.
		claudecode: z.object({ hooks: hooksRecordSchema.optional() }).passthrough().optional(),
		opencode: z.object({ hooks: hooksRecordSchema.optional() }).passthrough().optional(),
	})
	.passthrough()

export type OpencodeHooksFile = z.infer<typeof OpencodeHooksFileSchema>

// ─── Claude-side types (target) ───────────────────────────────────────────────

/**
 * A single hook entry in Claude's settings.json hook array.
 * Mirrors the shape Claude Code expects: type + command (+ optional timeout/prompt).
 */
export interface ClaudeHookEntry {
	readonly type: "command" | "prompt"
	readonly command?: string
	readonly timeout?: number
	readonly prompt?: string
}

/**
 * A matcher group inside a Claude hook event array.
 * When matcher is absent the hook applies to all tools.
 */
export interface ClaudeMatcherGroup {
	readonly matcher?: string
	readonly hooks: readonly ClaudeHookEntry[]
}

/**
 * The `hooks` block written inside settings.json (or .ccx-fragments/hooks.json).
 * Keys are Claude PascalCase event names.
 */
export type ClaudeHooksBlock = Partial<Record<string, readonly ClaudeMatcherGroup[]>>

/**
 * TClaude: the fragment shape written to .ccx-fragments/hooks.json.
 */
export interface ClaudeHooksFragment {
	readonly hooks: ClaudeHooksBlock
}
