import { describe, expect, it } from "bun:test"
import {
	classifyNotificationContractHandshake,
	NotificationChannel,
	NotificationContractID,
	NotificationContractSchemaVersion,
	NotificationNegotiatedState,
} from "../../src/notify/contract-compat"

function createValidHandshake(): {
	contract: { id: string; schemaVersion: string }
	capabilities: Record<string, { state: string }>
} {
	return {
		contract: {
			id: NotificationContractID,
			schemaVersion: NotificationContractSchemaVersion,
		},
		capabilities: {
			[NotificationChannel.UIToast]: { state: NotificationNegotiatedState.Supported },
			[NotificationChannel.TaskSystem]: { state: NotificationNegotiatedState.Supported },
			[NotificationChannel.SDKSystem]: { state: NotificationNegotiatedState.Unsupported },
			[NotificationChannel.DesktopTerminal]: {
				state: NotificationNegotiatedState.Unsupported,
			},
			[NotificationChannel.MCPChannel]: { state: NotificationNegotiatedState.InternalOnly },
		},
	}
}

describe("classifyNotificationContractHandshake", () => {
	it("fails when handshake payload is not an object", () => {
		const result = classifyNotificationContractHandshake(null)

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors[0]).toMatchObject({
			code: "invalid-contract-format",
			path: "$",
		})
	})

	it("fails when contract is missing", () => {
		const result = classifyNotificationContractHandshake({
			capabilities: {},
		})

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors[0]).toMatchObject({
			code: "invalid-contract-format",
			path: "contract",
		})
	})

	it("fails when contract is not an object", () => {
		const result = classifyNotificationContractHandshake({
			contract: "invalid",
			capabilities: {},
		})

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors[0]).toMatchObject({
			code: "invalid-contract-format",
			path: "contract",
		})
	})

	it("accepts exact schema version 1.1.0 with no warnings", () => {
		const result = classifyNotificationContractHandshake(createValidHandshake())

		expect(result.compatible).toBe(true)
		if (!result.compatible) {
			expect.unreachable("Expected compatible notification handshake")
		}

		expect(result.schemaVersion).toBe("1.1.0")
		expect(result.warnings).toEqual([])
		expect(result.negotiatedStateByChannel).toEqual({
			[NotificationChannel.UIToast]: NotificationNegotiatedState.Supported,
			[NotificationChannel.TaskSystem]: NotificationNegotiatedState.Supported,
			[NotificationChannel.SDKSystem]: NotificationNegotiatedState.Unsupported,
			[NotificationChannel.DesktopTerminal]: NotificationNegotiatedState.Unsupported,
			[NotificationChannel.MCPChannel]: NotificationNegotiatedState.InternalOnly,
		})
	})

	it("fails on unsupported schema major mismatch", () => {
		const handshake = createValidHandshake()
		handshake.contract.schemaVersion = "2.0.0"

		const result = classifyNotificationContractHandshake(handshake)

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors[0]?.code).toBe("unsupported-schema-major")
		expect(result.errors[0]).toMatchObject({
			code: "unsupported-schema-major",
			supportedMajor: 1,
			detectedMajor: 2,
			schemaVersion: "2.0.0",
		})
	})

	it("warns and continues for newer minor/patch on same major", () => {
		const handshake = createValidHandshake()
		handshake.contract.schemaVersion = "1.2.0"

		const result = classifyNotificationContractHandshake(handshake)

		expect(result.compatible).toBe(true)
		if (!result.compatible) {
			expect.unreachable("Expected compatible notification handshake")
		}

		expect(result.warnings).toHaveLength(1)
		expect(result.warnings[0]).toMatchObject({
			code: "newer-schema-minor-or-patch",
			receivedSchemaVersion: "1.2.0",
			supportedSchemaVersion: "1.1.0",
		})
	})

	it("warns and ignores unknown extra channel keys", () => {
		const handshake = createValidHandshake()
		handshake.capabilities["future.channel"] = { state: NotificationNegotiatedState.Supported }

		const result = classifyNotificationContractHandshake(handshake)

		expect(result.compatible).toBe(true)
		if (!result.compatible) {
			expect.unreachable("Expected compatible notification handshake")
		}

		expect(result.warnings).toContainEqual(
			expect.objectContaining({
				code: "unknown-channel-ignored",
				channel: "future.channel",
			}),
		)
		expect(Object.hasOwn(result.negotiatedStateByChannel, "future.channel")).toBe(false)
	})

	it("fails when a canonical channel is missing", () => {
		const handshake = createValidHandshake()
		delete handshake.capabilities[NotificationChannel.DesktopTerminal]

		const result = classifyNotificationContractHandshake(handshake)

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors).toContainEqual(
			expect.objectContaining({
				code: "missing-required-channel",
				channel: NotificationChannel.DesktopTerminal,
			}),
		)
	})

	it("fails when a known channel has an unknown negotiated state", () => {
		const handshake = createValidHandshake()
		handshake.capabilities[NotificationChannel.SDKSystem] = { state: "legacy_supported" }

		const result = classifyNotificationContractHandshake(handshake)

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors).toContainEqual(
			expect.objectContaining({
				code: "unknown-negotiated-state",
				channel: NotificationChannel.SDKSystem,
				state: "legacy_supported",
			}),
		)
	})

	it("fails malformed contract payloads", () => {
		const result = classifyNotificationContractHandshake({
			contract: {
				id: "invalid.contract.id",
				schemaVersion: "1.1.0",
			},
			capabilities: {},
		})

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors[0]?.code).toBe("invalid-contract-id")
	})

	it("fails invalid contract id types with null receivedContractID", () => {
		const result = classifyNotificationContractHandshake({
			contract: {
				id: 42,
				schemaVersion: "1.1.0",
			},
			capabilities: {},
		})

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors[0]).toMatchObject({
			code: "invalid-contract-id",
			receivedContractID: null,
		})
	})

	it("fails when schemaVersion is missing", () => {
		const result = classifyNotificationContractHandshake({
			contract: {
				id: NotificationContractID,
			},
			capabilities: {},
		})

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors[0]?.code).toBe("missing-schema-version")
	})

	it("fails when schemaVersion is an empty string", () => {
		const handshake = createValidHandshake()
		handshake.contract.schemaVersion = ""

		const result = classifyNotificationContractHandshake(handshake)

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors[0]).toMatchObject({
			code: "invalid-schema-version",
			schemaVersion: "",
		})
	})

	it("fails when schemaVersion format is not strict semver", () => {
		const handshake = createValidHandshake()
		handshake.contract.schemaVersion = "1.1"

		const result = classifyNotificationContractHandshake(handshake)

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors[0]).toMatchObject({
			code: "invalid-schema-version",
			schemaVersion: "1.1",
		})
	})

	it("fails when capabilities object is missing", () => {
		const result = classifyNotificationContractHandshake({
			contract: {
				id: NotificationContractID,
				schemaVersion: NotificationContractSchemaVersion,
			},
		})

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors[0]).toMatchObject({
			code: "invalid-contract-format",
			path: "capabilities",
		})
	})

	it("fails when capabilities is not an object", () => {
		const result = classifyNotificationContractHandshake({
			contract: {
				id: NotificationContractID,
				schemaVersion: NotificationContractSchemaVersion,
			},
			capabilities: "invalid",
		})

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors[0]).toMatchObject({
			code: "invalid-contract-format",
			path: "capabilities",
		})
	})

	it("fails when capability entry is not an object", () => {
		const handshake = createValidHandshake()
		handshake.capabilities[NotificationChannel.SDKSystem] = "invalid" as never

		const result = classifyNotificationContractHandshake(handshake)

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors).toContainEqual(
			expect.objectContaining({
				code: "invalid-contract-format",
				path: `capabilities.${NotificationChannel.SDKSystem}`,
			}),
		)
	})

	it("fails when negotiated state is not a string", () => {
		const handshake = createValidHandshake()
		handshake.capabilities[NotificationChannel.SDKSystem] = { state: 123 as never }

		const result = classifyNotificationContractHandshake(handshake)

		expect(result.compatible).toBe(false)
		if (result.compatible) {
			expect.unreachable("Expected incompatible notification handshake")
		}

		expect(result.errors).toContainEqual(
			expect.objectContaining({
				code: "invalid-contract-format",
				path: `capabilities.${NotificationChannel.SDKSystem}.state`,
			}),
		)
	})
})
