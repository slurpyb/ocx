// Translation logic derived from dyoshikawa/rulesync src/features/permissions/{opencode,claudecode}-permissions.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; output to a .ccx-fragments file rather than directly to
// settings.json so the pipeline can merge alongside the hooks translator.

import type { ClaudePermissionsFragment, OpencodePermissionsFile } from "./types"

// ─── Tool name mapping ────────────────────────────────────────────────────────
//
// OpenCode uses lowercase canonical names; Claude Code uses PascalCase.
// Unknown names (e.g. "mcp__myserver__mytool") pass through unchanged.

const CANONICAL_TO_CLAUDE: Record<string, string> = {
	bash: "Bash",
	read: "Read",
	edit: "Edit",
	write: "Write",
	webfetch: "WebFetch",
	websearch: "WebSearch",
	grep: "Grep",
	glob: "Glob",
	notebookedit: "NotebookEdit",
	agent: "Agent",
}

function toClaudeToolName(canonical: string): string {
	return CANONICAL_TO_CLAUDE[canonical] ?? canonical
}

// ─── Pattern entry helpers ────────────────────────────────────────────────────

/**
 * Build a Claude Code permission entry like "Bash(npm run *)".
 * When pattern is "*" the parenthetical is omitted → "Bash".
 * This mirrors rulesync's buildClaudePermissionEntry().
 */
function buildEntry(toolName: string, pattern: string): string {
	if (pattern === "*") return toolName
	return `${toolName}(${pattern})`
}

// ─── translate ────────────────────────────────────────────────────────────────
//
// "ask" handling
// ──────────────
// Claude Code's settings.json supports an `ask` bucket in addition to `allow`
// and `deny`. rulesync's convertRulesyncToClaudePermissions() preserves "ask"
// entries in that third bucket. We do the same: "ask" entries go to
// permissions.ask, not dropped. This is the most faithful translation and
// avoids silently elevating or blocking permissions the user explicitly marked
// as "ask".

/**
 * Pure OpenCode → Claude permissions transform.
 *
 * Flattens the per-tool `permission` map into three sorted, deduplicated
 * string arrays (allow / ask / deny) using Claude Code pattern syntax.
 */
export function translate(source: OpencodePermissionsFile): ClaudePermissionsFragment {
	const allow: string[] = []
	const ask: string[] = []
	const deny: string[] = []

	const permission = source.permission ?? {}

	for (const [category, value] of Object.entries(permission)) {
		const claudeTool = toClaudeToolName(category)

		// Normalise bare action string to wildcard map — mirrors rulesync's
		// normalizePermission():  "allow" → { "*": "allow" }
		const rules: Record<string, "allow" | "ask" | "deny"> =
			typeof value === "string" ? { "*": value } : value

		for (const [pattern, action] of Object.entries(rules)) {
			const entry = buildEntry(claudeTool, pattern)
			switch (action) {
				case "allow":
					allow.push(entry)
					break
				case "ask":
					ask.push(entry)
					break
				case "deny":
					deny.push(entry)
					break
			}
		}
	}

	// Sort for deterministic output; dedup with Set in case of repeated entries.
	const dedupSort = (arr: string[]): string[] => [...new Set(arr)].sort()

	return {
		permissions: {
			allow: dedupSort(allow),
			ask: dedupSort(ask),
			deny: dedupSort(deny),
		},
	}
}
