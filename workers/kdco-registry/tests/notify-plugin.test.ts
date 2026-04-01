import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { Event } from "@opencode-ai/sdk"
import {
	NotificationChannel as HostNotificationChannel,
	NotificationNegotiatedState as HostNotificationNegotiatedState,
	type NotificationContractHandshake,
	NotificationContractID,
	NotificationContractSchemaVersion,
} from "../../../packages/cli/src/notify/contract-compat"
import {
	NotificationCapabilityState,
	NotificationChannel,
	NotificationFallbackMode,
	NotificationHandlingMode,
	normalizeNotificationBoundaryInput,
} from "../files/plugins/notify/normalize"

function createHostHandshakeFixture(
	input: { schemaVersion?: string; capabilities?: Record<string, { state: string }> } = {},
): NotificationContractHandshake {
	return {
		contract: {
			id: NotificationContractID,
			schemaVersion: input.schemaVersion ?? NotificationContractSchemaVersion,
		},
		capabilities:
			input.capabilities ??
			({
				[HostNotificationChannel.UIToast]: {
					state: HostNotificationNegotiatedState.Supported,
				},
				[HostNotificationChannel.TaskSystem]: {
					state: HostNotificationNegotiatedState.Supported,
				},
				[HostNotificationChannel.SDKSystem]: {
					state: HostNotificationNegotiatedState.Unsupported,
				},
				[HostNotificationChannel.DesktopTerminal]: {
					state: HostNotificationNegotiatedState.Unsupported,
				},
				[HostNotificationChannel.MCPChannel]: {
					state: HostNotificationNegotiatedState.InternalOnly,
				},
			} satisfies NotificationContractHandshake["capabilities"]),
	}
}

type SessionInfo = {
	parentID?: string
	title?: string
}

let mockedConfig: unknown | undefined
let mockedTerminalName: string | null = null

const notificationPayloads: Array<Record<string, unknown>> = []
const notifyMock = mock((payload: Record<string, unknown>) => {
	notificationPayloads.push(payload)
})

mock.module("node:fs/promises", () => ({
	readFile: async () => {
		if (mockedConfig === undefined) {
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
		}

		return JSON.stringify(mockedConfig)
	},
}))

mock.module("detect-terminal", () => ({
	default: () => mockedTerminalName,
}))

mock.module("node-notifier", () => ({
	default: {
		notify: notifyMock,
	},
}))

let NotifyPlugin: typeof import("../files/plugins/notify").NotifyPlugin
let resolveNotificationRuntimePolicyFromHostHandshake: typeof import("../files/plugins/notify").resolveNotificationRuntimePolicyFromHostHandshake

beforeAll(async () => {
	;({ NotifyPlugin, resolveNotificationRuntimePolicyFromHostHandshake } = await import(
		"../files/plugins/notify"
	))
})

beforeEach(() => {
	mockedConfig = undefined
	mockedTerminalName = null
	notificationPayloads.length = 0
	notifyMock.mockClear()
	delete process.env.CMUX_WORKSPACE_ID
})

afterEach(() => {
	mock.restore()
})

