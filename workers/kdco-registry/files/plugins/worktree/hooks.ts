import { createHash } from "node:crypto"
import type { ToolContext } from "@opencode-ai/plugin"

export type HookType = "postCreate" | "preDelete"

export interface ParsedHookCommand {
	hookType: HookType
	commandText: string
	commandHash: string
}

export interface HookApprovalSnapshot {
	commandHashes: string[]
	commandTexts: string[]
}

export type HookExecutionOutcome = "run-once" | "run-and-persist" | "skip" | "error-skip"

export interface HookResolution {
	hook: ParsedHookCommand
	outcome: HookExecutionOutcome
	reason:
		| "durable-approved"
		| "approved-once"
		| "approved-always"
		| "rejected"
		| "dismissed"
		| "prompt-unavailable"
		| "prompt-error"
		| "storage-read-error"
		| "storage-write-error"
}

export interface HookApprovalReadResult {
	ok: true
	approved: boolean
}

export interface HookApprovalReadError {
	ok: false
	error: string
}

export type HookApprovalReadOutcome = HookApprovalReadResult | HookApprovalReadError

export interface HookApprovalWriteResult {
	ok: true
}

export interface HookApprovalWriteError {
	ok: false
	error: string
}

export type HookApprovalWriteOutcome = HookApprovalWriteResult | HookApprovalWriteError

interface HookApprovalResolverOptions {
	toolContext: ToolContext
	readDurableApproval: (hook: ParsedHookCommand) => Promise<HookApprovalReadOutcome>
	writeDurableApproval: (hook: ParsedHookCommand) => Promise<HookApprovalWriteOutcome>
}

type HookPromptDecision = "once" | "always" | "reject" | "dismissed" | "unavailable" | "error"

function toPromptMessage(hook: ParsedHookCommand): string {
	return [
		`Approve worktree ${hook.hookType} hook?`,
		"",
		"This command is defined in your repository config and will run locally:",
		"",
		hook.commandText,
		"",
		"Choose: once (run now), always (allow this exact command text for this project), or reject.",
	].join("\n")
}

function normalizePromptDecision(value: unknown): HookPromptDecision {
	if (typeof value === "boolean") {
		return value ? "once" : "reject"
	}

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase()
		if (normalized === "once") return "once"
		if (normalized === "always") return "always"
		if (normalized === "reject") return "reject"
		if (normalized === "dismiss" || normalized === "dismissed" || normalized === "cancel") {
			return "dismissed"
		}
	}

	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>
		const candidates = [record.value, record.choice, record.result, record.status, record.action]
		for (const candidate of candidates) {
			const normalizedCandidate = normalizePromptDecision(candidate)
			if (normalizedCandidate !== "dismissed") {
				return normalizedCandidate
			}
		}

		if (record.dismissed === true || record.cancelled === true || record.canceled === true) {
			return "dismissed"
		}
	}

	return "dismissed"
}

async function askForHookApproval(
	toolContext: ToolContext,
	hook: ParsedHookCommand,
): Promise<HookPromptDecision> {
	const ask = (toolContext as unknown as { ask?: (prompt: unknown) => Promise<unknown> }).ask
	if (typeof ask !== "function") {
		return "unavailable"
	}

	const promptPayload = {
		type: "approval",
		title: `Approve ${hook.hookType} hook`,
		message: toPromptMessage(hook),
		choices: [
			{ value: "once", label: "Run once" },
			{ value: "always", label: "Always run this exact command" },
			{ value: "reject", label: "Reject" },
		],
		default: "reject",
	}

	try {
		const response = await ask(promptPayload)
		return normalizePromptDecision(response)
	} catch {
		try {
			const fallbackResponse = await ask(toPromptMessage(hook))
			return normalizePromptDecision(fallbackResponse)
		} catch {
			return "error"
		}
	}
}

export function hashHookCommand(commandText: string): string {
	return createHash("sha256").update(commandText).digest("hex")
}

export function parseHookCommands(hookType: HookType, commands: string[]): ParsedHookCommand[] {
	return commands.map((commandText) => ({
		hookType,
		commandText,
		commandHash: hashHookCommand(commandText),
	}))
}

