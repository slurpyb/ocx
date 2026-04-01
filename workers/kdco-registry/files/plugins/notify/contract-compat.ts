/**
 * Standalone notify contract compatibility logic for shipped plugins.
 *
 * Keep this in sync with packages/cli/src/notify/contract-compat.ts.
 */
function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
	if (value === null || typeof value !== "object") {
		return false
	}

	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

export const NotificationContractID = "opencode.host.notification" as const
export const NotificationContractSchemaVersion = "1.1.0" as const

export const NotificationChannel = {
	UIToast: "ui.toast",
	TaskSystem: "task.system",
	SDKSystem: "sdk.system",
	DesktopTerminal: "desktop.terminal",
	MCPChannel: "mcp.channel",
} as const

export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel]

export const NotificationNegotiatedState = {
	Supported: "supported",
	FallbackApproved: "fallback_approved",
	Unsupported: "unsupported",
	InternalOnly: "internal_only",
} as const

export type NotificationNegotiatedState =
	(typeof NotificationNegotiatedState)[keyof typeof NotificationNegotiatedState]

export const NotificationFallbackMode = {
	None: "none",
	Drop: "drop",
	FailClosed: "fail_closed",
} as const

export type NotificationFallbackMode =
	(typeof NotificationFallbackMode)[keyof typeof NotificationFallbackMode]

export const NotificationCanonicalChannels = Object.values(
	NotificationChannel,
) as readonly NotificationChannel[]

export type NotificationNegotiatedStateByChannel = {
	[channel in NotificationChannel]: NotificationNegotiatedState
}

export type NotificationFallbackModeByChannel = {
	[channel in NotificationChannel]: NotificationFallbackMode
}

type SemverParts = {
	major: number
	minor: number
	patch: number
}

const STRICT_SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

const NotificationCanonicalChannelSet = new Set<string>(NotificationCanonicalChannels)
const NotificationNegotiatedStateSet = new Set<string>(Object.values(NotificationNegotiatedState))

const SupportedSchemaVersionParts = (() => {
	const parsed = parseStrictSemver(NotificationContractSchemaVersion)
	if (!parsed) {
		throw new Error(
			`Invalid NotificationContractSchemaVersion constant: ${NotificationContractSchemaVersion}`,
		)
	}

	return parsed
})()

export type NotificationContractCompatErrorIssue =
	| {
			severity: "error"
			code: "invalid-contract-format"
			path: string
			message: string
	  }
	| {
			severity: "error"
			code: "invalid-contract-id"
			expectedContractID: typeof NotificationContractID
			receivedContractID: string | null
			message: string
	  }
	| {
			severity: "error"
			code: "missing-schema-version"
			message: string
	  }
	| {
			severity: "error"
			code: "invalid-schema-version"
			schemaVersion: string
			message: string
	  }
	| {
			severity: "error"
			code: "unsupported-schema-major"
			supportedMajor: number
			detectedMajor: number
			schemaVersion: string
			message: string
	  }
	| {
			severity: "error"
			code: "missing-required-channel"
			channel: NotificationChannel
			message: string
	  }
	| {
			severity: "error"
			code: "unknown-negotiated-state"
			channel: NotificationChannel
			state: string
			message: string
	  }

export type NotificationContractCompatWarningIssue =
	| {
			severity: "warning"
			code: "newer-schema-minor-or-patch"
			supportedSchemaVersion: typeof NotificationContractSchemaVersion
			receivedSchemaVersion: string
			message: string
	  }
	| {
			severity: "warning"
			code: "unknown-channel-ignored"
			channel: string
			message: string
	  }

export type NotificationContractCompatibilityResult =
	| {
			compatible: true
			contractID: typeof NotificationContractID
			schemaVersion: string
			negotiatedStateByChannel: NotificationNegotiatedStateByChannel
			warnings: NotificationContractCompatWarningIssue[]
	  }
	| {
			compatible: false
			errors: NotificationContractCompatErrorIssue[]
			warnings: NotificationContractCompatWarningIssue[]
	  }

export interface NotificationContractHandshake {
	contract: {
		id: string
		schemaVersion: string
	}
	capabilities: Record<string, { state: string }>
}

