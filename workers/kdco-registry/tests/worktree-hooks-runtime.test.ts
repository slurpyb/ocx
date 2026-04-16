import { describe, expect, it } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import {
	createHookApprovalSnapshot,
	hashHookCommand,
	hooksForCurrentInvocation,
	matchHooksToApprovalSnapshot,
	parseHookCommands,
	resolveHookApprovals,
	summarizeHookResolutionSkips,
} from "../files/plugins/worktree/hooks"

function createToolContext(ask?: (input: unknown) => Promise<void>): ToolContext {
	const baseContext = {
		sessionID: "session-1",
		messageID: "message-1",
		agent: "plan",
		directory: "/tmp/project",
		worktree: "/tmp/project",
		abort: new AbortController().signal,
		metadata: (_input: { title?: string; metadata?: Record<string, unknown> }) => {},
		ask: async () => undefined,
	}

	if (!ask) {
		return {
			...baseContext,
			ask: undefined,
		} as unknown as ToolContext
	}

	return {
		...baseContext,
		ask,
	} as unknown as ToolContext
}

function approvalKey(hookType: "postCreate" | "preDelete", commandHash: string): string {
	return `${hookType}:${commandHash}`
}

function permissionError(name: string, message: string): Error {
	const error = new Error(message)
	error.name = name
	return error
}

