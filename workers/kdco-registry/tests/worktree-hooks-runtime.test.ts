import { describe, expect, it } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import {
	createHookApprovalSnapshot,
	hashHookCommand,
	hooksForCurrentInvocation,
	matchHooksToApprovalSnapshot,
	parseHookCommands,
	resolveHookApprovals,
} from "../files/plugins/worktree/hooks"

function createToolContext(ask?: (prompt: unknown) => Promise<unknown>): ToolContext {
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
			toolContext: createToolContext(async () => "reject"),
			readDurableApproval: async (hook) => ({
				ok: true,
				approved: approvals.has(approvalKey(hook.hookType, hook.commandHash)),
			}),
			writeDurableApproval: async () => ({ ok: true }),
		})

		expect(resolutions[0]?.outcome).toBe("skip")
		expect(hooksForCurrentInvocation(resolutions)).toEqual([])
	})

	it("skips unapproved hooks when user rejects", async () => {
		const hooks = parseHookCommands("postCreate", ["docker compose up -d"])

		const resolutions = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => "reject"),
			readDurableApproval: async () => ({ ok: true, approved: false }),
			writeDurableApproval: async () => ({ ok: true }),
		})

		expect(resolutions[0]?.outcome).toBe("skip")
		expect(hooksForCurrentInvocation(resolutions)).toHaveLength(0)
	})

	it("runs once only for the current invocation", async () => {
		const hooks = parseHookCommands("postCreate", ["pnpm install"])
		const approvals = new Set<string>()

		const firstInvocation = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => "once"),
			readDurableApproval: async (hook) => ({
				ok: true,
				approved: approvals.has(approvalKey(hook.hookType, hook.commandHash)),
			}),
			writeDurableApproval: async (hook) => {
				approvals.add(approvalKey(hook.hookType, hook.commandHash))
				return { ok: true }
			},
		})

		expect(firstInvocation[0]?.outcome).toBe("run-once")
		expect(hooksForCurrentInvocation(firstInvocation)).toHaveLength(1)
		expect(approvals.size).toBe(0)

		const secondInvocation = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(),
			readDurableApproval: async (hook) => ({
				ok: true,
				approved: approvals.has(approvalKey(hook.hookType, hook.commandHash)),
			}),
			writeDurableApproval: async () => ({ ok: true }),
		})

		expect(secondInvocation[0]?.outcome).toBe("error-skip")
		expect(hooksForCurrentInvocation(secondInvocation)).toHaveLength(0)
	})

	it("persists always approvals and reuses them on future invocations", async () => {
		const hooks = parseHookCommands("postCreate", ["pnpm install"])
		const approvals = new Set<string>()

		const firstInvocation = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => "always"),
			readDurableApproval: async (hook) => ({
				ok: true,
				approved: approvals.has(approvalKey(hook.hookType, hook.commandHash)),
			}),
			writeDurableApproval: async (hook) => {
				approvals.add(approvalKey(hook.hookType, hook.commandHash))
				return { ok: true }
			},
		})

		expect(firstInvocation[0]?.outcome).toBe("run-and-persist")
		expect(approvals.size).toBe(1)

		const secondInvocation = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => {
				throw new Error("prompt unavailable")
			}),
			readDurableApproval: async (hook) => ({
				ok: true,
				approved: approvals.has(approvalKey(hook.hookType, hook.commandHash)),
			}),
			writeDurableApproval: async () => ({ ok: true }),
		})

		expect(secondInvocation[0]?.outcome).toBe("run-and-persist")
		expect(hooksForCurrentInvocation(secondInvocation)).toHaveLength(1)
	})

	it("preserves hook order and multiplicity for mixed approvals", async () => {
		const commands = ["echo approved", "echo denied", "echo approved", "echo denied"]
		const hooks = parseHookCommands("preDelete", commands)
		const approvedHash = hooks[0].commandHash

		const resolutions = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => "reject"),
			readDurableApproval: async (hook) => ({
				ok: true,
				approved: hook.commandHash === approvedHash,
			}),
			writeDurableApproval: async () => ({ ok: true }),
		})

		const runnable = hooksForCurrentInvocation(resolutions)
		expect(runnable.map((hook) => hook.commandText)).toEqual(["echo approved", "echo approved"])
	})

	it("models preDelete timing as approve-on-delete and execute-on-idle", async () => {
		const preDeleteHooks = parseHookCommands("preDelete", ["docker compose down"])

		const resolutions = await resolveHookApprovals(preDeleteHooks, {
			toolContext: createToolContext(async () => "once"),
			readDurableApproval: async () => ({ ok: true, approved: false }),
			writeDurableApproval: async () => ({ ok: true }),
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

	it("fails closed when storage read/write or prompt path errors", async () => {
		const hooks = parseHookCommands("postCreate", ["pnpm install"])

		const readFailure = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => "once"),
			readDurableApproval: async () => ({ ok: false, error: "db read failed" }),
			writeDurableApproval: async () => ({ ok: true }),
		})
		expect(readFailure[0]?.outcome).toBe("error-skip")

		const writeFailure = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => "always"),
			readDurableApproval: async () => ({ ok: true, approved: false }),
			writeDurableApproval: async () => ({ ok: false, error: "db write failed" }),
		})
		expect(writeFailure[0]?.outcome).toBe("error-skip")

		const promptFailure = await resolveHookApprovals(hooks, {
			toolContext: createToolContext(async () => {
				throw new Error("interactive unavailable")
			}),
			readDurableApproval: async () => ({ ok: true, approved: false }),
			writeDurableApproval: async () => ({ ok: true }),
		})
		expect(promptFailure[0]?.outcome).toBe("error-skip")
		expect(hooksForCurrentInvocation(promptFailure)).toHaveLength(0)
	})
})