function minutesToClock(totalMinutes: number): string {
	const wrappedMinutes = ((totalMinutes % 1440) + 1440) % 1440
	const hour = Math.floor(wrappedMinutes / 60)
	const minute = wrappedMinutes % 60
	return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`
}

function buildCurrentMinuteQuietHours(): { enabled: boolean; start: string; end: string } {
	const now = new Date()
	const currentMinute = now.getHours() * 60 + now.getMinutes()

	return {
		enabled: true,
		start: minutesToClock(currentMinute - 1),
		end: minutesToClock(currentMinute + 1),
	}
}

function mockFocusedTerminal(): void {
	mockedTerminalName = "ghostty"

	spyOn(Bun, "spawn").mockImplementation((...args: unknown[]) => {
		const command = args[0]
		const script = Array.isArray(command) && typeof command[2] === "string" ? command[2] : ""
		const output = script.includes("frontmost") ? "Ghostty\n" : "com.mitchellh.ghostty\n"

		return {
			stdout: new Blob([output]).stream(),
			stderr: new Blob([""]).stream(),
			exited: Promise.resolve(0),
		} as ReturnType<typeof Bun.spawn>
	})
}

async function createPlugin(
	sessionInfoByID: Record<string, SessionInfo> = {},
	options: {
		hostNotificationContractHandshake?: unknown
		useNullPrototypeContext?: boolean
	} = {},
): Promise<{
	hooks: Awaited<ReturnType<typeof NotifyPlugin>>
	sessionGet: ReturnType<typeof mock>
}> {
	const sessionGet = mock(async ({ path: { id } }: { path: { id: string } }) => ({
		data: {
			title: sessionInfoByID[id]?.title ?? `Session ${id}`,
			parentID: sessionInfoByID[id]?.parentID,
		},
	}))

	const pluginContext = (options.useNullPrototypeContext ? Object.create(null) : {}) as Record<
		string,
		unknown
	>
	pluginContext.client = {
		session: {
			get: sessionGet,
		},
	}

	if (options.hostNotificationContractHandshake !== undefined) {
		pluginContext.notificationContractHandshake = options.hostNotificationContractHandshake
	}

	const hooks = await NotifyPlugin(pluginContext as unknown as Parameters<typeof NotifyPlugin>[0])

	return { hooks, sessionGet }
}

async function emitEvent(
	hooks: Awaited<ReturnType<typeof NotifyPlugin>>,
	event: Record<string, unknown>,
): Promise<void> {
	if (!hooks.event) throw new Error("Notify plugin did not register event handler")
	await hooks.event({ event: event as Event })
}

async function emitQuestionToolBefore(
	hooks: Awaited<ReturnType<typeof NotifyPlugin>>,
	sessionID: string,
	callID: string,
): Promise<void> {
	await emitToolBefore(hooks, {
		tool: "question",
		sessionID,
		callID,
	})
}

async function emitToolBefore(
	hooks: Awaited<ReturnType<typeof NotifyPlugin>>,
	input: unknown,
): Promise<void> {
	const hook = hooks["tool.execute.before"]
	if (!hook) throw new Error("Notify plugin did not register tool.execute.before")

	await (hook as (...args: unknown[]) => Promise<void>)(input, {})
}

describe("notify host handshake mixed-version seam", () => {
	it("accepts same-major drift, warns on unknown channels, and enforces host fail_closed runtime policy", async () => {
		const hostHandshake = createHostHandshakeFixture({
			schemaVersion: "1.2.0",
			capabilities: {
				[HostNotificationChannel.UIToast]: {
					state: HostNotificationNegotiatedState.Supported,
				},
				[HostNotificationChannel.TaskSystem]: {
					state: HostNotificationNegotiatedState.FallbackApproved,
				},
				[HostNotificationChannel.SDKSystem]: {
					state: HostNotificationNegotiatedState.Unsupported,
				},
				[HostNotificationChannel.DesktopTerminal]: {
					state: HostNotificationNegotiatedState.InternalOnly,
				},
				[HostNotificationChannel.MCPChannel]: {
					state: HostNotificationNegotiatedState.InternalOnly,
				},
				"future.channel": {
					state: HostNotificationNegotiatedState.Supported,
				},
			},
		})

		const policyResolution = resolveNotificationRuntimePolicyFromHostHandshake(hostHandshake)
		expect(policyResolution.compatible).toBe(true)
		if (!policyResolution.compatible) {
			expect.unreachable("Expected same-major host handshake to be compatible")
		}

		expect(policyResolution.source).toBe("host-handshake")
		expect(policyResolution.warnings.map((warning) => warning.code).sort()).toEqual([
			"newer-schema-minor-or-patch",
			"unknown-channel-ignored",
		])
		expect(
			Object.hasOwn(policyResolution.normalizePolicy.capabilityByChannel ?? {}, "future.channel"),
		).toBe(false)

		const desktopEvent = {
			type: "notification.desktop.terminal",
			properties: {
				title: "Terminal ping",
				message: "Agent needs your attention",
				level: "warning",
			},
		}

		const warnSpy = spyOn(console, "warn").mockImplementation(() => {})
		const { hooks: defaultHooks } = await createPlugin()

		await emitEvent(defaultHooks, desktopEvent)

		expect(notificationPayloads).toHaveLength(1)

		notificationPayloads.length = 0

		const { hooks } = await createPlugin({}, { hostNotificationContractHandshake: hostHandshake })

		await emitEvent(hooks, desktopEvent)

		expect(notificationPayloads).toHaveLength(0)

		const warningMessages = warnSpy.mock.calls.map((args) => String(args[0]))
		expect(warningMessages.some((message) => message.includes("newer-schema-minor-or-patch"))).toBe(
			true,
		)
		expect(warningMessages.some((message) => message.includes("unknown-channel-ignored"))).toBe(
			true,
		)
		expect(warningMessages.some((message) => message.includes("fail_closed"))).toBe(true)
	})

	it("hard-fails plugin startup for unsupported schema major", async () => {
		const incompatibleHandshake = createHostHandshakeFixture({
			schemaVersion: "2.0.0",
		})

		const policyResolution =
			resolveNotificationRuntimePolicyFromHostHandshake(incompatibleHandshake)
		expect(policyResolution.compatible).toBe(false)
		if (policyResolution.compatible) {
			expect.unreachable("Expected incompatible host handshake")
		}

		expect(policyResolution.errors.map((issue) => issue.code)).toContain("unsupported-schema-major")

		await expect(
			createPlugin({}, { hostNotificationContractHandshake: incompatibleHandshake }),
		).rejects.toThrow("unsupported-schema-major")
	})

	it("hard-fails incompatible host handshake even on null-prototype context envelope", async () => {
		const incompatibleHandshake = createHostHandshakeFixture({
			schemaVersion: "2.0.0",
		})

		await expect(
			createPlugin(
				{},
				{
					hostNotificationContractHandshake: incompatibleHandshake,
					useNullPrototypeContext: true,
				},
			),
		).rejects.toThrow("unsupported-schema-major")
	})

	it("hard-fails plugin startup when a canonical channel is missing", async () => {
		const missingRequiredChannelHandshake = createHostHandshakeFixture()
		delete missingRequiredChannelHandshake.capabilities[HostNotificationChannel.DesktopTerminal]

		const policyResolution = resolveNotificationRuntimePolicyFromHostHandshake(
			missingRequiredChannelHandshake,
		)
		expect(policyResolution.compatible).toBe(false)
		if (policyResolution.compatible) {
			expect.unreachable("Expected incompatible host handshake")
		}

		expect(policyResolution.errors.map((issue) => issue.code)).toContain("missing-required-channel")

		await expect(
			createPlugin({}, { hostNotificationContractHandshake: missingRequiredChannelHandshake }),
		).rejects.toThrow("missing-required-channel")
	})

	it("hard-fails plugin startup for unknown negotiated state on canonical channel", async () => {
		const unknownStateHandshake = createHostHandshakeFixture()
		unknownStateHandshake.capabilities[HostNotificationChannel.SDKSystem] = {
			state: "legacy_supported",
		}

		const policyResolution =
			resolveNotificationRuntimePolicyFromHostHandshake(unknownStateHandshake)
		expect(policyResolution.compatible).toBe(false)
		if (policyResolution.compatible) {
			expect.unreachable("Expected incompatible host handshake")
		}

		expect(policyResolution.errors).toContainEqual(
			expect.objectContaining({
				code: "unknown-negotiated-state",
				channel: HostNotificationChannel.SDKSystem,
				state: "legacy_supported",
			}),
		)

		await expect(
			createPlugin({}, { hostNotificationContractHandshake: unknownStateHandshake }),
		).rejects.toThrow("unknown-negotiated-state")
	})
})

describe("notify plugin event compatibility and dedupe", () => {
	it("proves host-handshake policy resolves mcp.channel fail_closed normalization and remains non-deliverable at runtime", async () => {
		const hostHandshake = createHostHandshakeFixture()
		hostHandshake.capabilities[HostNotificationChannel.MCPChannel] = {
			state: HostNotificationNegotiatedState.Unsupported,
		}

		const mcpEvent = {
			type: "notification.mcp.channel",
			properties: {
				server: "mcp-gateway",
				message: "rate limit warning",
				level: "warning",
				source: "mcp.server",
				trust: "untrusted",
			},
		}

		const hostPolicyResolution = resolveNotificationRuntimePolicyFromHostHandshake(hostHandshake)
		expect(hostPolicyResolution.compatible).toBe(true)
		if (!hostPolicyResolution.compatible) {
			expect.unreachable("Expected host notification handshake to be compatible")
		}

		expect(hostPolicyResolution.source).toBe("host-handshake")
		expect(
			hostPolicyResolution.normalizePolicy.capabilityByChannel?.[NotificationChannel.MCPChannel],
		).toEqual({
			state: NotificationCapabilityState.Unsupported,
			fallbackMode: NotificationFallbackMode.FailClosed,
		})

		const normalizedDefaultMCPIntent = normalizeNotificationBoundaryInput({
			source: "event",
			value: mcpEvent,
		})
		expect(normalizedDefaultMCPIntent.ok).toBe(true)
		if (!normalizedDefaultMCPIntent.ok) {
			expect.unreachable("Expected normalized default-policy mcp.channel intent")
		}

		expect(normalizedDefaultMCPIntent.intent.channel).toBe(NotificationChannel.MCPChannel)
		expect(normalizedDefaultMCPIntent.intent.capabilityState).toBe(
			NotificationCapabilityState.InternalOnly,
		)
		expect(normalizedDefaultMCPIntent.intent.fallbackMode).toBe(NotificationFallbackMode.FailClosed)
		expect(normalizedDefaultMCPIntent.intent.handlingMode).toBe(NotificationHandlingMode.FailClosed)

		const normalizedMCPIntent = normalizeNotificationBoundaryInput(
			{
				source: "event",
				value: mcpEvent,
			},
			hostPolicyResolution.normalizePolicy,
		)
		expect(normalizedMCPIntent.ok).toBe(true)
		if (!normalizedMCPIntent.ok) {
			expect.unreachable("Expected normalized mcp.channel intent")
		}

		expect(normalizedMCPIntent.intent.channel).toBe(NotificationChannel.MCPChannel)
		expect(normalizedMCPIntent.intent.capabilityState).toBe(NotificationCapabilityState.Unsupported)
		expect(normalizedMCPIntent.intent.fallbackMode).toBe(NotificationFallbackMode.FailClosed)
		expect(normalizedMCPIntent.intent.handlingMode).toBe(NotificationHandlingMode.FailClosed)
		expect(normalizedMCPIntent.intent.capabilityState).not.toBe(
			normalizedDefaultMCPIntent.intent.capabilityState,
		)

		const { hooks: defaultHooks } = await createPlugin()
		await emitEvent(defaultHooks, mcpEvent)
		expect(notificationPayloads).toHaveLength(0)

		notificationPayloads.length = 0

		const { hooks: hostHandshakeHooks } = await createPlugin(
			{},
			{
				hostNotificationContractHandshake: hostHandshake,
			},
		)
		await emitEvent(hostHandshakeHooks, mcpEvent)
		expect(notificationPayloads).toHaveLength(0)
	})

	it("dedupes permission notification when permission.asked and permission.updated describe same request", async () => {
		const { hooks } = await createPlugin()

		await emitEvent(hooks, {
			type: "permission.asked",
			properties: {
				id: "perm-shared",
				sessionID: "session-a",
				permission: "bash",
				patterns: [],
				metadata: {},
				always: [],
			},
		})

		await emitEvent(hooks, {
			type: "permission.updated",
			properties: {
				id: "perm-shared",
			},
		})

		expect(notificationPayloads).toHaveLength(1)
		expect(notificationPayloads[0]?.title).toBe("Waiting for you")
	})

	it("notifies for question.asked and legacy question tool.execute.before", async () => {
		const { hooks } = await createPlugin()

		await emitQuestionToolBefore(hooks, "session-a", "call-tool")

		await emitEvent(hooks, {
			type: "question.asked",
			properties: {
				id: "question-1",
				sessionID: "session-a",
				questions: [],
				tool: {
					messageID: "message-1",
					callID: "call-event",
				},
			},
		})

		expect(notificationPayloads).toHaveLength(2)
		expect(notificationPayloads.map((payload) => payload.title)).toEqual([
			"Question for you",
			"Question for you",
		])
	})

	it("dedupes question notification when question.asked and tool hook describe same request", async () => {
		const { hooks } = await createPlugin()

		await emitQuestionToolBefore(hooks, "session-a", "call-shared")

		await emitEvent(hooks, {
			type: "question.asked",
			properties: {
				id: "question-1",
				sessionID: "session-a",
				questions: [],
				tool: {
					messageID: "message-1",
					callID: "call-shared",
				},
			},
		})

		expect(notificationPayloads).toHaveLength(1)
		expect(notificationPayloads[0]?.title).toBe("Question for you")
	})

	it("notifies for session.status idle and legacy session.idle", async () => {
		const { hooks } = await createPlugin({
			"session-status": { title: "Status Session" },
			"session-idle": { title: "Idle Session" },
		})

		await emitEvent(hooks, {
			type: "session.status",
			properties: {
				sessionID: "session-status",
				status: {
					type: "idle",
				},
			},
		})

		await emitEvent(hooks, {
			type: "session.idle",
			properties: {
				sessionID: "session-idle",
			},
		})

		expect(notificationPayloads).toHaveLength(2)
		expect(notificationPayloads.map((payload) => payload.title)).toEqual([
			"Ready for review",
			"Ready for review",
		])
	})

	it("delivers direct notification.desktop.terminal events through NotifyPlugin", async () => {
		const { hooks } = await createPlugin()

		await emitEvent(hooks, {
			type: "notification.desktop.terminal",
			properties: {
				title: "Terminal ping",
				message: "Agent needs your attention",
				level: "warning",
			},
		})

		expect(notificationPayloads).toHaveLength(1)
		expect(notificationPayloads[0]).toMatchObject({
			title: "Terminal ping",
			message: "Agent needs your attention",
		})
	})

	it("keeps direct notification.desktop.terminal payload literal when title matches legacy question", async () => {
		const { hooks } = await createPlugin()

		await emitEvent(hooks, {
			type: "notification.desktop.terminal",
			properties: {
				title: "Question for you",
				message: "Literal question body from direct desktop event",
				level: "warning",
			},
		})

		expect(notificationPayloads).toHaveLength(1)
		expect(notificationPayloads[0]).toMatchObject({
			title: "Question for you",
			message: "Literal question body from direct desktop event",
		})
		expect(notificationPayloads[0]?.message).not.toBe("OpenCode needs your input")
	})

	it("notifies for session.error through NotifyPlugin", async () => {
		const { hooks } = await createPlugin({
			"session-error": { title: "Error Session" },
		})

		await emitEvent(hooks, {
			type: "session.error",
			properties: {
				sessionID: "session-error",
				error: "Disk blew up",
			},
		})

		expect(notificationPayloads).toHaveLength(1)
		expect(notificationPayloads[0]).toMatchObject({
			title: "Something went wrong",
			message: "Disk blew up",
		})
	})

	it("dedupes ready notification when session.status idle and session.idle describe same transition", async () => {
		const { hooks } = await createPlugin({
			"session-a": { title: "Session A" },
		})

		await emitEvent(hooks, {
			type: "session.status",
			properties: {
				sessionID: "session-a",
				status: {
					type: "idle",
				},
			},
		})

		await emitEvent(hooks, {
			type: "session.idle",
			properties: {
				sessionID: "session-a",
			},
		})

		expect(notificationPayloads).toHaveLength(1)
		expect(notificationPayloads[0]?.title).toBe("Ready for review")
	})

	it("keeps parent-session gating only for ready notifications", async () => {
		const { hooks } = await createPlugin({
			"child-session": {
				parentID: "root-session",
				title: "Child Session",
			},
		})

		await emitEvent(hooks, {
			type: "session.status",
			properties: {
				sessionID: "child-session",
				status: {
					type: "idle",
				},
			},
		})

		await emitEvent(hooks, {
			type: "session.idle",
			properties: {
				sessionID: "child-session",
			},
		})

		await emitEvent(hooks, {
			type: "permission.asked",
			properties: {
				id: "perm-1",
				sessionID: "child-session",
				permission: "bash",
				patterns: [],
				metadata: {},
				always: [],
			},
		})

		await emitEvent(hooks, {
			type: "question.asked",
			properties: {
				id: "question-1",
				sessionID: "child-session",
				questions: [],
			},
		})

		expect(notificationPayloads).toHaveLength(2)
		expect(notificationPayloads.map((payload) => payload.title)).toEqual([
			"Waiting for you",
			"Question for you",
		])
	})

	it("suppresses focus-gated notifications but keeps question prompt notifications", async () => {
		mockFocusedTerminal()

		const { hooks } = await createPlugin({
			"session-a": { title: "Session A" },
		})

		await emitEvent(hooks, {
			type: "permission.asked",
			properties: {
				id: "perm-1",
				sessionID: "session-a",
				permission: "bash",
				patterns: [],
				metadata: {},
				always: [],
			},
		})

		await emitEvent(hooks, {
			type: "session.status",
			properties: {
				sessionID: "session-a",
				status: {
					type: "idle",
				},
			},
		})

		await emitEvent(hooks, {
			type: "question.asked",
			properties: {
				id: "question-1",
				sessionID: "session-a",
				questions: [],
			},
		})

		expect(notificationPayloads).toHaveLength(1)
		expect(notificationPayloads[0]?.title).toBe("Question for you")
	})

	it("suppresses notifications during quiet hours for legacy and new event aliases", async () => {
		mockedConfig = {
			quietHours: buildCurrentMinuteQuietHours(),
		}

		const { hooks } = await createPlugin({
			"session-a": { title: "Session A" },
		})

		await emitEvent(hooks, {
			type: "permission.updated",
			properties: {},
		})

		await emitEvent(hooks, {
			type: "permission.asked",
			properties: {
				id: "perm-1",
				sessionID: "session-a",
				permission: "bash",
				patterns: [],
				metadata: {},
				always: [],
			},
		})

		await emitQuestionToolBefore(hooks, "session-a", "call-legacy")

		await emitEvent(hooks, {
			type: "question.asked",
			properties: {
				id: "question-1",
				sessionID: "session-a",
				questions: [],
			},
		})

		await emitEvent(hooks, {
			type: "session.idle",
			properties: {
				sessionID: "session-a",
			},
		})

		await emitEvent(hooks, {
			type: "session.status",
			properties: {
				sessionID: "session-a",
				status: {
					type: "idle",
				},
			},
		})

		expect(notificationPayloads).toHaveLength(0)
	})

	it("logs and drops malformed legacy event payloads from normalization boundary", async () => {
		const warnSpy = spyOn(console, "warn").mockImplementation(() => {})
		const { hooks } = await createPlugin()

		await emitEvent(hooks, {
			type: "session.status",
			properties: {
				status: {
					type: "idle",
				},
			},
		})

		expect(notificationPayloads).toHaveLength(0)
		expect(warnSpy).toHaveBeenCalledTimes(1)
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("[notify] Dropping event payload type=session.status"),
		)
	})

	it("logs and drops malformed tool.execute.before payloads from normalization boundary", async () => {
		const warnSpy = spyOn(console, "warn").mockImplementation(() => {})
		const { hooks } = await createPlugin()

		await emitToolBefore(hooks, null)

		expect(notificationPayloads).toHaveLength(0)
		expect(warnSpy).toHaveBeenCalledTimes(1)
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("[notify] Dropping tool.execute.before payload"),
		)
	})
})
