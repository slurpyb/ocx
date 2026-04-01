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

function withNullPrototype<T extends object>(value: T): T {
	return Object.assign(Object.create(null), value) as T
}

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

	it("matches canonical classification for invalid object-shape handshakes", () => {
		const channel = Object.keys(canonicalClosedHostDefaultHandshake.capabilities)[0]
		expect(channel).toBeTruthy()
		if (!channel) {
			expect.unreachable("Expected closed-host handshake fixture to include at least one channel")
		}

		const invalidShapeCases = [
			{
				label: "null-prototype handshake root",
				handshake: withNullPrototype(canonicalClosedHostDefaultHandshake),
			},
			{
				label: "null-prototype contract",
				handshake: {
					...canonicalClosedHostDefaultHandshake,
					contract: withNullPrototype(canonicalClosedHostDefaultHandshake.contract),
				},
			},
			{
				label: "null-prototype capabilities",
				handshake: {
					...canonicalClosedHostDefaultHandshake,
					capabilities: withNullPrototype(canonicalClosedHostDefaultHandshake.capabilities),
				},
			},
			{
				label: "null-prototype capability entry",
				handshake: {
					...canonicalClosedHostDefaultHandshake,
					capabilities: {
						...canonicalClosedHostDefaultHandshake.capabilities,
						[channel]: withNullPrototype(
							canonicalClosedHostDefaultHandshake.capabilities[channel] as { state: string },
						),
					},
				},
			},
		] as const

		for (const testCase of invalidShapeCases) {
			const canonicalResult = classifyCanonicalNotificationContractHandshake(testCase.handshake)
			const shippedResult = classifyShippedNotificationContractHandshake(testCase.handshake)

			expect(canonicalResult.compatible, testCase.label).toBe(false)
			expect(shippedResult, testCase.label).toEqual(canonicalResult)
		}
	})
})