export function classifyNotificationContractHandshake(
	handshake: unknown,
): NotificationContractCompatibilityResult {
	const warnings: NotificationContractCompatWarningIssue[] = []

	if (!isPlainObject(handshake)) {
		return incompatible(
			[
				{
					severity: "error",
					code: "invalid-contract-format",
					path: "$",
					message: "Notification contract handshake must be an object.",
				},
			],
			warnings,
		)
	}

	if (!isPlainObject(handshake.contract)) {
		return incompatible(
			[
				{
					severity: "error",
					code: "invalid-contract-format",
					path: "contract",
					message: "Notification contract handshake must include a contract object.",
				},
			],
			warnings,
		)
	}

	const contract = handshake.contract
	const contractID = contract.id

	if (contractID !== NotificationContractID) {
		return incompatible(
			[
				{
					severity: "error",
					code: "invalid-contract-id",
					expectedContractID: NotificationContractID,
					receivedContractID: typeof contractID === "string" ? contractID : null,
					message: `Notification contract id mismatch. Expected "${NotificationContractID}".`,
				},
			],
			warnings,
		)
	}

	if (!Object.hasOwn(contract, "schemaVersion")) {
		return incompatible(
			[
				{
					severity: "error",
					code: "missing-schema-version",
					message: "Notification contract schemaVersion is required.",
				},
			],
			warnings,
		)
	}

	const schemaVersion = contract.schemaVersion
	if (typeof schemaVersion !== "string" || schemaVersion.length === 0) {
		return incompatible(
			[
				{
					severity: "error",
					code: "invalid-schema-version",
					schemaVersion: String(schemaVersion),
					message: "Notification contract schemaVersion must be a non-empty semver string.",
				},
			],
			warnings,
		)
	}

	const parsedSchemaVersion = parseStrictSemver(schemaVersion)
	if (!parsedSchemaVersion) {
		return incompatible(
			[
				{
					severity: "error",
					code: "invalid-schema-version",
					schemaVersion,
					message: "Notification contract schemaVersion must be strict semver (major.minor.patch).",
				},
			],
			warnings,
		)
	}

	if (parsedSchemaVersion.major !== SupportedSchemaVersionParts.major) {
		return incompatible(
			[
				{
					severity: "error",
					code: "unsupported-schema-major",
					supportedMajor: SupportedSchemaVersionParts.major,
					detectedMajor: parsedSchemaVersion.major,
					schemaVersion,
					message:
						`Unsupported notification contract schema major ${parsedSchemaVersion.major}. ` +
						`Expected major ${SupportedSchemaVersionParts.major}.`,
				},
			],
			warnings,
		)
	}

	if (isNewerMinorOrPatch(parsedSchemaVersion, SupportedSchemaVersionParts)) {
		warnings.push({
			severity: "warning",
			code: "newer-schema-minor-or-patch",
			supportedSchemaVersion: NotificationContractSchemaVersion,
			receivedSchemaVersion: schemaVersion,
			message:
				`Notification contract schemaVersion ${schemaVersion} is newer than supported ` +
				`${NotificationContractSchemaVersion}. Continuing with same-major compatibility mode.`,
		})
	}

	if (!isPlainObject(handshake.capabilities)) {
		return incompatible(
			[
				{
					severity: "error",
					code: "invalid-contract-format",
					path: "capabilities",
					message: "Notification contract handshake must include a capabilities object.",
				},
			],
			warnings,
		)
	}

	const capabilities = handshake.capabilities

	for (const channel of Object.keys(capabilities)) {
		if (NotificationCanonicalChannelSet.has(channel)) {
			continue
		}

		warnings.push({
			severity: "warning",
			code: "unknown-channel-ignored",
			channel,
			message: `Notification channel "${channel}" is unknown to this OCX version and will be ignored.`,
		})
	}

	const errors: NotificationContractCompatErrorIssue[] = []
	const parsedStates: Partial<NotificationNegotiatedStateByChannel> = {}

	for (const channel of NotificationCanonicalChannels) {
		if (!Object.hasOwn(capabilities, channel)) {
			errors.push({
				severity: "error",
				code: "missing-required-channel",
				channel,
				message: `Missing required notification channel capability "${channel}".`,
			})
			continue
		}

		const capability = capabilities[channel]
		if (!isPlainObject(capability)) {
			errors.push({
				severity: "error",
				code: "invalid-contract-format",
				path: `capabilities.${channel}`,
				message: `Capability entry for channel "${channel}" must be an object.`,
			})
			continue
		}

		const state = capability.state
		if (typeof state !== "string") {
			errors.push({
				severity: "error",
				code: "invalid-contract-format",
				path: `capabilities.${channel}.state`,
				message: `Capability state for channel "${channel}" must be a string.`,
			})
			continue
		}

		if (!NotificationNegotiatedStateSet.has(state)) {
			errors.push({
				severity: "error",
				code: "unknown-negotiated-state",
				channel,
				state,
				message: `Unknown notification negotiated state "${state}" for channel "${channel}".`,
			})
			continue
		}

		parsedStates[channel] = state as NotificationNegotiatedState
	}

	if (errors.length > 0) {
		return incompatible(errors, warnings)
	}

	const negotiatedStateByChannelResult = buildNegotiatedStateByChannel(parsedStates)
	if (!negotiatedStateByChannelResult.compatible) {
		return incompatible(negotiatedStateByChannelResult.errors, warnings)
	}

	return {
		compatible: true,
		contractID: NotificationContractID,
		schemaVersion,
		negotiatedStateByChannel: negotiatedStateByChannelResult.negotiatedStateByChannel,
		warnings,
	}
}

function parseStrictSemver(version: string): SemverParts | null {
	const match = version.match(STRICT_SEMVER_REGEX)
	if (!match) {
		return null
	}

	const majorToken = match[1]
	const minorToken = match[2]
	const patchToken = match[3]
	if (!majorToken || !minorToken || !patchToken) {
		return null
	}

	return {
		major: Number.parseInt(majorToken, 10),
		minor: Number.parseInt(minorToken, 10),
		patch: Number.parseInt(patchToken, 10),
	}
}

