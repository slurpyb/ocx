import { describe, expect, it } from "bun:test"
import {
	CLOSED_HOST_DEFAULT_NOTIFICATION_NEGOTIATED_STATE_BY_CHANNEL,
	createNotificationCapabilityByChannelFromNegotiatedState,
	DesktopTerminalSemanticIntent,
	type NormalizeNotificationOptions,
	type NotificationCapabilityByChannel,
	NotificationCapabilityState,
	NotificationChannel,
	NotificationFallbackMode,
	NotificationHandlingMode,
	NotificationLevel,
	normalizeNotificationBoundaryInput,
	normalizeNotificationEvent,
	normalizeNotificationToolExecuteBefore,
} from "../files/plugins/notify/normalize"
import { createNotificationTaskSystemEvent } from "../files/plugins/notify/task-system-event"

function createBehaviorallyDistinctPolicy(): NormalizeNotificationOptions {
	const defaultCapabilityByChannel = createNotificationCapabilityByChannelFromNegotiatedState(
		CLOSED_HOST_DEFAULT_NOTIFICATION_NEGOTIATED_STATE_BY_CHANNEL,
	)

	const capabilityByChannel: NotificationCapabilityByChannel = {
		...defaultCapabilityByChannel,
		[NotificationChannel.TaskSystem]: {
			state: NotificationCapabilityState.Unsupported,
			fallbackMode: NotificationFallbackMode.Drop,
		},
		[NotificationChannel.SDKSystem]: {
			state: NotificationCapabilityState.Supported,
			fallbackMode: NotificationFallbackMode.None,
		},
		[NotificationChannel.DesktopTerminal]: {
			state: NotificationCapabilityState.Supported,
			fallbackMode: NotificationFallbackMode.None,
		},
	}

	return { capabilityByChannel }
}

