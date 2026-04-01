import type { NotificationLevel } from "./normalize"

export const NotificationTaskSystemEventType = "notification.task.system" as const

export interface NotificationTaskSystemEvent {
	type: typeof NotificationTaskSystemEventType
	properties: {
		id?: string
		dedupeKey?: string
		title?: string
		message: string
		level: NotificationLevel
		sessionID?: string
	}
}

export function createNotificationTaskSystemEvent(
	properties: NotificationTaskSystemEvent["properties"],
): NotificationTaskSystemEvent {
	return {
		type: NotificationTaskSystemEventType,
		properties,
	}
}
