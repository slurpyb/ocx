// Translation logic derived from dyoshikawa/rulesync src/features/hooks/{opencode,claudecode}-hooks.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; output to a .ccx-fragments file rather than directly to
// settings.json so the pipeline can merge alongside the permissions translator.

import type {
	ClaudeHookEntry,
	ClaudeHooksFragment,
	ClaudeMatcherGroup,
	OpencodeHooksFile,
} from "./types"
import {
	CANONICAL_TO_CLAUDE_EVENT,
	CLAUDE_NO_MATCHER_EVENTS,
	CLAUDE_SUPPORTED_EVENTS,
} from "./types"

const CLAUDE_SUPPORTED_SET: ReadonlySet<string> = new Set(CLAUDE_SUPPORTED_EVENTS)

/**
 * Translate a canonical .rulesync/hooks.json config into Claude's hooks block.
 *
 * Algorithm (mirrors canonicalToToolHooks in rulesync/src/features/hooks/tool-hooks-converter.ts):
 *
 * 1. Merge shared hooks with any claudecode-specific overrides.
 * 2. Filter to events Claude supports.
 * 3. Group definitions by matcher within each event.
 * 4. For each matcher group, emit { matcher?, hooks: [{ type, command?, timeout?, prompt? }] }.
 * 5. Drop prompt-type hooks that have no prompt field (they'd be no-ops).
 * 6. Emit under Claude's PascalCase event key.
 *
 * Prefixing: rulesync prefixes dot-relative commands with $CLAUDE_PROJECT_DIR.
 * ccx replicates this behaviour — only commands starting with "." are prefixed,
 * bare executables like "npx prettier ..." are left intact.
 */
export function translate(source: OpencodeHooksFile): ClaudeHooksFragment {
	// Merge shared hooks with claudecode-specific overrides (overrides win).
	const sharedHooks: Record<string, ReturnType<(typeof source.hooks)[string]["slice"]>> = {}
	for (const [event, defs] of Object.entries(source.hooks)) {
		if (CLAUDE_SUPPORTED_SET.has(event)) {
			sharedHooks[event] = defs
		}
	}
	const effectiveHooks: typeof sharedHooks = {
		...sharedHooks,
		...(source.claudecode?.hooks ?? {}),
	}

	const result: Record<string, readonly ClaudeMatcherGroup[]> = {}

	for (const [canonicalEvent, definitions] of Object.entries(effectiveHooks)) {
		// Drop events Claude doesn't support (may come from claudecode override block).
		if (!CLAUDE_SUPPORTED_SET.has(canonicalEvent)) {
			// Unsupported event — silently drop (no Claude equivalent).
			continue
		}

		const claudeEventName = CANONICAL_TO_CLAUDE_EVENT[canonicalEvent] ?? canonicalEvent
		const isNoMatcherEvent = CLAUDE_NO_MATCHER_EVENTS.has(canonicalEvent)

		// Group definitions by matcher value so we can build matcher groups.
		const byMatcher = new Map<string, typeof definitions>()
		for (const def of definitions) {
			const key = def.matcher ?? ""
			const list = byMatcher.get(key)
			if (list) list.push(def)
			else byMatcher.set(key, [def])
		}

		const entries: ClaudeMatcherGroup[] = []

		for (const [matcherKey, defs] of byMatcher) {
			const hooks: ClaudeHookEntry[] = []

			for (const def of defs) {
				const hookType = def.type ?? "command"

				// Build the command, prefixing dot-relative paths with $CLAUDE_PROJECT_DIR.
				let command: string | undefined = def.command
				if (typeof command === "string") {
					const trimmed = command.trimStart()
					if (trimmed.startsWith(".")) {
						command = `$CLAUDE_PROJECT_DIR/${trimmed.replace(/^\.\//, "")}`
					}
				}

				const entry: ClaudeHookEntry = {
					type: hookType,
					...(command !== undefined && { command }),
					...(def.timeout !== undefined && { timeout: def.timeout }),
					...(def.prompt !== undefined && { prompt: def.prompt }),
				}

				hooks.push(entry)
			}

			if (hooks.length === 0) continue

			// For no-matcher events (worktreeCreate, worktreeRemove), always omit matcher.
			const includeMatcher = matcherKey !== "" && !isNoMatcherEvent

			const group: ClaudeMatcherGroup = {
				...(includeMatcher && { matcher: matcherKey }),
				hooks,
			}

			entries.push(group)
		}

		if (entries.length > 0) {
			result[claudeEventName] = entries
		}
	}

	return { hooks: result }
}
