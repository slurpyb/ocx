import {
	ClosedHostDefaultNotificationFallbackModeByChannel as CanonicalClosedHostFallbackModeByChannel,
	ClosedHostDefaultNotificationNegotiatedStateByChannel as CanonicalClosedHostNegotiatedStateByChannel,
	type NotificationFallbackModeByChannel as CanonicalNotificationFallbackModeByChannel,
	type NotificationNegotiatedStateByChannel as CanonicalNotificationNegotiatedStateByChannel,
} from "./contract-compat"
import { NotificationTaskSystemEventType } from "./task-system-event"

export const NotificationChannel = {
	UIToast: "ui.toast",
	TaskSystem: "task.system",
	SDKSystem: "sdk.system",
	DesktopTerminal: "desktop.terminal",
	MCPChannel: "mcp.channel",
} as const

export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel]

export const NotificationCapabilityState = {
	Supported: "supported",
	FallbackApproved: "fallback_approved",
	Unsupported: "unsupported",
	InternalOnly: "internal_only",
} as const

export type NotificationCapabilityState =
	(typeof NotificationCapabilityState)[keyof typeof NotificationCapabilityState]

export const NotificationFallbackMode = {
	None: "none",
	Drop: "drop",
	FailClosed: "fail_closed",
} as const

export type NotificationFallbackMode =
	(typeof NotificationFallbackMode)[keyof typeof NotificationFallbackMode]

export const NotificationTrustLevel = {
	Trusted: "trusted",
	Untrusted: "untrusted",
} as const

export type NotificationTrustLevel =
	(typeof NotificationTrustLevel)[keyof typeof NotificationTrustLevel]

export const NotificationLevel = {
	Info: "info",
	Success: "success",
	Warning: "warning",
	Error: "error",
} as const

export type NotificationLevel = (typeof NotificationLevel)[keyof typeof NotificationLevel]

export const DesktopTerminalSemanticIntent = {
	Generic: "generic",
	SessionReady: "session-ready",
	SessionError: "session-error",
	Permission: "permission",
	Question: "question",
} as const

export type DesktopTerminalSemanticIntent =
	(typeof DesktopTerminalSemanticIntent)[keyof typeof DesktopTerminalSemanticIntent]

export const NotificationHandlingMode = {
	Deliver: "deliver",
	Drop: "drop",
	FailClosed: "fail_closed",
} as const

export type NotificationHandlingMode =
	(typeof NotificationHandlingMode)[keyof typeof NotificationHandlingMode]

export interface NotificationCapabilityProfile {
	state: NotificationCapabilityState
	fallbackMode: NotificationFallbackMode
}

export type NotificationCapabilityByChannel = {
	[channel in NotificationChannel]: NotificationCapabilityProfile
}

export type NotificationNegotiatedStateByChannel = {
	[channel in NotificationChannel]: NotificationCapabilityState
}

const NOTIFICATION_CAPABILITY_STATE_SET = new Set<string>(
	Object.values(NotificationCapabilityState),
)

const NOTIFICATION_FALLBACK_MODE_SET = new Set<string>(Object.values(NotificationFallbackMode))

function parseCapabilityStateFromCanonicalContract(input: {
	channel: NotificationChannel
	state: string
}): NotificationCapabilityState {
	if (!NOTIFICATION_CAPABILITY_STATE_SET.has(input.state)) {
		throw new Error(
			`Authoritative notification negotiated-state mismatch: channel ${input.channel} has unsupported state "${input.state}".`,
		)
	}

	return input.state as NotificationCapabilityState
}

function parseFallbackModeFromCanonicalContract(input: {
	channel: NotificationChannel
	fallbackMode: string
}): NotificationFallbackMode {
	if (!NOTIFICATION_FALLBACK_MODE_SET.has(input.fallbackMode)) {
		throw new Error(
			`Authoritative notification fallback-mode mismatch: channel ${input.channel} has unsupported fallback mode "${input.fallbackMode}".`,
		)
	}

	return input.fallbackMode as NotificationFallbackMode
}

function parseNegotiatedStateFromCanonicalContract(
	negotiatedStateByChannel: CanonicalNotificationNegotiatedStateByChannel,
): NotificationNegotiatedStateByChannel {
	return {
		[NotificationChannel.UIToast]: parseCapabilityStateFromCanonicalContract({
			channel: NotificationChannel.UIToast,
			state: negotiatedStateByChannel[NotificationChannel.UIToast],
		}),
		[NotificationChannel.TaskSystem]: parseCapabilityStateFromCanonicalContract({
			channel: NotificationChannel.TaskSystem,
			state: negotiatedStateByChannel[NotificationChannel.TaskSystem],
		}),
		[NotificationChannel.SDKSystem]: parseCapabilityStateFromCanonicalContract({
			channel: NotificationChannel.SDKSystem,
			state: negotiatedStateByChannel[NotificationChannel.SDKSystem],
		}),
		[NotificationChannel.DesktopTerminal]: parseCapabilityStateFromCanonicalContract({
			channel: NotificationChannel.DesktopTerminal,
			state: negotiatedStateByChannel[NotificationChannel.DesktopTerminal],
		}),
		[NotificationChannel.MCPChannel]: parseCapabilityStateFromCanonicalContract({
			channel: NotificationChannel.MCPChannel,
			state: negotiatedStateByChannel[NotificationChannel.MCPChannel],
		}),
	}
}

