import { describe, expect, it } from "bun:test"
import {
	ClosedHostDefaultNotificationFallbackModeByChannel as canonicalClosedHostDefaultFallbackModeByChannel,
	ClosedHostDefaultNotificationHandshake as canonicalClosedHostDefaultHandshake,
	ClosedHostDefaultNotificationNegotiatedStateByChannel as canonicalClosedHostNegotiatedStateByChannel,
	NotificationContractID as canonicalNotificationContractID,
	NotificationContractSchemaVersion as canonicalNotificationContractSchemaVersion,
	classifyNotificationContractHandshake as classifyCanonicalNotificationContractHandshake,
} from "../../../packages/cli/src/notify/contract-compat"
import {
	classifyNotificationContractHandshake as classifyShippedNotificationContractHandshake,
	ClosedHostDefaultNotificationFallbackModeByChannel as shippedClosedHostDefaultFallbackModeByChannel,
	ClosedHostDefaultNotificationNegotiatedStateByChannel as shippedClosedHostNegotiatedStateByChannel,
	NotificationContractID as shippedNotificationContractID,
	NotificationContractSchemaVersion as shippedNotificationContractSchemaVersion,
} from "../files/plugins/notify/contract-compat"

describe("notify contract-compat parity", () => {
	it("keeps shipped notification contract constants aligned with canonical CLI definitions", () => {
		expect(shippedNotificationContractID).toBe(canonicalNotificationContractID)
		expect(shippedNotificationContractSchemaVersion).toBe(
			canonicalNotificationContractSchemaVersion,
		)
		expect(shippedClosedHostNegotiatedStateByChannel).toEqual(
			canonicalClosedHostNegotiatedStateByChannel,
		)
		expect(shippedClosedHostDefaultFallbackModeByChannel).toEqual(
			canonicalClosedHostDefaultFallbackModeByChannel,
		)
	})

	it("classifies canonical closed-host handshake the same way as canonical implementation", () => {
		const canonicalResult = classifyCanonicalNotificationContractHandshake(
			canonicalClosedHostDefaultHandshake,
		)
		const shippedResult = classifyShippedNotificationContractHandshake(
			canonicalClosedHostDefaultHandshake,
		)

		expect(shippedResult).toEqual(canonicalResult)
	})
})
