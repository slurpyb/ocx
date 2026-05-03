interface NotifyBackendOptions {
	preferTermux?: boolean
	preferCmux: boolean
	tryTermuxNotify?: () => Promise<boolean>
	tryCmuxNotify: () => Promise<boolean>
	sendNodeNotify: () => Promise<void> | void
}

export async function sendNotificationWithFallback(options: NotifyBackendOptions): Promise<void> {
	if (options.preferTermux && options.tryTermuxNotify) {
		try {
			const sentViaTermux = await options.tryTermuxNotify()
			if (sentViaTermux) return
		} catch {
			// Fall through to cmux/node-notifier fallback
		}
	}

	if (!options.preferCmux) {
		await options.sendNodeNotify()
		return
	}

	try {
		const sentViaCmux = await options.tryCmuxNotify()
		if (sentViaCmux) return
	} catch {
		// Fall through to node-notifier fallback
	}

	await options.sendNodeNotify()
}