function parseFallbackModeByChannelFromCanonicalContract(
	fallbackModeByChannel: CanonicalNotificationFallbackModeByChannel,
): {
	[channel in NotificationChannel]: NotificationFallbackMode
} {
	return {
		[NotificationChannel.UIToast]: parseFallbackModeFromCanonicalContract({
			channel: NotificationChannel.UIToast,
			fallbackMode: fallbackModeByChannel[NotificationChannel.UIToast],
		}),
		[NotificationChannel.TaskSystem]: parseFallbackModeFromCanonicalContract({
			channel: NotificationChannel.TaskSystem,
			fallbackMode: fallbackModeByChannel[NotificationChannel.TaskSystem],
		}),
		[NotificationChannel.SDKSystem]: parseFallbackModeFromCanonicalContract({
			channel: NotificationChannel.SDKSystem,
			fallbackMode: fallbackModeByChannel[NotificationChannel.SDKSystem],
		}),
		[NotificationChannel.DesktopTerminal]: parseFallbackModeFromCanonicalContract({
			channel: NotificationChannel.DesktopTerminal,
			fallbackMode: fallbackModeByChannel[NotificationChannel.DesktopTerminal],
		}),
		[NotificationChannel.MCPChannel]: parseFallbackModeFromCanonicalContract({
			channel: NotificationChannel.MCPChannel,
			fallbackMode: fallbackModeByChannel[NotificationChannel.MCPChannel],
		}),
	}
}

export const CLOSED_HOST_DEFAULT_NOTIFICATION_NEGOTIATED_STATE_BY_CHANNEL =
	parseNegotiatedStateFromCanonicalContract(CanonicalClosedHostNegotiatedStateByChannel)

export const CLOSED_HOST_NOTIFICATION_FALLBACK_MODE_BY_CHANNEL =
	parseFallbackModeByChannelFromCanonicalContract(CanonicalClosedHostFallbackModeByChannel)

function createClosedHostCapabilityProfile(input: {
	channel: NotificationChannel
	state: NotificationCapabilityState
}): NotificationCapabilityProfile {
	const fallbackMode = CLOSED_HOST_NOTIFICATION_FALLBACK_MODE_BY_CHANNEL[input.channel]

	if (fallbackMode === NotificationFallbackMode.None) {
		if (
			input.state !== NotificationCapabilityState.Supported &&
			input.state !== NotificationCapabilityState.FallbackApproved
		) {
			throw new Error(
				`Closed host notification policy mismatch: channel ${input.channel} requires supported/fallback_approved when fallback mode is none (received ${input.state}).`,
			)
		}

		return {
			state: input.state,
			fallbackMode,
		}
	}

	if (
		input.state === NotificationCapabilityState.Supported ||
		input.state === NotificationCapabilityState.FallbackApproved
	) {
		throw new Error(
			`Closed host notification policy mismatch: channel ${input.channel} cannot be supported/fallback_approved when fallback mode is ${fallbackMode}.`,
		)
	}

	return {
		state: input.state,
		fallbackMode,
	}
}

export function createNotificationCapabilityByChannelFromNegotiatedState(
	negotiatedStateByChannel: NotificationNegotiatedStateByChannel,
): NotificationCapabilityByChannel {
	return {
		[NotificationChannel.UIToast]: createClosedHostCapabilityProfile({
			channel: NotificationChannel.UIToast,
			state: negotiatedStateByChannel[NotificationChannel.UIToast],
		}),
		[NotificationChannel.TaskSystem]: createClosedHostCapabilityProfile({
			channel: NotificationChannel.TaskSystem,
			state: negotiatedStateByChannel[NotificationChannel.TaskSystem],
		}),
		[NotificationChannel.SDKSystem]: createClosedHostCapabilityProfile({
			channel: NotificationChannel.SDKSystem,
			state: negotiatedStateByChannel[NotificationChannel.SDKSystem],
		}),
		[NotificationChannel.DesktopTerminal]: createClosedHostCapabilityProfile({
			channel: NotificationChannel.DesktopTerminal,
			state: negotiatedStateByChannel[NotificationChannel.DesktopTerminal],
		}),
		[NotificationChannel.MCPChannel]: createClosedHostCapabilityProfile({
			channel: NotificationChannel.MCPChannel,
			state: negotiatedStateByChannel[NotificationChannel.MCPChannel],
		}),
	}
}

export const DEFAULT_NOTIFICATION_CAPABILITY_BY_CHANNEL =
	createNotificationCapabilityByChannelFromNegotiatedState(
		CLOSED_HOST_DEFAULT_NOTIFICATION_NEGOTIATED_STATE_BY_CHANNEL,
	)

