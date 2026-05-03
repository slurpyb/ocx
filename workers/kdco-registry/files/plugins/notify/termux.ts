import { TimeoutError, withTimeout } from "../kdco-primitives/with-timeout"

export interface TermuxNotificationPayload {
	title: string
	body: string
}

export interface TermuxNotificationConfig {
	enabled: boolean
	notificationCommand: string
	launchCommand: string
	launchActivity: string
	timeoutMs: number
}

type EnvironmentVariables = Record<string, string | undefined>
type TermuxProcess = {
	exited: Promise<number>
	kill?: () => void
}
type SpawnTermuxProcess = (command: string[]) => TermuxProcess

type TermuxExecutionOptions = {
	env?: EnvironmentVariables
	spawnProcess?: SpawnTermuxProcess
}

const TERMUX_PREFIX_MARKER = "/com.termux/"

const spawnTermuxWithBun: SpawnTermuxProcess = (command) =>
	Bun.spawn(command, {
		stdout: "ignore",
		stderr: "ignore",
	})

function hasNonEmptyEnvValue(value: string | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0
}

export function isTermuxEnvironment(env: EnvironmentVariables = process.env): boolean {
	if (!hasNonEmptyEnvValue(env.TERMUX_VERSION)) return false
	if (!hasNonEmptyEnvValue(env.PREFIX)) return false

	return `/${env.PREFIX?.trim()}/`.includes(TERMUX_PREFIX_MARKER)
}

export function buildTermuxLaunchAction(config: TermuxNotificationConfig): string {
	return `${config.launchCommand} start -n ${config.launchActivity}`
}

export function buildTermuxNotificationArgs(
	payload: TermuxNotificationPayload,
	config: TermuxNotificationConfig,
): string[] {
	return [
		"--title",
		payload.title,
		"--content",
		payload.body,
		"--action",
		buildTermuxLaunchAction(config),
	]
}

export async function sendTermuxNotification(
	payload: TermuxNotificationPayload,
	config: TermuxNotificationConfig,
	options?: TermuxExecutionOptions,
): Promise<boolean> {
	if (!config.enabled) return false
	if (!isTermuxEnvironment(options?.env)) return false

	const spawnProcess = options?.spawnProcess ?? spawnTermuxWithBun

	try {
		const proc = spawnProcess([
			config.notificationCommand,
			...buildTermuxNotificationArgs(payload, config),
		])

		try {
			const exitCode = await withTimeout(
				proc.exited,
				config.timeoutMs,
				"termux-notification timed out",
			)
			return exitCode === 0
		} catch (error) {
			if (error instanceof TimeoutError) {
				try {
					proc.kill?.()
				} catch {
					// best effort cleanup
				}
			}

			return false
		}
	} catch {
		return false
	}
}
