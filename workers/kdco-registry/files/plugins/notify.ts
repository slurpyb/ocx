/**
 * notify
 * Native OS notifications for OpenCode
 *
 * Philosophy: "Notify the human when the AI needs them back, not for every micro-event."
 *
 * Features:
 * - Uses cmux native notifications when running inside cmux
 * - Auto-detects terminal emulator (Ghostty, Kitty, iTerm, WezTerm, etc.)
 * - Suppresses notifications when terminal is focused (like Ghostty does)
 * - Click notification to focus terminal
 * - Parent session only by default (no spam from sub-tasks)
 *
 * Uses cmux CLI first (if available), then node-notifier fallback:
 * - cmux: `cmux notify --title ... --subtitle ... --body ...`
 * - macOS: terminal-notifier (native NSUserNotificationCenter)
 * - Windows: SnoreToast (native toast notifications)
 * - Linux: notify-send (native desktop notifications)
 */

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"
// @ts-expect-error - installed at runtime by OCX
import detectTerminal from "detect-terminal"
import {
	classifyNotificationContractHandshake,
	type NotificationContractCompatErrorIssue,
	type NotificationContractCompatWarningIssue,
} from "../../../../packages/cli/src/notify/contract-compat"
import { isPlainObject } from "../../../../packages/cli/src/utils/type-guards"
import type { OpencodeClient } from "./kdco-primitives/types"
import {
	type DesktopTransportPayload,
	type NotifyBackendRuntime,
	sendNotificationWithFallback,
} from "./notify/backend"
import { canUseCmuxNotification } from "./notify/cmux"
import {
	createNotificationCapabilityByChannelFromNegotiatedState,
	DEFAULT_NOTIFICATION_CAPABILITY_BY_CHANNEL,
	DesktopTerminalSemanticIntent,
	type NormalizedNotificationIntent,
	type NormalizedNotificationParseFailure,
	type NormalizeNotificationBoundaryInput,
	type NormalizeNotificationOptions,
	NotificationChannel,
	NotificationHandlingMode,
	NotificationLevel,
	normalizeNotificationBoundaryInput,
} from "./notify/normalize"

interface NotifyConfig {
	/** Notify for child/sub-session events (default: false) */
	notifyChildSessions: boolean
	/** Sound configuration per event type */
	sounds: {
		idle: string
		error: string
		permission: string
		question?: string
	}
	/** Quiet hours configuration */
	quietHours: {
		enabled: boolean
		start: string // "HH:MM" format
		end: string // "HH:MM" format
	}
	/** Override terminal detection (optional) */
	terminal?: string
}

interface TerminalInfo {
	name: string | null
	bundleId: string | null
	processName: string | null
}

const DEFAULT_CONFIG: NotifyConfig = {
	notifyChildSessions: false,
	sounds: {
		idle: "Glass",
		error: "Basso",
		permission: "Submarine",
	},
	quietHours: {
		enabled: false,
		start: "22:00",
		end: "08:00",
	},
}

// Terminal name to macOS process name mapping (for focus detection)
const TERMINAL_PROCESS_NAMES: Record<string, string> = {
	ghostty: "Ghostty",
	kitty: "kitty",
	iterm: "iTerm2",
	iterm2: "iTerm2",
	wezterm: "WezTerm",
	alacritty: "Alacritty",
	terminal: "Terminal",
	apple_terminal: "Terminal",
	hyper: "Hyper",
	warp: "Warp",
	vscode: "Code",
	"vscode-insiders": "Code - Insiders",
}

// ==========================================
// CONFIGURATION
// ==========================================

async function loadConfig(): Promise<NotifyConfig> {
	const configPath = path.join(os.homedir(), ".config", "opencode", "kdco-notify.json")

	try {
		const content = await fs.readFile(configPath, "utf8")
		const userConfig = JSON.parse(content) as Partial<NotifyConfig>

		// Merge with defaults
		return {
			...DEFAULT_CONFIG,
			...userConfig,
			sounds: {
				...DEFAULT_CONFIG.sounds,
				...userConfig.sounds,
			},
			quietHours: {
				...DEFAULT_CONFIG.quietHours,
				...userConfig.quietHours,
			},
		}
	} catch {
		// Config doesn't exist or is invalid, use defaults
		return DEFAULT_CONFIG
	}
}

// ==========================================
// TERMINAL DETECTION (macOS)
// ==========================================