export type NotificationTimeoutByChannel = {
	[channel in NotificationChannel]: number
}

export const DEFAULT_NOTIFICATION_TIMEOUT_MS_BY_CHANNEL: NotificationTimeoutByChannel = {
	[NotificationChannel.UIToast]: 5000,
	[NotificationChannel.TaskSystem]: 5000,
	[NotificationChannel.SDKSystem]: 5000,
	[NotificationChannel.DesktopTerminal]: 5000,
	[NotificationChannel.MCPChannel]: 5000,
}

export interface NormalizeNotificationOptions {
	capabilityByChannel?: NotificationCapabilityByChannel
	timeoutMsByChannel?: Partial<NotificationTimeoutByChannel>
}

export interface NormalizedNotificationOrigin {
	source: "event" | "tool.execute.before"
	rawType: string
}

export interface NormalizedNotificationIntentBase<Channel extends NotificationChannel> {
	channel: Channel
	capabilityState: NotificationCapabilityState
	fallbackMode: NotificationFallbackMode
	handlingMode: NotificationHandlingMode
	origin: NormalizedNotificationOrigin
	notificationId: string
	dedupeKey?: string
	trustLevel: NotificationTrustLevel
	timeoutMs: number
	invalidates: readonly string[]
}

export interface NormalizedUIToastIntent
	extends NormalizedNotificationIntentBase<typeof NotificationChannel.UIToast> {
	payload: {
		title?: string
		message: string
		variant: NotificationLevel
		durationMs: number
	}
}

export interface NormalizedTaskSystemIntent
	extends NormalizedNotificationIntentBase<typeof NotificationChannel.TaskSystem> {
	payload: {
		title?: string
		message: string
		level: NotificationLevel
		sessionID?: string
	}
}

export interface NormalizedSDKSystemIntent
	extends NormalizedNotificationIntentBase<typeof NotificationChannel.SDKSystem> {
	payload: {
		code: string
		message: string
		level: NotificationLevel
		sourceEvent: string
	}
}

export interface NormalizedDesktopTerminalIntent
	extends NormalizedNotificationIntentBase<typeof NotificationChannel.DesktopTerminal> {
	semanticIntent: DesktopTerminalSemanticIntent
	payload: {
		title?: string
		message: string
		level: NotificationLevel
		sessionID?: string
	}
}

export interface NormalizedMCPChannelIntent
	extends NormalizedNotificationIntentBase<typeof NotificationChannel.MCPChannel> {
	payload: {
		server: string
		message: string
		level: NotificationLevel
		source: "mcp.server" | "host.bridge"
		trust: NotificationTrustLevel
	}
}

export type NormalizedNotificationIntent =
	| NormalizedUIToastIntent
	| NormalizedTaskSystemIntent
	| NormalizedSDKSystemIntent
	| NormalizedDesktopTerminalIntent
	| NormalizedMCPChannelIntent

export type NormalizedNotificationParseFailureCode =
	| "invalid-envelope"
	| "invalid-properties"
	| "unsupported-type"
	| "invalid-tool-input"

export interface NormalizedNotificationParseFailure {
	ok: false
	kind: "parse_failure"
	code: NormalizedNotificationParseFailureCode
	message: string
	source: "event" | "tool.execute.before"
	rawType?: string
	raw: unknown
	details?: Record<string, unknown>
}

export interface NormalizedNotificationParseSuccess {
	ok: true
	kind: "normalized_intent"
	intent: NormalizedNotificationIntent
}

export type NormalizedNotificationParseResult =
	| NormalizedNotificationParseSuccess
	| NormalizedNotificationParseFailure

export type NormalizeNotificationBoundaryInput =
	| { source: "event"; value: unknown }
	| { source: "tool.execute.before"; value: unknown }

const NOTIFICATION_LEVEL_SET = new Set<string>(Object.values(NotificationLevel))

function normalizeNotificationCapabilities(
	capabilityByChannel: NormalizeNotificationOptions["capabilityByChannel"],
): NotificationCapabilityByChannel {
	return capabilityByChannel ?? DEFAULT_NOTIFICATION_CAPABILITY_BY_CHANNEL
}

function normalizeNotificationTimeouts(
	overrides: NormalizeNotificationOptions["timeoutMsByChannel"],
): NotificationTimeoutByChannel {
	return {
		[NotificationChannel.UIToast]:
			overrides?.[NotificationChannel.UIToast] ??
			DEFAULT_NOTIFICATION_TIMEOUT_MS_BY_CHANNEL[NotificationChannel.UIToast],
		[NotificationChannel.TaskSystem]:
			overrides?.[NotificationChannel.TaskSystem] ??
			DEFAULT_NOTIFICATION_TIMEOUT_MS_BY_CHANNEL[NotificationChannel.TaskSystem],
		[NotificationChannel.SDKSystem]:
			overrides?.[NotificationChannel.SDKSystem] ??
			DEFAULT_NOTIFICATION_TIMEOUT_MS_BY_CHANNEL[NotificationChannel.SDKSystem],
		[NotificationChannel.DesktopTerminal]:
			overrides?.[NotificationChannel.DesktopTerminal] ??
			DEFAULT_NOTIFICATION_TIMEOUT_MS_BY_CHANNEL[NotificationChannel.DesktopTerminal],
		[NotificationChannel.MCPChannel]:
			overrides?.[NotificationChannel.MCPChannel] ??
			DEFAULT_NOTIFICATION_TIMEOUT_MS_BY_CHANNEL[NotificationChannel.MCPChannel],
	}
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined
	}

	return value as Record<string, unknown>
}

function toNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined
	}

	const normalized = value.trim()
	return normalized.length > 0 ? normalized : undefined
}

function toNotificationLevel(value: unknown): NotificationLevel | undefined {
	const normalized = toNonEmptyString(value)
	if (!normalized || !NOTIFICATION_LEVEL_SET.has(normalized)) {
		return undefined
	}

	return normalized as NotificationLevel
}

function toDurationMs(value: unknown, fallback: number): number | undefined {
	if (value === undefined) {
		return fallback
	}

	if (typeof value !== "number" || !Number.isInteger(value)) {
		return undefined
	}

	if (value <= 0 || value > 60_000) {
		return undefined
	}

	return value
}

function toLegacySessionErrorMessage(errorValue: unknown): string {
	const directMessage = toNonEmptyString(errorValue)
	if (directMessage) {
		return directMessage
	}

	if (!errorValue) {
		return "Something went wrong"
	}

	const stringified = toNonEmptyString(String(errorValue))
	return stringified ?? "Something went wrong"
}

function failure(input: {
	code: NormalizedNotificationParseFailureCode
	message: string
	source: "event" | "tool.execute.before"
	rawType?: string
	raw: unknown
	details?: Record<string, unknown>
}): NormalizedNotificationParseFailure {
	return {
		ok: false,
		kind: "parse_failure",
		code: input.code,
		message: input.message,
		source: input.source,
		rawType: input.rawType,
		raw: input.raw,
		details: input.details,
	}
}

function success(intent: NormalizedNotificationIntent): NormalizedNotificationParseSuccess {
	return {
		ok: true,
		kind: "normalized_intent",
		intent,
	}
}

function resolveHandlingMode(
	capabilityState: NotificationCapabilityState,
	fallbackMode: NotificationFallbackMode,
): NotificationHandlingMode {
	if (
		capabilityState === NotificationCapabilityState.Supported ||
		capabilityState === NotificationCapabilityState.FallbackApproved
	) {
		return NotificationHandlingMode.Deliver
	}

	if (fallbackMode === NotificationFallbackMode.Drop) {
		return NotificationHandlingMode.Drop
	}

	if (fallbackMode === NotificationFallbackMode.FailClosed) {
		return NotificationHandlingMode.FailClosed
	}

	throw new Error(
		`Invalid notification capability combination: state=${capabilityState}, fallback=${fallbackMode}`,
	)
}

function createIdentity(input: {
	explicitID?: string
	explicitDedupeKey?: string
	fallbackNotificationID: string
	fallbackDedupeKey?: string
}): {
	notificationId: string
	dedupeKey?: string
} {
	const fallbackNotificationID = input.fallbackNotificationID.trim()
	const notificationId = input.explicitID ?? fallbackNotificationID
	const dedupeKey = input.explicitDedupeKey ?? input.fallbackDedupeKey

	return {
		notificationId,
		dedupeKey,
	}
}

function createIntentBase<Channel extends NotificationChannel>(input: {
	channel: Channel
	origin: NormalizedNotificationOrigin
	trustLevel: NotificationTrustLevel
	notificationId: string
	dedupeKey?: string
	invalidates?: readonly string[]
	capabilityByChannel: NotificationCapabilityByChannel
	timeoutMsByChannel: NotificationTimeoutByChannel
}): NormalizedNotificationIntentBase<Channel> {
	const capability = input.capabilityByChannel[input.channel]

	return {
		channel: input.channel,
		capabilityState: capability.state,
		fallbackMode: capability.fallbackMode,
		handlingMode: resolveHandlingMode(capability.state, capability.fallbackMode),
		origin: input.origin,
		notificationId: input.notificationId,
		dedupeKey: input.dedupeKey,
		trustLevel: input.trustLevel,
		timeoutMs: input.timeoutMsByChannel[input.channel],
		invalidates: input.invalidates ?? [],
	}
}