describe("worktree hook runtime approvals", () => {
	it("uses exact command text for command hash identity", () => {
		const base = hashHookCommand("pnpm install")
		const trailingSpace = hashHookCommand("pnpm install ")
		const trailingNewline = hashHookCommand("pnpm install\n")

		expect(base).not.toBe(trailingSpace)
		expect(base).not.toBe(trailingNewline)
		expect(trailingSpace).not.toBe(trailingNewline)
	})

	it("invalidates durable approval when command text changes", async () => {
		const approvedHooks = parseHookCommands("postCreate", ["pnpm install"])
		const updatedHooks = parseHookCommands("postCreate", ["pnpm install --frozen-lockfile"])
		const approvals = new Set([approvalKey("postCreate", approvedHooks[0].commandHash)])

		const resolutions = await resolveHookApprovals(updatedHooks, {
			toolContext: createToolContext(async () => undefined),
			readDurableApproval: async (hook) => ({
				ok: true,
				approved: approvals.has(approvalKey(hook.hookType, hook.commandHash)),
			}),
		})

		expect(resolutions[0]?.outcome).toBe("run-once")
		expect(resolutions[0]?.reason).toBe("approved-by-permission")
		expect(hooksForCurrentInvocation(resolutions)).toHaveLength(1)
	})

	it("skips unapproved hooks when user rejects", async () => {
		const hooks = parseHookCommands("postCreate", ["docker compose up -d"])

		const resolutions = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => {
				throw permissionError("PermissionRejectedError", "rejected")
			}),
			readDurableApproval: async () => ({ ok: true, approved: false }),
		})

		expect(resolutions[0]?.outcome).toBe("skip")
		expect(resolutions[0]?.reason).toBe("rejected")
		expect(hooksForCurrentInvocation(resolutions)).toHaveLength(0)
	})

	it("skips hooks denied by existing permission rules", async () => {
		const hooks = parseHookCommands("preDelete", ["docker compose down"])

		const resolutions = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => {
				throw permissionError(
					"PermissionDeniedError",
					"The user has specified a rule which prevents you from using this specific tool call.",
				)
			}),
			readDurableApproval: async () => ({ ok: true, approved: false }),
		})

		expect(resolutions[0]?.outcome).toBe("skip")
		expect(resolutions[0]?.reason).toBe("permission-denied")
		expect(hooksForCurrentInvocation(resolutions)).toHaveLength(0)
	})

	it("gives permission deny precedence over legacy durable approvals", async () => {
		const hooks = parseHookCommands("postCreate", ["pnpm install"])
		let readDurableApprovalInvocations = 0

		const resolutions = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => {
				throw permissionError(
					"PermissionDeniedError",
					"The user has specified a rule which prevents you from using this specific tool call.",
				)
			}),
			readDurableApproval: async () => {
				readDurableApprovalInvocations += 1
				return { ok: true, approved: true }
			},
		})

		expect(readDurableApprovalInvocations).toBe(0)
		expect(resolutions[0]?.outcome).toBe("skip")
		expect(resolutions[0]?.reason).toBe("permission-denied")
		expect(hooksForCurrentInvocation(resolutions)).toHaveLength(0)
	})

	it("requests approval with permission API payload", async () => {
		const hooks = parseHookCommands("postCreate", ["pnpm install"])
		let askPayload: Record<string, unknown> | undefined

		const resolutions = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async (payload) => {
				askPayload = payload as Record<string, unknown>
			}),
			readDurableApproval: async () => ({ ok: true, approved: false }),
		})

		expect(askPayload).toBeDefined()
		expect(askPayload?.permission).toBe("worktree.hook.postCreate")
		expect(askPayload?.patterns).toEqual([`hash=${hooks[0].commandHash}; command="pnpm install"`])
		expect(askPayload?.always).toEqual([`hash=${hooks[0].commandHash}; command="pnpm install"`])
		expect(askPayload?.metadata).toEqual({
			hookType: "postCreate",
			commandText: "pnpm install",
			commandHash: hooks[0].commandHash,
		})
		expect(resolutions[0]?.outcome).toBe("run-once")
		expect(resolutions[0]?.reason).toBe("approved-by-permission")
	})

	it("includes readable command text in permission pattern for approval UI", async () => {
		const hooks = parseHookCommands("postCreate", ["pnpm run check:* --scope ?core"])
		let askPayload: Record<string, unknown> | undefined

		await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async (payload) => {
				askPayload = payload as Record<string, unknown>
			}),
			readDurableApproval: async () => ({ ok: true, approved: false }),
		})

		const pattern = (askPayload?.patterns as string[] | undefined)?.[0]
		expect(pattern).toContain("pnpm run check:")
		expect(pattern).toContain("--scope")
		expect(pattern).toContain("﹡")
		expect(pattern).toContain("﹖")
	})

	it("runs approved hooks and does not persist once approvals locally", async () => {
		const hooks = parseHookCommands("postCreate", ["pnpm install"])

		const firstInvocation = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => undefined),
			readDurableApproval: async () => ({ ok: true, approved: false }),
		})

		expect(firstInvocation[0]?.outcome).toBe("run-once")
		expect(hooksForCurrentInvocation(firstInvocation)).toHaveLength(1)

		const secondInvocation = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(),
			readDurableApproval: async () => ({ ok: true, approved: false }),
		})

		expect(secondInvocation[0]?.outcome).toBe("error-skip")
		expect(secondInvocation[0]?.reason).toBe("prompt-unavailable")
		expect(hooksForCurrentInvocation(secondInvocation)).toHaveLength(0)
	})

	it("reuses durable approvals only after permission check", async () => {
		const hooks = parseHookCommands("postCreate", ["pnpm install"])
		let askInvocations = 0

		const resolutions = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => {
				askInvocations += 1
			}),
			readDurableApproval: async () => ({ ok: true, approved: true }),
		})

		expect(askInvocations).toBe(1)
		expect(resolutions[0]?.outcome).toBe("run-and-persist")
		expect(resolutions[0]?.reason).toBe("durable-approved")
		expect(hooksForCurrentInvocation(resolutions)).toHaveLength(1)
	})

	it("preserves hook order and multiplicity for mixed approvals", async () => {
		const commands = ["echo approved", "echo denied", "echo approved", "echo denied"]
		const hooks = parseHookCommands("preDelete", commands)
		const approvedHash = hooks[0].commandHash

		const resolutions = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async (payload) => {
				const record = payload as { patterns?: string[] }
				const pattern = record.patterns?.[0] ?? ""
				if (pattern.includes(approvedHash)) {
					return
				}

				throw permissionError("PermissionRejectedError", "rejected")
			}),
			readDurableApproval: async (hook) => ({
				ok: true,
				approved: hook.commandHash === approvedHash,
			}),
		})

		const runnable = hooksForCurrentInvocation(resolutions)
		expect(runnable.map((hook) => hook.commandText)).toEqual(["echo approved", "echo approved"])
	})

	it("models preDelete timing as approve-on-delete and execute-on-idle", async () => {
		const preDeleteHooks = parseHookCommands("preDelete", ["docker compose down"])

		const resolutions = await resolveHookApprovals(preDeleteHooks, {
			toolContext: createToolContext(async () => undefined),
			readDurableApproval: async () => ({ ok: true, approved: false }),
		})

		const approvedForDeleteInvocation = hooksForCurrentInvocation(resolutions)
		const snapshot = createHookApprovalSnapshot(approvedForDeleteInvocation)

		const idleMatch = matchHooksToApprovalSnapshot(preDeleteHooks, snapshot)
		expect(idleMatch.ok).toBe(true)
		expect(idleMatch.ok ? idleMatch.hooks.map((hook) => hook.commandText) : []).toEqual([
			"docker compose down",
		])
	})

	it("skips deferred preDelete hooks when config changes before idle", () => {
		const scheduledHooks = parseHookCommands("preDelete", ["docker compose down"])
		const approvedSnapshot = createHookApprovalSnapshot(scheduledHooks)

		const editedHooks = parseHookCommands("preDelete", ["docker compose down --remove-orphans"])
		const matchResult = matchHooksToApprovalSnapshot(editedHooks, approvedSnapshot)

		expect(matchResult.ok).toBe(false)
	})

	it("fails closed when storage read or prompt path errors", async () => {
		const hooks = parseHookCommands("postCreate", ["pnpm install"])

		const readFailure = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => undefined),
			readDurableApproval: async () => ({ ok: false, error: "db read failed" }),
		})
		expect(readFailure[0]?.outcome).toBe("error-skip")
		expect(readFailure[0]?.reason).toBe("storage-read-error")
		expect(readFailure[0]?.reasonDetail).toBe("db read failed")

		const promptUnavailable = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(),
			readDurableApproval: async () => ({ ok: true, approved: false }),
		})
		expect(promptUnavailable[0]?.outcome).toBe("error-skip")
		expect(promptUnavailable[0]?.reason).toBe("prompt-unavailable")

		const promptFailure = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => {
				throw new Error("interactive unavailable")
			}),
			readDurableApproval: async () => ({ ok: true, approved: false }),
		})
		expect(promptFailure[0]?.outcome).toBe("error-skip")
		expect(promptFailure[0]?.reason).toBe("prompt-error")
		expect(promptFailure[0]?.reasonDetail).toBe("interactive unavailable")
		expect(hooksForCurrentInvocation(promptFailure)).toHaveLength(0)
	})

	it("returns actionable skip guidance when approval prompt is unavailable", () => {
		const hooks = parseHookCommands("postCreate", ["pnpm install"])
		const lines = summarizeHookResolutionSkips("postCreate", [
			{
				hook: hooks[0],
				outcome: "error-skip",
				reason: "prompt-unavailable",
			},
		])

		expect(lines.join("\n")).toContain("Re-run worktree_create in an interactive session")
		expect(lines.join("\n")).toContain("postCreate")
		expect(lines.join("\n")).toContain("pnpm install")
	})
})