async function runOsascript(script: string): Promise<string | null> {
	if (process.platform !== "darwin") return null

	try {
		const proc = Bun.spawn(["osascript", "-e", script], {
			stdout: "pipe",
			stderr: "pipe",
		})
		const output = await new Response(proc.stdout).text()
		return output.trim()
	} catch {
		return null
	}
}

async function getBundleId(appName: string): Promise<string | null> {
	return runOsascript(`id of application "${appName}"`)
}

async function getFrontmostApp(): Promise<string | null> {
	return runOsascript(
		'tell application "System Events" to get name of first application process whose frontmost is true',
	)
}

async function detectTerminalInfo(config: NotifyConfig): Promise<TerminalInfo> {
	// Use config override if provided
	const terminalName = config.terminal || detectTerminal() || null

	if (!terminalName) {
		return { name: null, bundleId: null, processName: null }
	}

	// Get process name for focus detection
	const processName = TERMINAL_PROCESS_NAMES[terminalName.toLowerCase()] || terminalName

	// Dynamically get bundle ID from macOS (no hardcoding!)
	const bundleId = await getBundleId(processName)

	return {
		name: terminalName,
		bundleId,
		processName,
	}
}

async function isTerminalFocused(terminalInfo: TerminalInfo): Promise<boolean> {
	if (!terminalInfo.processName) return false
	if (process.platform !== "darwin") return false

	const frontmost = await getFrontmostApp()
	if (!frontmost) return false

	// Case-insensitive comparison
	return frontmost.toLowerCase() === terminalInfo.processName.toLowerCase()
}

// ==========================================
// QUIET HOURS CHECK
// ==========================================