function normalizeTaskSystemEvent(
	properties: Record<string, unknown>,
	capabilityByChannel: NotificationCapabilityByChannel,
	timeoutMsByChannel: NotificationTimeoutByChannel,
): NormalizedNotificationParseResult {
	const message = toNonEmptyString(properties.message)
	const level = toNotificationLevel(properties.level)

	if (!message || !level) {
		return failure({
			code: "invalid-properties",
			message: `${NotificationTaskSystemEventType} requires non-empty message and valid level.`,
			source: "event",
			rawType: NotificationTaskSystemEventType,
			raw: properties,
		})
	}

	const title = toNonEmptyString(properties.title)
	const sessionID = toNonEmptyString(properties.sessionID)
	const identity = createIdentity({
		explicitID: toNonEmptyString(properties.id),
		explicitDedupeKey: toNonEmptyString(properties.dedupeKey),
		fallbackNotificationID: `task-system:${sessionID ?? "global"}:${level}:${message}`,
		fallbackDedupeKey: `task-system:${sessionID ?? "global"}:${level}:${message}`,
	})

	const base = createIntentBase({
		channel: NotificationChannel.TaskSystem,
		origin: {
			source: "event",
			rawType: NotificationTaskSystemEventType,
		},
		trustLevel: NotificationTrustLevel.Trusted,
		notificationId: identity.notificationId,
		dedupeKey: identity.dedupeKey,
		capabilityByChannel,
		timeoutMsByChannel,
	})

	return success({
		...base,
		payload: {
			title,
			message,
			level,
			sessionID,
		},
	})
}

function normalizeSDKSystemEvent(
	properties: Record<string, unknown>,
	capabilityByChannel: NotificationCapabilityByChannel,
	timeoutMsByChannel: NotificationTimeoutByChannel,
): NormalizedNotificationParseResult {
	const code = toNonEmptyString(properties.code)
	const message = toNonEmptyString(properties.message)
	const level = toNotificationLevel(properties.level)
	const sourceEvent = toNonEmptyString(properties.sourceEvent)

	if (!code || !message || !level || !sourceEvent) {
		return failure({
			code: "invalid-properties",
			message:
				"notification.sdk.system requires code, message, level, and sourceEvent as non-empty values.",
			source: "event",
			rawType: "notification.sdk.system",
			raw: properties,
		})
	}

	const identity = createIdentity({
		explicitID: toNonEmptyString(properties.id),
		explicitDedupeKey: toNonEmptyString(properties.dedupeKey),
		fallbackNotificationID: `sdk-system:${code}:${sourceEvent}`,
		fallbackDedupeKey: `sdk-system:${code}:${sourceEvent}`,
	})

	const base = createIntentBase({
		channel: NotificationChannel.SDKSystem,
		origin: {
			source: "event",
			rawType: "notification.sdk.system",
		},
		trustLevel: NotificationTrustLevel.Trusted,
		notificationId: identity.notificationId,
		dedupeKey: identity.dedupeKey,
		capabilityByChannel,
		timeoutMsByChannel,
	})

	return success({
		...base,
		payload: {
			code,
			message,
			level,
			sourceEvent,
		},
	})
}

function normalizeUIToastEvent(
	rawType: string,
	properties: Record<string, unknown>,
	capabilityByChannel: NotificationCapabilityByChannel,
	timeoutMsByChannel: NotificationTimeoutByChannel,
): NormalizedNotificationParseResult {
	const message = toNonEmptyString(properties.message)
	const variant = toNotificationLevel(properties.variant)
	const durationMs = toDurationMs(properties.duration, 5000)

	if (!message || !variant || durationMs === undefined) {
		return failure({
			code: "invalid-properties",
			message: "ui.toast requires message, variant, and optional duration within 1..60000.",
			source: "event",
			rawType,
			raw: properties,
		})
	}

	const title = toNonEmptyString(properties.title)
	const identity = createIdentity({
		explicitID: toNonEmptyString(properties.id),
		explicitDedupeKey: toNonEmptyString(properties.dedupeKey),
		fallbackNotificationID: `ui-toast:${variant}:${message}`,
		fallbackDedupeKey: `ui-toast:${variant}:${message}`,
	})

	const base = createIntentBase({
		channel: NotificationChannel.UIToast,
		origin: {
			source: "event",
			rawType,
		},
		trustLevel: NotificationTrustLevel.Trusted,
		notificationId: identity.notificationId,
		dedupeKey: identity.dedupeKey,
		capabilityByChannel,
		timeoutMsByChannel: {
			...timeoutMsByChannel,
			[NotificationChannel.UIToast]: durationMs,
		},
	})

	return success({
		...base,
		payload: {
			title,
			message,
			variant,
			durationMs,
		},
	})
}

function normalizeDesktopTerminalEvent(
	rawType: string,
	properties: Record<string, unknown>,
	capabilityByChannel: NotificationCapabilityByChannel,
	timeoutMsByChannel: NotificationTimeoutByChannel,
): NormalizedNotificationParseResult {
	const message = toNonEmptyString(properties.message)
	const level = toNotificationLevel(properties.level)

	if (!message || !level) {
		return failure({
			code: "invalid-properties",
			message: "desktop.terminal requires non-empty message and valid level.",
			source: "event",
			rawType,
			raw: properties,
		})
	}

	const title = toNonEmptyString(properties.title)
	const sessionID = toNonEmptyString(properties.sessionID)
	const identity = createIdentity({
		explicitID: toNonEmptyString(properties.id),
		explicitDedupeKey: toNonEmptyString(properties.dedupeKey),
		fallbackNotificationID: `desktop-terminal:${sessionID ?? "global"}:${level}:${message}`,
		fallbackDedupeKey: `desktop-terminal:${sessionID ?? "global"}:${level}:${message}`,
	})

	const base = createIntentBase({
		channel: NotificationChannel.DesktopTerminal,
		origin: {
			source: "event",
			rawType,
		},
		trustLevel: NotificationTrustLevel.Trusted,
		notificationId: identity.notificationId,
		dedupeKey: identity.dedupeKey,
		capabilityByChannel,
		timeoutMsByChannel,
	})

	return success({
		...base,
		semanticIntent: DesktopTerminalSemanticIntent.Generic,
		payload: {
			title,
			message,
			level,
			sessionID,
		},
	})
}

