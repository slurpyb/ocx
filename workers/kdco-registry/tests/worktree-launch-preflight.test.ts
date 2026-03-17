import type { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import {
	ensureLaunchContextExecutable,
	ensureLaunchContextProfile,
	finalizeWorktreeLaunch,
} from "../files/plugins/worktree"

describe("worktree launch preflight", () => {
	it("normalizes PATH-based OCX launchers to stable paths", async () => {
		const validated = await ensureLaunchContextExecutable(
			{ mode: "ocx", ocxBin: "ocx", profile: "work" },
			"/tmp/repo",
			{
				resolveExecutable: (command) => (command === "ocx" ? "/opt/bin/ocx" : undefined),
				pathExists: async () => true,
			},
		)

		expect(validated.mode).toBe("ocx")
		if (validated.mode !== "ocx") {
			throw new Error("Expected OCX launch context")
		}
		expect(validated.ocxBin).toBe("/opt/bin/ocx")
	})

	it("fails loud for stale path-based OCX launchers", async () => {
		await expect(
			ensureLaunchContextExecutable(
				{
					mode: "ocx",
					ocxBin: "./definitely-missing-ocx-launcher",
					profile: "work",
				},
				"/tmp/repo",
				{
					pathExists: async () => false,
				},
			),
		).rejects.toThrow(/missing or stale/i)
	})

	it("fails loud for missing OCX profiles before terminal launch", async () => {
		await expect(
			ensureLaunchContextProfile(
				{ mode: "ocx", ocxBin: "/usr/local/bin/ocx", profile: "deleted" },
				async () => ({ ok: false, error: 'Profile "deleted" not found' }),
			),
		).rejects.toThrow(/profile/i)
	})

	it("does not persist durable session state when launch fails", async () => {
		let persisted = false
		let cleanedUp = false

		const result = await finalizeWorktreeLaunch({
			database: {} as Database,
			worktreePath: "/tmp/worktree",
			launchArgv: ["/usr/local/bin/ocx", "opencode", "--session", "session-1"],
			branch: "feature/test",
			forkedSessionId: "session-1",
			sessionRecord: {
				id: "session-1",
				branch: "feature/test",
				path: "/tmp/worktree",
				createdAt: new Date().toISOString(),
				launchMode: "ocx",
				profile: "work",
				ocxBin: "/usr/local/bin/ocx",
			},
			log: {
				debug: () => {},
				info: () => {},
				warn: () => {},
				error: () => {},
			},
			openTerminalFn: async () => ({ success: false, error: "simulated launch failure" }),
			addSessionFn: (_db, _session) => {
				persisted = true
			},
			deleteForkedSessionFn: async () => {
				cleanedUp = true
			},
		})

		expect(result.success).toBe(false)
		expect(persisted).toBe(false)
		expect(cleanedUp).toBe(true)
	})

	it("persists durable session state only after successful launch", async () => {
		let persisted = false
		let cleanedUp = false

		const result = await finalizeWorktreeLaunch({
			database: {} as Database,
			worktreePath: "/tmp/worktree",
			launchArgv: ["/usr/local/bin/ocx", "opencode", "--session", "session-1"],
			branch: "feature/test",
			forkedSessionId: "session-1",
			sessionRecord: {
				id: "session-1",
				branch: "feature/test",
				path: "/tmp/worktree",
				createdAt: new Date().toISOString(),
				launchMode: "ocx",
				profile: "work",
				ocxBin: "/usr/local/bin/ocx",
			},
			log: {
				debug: () => {},
				info: () => {},
				warn: () => {},
				error: () => {},
			},
			openTerminalFn: async () => ({ success: true }),
			addSessionFn: (_db, _session) => {
				persisted = true
			},
			deleteForkedSessionFn: async () => {
				cleanedUp = true
			},
		})

		expect(result.success).toBe(true)
		expect(persisted).toBe(true)
		expect(cleanedUp).toBe(false)
	})
})