function isQuietHours(config: NotifyConfig): boolean {
	if (!config.quietHours.enabled) return false

	const now = new Date()
	const currentMinutes = now.getHours() * 60 + now.getMinutes()

	const [startHour, startMin] = config.quietHours.start.split(":").map(Number)
	const [endHour, endMin] = config.quietHours.end.split(":").map(Number)

	const startMinutes = startHour * 60 + startMin
	const endMinutes = endHour * 60 + endMin

	// Handle overnight quiet hours (e.g., 22:00 - 08:00)
	if (startMinutes > endMinutes) {
		return currentMinutes >= startMinutes || currentMinutes < endMinutes
	}

	return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

// ==========================================
// PARENT SESSION DETECTION
// ==========================================

async function isParentSession(client: OpencodeClient, sessionID: string): Promise<boolean> {
	try {
		const session = await client.session.get({ path: { id: sessionID } })
		// No parentID means this IS the parent/root session
		return !session.data?.parentID
	} catch {
		// If we can't fetch, assume it's a parent to be safe (notify rather than miss)
		return true
	}
}

// ==========================================
// NOTIFICATION SENDER
// ==========================================

interface NotificationOptions {
	title: string
	message: string
	subtitle?: string
	cmuxBody?: string
	sound: string
	terminalBundleId?: string | null
}

const QUESTION_DEDUPE_WINDOW_MS = 1500
const READY_DEDUPE_WINDOW_MS = 1500
const PERMISSION_DEDUPE_WINDOW_MS = 1500

const NORMALIZE_NOTIFICATION_POLICY: NormalizeNotificationOptions = {
	capabilityByChannel: DEFAULT_NOTIFICATION_CAPABILITY_BY_CHANNEL,
}

export type NotifyRuntimePolicyResolution =
	| {
			compatible: true
			source: "default" | "host-handshake"
			normalizePolicy: NormalizeNotificationOptions
			warnings: NotificationContractCompatWarningIssue[]
	  }
	| {
			compatible: false
			source: "host-handshake"
			errors: NotificationContractCompatErrorIssue[]
			warnings: NotificationContractCompatWarningIssue[]
	  }

export function resolveNotificationRuntimePolicyFromHostHandshake(
	hostNotificationContractHandshake: unknown,
): NotifyRuntimePolicyResolution {
	if (hostNotificationContractHandshake === undefined) {
		return {
			compatible: true,
			source: "default",
			normalizePolicy: NORMALIZE_NOTIFICATION_POLICY,
			warnings: [],
		}
	}

	const compatibility = classifyNotificationContractHandshake(hostNotificationContractHandshake)
	if (!compatibility.compatible) {
		return {
			compatible: false,
			source: "host-handshake",
			errors: compatibility.errors,
			warnings: compatibility.warnings,
		}
	}

	return {
		compatible: true,
		source: "host-handshake",
		normalizePolicy: {
			capabilityByChannel: createNotificationCapabilityByChannelFromNegotiatedState(
				compatibility.negotiatedStateByChannel,
			),
		},
		warnings: compatibility.warnings,
	}
}

function readHostNotificationContractHandshake(ctx: unknown): unknown {
	if (!isPlainObject(ctx)) {
		return undefined
	}

	if (!Object.hasOwn(ctx, "notificationContractHandshake")) {
		return undefined
	}

	return (ctx as Record<string, unknown>).notificationContractHandshake
}

function reportHostHandshakeWarnings(warnings: NotificationContractCompatWarningIssue[]): void {
	for (const warning of warnings) {
		console.warn(
			`[notify] Host notification handshake warning: ${warning.code} (${warning.message})`,
		)
	}
}

export async function processBoundaryInput(
	input: NormalizeNotificationBoundaryInput,
	options: {
		normalizePolicy?: NormalizeNotificationOptions
		routeNormalizedIntent: (intent: NormalizedNotificationIntent) => Promise<void>
		handleParseFailure?: (failure: NormalizedNotificationParseFailure) => void
	},
): Promise<void> {
	const parsed = normalizeNotificationBoundaryInput(input, options.normalizePolicy)
	if (!parsed.ok) {
		const onParseFailure = options.handleParseFailure ?? handleNormalizeParseFailure
		onParseFailure(parsed)
		return
	}

	await options.routeNormalizedIntent(parsed.intent)
}

const SESSION_READY_TITLE = "Ready for review"
const SESSION_ERROR_TITLE = "Something went wrong"
const PERMISSION_TITLE = "Waiting for you"
const QUESTION_TITLE = "Question for you"

type RecentNotifications = Map<string, number>

type DesktopTerminalIntent = Extract<
	NormalizedNotificationIntent,
	{ channel: typeof NotificationChannel.DesktopTerminal }
>

function shouldSendDedupedNotification(
	recentNotifications: RecentNotifications,
	dedupeKey: string,
	windowMs: number,
	nowMs = Date.now(),
): boolean {
	for (const [key, timestamp] of recentNotifications) {
		if (nowMs - timestamp >= windowMs) {
			recentNotifications.delete(key)
		}
	}

	const lastSentAt = recentNotifications.get(dedupeKey)
	if (lastSentAt !== undefined && nowMs - lastSentAt < windowMs) {
		return false
	}

	recentNotifications.set(dedupeKey, nowMs)
	return true
}

function handleNormalizeParseFailure(failure: NormalizedNotificationParseFailure): void {
	if (failure.code === "unsupported-type") {
		return
	}

	const rawTypeLabel = failure.rawType ? ` type=${failure.rawType}` : ""
	console.warn(
		`[notify] Dropping ${failure.source} payload${rawTypeLabel}: ${failure.code} (${failure.message})`,
	)
}

function resolveDesktopSound(level: NotificationLevel, config: NotifyConfig): string {
	switch (level) {
		case NotificationLevel.Error:
			return config.sounds.error
		case NotificationLevel.Warning:
			return config.sounds.permission
		case NotificationLevel.Info:
		case NotificationLevel.Success:
			return config.sounds.idle
	}
}

function resolveDesktopTitle(intent: DesktopTerminalIntent): string {
	if (intent.payload.title) {
		return intent.payload.title
	}

	switch (intent.payload.level) {
		case NotificationLevel.Error:
			return SESSION_ERROR_TITLE
		case NotificationLevel.Warning:
			return "OpenCode notification"
		case NotificationLevel.Info:
		case NotificationLevel.Success:
			return "OpenCode"
	}
}

async function sendNotification(
	options: NotificationOptions,
	runtime: NotifyBackendRuntime,
): Promise<void> {
	const transportPayload: DesktopTransportPayload = {
		title: options.title,
		message: options.message,
		sound: options.sound,
		subtitle: options.subtitle,
		cmuxBody: options.cmuxBody,
		terminalBundleId: options.terminalBundleId,
	}

	await sendNotificationWithFallback(transportPayload, runtime)
}

// ==========================================
// EVENT HANDLERS
// ==========================================

async function handleSessionIdle(
	client: OpencodeClient,
	sessionID: string,
	config: NotifyConfig,
	terminalInfo: TerminalInfo,
	notificationRuntime: NotifyBackendRuntime,
): Promise<void> {
	// Check if we should notify for this session
	if (!config.notifyChildSessions) {
		const isParent = await isParentSession(client, sessionID)
		if (!isParent) return
	}

	// Check quiet hours
	if (isQuietHours(config)) return

	// Check if terminal is focused (suppress notification if user is already looking)
	if (await isTerminalFocused(terminalInfo)) return

	// Get session info for context
	let sessionTitle = "Task"
	try {
		const session = await client.session.get({ path: { id: sessionID } })
		if (session.data?.title) {
			sessionTitle = session.data.title.slice(0, 50)
		}
	} catch {
		// Use default title
	}

	await sendNotification(
		{
			title: SESSION_READY_TITLE,
			message: sessionTitle,
			subtitle: sessionTitle,
			cmuxBody: "OpenCode task is ready for review",
			sound: config.sounds.idle,
			terminalBundleId: terminalInfo.bundleId,
		},
		notificationRuntime,
	)
}

async function handleSessionError(
	client: OpencodeClient,
	sessionID: string,
	error: string | undefined,
	config: NotifyConfig,
	terminalInfo: TerminalInfo,
	notificationRuntime: NotifyBackendRuntime,
): Promise<void> {
	// Check if we should notify for this session
	if (!config.notifyChildSessions) {
		const isParent = await isParentSession(client, sessionID)
		if (!isParent) return
	}

	// Check quiet hours
	if (isQuietHours(config)) return

	// Check if terminal is focused (suppress notification if user is already looking)
	if (await isTerminalFocused(terminalInfo)) return

	const errorMessage = error?.slice(0, 100) || "Something went wrong"

	await sendNotification(
		{
			title: SESSION_ERROR_TITLE,
			message: errorMessage,
			sound: config.sounds.error,
			terminalBundleId: terminalInfo.bundleId,
		},
		notificationRuntime,
	)
}

async function handlePermissionUpdated(
	config: NotifyConfig,
	terminalInfo: TerminalInfo,
	notificationRuntime: NotifyBackendRuntime,
): Promise<void> {
	// Always notify for permission events - AI is blocked waiting for human
	// No parent check needed: permissions always need human attention

	// Check quiet hours
	if (isQuietHours(config)) return

	// Check if terminal is focused (suppress notification if user is already looking)
	if (await isTerminalFocused(terminalInfo)) return

	await sendNotification(
		{
			title: PERMISSION_TITLE,
			message: "OpenCode needs your input",
			sound: config.sounds.permission,
			terminalBundleId: terminalInfo.bundleId,
		},
		notificationRuntime,
	)
}

async function handleQuestionAsked(
	config: NotifyConfig,
	terminalInfo: TerminalInfo,
	notificationRuntime: NotifyBackendRuntime,
): Promise<void> {
	// Guard: quiet hours only (no focus check for questions - tmux workflow)
	if (isQuietHours(config)) return

	const sound = config.sounds.question ?? config.sounds.permission

	await sendNotification(
		{
			title: QUESTION_TITLE,
			message: "OpenCode needs your input",
			sound,
			terminalBundleId: terminalInfo.bundleId,
		},
		notificationRuntime,
	)
}

async function handleDesktopTerminalNotification(
	intent: DesktopTerminalIntent,
	config: NotifyConfig,
	terminalInfo: TerminalInfo,
	notificationRuntime: NotifyBackendRuntime,
): Promise<void> {
	if (isQuietHours(config)) return

	if (await isTerminalFocused(terminalInfo)) return

	await sendNotification(
		{
			title: resolveDesktopTitle(intent),
			message: intent.payload.message,
			sound: resolveDesktopSound(intent.payload.level, config),
			terminalBundleId: terminalInfo.bundleId,
		},
		notificationRuntime,
	)
}

// ==========================================
// PLUGIN EXPORT
// ==========================================

export const NotifyPlugin: Plugin = async (ctx) => {
	const { client } = ctx
	const policyResolution = resolveNotificationRuntimePolicyFromHostHandshake(
		readHostNotificationContractHandshake(ctx),
	)

	if (!policyResolution.compatible) {
		const issueCodes = policyResolution.errors.map((issue) => issue.code).join(", ") || "unknown"
		throw new Error(`Incompatible notification contract handshake: ${issueCodes}`)
	}

	if (policyResolution.warnings.length > 0) {
		reportHostHandshakeWarnings(policyResolution.warnings)
	}

	const normalizePolicy = policyResolution.normalizePolicy
	const shouldEnforceHostFailClosedRuntime = policyResolution.source === "host-handshake"

	// Load config once at startup
	const config = await loadConfig()

	// Detect terminal once at startup (cached for performance)
	const terminalInfo = await detectTerminalInfo(config)
	const notificationRuntime: NotifyBackendRuntime = {
		preferCmux: canUseCmuxNotification(),
	}
	const recentQuestionNotifications: RecentNotifications = new Map()
	const recentReadyNotifications: RecentNotifications = new Map()
	const recentPermissionNotifications: RecentNotifications = new Map()

	const notifyQuestionIfNeeded = async (dedupeKey: string | undefined): Promise<void> => {
		if (
			dedupeKey &&
			!shouldSendDedupedNotification(
				recentQuestionNotifications,
				dedupeKey,
				QUESTION_DEDUPE_WINDOW_MS,
			)
		) {
			return
		}

		await handleQuestionAsked(config, terminalInfo, notificationRuntime)
	}

	const notifySessionReadyIfNeeded = async (
		sessionID: string | undefined,
		dedupeKey: string | undefined,
	): Promise<void> => {
		if (!sessionID) return

		if (
			dedupeKey &&
			!shouldSendDedupedNotification(recentReadyNotifications, dedupeKey, READY_DEDUPE_WINDOW_MS)
		) {
			return
		}

		await handleSessionIdle(
			client as OpencodeClient,
			sessionID,
			config,
			terminalInfo,
			notificationRuntime,
		)
	}

	const notifyPermissionIfNeeded = async (dedupeKey: string | undefined): Promise<void> => {
		if (
			dedupeKey &&
			!shouldSendDedupedNotification(
				recentPermissionNotifications,
				dedupeKey,
				PERMISSION_DEDUPE_WINDOW_MS,
			)
		) {
			return
		}

		await handlePermissionUpdated(config, terminalInfo, notificationRuntime)
	}

	const routeNormalizedIntent = async (intent: NormalizedNotificationIntent): Promise<void> => {
		if (intent.channel !== NotificationChannel.DesktopTerminal) {
			return
		}

		switch (intent.handlingMode) {
			case NotificationHandlingMode.Drop:
				return
			case NotificationHandlingMode.FailClosed:
				if (shouldEnforceHostFailClosedRuntime) {
					console.warn(
						`[notify] Dropping ${intent.origin.rawType} notification due host fail_closed policy on ${intent.channel} (state=${intent.capabilityState}).`,
					)
					return
				}
				break
			case NotificationHandlingMode.Deliver:
				break
		}

		switch (intent.semanticIntent) {
			case DesktopTerminalSemanticIntent.SessionReady: {
				await notifySessionReadyIfNeeded(intent.payload.sessionID, intent.dedupeKey)
				return
			}
			case DesktopTerminalSemanticIntent.SessionError: {
				if (!intent.payload.sessionID) return
				await handleSessionError(
					client as OpencodeClient,
					intent.payload.sessionID,
					intent.payload.message,
					config,
					terminalInfo,
					notificationRuntime,
				)
				return
			}
			case DesktopTerminalSemanticIntent.Permission: {
				await notifyPermissionIfNeeded(intent.dedupeKey)
				return
			}
			case DesktopTerminalSemanticIntent.Question: {
				await notifyQuestionIfNeeded(intent.dedupeKey)
				return
			}
			case DesktopTerminalSemanticIntent.Generic: {
				await handleDesktopTerminalNotification(intent, config, terminalInfo, notificationRuntime)
				return
			}
		}
	}

	return {
		"tool.execute.before": async (input: unknown) => {
			await processBoundaryInput(
				{
					source: "tool.execute.before",
					value: input,
				},
				{
					normalizePolicy,
					routeNormalizedIntent,
					handleParseFailure: handleNormalizeParseFailure,
				},
			)
		},
		event: async ({ event }: { event: Event }): Promise<void> => {
			await processBoundaryInput(
				{
					source: "event",
					value: event,
				},
				{
					normalizePolicy,
					routeNormalizedIntent,
					handleParseFailure: handleNormalizeParseFailure,
				},
			)
		},
	}
}

export default NotifyPlugin