function normalizeMCPChannelEvent(
	properties: Record<string, unknown>,
	capabilityByChannel: NotificationCapabilityByChannel,
	timeoutMsByChannel: NotificationTimeoutByChannel,
): NormalizedNotificationParseResult {
	const server = toNonEmptyString(properties.server)
	const message = toNonEmptyString(properties.message)
	const level = toNotificationLevel(properties.level)
	const source = toNonEmptyString(properties.source)
	const trust = toNonEmptyString(properties.trust)

	if (!server || !message || !level || !source || !trust) {
		return failure({
			code: "invalid-properties",
			message:
				"notification.mcp.channel requires server, message, level, source, and trust fields.",
			source: "event",
			rawType: "notification.mcp.channel",
			raw: properties,
		})
	}

	if (source !== "mcp.server" && source !== "host.bridge") {
		return failure({
			code: "invalid-properties",
			message: `notification.mcp.channel source must be "mcp.server" or "host.bridge", received "${source}".`,
			source: "event",
			rawType: "notification.mcp.channel",
			raw: properties,
		})
	}

	if (trust !== NotificationTrustLevel.Trusted && trust !== NotificationTrustLevel.Untrusted) {
		return failure({
			code: "invalid-properties",
			message: `notification.mcp.channel trust must be "${NotificationTrustLevel.Trusted}" or "${NotificationTrustLevel.Untrusted}".`,
			source: "event",
			rawType: "notification.mcp.channel",
			raw: properties,
		})
	}

	const identity = createIdentity({
		explicitID: toNonEmptyString(properties.id),
		explicitDedupeKey: toNonEmptyString(properties.dedupeKey),
		fallbackNotificationID: `mcp-channel:${source}:${server}:${level}:${message}`,
		fallbackDedupeKey: `mcp-channel:${source}:${server}:${level}:${message}`,
	})

	const base = createIntentBase({
		channel: NotificationChannel.MCPChannel,
		origin: {
			source: "event",
			rawType: "notification.mcp.channel",
		},
		trustLevel: trust,
		notificationId: identity.notificationId,
		dedupeKey: identity.dedupeKey,
		capabilityByChannel,
		timeoutMsByChannel,
	})

	return success({
		...base,
		payload: {
			server,
			message,
			level,
			source,
			trust,
		},
	})
}

function normalizeLegacySessionReadyEvent(
	rawType: "session.status" | "session.idle",
	properties: Record<string, unknown>,
	capabilityByChannel: NotificationCapabilityByChannel,
	timeoutMsByChannel: NotificationTimeoutByChannel,
): NormalizedNotificationParseResult {
	const sessionID = toNonEmptyString(properties.sessionID)
	if (!sessionID) {
		return failure({
			code: "invalid-properties",
			message: `${rawType} requires a non-empty sessionID.`,
			source: "event",
			rawType,
			raw: properties,
		})
	}

	if (rawType === "session.status") {
		const status = toRecord(properties.status)
		const statusType = toNonEmptyString(status?.type)
		if (statusType !== "idle") {
			return failure({
				code: "unsupported-type",
				message: "session.status is only normalized when status.type is idle.",
				source: "event",
				rawType,
				raw: properties,
			})
		}
	}

	const dedupeKey = `session-ready:${sessionID}`
	const identity = createIdentity({
		explicitID: toNonEmptyString(properties.id),
		explicitDedupeKey: toNonEmptyString(properties.dedupeKey),
		fallbackNotificationID: dedupeKey,
		fallbackDedupeKey: dedupeKey,
	})

	const base = createIntentBase({
		channel: NotificationChannel.DesktopTerminal,
		origin: {
			source: "event",
			rawType,
		},
		trustLevel: NotificationTrustLevel.Trusted,
		notificationId: identity.notificationId,
		dedupeKey: identity.dedupeKey,
		capabilityByChannel,
		timeoutMsByChannel,
	})

	return success({
		...base,
		semanticIntent: DesktopTerminalSemanticIntent.SessionReady,
		payload: {
			title: "Ready for review",
			message: "OpenCode task is ready for review",
			level: NotificationLevel.Info,
			sessionID,
		},
	})
}