describe("notify normalization boundary", () => {
	it("normalizes valid notification.task.system events", () => {
		const result = normalizeNotificationEvent({
			type: "notification.task.system",
			properties: {
				title: "Task started",
				message: 'Started task "audit" with @coder.',
				level: "info",
				sessionID: "session-1",
			},
		})

		expect(result.ok).toBe(true)
		if (!result.ok) {
			expect.unreachable("Expected normalized task.system intent")
		}

		expect(result.intent.channel).toBe(NotificationChannel.TaskSystem)
		expect(result.intent.capabilityState).toBe(NotificationCapabilityState.Supported)
		expect(result.intent.fallbackMode).toBe(NotificationFallbackMode.None)
		expect(result.intent.handlingMode).toBe(NotificationHandlingMode.Deliver)
		expect(result.intent.payload).toEqual({
			title: "Task started",
			message: 'Started task "audit" with @coder.',
			level: "info",
			sessionID: "session-1",
		})
	})

	it("normalizes helper-built task/system bridge payloads", () => {
		const event = createNotificationTaskSystemEvent({
			id: "background-agent:terminal:session-42:task-1:complete",
			dedupeKey: "background-agent:terminal:session-42:task-1:complete",
			title: "Bridge Result",
			message: "Background agent complete: Bridge Result",
			level: NotificationLevel.Success,
			sessionID: "session-42",
		})

		const result = normalizeNotificationEvent(event)

		expect(result.ok).toBe(true)
		if (!result.ok) {
			expect.unreachable("Expected normalized helper-built task.system intent")
		}

		expect(result.intent.channel).toBe(NotificationChannel.TaskSystem)
		expect(result.intent.payload).toEqual({
			title: "Bridge Result",
			message: "Background agent complete: Bridge Result",
			level: "success",
			sessionID: "session-42",
		})
	})

	it("normalizes legacy desktop/native-ready events to desktop.terminal intent", () => {
		const result = normalizeNotificationEvent({
			type: "session.idle",
			properties: {
				sessionID: "session-ready-42",
			},
		})

		expect(result.ok).toBe(true)
		if (!result.ok) {
			expect.unreachable("Expected normalized desktop intent")
		}

		expect(result.intent.channel).toBe(NotificationChannel.DesktopTerminal)
		if (result.intent.channel !== NotificationChannel.DesktopTerminal) {
			expect.unreachable("Expected desktop terminal intent")
		}

		expect(result.intent.semanticIntent).toBe(DesktopTerminalSemanticIntent.SessionReady)
		expect(result.intent.origin.rawType).toBe("session.idle")
		expect(result.intent.notificationId).toBe("session-ready:session-ready-42")
		expect(result.intent.dedupeKey).toBe("session-ready:session-ready-42")
		expect(result.intent.payload).toEqual({
			title: "Ready for review",
			message: "OpenCode task is ready for review",
			level: "info",
			sessionID: "session-ready-42",
		})
	})

	it("encodes internal_only and unsupported handling in normalized result", () => {
		const sdkResult = normalizeNotificationEvent({
			type: "notification.sdk.system",
			properties: {
				code: "SESSION_RETRYING",
				message: "Session retry scheduled",
				level: "warning",
				sourceEvent: "notification.task.system",
			},
		})

		expect(sdkResult.ok).toBe(true)
		if (!sdkResult.ok) {
			expect.unreachable("Expected normalized sdk.system intent")
		}

		expect(sdkResult.intent.channel).toBe(NotificationChannel.SDKSystem)
		expect(sdkResult.intent.capabilityState).toBe(NotificationCapabilityState.Unsupported)
		expect(sdkResult.intent.fallbackMode).toBe(NotificationFallbackMode.Drop)
		expect(sdkResult.intent.handlingMode).toBe(NotificationHandlingMode.Drop)

		const mcpResult = normalizeNotificationEvent({
			type: "notification.mcp.channel",
			properties: {
				server: "mcp-gateway",
				message: "rate limit warning",
				level: "warning",
				source: "mcp.server",
				trust: "untrusted",
			},
		})

		expect(mcpResult.ok).toBe(true)
		if (!mcpResult.ok) {
			expect.unreachable("Expected normalized mcp.channel intent")
		}

		expect(mcpResult.intent.channel).toBe(NotificationChannel.MCPChannel)
		expect(mcpResult.intent.capabilityState).toBe(NotificationCapabilityState.InternalOnly)
		expect(mcpResult.intent.fallbackMode).toBe(NotificationFallbackMode.FailClosed)
		expect(mcpResult.intent.handlingMode).toBe(NotificationHandlingMode.FailClosed)
		expect(mcpResult.intent.trustLevel).toBe("untrusted")
	})

	it("keeps mcp.channel fallback identity unique per message", () => {
		const baseline = normalizeNotificationEvent({
			type: "notification.mcp.channel",
			properties: {
				server: "mcp-gateway",
				message: "rate limit warning",
				level: "warning",
				source: "mcp.server",
				trust: "untrusted",
			},
		})

		const distinctMessage = normalizeNotificationEvent({
			type: "notification.mcp.channel",
			properties: {
				server: "mcp-gateway",
				message: "gateway degraded",
				level: "warning",
				source: "mcp.server",
				trust: "untrusted",
			},
		})

		const repeatedBaseline = normalizeNotificationEvent({
			type: "notification.mcp.channel",
			properties: {
				server: "mcp-gateway",
				message: "rate limit warning",
				level: "warning",
				source: "mcp.server",
				trust: "untrusted",
			},
		})

		expect(baseline.ok).toBe(true)
		expect(distinctMessage.ok).toBe(true)
		expect(repeatedBaseline.ok).toBe(true)

		if (!baseline.ok || !distinctMessage.ok || !repeatedBaseline.ok) {
			expect.unreachable("Expected normalized mcp.channel intents")
		}

		expect(baseline.intent.notificationId).not.toBe(distinctMessage.intent.notificationId)
		expect(baseline.intent.dedupeKey).not.toBe(distinctMessage.intent.dedupeKey)

		expect(baseline.intent.notificationId).toBe(repeatedBaseline.intent.notificationId)
		expect(baseline.intent.dedupeKey).toBe(repeatedBaseline.intent.dedupeKey)
	})

	it("returns parse_failure for malformed event payload", () => {
		const result = normalizeNotificationEvent({
			type: "notification.task.system",
			properties: {
				level: "info",
			},
		})

		expect(result.ok).toBe(false)
		if (result.ok) {
			expect.unreachable("Expected parse failure")
		}

		expect(result.kind).toBe("parse_failure")
		expect(result.code).toBe("invalid-properties")
		expect(result.rawType).toBe("notification.task.system")
	})

	it("builds per-channel fallback policy from negotiated host state", () => {
		const capabilityByChannel = createNotificationCapabilityByChannelFromNegotiatedState(
			CLOSED_HOST_DEFAULT_NOTIFICATION_NEGOTIATED_STATE_BY_CHANNEL,
		)

		expect(capabilityByChannel[NotificationChannel.SDKSystem]).toEqual({
			state: NotificationCapabilityState.Unsupported,
			fallbackMode: NotificationFallbackMode.Drop,
		})
		expect(capabilityByChannel[NotificationChannel.DesktopTerminal]).toEqual({
			state: NotificationCapabilityState.Unsupported,
			fallbackMode: NotificationFallbackMode.FailClosed,
		})
	})

	it("captures compact closed-host parity smoke across all five channels", () => {
		function summarize(
			result: ReturnType<typeof normalizeNotificationEvent>,
			errorMessage: string,
		): {
			capabilityState: NotificationCapabilityState
			fallbackMode: NotificationFallbackMode
			handlingMode: NotificationHandlingMode
		} {
			expect(result.ok).toBe(true)
			if (!result.ok) {
				expect.unreachable(errorMessage)
			}

			return {
				capabilityState: result.intent.capabilityState,
				fallbackMode: result.intent.fallbackMode,
				handlingMode: result.intent.handlingMode,
			}
		}

		const parityByChannel = {
			[NotificationChannel.UIToast]: summarize(
				normalizeNotificationEvent({
					type: "notification.ui.toast",
					properties: {
						message: "Heads up",
						variant: "info",
					},
				}),
				"Expected normalized ui.toast parity entry",
			),
			[NotificationChannel.TaskSystem]: summarize(
				normalizeNotificationEvent({
					type: "notification.task.system",
					properties: {
						message: "Task completed",
						level: "success",
					},
				}),
				"Expected normalized task.system parity entry",
			),
			[NotificationChannel.SDKSystem]: summarize(
				normalizeNotificationEvent({
					type: "notification.sdk.system",
					properties: {
						code: "SESSION_RETRYING",
						message: "Session is retrying",
						level: "warning",
						sourceEvent: "notification.task.system",
					},
				}),
				"Expected normalized sdk.system parity entry",
			),
			[NotificationChannel.DesktopTerminal]: summarize(
				normalizeNotificationEvent({
					type: "notification.desktop.terminal",
					properties: {
						title: "Terminal ping",
						message: "Agent needs your attention",
						level: "warning",
					},
				}),
				"Expected normalized desktop.terminal parity entry",
			),
			[NotificationChannel.MCPChannel]: summarize(
				normalizeNotificationEvent({
					type: "notification.mcp.channel",
					properties: {
						server: "mcp-gateway",
						message: "rate limit warning",
						level: "warning",
						source: "mcp.server",
						trust: "untrusted",
					},
				}),
				"Expected normalized mcp.channel parity entry",
			),
		}

		expect(parityByChannel).toEqual({
			[NotificationChannel.UIToast]: {
				capabilityState: NotificationCapabilityState.Supported,
				fallbackMode: NotificationFallbackMode.None,
				handlingMode: NotificationHandlingMode.Deliver,
			},
			[NotificationChannel.TaskSystem]: {
				capabilityState: NotificationCapabilityState.Supported,
				fallbackMode: NotificationFallbackMode.None,
				handlingMode: NotificationHandlingMode.Deliver,
			},
			[NotificationChannel.SDKSystem]: {
				capabilityState: NotificationCapabilityState.Unsupported,
				fallbackMode: NotificationFallbackMode.Drop,
				handlingMode: NotificationHandlingMode.Drop,
			},
			[NotificationChannel.DesktopTerminal]: {
				capabilityState: NotificationCapabilityState.Unsupported,
				fallbackMode: NotificationFallbackMode.FailClosed,
				handlingMode: NotificationHandlingMode.FailClosed,
			},
			[NotificationChannel.MCPChannel]: {
				capabilityState: NotificationCapabilityState.InternalOnly,
				fallbackMode: NotificationFallbackMode.FailClosed,
				handlingMode: NotificationHandlingMode.FailClosed,
			},
		})
	})

	it("fails fast when negotiated state conflicts with closed host fallback metadata", () => {
		expect(() =>
			createNotificationCapabilityByChannelFromNegotiatedState({
				...CLOSED_HOST_DEFAULT_NOTIFICATION_NEGOTIATED_STATE_BY_CHANNEL,
				[NotificationChannel.SDKSystem]: NotificationCapabilityState.Supported,
			}),
		).toThrow(
			"Closed host notification policy mismatch: channel sdk.system cannot be supported/fallback_approved when fallback mode is drop.",
		)
	})

	it("consumes supplied capability policy directly for normalization behavior", () => {
		const options = createBehaviorallyDistinctPolicy()

		const taskResult = normalizeNotificationEvent(
			{
				type: "notification.task.system",
				properties: {
					message: "Task transport request",
					level: "success",
				},
			},
			options,
		)

		expect(taskResult.ok).toBe(true)
		if (!taskResult.ok) {
			expect.unreachable("Expected normalized task.system intent")
		}

		expect(taskResult.intent.capabilityState).toBe(NotificationCapabilityState.Unsupported)
		expect(taskResult.intent.fallbackMode).toBe(NotificationFallbackMode.Drop)
		expect(taskResult.intent.handlingMode).toBe(NotificationHandlingMode.Drop)
	})

	it("applies injected boundary policy for both event and tool sources", () => {
		const options = createBehaviorallyDistinctPolicy()

		const eventBoundaryResult = normalizeNotificationBoundaryInput(
			{
				source: "event",
				value: {
					type: "notification.sdk.system",
					properties: {
						code: "POLICY_DROP",
						message: "Drop path",
						level: "warning",
						sourceEvent: "notification.task.system",
					},
				},
			},
			options,
		)

		expect(eventBoundaryResult.ok).toBe(true)
		if (!eventBoundaryResult.ok) {
			expect.unreachable("Expected normalized event-boundary intent")
		}

		expect(eventBoundaryResult.intent.channel).toBe(NotificationChannel.SDKSystem)
		expect(eventBoundaryResult.intent.fallbackMode).toBe(NotificationFallbackMode.None)
		expect(eventBoundaryResult.intent.handlingMode).toBe(NotificationHandlingMode.Deliver)

		const toolBoundaryResult = normalizeNotificationBoundaryInput(
			{
				source: "tool.execute.before",
				value: {
					tool: "question",
					sessionID: "session-tool-policy",
					callID: "call-tool-policy",
				},
			},
			options,
		)

		expect(toolBoundaryResult.ok).toBe(true)
		if (!toolBoundaryResult.ok) {
			expect.unreachable("Expected normalized tool-boundary intent")
		}

		expect(toolBoundaryResult.intent.channel).toBe(NotificationChannel.DesktopTerminal)
		expect(toolBoundaryResult.intent.fallbackMode).toBe(NotificationFallbackMode.None)
		expect(toolBoundaryResult.intent.handlingMode).toBe(NotificationHandlingMode.Deliver)
	})

	it("preserves session.error detail via String(error) for truthy non-string values", () => {
		const result = normalizeNotificationEvent({
			type: "session.error",
			properties: {
				sessionID: "session-err-1",
				error: new Error("Disk blew up"),
			},
		})

		expect(result.ok).toBe(true)
		if (!result.ok) {
			expect.unreachable("Expected normalized session.error intent")
		}

		expect(result.intent.payload.message).toBe("Error: Disk blew up")
	})

	it("normalizes direct desktop terminal events as generic semantic intents", () => {
		const result = normalizeNotificationEvent({
			type: "notification.desktop.terminal",
			properties: {
				title: "Question for you",
				message: "Literal direct desktop payload",
				level: "warning",
			},
		})

		expect(result.ok).toBe(true)
		if (!result.ok) {
			expect.unreachable("Expected normalized direct desktop terminal intent")
		}

		expect(result.intent.channel).toBe(NotificationChannel.DesktopTerminal)
		if (result.intent.channel !== NotificationChannel.DesktopTerminal) {
			expect.unreachable("Expected desktop terminal intent")
		}

		expect(result.intent.semanticIntent).toBe(DesktopTerminalSemanticIntent.Generic)
		expect(result.intent.payload.title).toBe("Question for you")
	})

	it("does not invent permission dedupe keys when request id is missing", () => {
		const result = normalizeNotificationEvent({
			type: "permission.updated",
			properties: {
				sessionID: "session-perm-missing-id",
			},
		})

		expect(result.ok).toBe(true)
		if (!result.ok) {
			expect.unreachable("Expected normalized permission intent")
		}

		expect(result.intent.dedupeKey).toBeUndefined()
	})

	it("does not invent question dedupe keys when stable identifiers are missing", () => {
		const eventResult = normalizeNotificationEvent({
			type: "question.asked",
			properties: {
				sessionID: "session-question-missing-id",
				questions: [],
			},
		})

		expect(eventResult.ok).toBe(true)
		if (!eventResult.ok) {
			expect.unreachable("Expected normalized question.asked intent")
		}

		expect(eventResult.intent.dedupeKey).toBeUndefined()

		const requestOnlyEventResult = normalizeNotificationEvent({
			type: "question.asked",
			properties: {
				id: "question-request-only",
				questions: [],
			},
		})

		expect(requestOnlyEventResult.ok).toBe(true)
		if (!requestOnlyEventResult.ok) {
			expect.unreachable("Expected normalized request-only question.asked intent")
		}

		expect(requestOnlyEventResult.intent.dedupeKey).toBeUndefined()

		const toolResult = normalizeNotificationToolExecuteBefore({
			tool: "question",
			sessionID: "session-question-missing-call",
		})

		expect(toolResult.ok).toBe(true)
		if (!toolResult.ok) {
			expect.unreachable("Expected normalized tool.execute.before intent")
		}

		expect(toolResult.intent.dedupeKey).toBeUndefined()
	})

	it("normalizes legacy question tool hook into desktop intent", () => {
		const result = normalizeNotificationToolExecuteBefore({
			tool: "question",
			sessionID: "session-tool",
			callID: "call-1",
		})

		expect(result.ok).toBe(true)
		if (!result.ok) {
			expect.unreachable("Expected normalized tool.execute.before intent")
		}

		expect(result.intent.channel).toBe(NotificationChannel.DesktopTerminal)
		if (result.intent.channel !== NotificationChannel.DesktopTerminal) {
			expect.unreachable("Expected desktop terminal intent")
		}

		expect(result.intent.origin.source).toBe("tool.execute.before")
		expect(result.intent.semanticIntent).toBe(DesktopTerminalSemanticIntent.Question)
		expect(result.intent.dedupeKey).toBe("question:session-tool:call-1")
	})
})