export async function resolveHookApprovals(
	parsedHooks: ParsedHookCommand[],
	options: HookApprovalResolverOptions,
): Promise<HookResolution[]> {
	const resolutions: HookResolution[] = []

	for (const hook of parsedHooks) {
		const durableApproval = await options.readDurableApproval(hook)
		if (!durableApproval.ok) {
			resolutions.push({ hook, outcome: "error-skip", reason: "storage-read-error" })
			continue
		}

		if (durableApproval.approved) {
			resolutions.push({ hook, outcome: "run-and-persist", reason: "durable-approved" })
			continue
		}

		const promptDecision = await askForHookApproval(options.toolContext, hook)
		if (promptDecision === "always") {
			const persistResult = await options.writeDurableApproval(hook)
			if (!persistResult.ok) {
				resolutions.push({ hook, outcome: "error-skip", reason: "storage-write-error" })
				continue
			}

			resolutions.push({ hook, outcome: "run-and-persist", reason: "approved-always" })
			continue
		}

		if (promptDecision === "once") {
			resolutions.push({ hook, outcome: "run-once", reason: "approved-once" })
			continue
		}

		if (promptDecision === "reject") {
			resolutions.push({ hook, outcome: "skip", reason: "rejected" })
			continue
		}

		if (promptDecision === "dismissed") {
			resolutions.push({ hook, outcome: "skip", reason: "dismissed" })
			continue
		}

		if (promptDecision === "unavailable") {
			resolutions.push({ hook, outcome: "error-skip", reason: "prompt-unavailable" })
			continue
		}

		resolutions.push({ hook, outcome: "error-skip", reason: "prompt-error" })
	}

	return resolutions
}

export function hooksForCurrentInvocation(resolutions: HookResolution[]): ParsedHookCommand[] {
	return resolutions
		.filter(
			(resolution) => resolution.outcome === "run-once" || resolution.outcome === "run-and-persist",
		)
		.map((resolution) => resolution.hook)
}

export function createHookApprovalSnapshot(hooks: ParsedHookCommand[]): HookApprovalSnapshot {
	return {
		commandHashes: hooks.map((hook) => hook.commandHash),
		commandTexts: hooks.map((hook) => hook.commandText),
	}
}

function snapshotHasConsistentLengths(snapshot: HookApprovalSnapshot): boolean {
	return (
		snapshot.commandTexts.length === 0 ||
		snapshot.commandTexts.length === snapshot.commandHashes.length
	)
}

export function matchHooksToApprovalSnapshot(
	currentHooks: ParsedHookCommand[],
	snapshot: HookApprovalSnapshot,
): { ok: true; hooks: ParsedHookCommand[] } | { ok: false; reason: string } {
	if (!snapshotHasConsistentLengths(snapshot)) {
		return { ok: false, reason: "snapshot-length-mismatch" }
	}

	if (snapshot.commandHashes.length === 0) {
		return { ok: true, hooks: [] }
	}

	const matchedHooks: ParsedHookCommand[] = []
	let currentHookIndex = 0

	for (let snapshotIndex = 0; snapshotIndex < snapshot.commandHashes.length; snapshotIndex++) {
		const expectedHash = snapshot.commandHashes[snapshotIndex]
		const expectedText = snapshot.commandTexts[snapshotIndex]
		let foundMatch = false

		while (currentHookIndex < currentHooks.length) {
			const candidate = currentHooks[currentHookIndex]
			currentHookIndex += 1

			if (candidate.commandHash !== expectedHash) {
				continue
			}

			if (expectedText !== undefined && candidate.commandText !== expectedText) {
				continue
			}

			matchedHooks.push(candidate)
			foundMatch = true
			break
		}

		if (!foundMatch) {
			return { ok: false, reason: "snapshot-not-found-in-current-config" }
		}
	}

	return { ok: true, hooks: matchedHooks }
}

export function shortCommandHash(commandHash: string): string {
	return commandHash.slice(0, 12)
}