function normalizeLegacySessionErrorEvent(
	properties: Record<string, unknown>,
	capabilityByChannel: NotificationCapabilityByChannel,
	timeoutMsByChannel: NotificationTimeoutByChannel,
): NormalizedNotificationParseResult {
	const sessionID = toNonEmptyString(properties.sessionID)
	if (!sessionID) {
		return failure({
			code: "invalid-properties",
			message: "session.error requires a non-empty sessionID.",
			source: "event",
			rawType: "session.error",
			raw: properties,
		})
	}

	const errorMessage = toLegacySessionErrorMessage(properties.error)

	const dedupeKey = `session-error:${sessionID}`
	const identity = createIdentity({
		explicitID: toNonEmptyString(properties.id),
		explicitDedupeKey: toNonEmptyString(properties.dedupeKey),
		fallbackNotificationID: dedupeKey,
		fallbackDedupeKey: dedupeKey,
	})

	const base = createIntentBase({
		channel: NotificationChannel.DesktopTerminal,
		origin: {
			source: "event",
			rawType: "session.error",
		},
		trustLevel: NotificationTrustLevel.Trusted,
		notificationId: identity.notificationId,
		dedupeKey: identity.dedupeKey,
		capabilityByChannel,
		timeoutMsByChannel,
	})

	return success({
		...base,
		semanticIntent: DesktopTerminalSemanticIntent.SessionError,
		payload: {
			title: "Something went wrong",
			message: errorMessage,
			level: NotificationLevel.Error,
			sessionID,
		},
	})
}

function normalizeLegacyPermissionEvent(
	rawType: "permission.updated" | "permission.asked",
	properties: Record<string, unknown>,
	capabilityByChannel: NotificationCapabilityByChannel,
	timeoutMsByChannel: NotificationTimeoutByChannel,
): NormalizedNotificationParseResult {
	const requestID = toNonEmptyString(properties.id)
	const dedupeKey = requestID ? `permission:request:${requestID}` : undefined
	const identity = createIdentity({
		explicitID: requestID,
		explicitDedupeKey: toNonEmptyString(properties.dedupeKey),
		fallbackNotificationID: requestID ? `permission:request:${requestID}` : `permission:${rawType}`,
		fallbackDedupeKey: dedupeKey,
	})

	const base = createIntentBase({
		channel: NotificationChannel.DesktopTerminal,
		origin: {
			source: "event",
			rawType,
		},
		trustLevel: NotificationTrustLevel.Trusted,
		notificationId: identity.notificationId,
		dedupeKey: identity.dedupeKey,
		capabilityByChannel,
		timeoutMsByChannel,
	})

	return success({
		...base,
		semanticIntent: DesktopTerminalSemanticIntent.Permission,
		payload: {
			title: "Waiting for you",
			message: "OpenCode needs your input",
			level: NotificationLevel.Warning,
			sessionID: toNonEmptyString(properties.sessionID),
		},
	})
}

function buildLegacyQuestionDedupeKey(properties: Record<string, unknown>): string | undefined {
	const sessionID = toNonEmptyString(properties.sessionID)
	const requestID = toNonEmptyString(properties.id)
	const tool = toRecord(properties.tool)
	const toolCallID = toNonEmptyString(tool?.callID)

	if (sessionID && toolCallID) {
		return `question:${sessionID}:${toolCallID}`
	}

	if (sessionID && requestID) {
		return `question:${sessionID}:request:${requestID}`
	}

	return undefined
}

function normalizeLegacyQuestionAskedEvent(
	properties: Record<string, unknown>,
	capabilityByChannel: NotificationCapabilityByChannel,
	timeoutMsByChannel: NotificationTimeoutByChannel,
): NormalizedNotificationParseResult {
	const sessionID = toNonEmptyString(properties.sessionID)
	const requestID = toNonEmptyString(properties.id)
	const dedupeKey = buildLegacyQuestionDedupeKey(properties)
	const identity = createIdentity({
		explicitID: requestID,
		explicitDedupeKey: toNonEmptyString(properties.dedupeKey),
		fallbackNotificationID: dedupeKey ?? `question:${sessionID ?? "unknown"}:legacy-event`,
		fallbackDedupeKey: dedupeKey,
	})

	const base = createIntentBase({
		channel: NotificationChannel.DesktopTerminal,
		origin: {
			source: "event",
			rawType: "question.asked",
		},
		trustLevel: NotificationTrustLevel.Trusted,
		notificationId: identity.notificationId,
		dedupeKey: identity.dedupeKey,
		capabilityByChannel,
		timeoutMsByChannel,
	})

	return success({
		...base,
		semanticIntent: DesktopTerminalSemanticIntent.Question,
		payload: {
			title: "Question for you",
			message: "OpenCode needs your input",
			level: NotificationLevel.Warning,
			sessionID,
		},
	})
}

