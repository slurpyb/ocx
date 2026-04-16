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
	reasonDetail?: string
	reason:
		| "durable-approved"
		| "approved-by-permission"
		| "rejected"
		| "permission-denied"
		| "prompt-unavailable"
		| "prompt-error"
		| "storage-read-error"
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

interface HookApprovalResolverOptions {
	toolContext: ToolContext
	readDurableApproval: (hook: ParsedHookCommand) => Promise<HookApprovalReadOutcome>
}

type HookPromptDecision =
	| { kind: "approved" }
	| { kind: "rejected" }
	| { kind: "denied"; detail?: string }
	| { kind: "unavailable" }
	| { kind: "error"; detail?: string }

function approvalPatternForHook(hook: ParsedHookCommand): string {
	const visibleCommand = JSON.stringify(hook.commandText)
		.replaceAll("*", "﹡")
		.replaceAll("?", "﹖")
	return `hash=${hook.commandHash}; command=${visibleCommand}`
}

function getErrorMessage(error: unknown): string | undefined {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message.trim()
	}

	if (typeof error === "string" && error.trim().length > 0) {
		return error.trim()
	}

	return undefined
}

function getErrorIdentifier(error: unknown): string | undefined {
	if (!error || typeof error !== "object") {
		return undefined
	}

	if ("name" in error && typeof error.name === "string" && error.name.length > 0) {
		return error.name
	}

	if ("_tag" in error && typeof error._tag === "string" && error._tag.length > 0) {
		return error._tag
	}

	return undefined
}

function classifyAskError(error: unknown): HookPromptDecision {
	const detail = getErrorMessage(error)
	const identifier = getErrorIdentifier(error)
	if (identifier === "PermissionRejectedError" || identifier === "PermissionCorrectedError") {
		return { kind: "rejected" }
	}

	if (identifier === "PermissionDeniedError") {
		return { kind: "denied", detail }
	}

	const loweredDetail = detail?.toLowerCase()
	if (loweredDetail?.includes("rejected permission")) {
		return { kind: "rejected" }
	}

	if (
		loweredDetail?.includes("permission denied") ||
		loweredDetail?.includes("prevents you from using this specific tool call")
	) {
		return { kind: "denied", detail }
	}

	return { kind: "error", detail }
}

async function askForHookApproval(
	toolContext: ToolContext,
	hook: ParsedHookCommand,
): Promise<HookPromptDecision> {
	const ask = (
		toolContext as unknown as {
			ask?: (input: {
				permission: string
				patterns: string[]
				always: string[]
				metadata: Record<string, unknown>
			}) => Promise<void>
		}
	).ask
	if (typeof ask !== "function") {
		return { kind: "unavailable" }
	}

	const permissionPattern = approvalPatternForHook(hook)

	try {
		await ask({
			permission: `worktree.hook.${hook.hookType}`,
			patterns: [permissionPattern],
			always: [permissionPattern],
			metadata: {
				hookType: hook.hookType,
				commandText: hook.commandText,
				commandHash: hook.commandHash,
			},
		})
		return { kind: "approved" }
	} catch (error) {
		return classifyAskError(error)
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
		const promptDecision = await askForHookApproval(options.toolContext, hook)
		if (promptDecision.kind === "approved") {
			const durableApproval = await options.readDurableApproval(hook)
			if (!durableApproval.ok) {
				resolutions.push({
					hook,
					outcome: "error-skip",
					reason: "storage-read-error",
					reasonDetail: durableApproval.error,
				})
				continue
			}

			if (durableApproval.approved) {
				resolutions.push({ hook, outcome: "run-and-persist", reason: "durable-approved" })
				continue
			}

			resolutions.push({ hook, outcome: "run-once", reason: "approved-by-permission" })
			continue
		}

		if (promptDecision.kind === "rejected") {
			resolutions.push({ hook, outcome: "skip", reason: "rejected" })
			continue
		}

		if (promptDecision.kind === "denied") {
			resolutions.push({
				hook,
				outcome: "skip",
				reason: "permission-denied",
				reasonDetail: promptDecision.detail,
			})
			continue
		}

		if (promptDecision.kind === "unavailable") {
			resolutions.push({ hook, outcome: "error-skip", reason: "prompt-unavailable" })
			continue
		}

		resolutions.push({
			hook,
			outcome: "error-skip",
			reason: "prompt-error",
			reasonDetail: promptDecision.detail,
		})
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

function formatHookCommandPreview(commandText: string): string {
	const firstLine = commandText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0)

	if (!firstLine) {
		return "(empty command)"
	}

	if (firstLine.length <= 96) {
		return firstLine
	}

	return `${firstLine.slice(0, 93)}...`
}

function summarizeReason(resolution: HookResolution): string {
	if (resolution.reason === "rejected") {
		return "user rejected approval"
	}

	if (resolution.reason === "permission-denied") {
		return "blocked by permission rules"
	}

	if (resolution.reason === "prompt-unavailable") {
		return "permission prompt unavailable"
	}

	if (resolution.reason === "prompt-error") {
		return "permission request failed"
	}

	if (resolution.reason === "storage-read-error") {
		return "approval storage read failed"
	}

	return resolution.reason
}

function hookToolName(hookType: HookType): string {
	return hookType === "postCreate" ? "worktree_create" : "worktree_delete"
}

export function summarizeHookResolutionSkips(
	hookType: HookType,
	resolutions: HookResolution[],
): string[] {
	const skippedResolutions = resolutions.filter(
		(resolution) => resolution.outcome === "skip" || resolution.outcome === "error-skip",
	)
	if (skippedResolutions.length === 0) {
		return []
	}

	const hasPromptError = skippedResolutions.some(
		(resolution) =>
			resolution.reason === "prompt-unavailable" || resolution.reason === "prompt-error",
	)
	const hasStorageError = skippedResolutions.some(
		(resolution) => resolution.reason === "storage-read-error",
	)
	const hasPermissionDenied = skippedResolutions.some(
		(resolution) => resolution.reason === "permission-denied",
	)

	const lines = [
		`⚠️ Skipped ${skippedResolutions.length} ${hookType} hook${skippedResolutions.length === 1 ? "" : "s"}.`,
	]

	if (hasPromptError) {
		lines.push(
			`   Approval could not be collected for at least one hook. Re-run ${hookToolName(hookType)} in an interactive session to approve these hooks (once or always).`,
		)
	}

	if (hasPermissionDenied) {
		lines.push(
			`   At least one hook is blocked by existing permission rules (permission: worktree.hook.${hookType}).`,
		)
	}

	if (hasStorageError) {
		lines.push(
			"   Local approval storage failed to read durable approvals; hooks stayed blocked for safety.",
		)
	}

	for (const resolution of skippedResolutions) {
		const hookRef = `${resolution.hook.hookType}:${shortCommandHash(resolution.hook.commandHash)}`
		const commandPreview = formatHookCommandPreview(resolution.hook.commandText)
		lines.push(`   - ${hookRef} (${summarizeReason(resolution)}): ${commandPreview}`)
		if (resolution.reasonDetail) {
			lines.push(`     detail: ${resolution.reasonDetail}`)
		}
	}

	return lines
}
