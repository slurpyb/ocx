import { describe, expect, it, mock } from "bun:test"
import { sendNotificationWithFallback } from "../files/plugins/notify/backend"
import { sendCmuxNotification } from "../files/plugins/notify/cmux"

const baseTransportPayload = {
	title: "Ready for review",
	message: "Agent needs your attention",
	sound: "Glass",
	subtitle: "Session A",
	cmuxBody: "OpenCode task is ready for review",
	terminalBundleId: "com.mitchellh.ghostty",
} as const

describe("notify backend fallback behavior", () => {
	it("uses node notifier directly when cmux is not preferred", async () => {
		const cmuxSender = mock(async () => true)
		const nodeSender = mock(() => {})

		await sendNotificationWithFallback(
			baseTransportPayload,
			{
				preferCmux: false,
			},
			{
				sendCmuxNotification: cmuxSender,
				sendNodeNotification: nodeSender,
			},
		)

		expect(cmuxSender).not.toHaveBeenCalled()
		expect(nodeSender).toHaveBeenCalledTimes(1)
		const expectedNodePayload: Record<string, unknown> = {
			title: "Ready for review",
			message: "Agent needs your attention",
			sound: "Glass",
		}
		if (process.platform === "darwin") {
			expectedNodePayload.activate = "com.mitchellh.ghostty"
		}
		expect(nodeSender).toHaveBeenCalledWith(expectedNodePayload)
	})

	it("prefers cmux when cmux delivery succeeds", async () => {
		const cmuxSender = mock(async () => true)
		const nodeSender = mock(() => {})

		await sendNotificationWithFallback(
			baseTransportPayload,
			{ preferCmux: true },
			{
				sendCmuxNotification: cmuxSender,
				sendNodeNotification: nodeSender,
			},
		)

		expect(cmuxSender).toHaveBeenCalledTimes(1)
		expect(cmuxSender).toHaveBeenCalledWith({
			title: "Ready for review",
			subtitle: "Session A",
			body: "OpenCode task is ready for review",
		})
		expect(nodeSender).not.toHaveBeenCalled()
	})

	it("falls back to node notifier when cmux returns false", async () => {
		const cmuxSender = mock(async () => false)
		const nodeSender = mock(() => {})

		await sendNotificationWithFallback(
			baseTransportPayload,
			{ preferCmux: true },
			{
				sendCmuxNotification: cmuxSender,
				sendNodeNotification: nodeSender,
			},
		)

		expect(cmuxSender).toHaveBeenCalledTimes(1)
		expect(nodeSender).toHaveBeenCalledTimes(1)
	})

	it("falls back to node notifier when cmux throws", async () => {
		const cmuxSender = mock(async () => {
			throw new Error("cmux unavailable")
		})
		const nodeSender = mock(() => {})

		await sendNotificationWithFallback(
			baseTransportPayload,
			{ preferCmux: true },
			{
				sendCmuxNotification: cmuxSender,
				sendNodeNotification: nodeSender,
			},
		)

		expect(cmuxSender).toHaveBeenCalledTimes(1)
		expect(nodeSender).toHaveBeenCalledTimes(1)
	})

	it("falls back to node notifier when cmux exits non-zero", async () => {
		const nodeSender = mock(() => {})

		await sendNotificationWithFallback(
			baseTransportPayload,
			{ preferCmux: true },
			{
				sendCmuxNotification: (payload) =>
					sendCmuxNotification(payload, {
						spawnProcess: () => ({
							exited: Promise.resolve(1),
						}),
					}),
				sendNodeNotification: nodeSender,
			},
		)

		expect(nodeSender).toHaveBeenCalledTimes(1)
	})

	it("falls back to node notifier when cmux times out", async () => {
		const nodeSender = mock(() => {})

		await sendNotificationWithFallback(
			baseTransportPayload,
			{ preferCmux: true },
			{
				sendCmuxNotification: (payload) =>
					sendCmuxNotification(payload, {
						timeoutMs: 10,
						spawnProcess: () => ({
							exited: new Promise<number>(() => {
								// Simulate hung cmux process
							}),
						}),
					}),
				sendNodeNotification: nodeSender,
			},
		)

		expect(nodeSender).toHaveBeenCalledTimes(1)
	})

	it("uses message as cmux body when cmuxBody is omitted", async () => {
		const cmuxSender = mock(async () => true)

		await sendNotificationWithFallback(
			{
				title: "Fallback body",
				message: "Message body",
				sound: "Glass",
			},
			{ preferCmux: true },
			{
				sendCmuxNotification: cmuxSender,
				sendNodeNotification: mock(() => {}),
			},
		)

		expect(cmuxSender).toHaveBeenCalledWith({
			title: "Fallback body",
			subtitle: undefined,
			body: "Message body",
		})
	})
})