export function normalizeNotificationEvent(
	rawEvent: unknown,
	options: NormalizeNotificationOptions = {},
): NormalizedNotificationParseResult {
	const event = toRecord(rawEvent)
	if (!event) {
		return failure({
			code: "invalid-envelope",
			message: "Notification event must be an object.",
			source: "event",
			raw: rawEvent,
		})
	}

	const rawType = toNonEmptyString(event.type)
	if (!rawType) {
		return failure({
			code: "invalid-envelope",
			message: "Notification event requires a non-empty type.",
			source: "event",
			raw: rawEvent,
		})
	}

	const properties = toRecord(event.properties)
	if (!properties) {
		return failure({
			code: "invalid-properties",
			message: `Notification event "${rawType}" requires an object properties payload.`,
			source: "event",
			rawType,
			raw: rawEvent,
		})
	}

	const capabilityByChannel = normalizeNotificationCapabilities(options.capabilityByChannel)
	const timeoutMsByChannel = normalizeNotificationTimeouts(options.timeoutMsByChannel)

	switch (rawType) {
		case NotificationTaskSystemEventType:
			return normalizeTaskSystemEvent(properties, capabilityByChannel, timeoutMsByChannel)
		case "notification.sdk.system":
			return normalizeSDKSystemEvent(properties, capabilityByChannel, timeoutMsByChannel)
		case "notification.mcp.channel":
			return normalizeMCPChannelEvent(properties, capabilityByChannel, timeoutMsByChannel)
		case "notification.desktop.terminal":
			return normalizeDesktopTerminalEvent(
				rawType,
				properties,
				capabilityByChannel,
				timeoutMsByChannel,
			)
		case "notification.ui.toast":
		case "tui.toast.show":
			return normalizeUIToastEvent(rawType, properties, capabilityByChannel, timeoutMsByChannel)
		case "session.status":
			return normalizeLegacySessionReadyEvent(
				"session.status",
				properties,
				capabilityByChannel,
				timeoutMsByChannel,
			)
		case "session.idle":
			return normalizeLegacySessionReadyEvent(
				"session.idle",
				properties,
				capabilityByChannel,
				timeoutMsByChannel,
			)
		case "session.error":
			return normalizeLegacySessionErrorEvent(properties, capabilityByChannel, timeoutMsByChannel)
		case "permission.updated":
			return normalizeLegacyPermissionEvent(
				"permission.updated",
				properties,
				capabilityByChannel,
				timeoutMsByChannel,
			)
		case "permission.asked":
			return normalizeLegacyPermissionEvent(
				"permission.asked",
				properties,
				capabilityByChannel,
				timeoutMsByChannel,
			)
		case "question.asked":
			return normalizeLegacyQuestionAskedEvent(properties, capabilityByChannel, timeoutMsByChannel)
		default:
			return failure({
				code: "unsupported-type",
				message: `Unsupported notification event type: "${rawType}".`,
				source: "event",
				rawType,
				raw: rawEvent,
			})
	}
}

export function normalizeNotificationToolExecuteBefore(
	rawInput: unknown,
	options: NormalizeNotificationOptions = {},
): NormalizedNotificationParseResult {
	const input = toRecord(rawInput)
	if (!input) {
		return failure({
			code: "invalid-tool-input",
			message: "tool.execute.before payload must be an object.",
			source: "tool.execute.before",
			raw: rawInput,
		})
	}

	const tool = toNonEmptyString(input.tool)
	if (tool !== "question") {
		return failure({
			code: "unsupported-type",
			message: `Unsupported tool.execute.before notification source: "${tool ?? "<missing>"}".`,
			source: "tool.execute.before",
			rawType: tool,
			raw: rawInput,
		})
	}

	const sessionID = toNonEmptyString(input.sessionID)
	const callID = toNonEmptyString(input.callID)
	const dedupeKey = sessionID && callID ? `question:${sessionID}:${callID}` : undefined
	const fallbackNotificationID = dedupeKey ?? `question:${sessionID ?? "unknown"}:legacy-tool`

	const identity = createIdentity({
		explicitID: toNonEmptyString(input.id),
		explicitDedupeKey: toNonEmptyString(input.dedupeKey),
		fallbackNotificationID,
		fallbackDedupeKey: dedupeKey,
	})

	const capabilityByChannel = normalizeNotificationCapabilities(options.capabilityByChannel)
	const timeoutMsByChannel = normalizeNotificationTimeouts(options.timeoutMsByChannel)

	const base = createIntentBase({
		channel: NotificationChannel.DesktopTerminal,
		origin: {
			source: "tool.execute.before",
			rawType: "tool.execute.before:question",
		},
		trustLevel: NotificationTrustLevel.Trusted,
		notificationId: identity.notificationId,
		dedupeKey: identity.dedupeKey,
		capabilityByChannel,
		timeoutMsByChannel,
	})

	return success({
		...base,
		semanticIntent: DesktopTerminalSemanticIntent.Question,
		payload: {
			title: "Question for you",
			message: "OpenCode needs your input",
			level: NotificationLevel.Warning,
			sessionID,
		},
	})
}

export function normalizeNotificationBoundaryInput(
	input: NormalizeNotificationBoundaryInput,
	options?: NormalizeNotificationOptions,
): NormalizedNotificationParseResult {
	if (input.source === "event") {
		return normalizeNotificationEvent(input.value, options)
	}

	return normalizeNotificationToolExecuteBefore(input.value, options)
}
