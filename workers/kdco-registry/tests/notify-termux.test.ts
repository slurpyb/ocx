import { describe, expect, it } from "bun:test"
import {
	buildTermuxLaunchAction,
	buildTermuxNotificationArgs,
	isTermuxEnvironment,
	sendTermuxNotification,
	type TermuxNotificationConfig,
} from "../files/plugins/notify/termux"

const DEFAULT_TERMUX_CONFIG: TermuxNotificationConfig = {
	enabled: true,
	notificationCommand: "termux-notification",
	launchCommand: "am",
	launchActivity: "com.termux/com.termux.app.TermuxActivity",
	timeoutMs: 1500,
}

describe("notify termux integration", () => {
	it("detects Termux only when TERMUX_VERSION and PREFIX identify Termux", () => {
		expect(
			isTermuxEnvironment({
				TERMUX_VERSION: "0.118.1",
				PREFIX: "/data/data/com.termux/files/usr",
			}),
		).toBe(true)

		expect(isTermuxEnvironment({ TERMUX_VERSION: "0.118.1" })).toBe(false)
		expect(isTermuxEnvironment({ PREFIX: "/data/data/com.termux/files/usr" })).toBe(false)
		expect(
			isTermuxEnvironment({
				TERMUX_VERSION: "0.118.1",
				PREFIX: "/usr/local",
			}),
		).toBe(false)
	})

	it("builds a Termux launch action for the configured activity", () => {
		expect(buildTermuxLaunchAction(DEFAULT_TERMUX_CONFIG)).toBe(
			"am start -n com.termux/com.termux.app.TermuxActivity",
		)
	})

	it("builds termux-notification args with title, content, and click action", () => {
		expect(
			buildTermuxNotificationArgs(
				{
					title: "Waiting for you",
					body: "OpenCode needs your input",
				},
				DEFAULT_TERMUX_CONFIG,
			),
		).toEqual([
			"--title",
			"Waiting for you",
			"--content",
			"OpenCode needs your input",
			"--action",
			"am start -n com.termux/com.termux.app.TermuxActivity",
		])
	})

	it("sends termux-notification when running in Termux", async () => {
		const commands: string[][] = []

		const sent = await sendTermuxNotification(
			{
				title: "Ready for review",
				body: "Task complete",
			},
			DEFAULT_TERMUX_CONFIG,
			{
				env: {
					TERMUX_VERSION: "0.118.1",
					PREFIX: "/data/data/com.termux/files/usr",
				},
				spawnProcess: (command) => {
					commands.push(command)
					return {
						exited: Promise.resolve(0),
					}
				},
			},
		)

		expect(sent).toBe(true)
		expect(commands).toEqual([
			[
				"termux-notification",
				"--title",
				"Ready for review",
				"--content",
				"Task complete",
				"--action",
				"am start -n com.termux/com.termux.app.TermuxActivity",
			],
		])
	})

	it("returns false without spawning outside Termux", async () => {
		const commands: string[][] = []

		const sent = await sendTermuxNotification(
			{
				title: "Ready",
				body: "Task complete",
			},
			DEFAULT_TERMUX_CONFIG,
			{
				env: { TERMUX_VERSION: "0.118.1", PREFIX: "/usr/local" },
				spawnProcess: (command) => {
					commands.push(command)
					return { exited: Promise.resolve(0) }
				},
			},
		)

		expect(sent).toBe(false)
		expect(commands).toEqual([])
	})

	it("returns false and kills the process when termux-notification times out", async () => {
		let killed = false

		const sent = await sendTermuxNotification(
			{
				title: "Ready",
				body: "Task complete",
			},
			{
				...DEFAULT_TERMUX_CONFIG,
				timeoutMs: 10,
			},
			{
				env: {
					TERMUX_VERSION: "0.118.1",
					PREFIX: "/data/data/com.termux/files/usr",
				},
				spawnProcess: () => ({
					exited: new Promise<number>(() => {
						// Simulate hung termux-notification process
					}),
					kill: () => {
						killed = true
					},
				}),
			},
		)

		expect(sent).toBe(false)
		expect(killed).toBe(true)
	})
})