function isNewerMinorOrPatch(candidate: SemverParts, supported: SemverParts): boolean {
	if (candidate.major !== supported.major) {
		return false
	}

	if (candidate.minor > supported.minor) {
		return true
	}

	if (candidate.minor < supported.minor) {
		return false
	}

	return candidate.patch > supported.patch
}

function buildNegotiatedStateByChannel(parsedStates: Partial<NotificationNegotiatedStateByChannel>):
	| {
			compatible: true
			negotiatedStateByChannel: NotificationNegotiatedStateByChannel
	  }
	| {
			compatible: false
			errors: NotificationContractCompatErrorIssue[]
	  } {
	const errors: NotificationContractCompatErrorIssue[] = []
	const negotiatedStateByChannel: Partial<NotificationNegotiatedStateByChannel> = {}

	for (const channel of NotificationCanonicalChannels) {
		const state = parsedStates[channel]
		if (state === undefined) {
			errors.push({
				severity: "error",
				code: "missing-required-channel",
				channel,
				message: `Missing required notification channel capability "${channel}".`,
			})
			continue
		}

		negotiatedStateByChannel[channel] = state
	}

	if (errors.length > 0) {
		return {
			compatible: false,
			errors,
		}
	}

	return {
		compatible: true,
		negotiatedStateByChannel: negotiatedStateByChannel as NotificationNegotiatedStateByChannel,
	}
}

function incompatible(
	errors: NotificationContractCompatErrorIssue[],
	warnings: NotificationContractCompatWarningIssue[],
): NotificationContractCompatibilityResult {
	return {
		compatible: false,
		errors,
		warnings,
	}
}

export const ClosedHostDefaultNotificationHandshake: NotificationContractHandshake = {
	contract: {
		id: NotificationContractID,
		schemaVersion: NotificationContractSchemaVersion,
	},
	capabilities: {
		[NotificationChannel.UIToast]: { state: NotificationNegotiatedState.Supported },
		[NotificationChannel.TaskSystem]: { state: NotificationNegotiatedState.Supported },
		[NotificationChannel.SDKSystem]: { state: NotificationNegotiatedState.Unsupported },
		[NotificationChannel.DesktopTerminal]: { state: NotificationNegotiatedState.Unsupported },
		[NotificationChannel.MCPChannel]: { state: NotificationNegotiatedState.InternalOnly },
	},
}

export const ClosedHostDefaultNotificationCompatibility = (() => {
	const compatibility = classifyNotificationContractHandshake(
		ClosedHostDefaultNotificationHandshake,
	)
	if (!compatibility.compatible) {
		const issueCodes = compatibility.errors.map((issue) => issue.code).join(", ") || "unknown"
		throw new Error(
			`Closed host notification contract fixture is invalid. Compatibility errors: ${issueCodes}.`,
		)
	}

	return compatibility
})()

export const ClosedHostDefaultNotificationNegotiatedStateByChannel =
	ClosedHostDefaultNotificationCompatibility.negotiatedStateByChannel

export const ClosedHostDefaultNotificationFallbackModeByChannel: NotificationFallbackModeByChannel =
	{
		[NotificationChannel.UIToast]: NotificationFallbackMode.None,
		[NotificationChannel.TaskSystem]: NotificationFallbackMode.None,
		[NotificationChannel.SDKSystem]: NotificationFallbackMode.Drop,
		[NotificationChannel.DesktopTerminal]: NotificationFallbackMode.FailClosed,
		[NotificationChannel.MCPChannel]: NotificationFallbackMode.FailClosed,
	}

assertClosedHostDefaultFallbackPolicyConsistency({
	negotiatedStateByChannel: ClosedHostDefaultNotificationNegotiatedStateByChannel,
	fallbackModeByChannel: ClosedHostDefaultNotificationFallbackModeByChannel,
})

function assertClosedHostDefaultFallbackPolicyConsistency(input: {
	negotiatedStateByChannel: NotificationNegotiatedStateByChannel
	fallbackModeByChannel: NotificationFallbackModeByChannel
}): void {
	for (const channel of NotificationCanonicalChannels) {
		const state = input.negotiatedStateByChannel[channel]
		const fallbackMode = input.fallbackModeByChannel[channel]

		if (fallbackMode === NotificationFallbackMode.None) {
			if (
				state === NotificationNegotiatedState.Supported ||
				state === NotificationNegotiatedState.FallbackApproved
			) {
				continue
			}

			throw new Error(
				`Closed host notification fallback policy mismatch: channel ${channel} uses fallback mode "${fallbackMode}" but negotiated state is "${state}".`,
			)
		}

		if (
			state === NotificationNegotiatedState.Unsupported ||
			state === NotificationNegotiatedState.InternalOnly
		) {
			continue
		}

		throw new Error(
			`Closed host notification fallback policy mismatch: channel ${channel} uses fallback mode "${fallbackMode}" but negotiated state is "${state}".`,
		)
	}
}
