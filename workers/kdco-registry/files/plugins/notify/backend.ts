// @ts-expect-error - installed at runtime by OCX
import notifier from "node-notifier"
import { type CmuxNotificationPayload, sendCmuxNotification } from "./cmux"

export interface NotifyBackendRuntime {
	preferCmux: boolean
}

export interface DesktopTransportPayload {
	title: string
	message: string
	sound: string
	subtitle?: string
	cmuxBody?: string
	terminalBundleId?: string | null
}

interface NotifyBackendDependencies {
	sendCmuxNotification?: (payload: CmuxNotificationPayload) => Promise<boolean>
	sendNodeNotification?: (payload: Record<string, unknown>) => void
}

function toCmuxNotificationPayload(payload: DesktopTransportPayload): CmuxNotificationPayload {
	return {
		title: payload.title,
		subtitle: payload.subtitle,
		body: payload.cmuxBody ?? payload.message,
	}
}

function toNodeNotificationPayload(payload: DesktopTransportPayload): Record<string, unknown> {
	const nodePayload: Record<string, unknown> = {
		title: payload.title,
		message: payload.message,
		sound: payload.sound,
	}

	if (process.platform === "darwin" && payload.terminalBundleId) {
		nodePayload.activate = payload.terminalBundleId
	}

	return nodePayload
}

export async function sendNotificationWithFallback(
	payload: DesktopTransportPayload,
	runtime: NotifyBackendRuntime,
	dependencies: NotifyBackendDependencies = {},
): Promise<void> {
	const cmuxSender = dependencies.sendCmuxNotification ?? sendCmuxNotification
	const nodeSender =
		dependencies.sendNodeNotification ??
		((nodePayload: Record<string, unknown>) => {
			notifier.notify(nodePayload)
		})

	if (!runtime.preferCmux) {
		nodeSender(toNodeNotificationPayload(payload))
		return
	}

	try {
		const sentViaCmux = await cmuxSender(toCmuxNotificationPayload(payload))
		if (sentViaCmux) {
			return
		}
	} catch {
		// Fall through to node-notifier fallback
	}

	nodeSender(toNodeNotificationPayload(payload))
}
