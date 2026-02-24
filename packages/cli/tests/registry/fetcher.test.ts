import { afterEach, describe, expect, it, mock } from "bun:test"
import {
	_clearFetcherCacheForTests,
	classifyRegistryIndexIssue,
	fetchComponentVersion,
	fetchFileContent,
	fetchRegistryIndex,
} from "../../src/registry/fetcher"
import {
	NetworkError,
	NotFoundError,
	RegistryCompatibilityError,
	ValidationError,
} from "../../src/utils/errors"
import { startLegacyFixtureRegistry } from "../legacy-fixture-registry"

const REGISTRY_SCHEMA_V2_URL = "https://ocx.kdco.dev/schemas/v2/registry.json"
const REGISTRY_SCHEMA_UNVERSIONED_URL = "https://ocx.kdco.dev/schemas/registry.json"

describe("fetcher", () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
		_clearFetcherCacheForTests()
	})

	describe("network error handling", () => {
		it("throws NetworkError on DNS failure", async () => {
			globalThis.fetch = mock(() =>
				Promise.reject(new Error("getaddrinfo ENOTFOUND registry.example.com")),
			)

			await expect(fetchRegistryIndex("https://registry.example.com")).rejects.toThrow(NetworkError)
			await expect(fetchRegistryIndex("https://registry.example2.com")).rejects.toThrow(
				/network request failed/i,
			)
		})

		it("throws NetworkError on connection refused", async () => {
			globalThis.fetch = mock(() =>
				Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:3000")),
			)

			await expect(fetchRegistryIndex("https://localhost:3000")).rejects.toThrow(NetworkError)
		})

		it("throws NetworkError on timeout", async () => {
			globalThis.fetch = mock(() => Promise.reject(new Error("The operation timed out")))

			await expect(fetchRegistryIndex("https://registry.example.com")).rejects.toThrow(NetworkError)
		})

		it("throws NetworkError on HTTP 500", async () => {
			globalThis.fetch = mock(() =>
				Promise.resolve(
					new Response("Internal Server Error", {
						status: 500,
						statusText: "Internal Server Error",
					}),
				),
			)

			await expect(fetchRegistryIndex("https://registry.example.com")).rejects.toThrow(NetworkError)
			await expect(fetchRegistryIndex("https://registry.example2.com")).rejects.toThrow(/500/)
		})

		it("throws NetworkError on HTTP 503", async () => {
			globalThis.fetch = mock(() =>
				Promise.resolve(
					new Response("Service Unavailable", {
						status: 503,
						statusText: "Service Unavailable",
					}),
				),
			)

			await expect(fetchRegistryIndex("https://registry.example.com")).rejects.toThrow(NetworkError)
		})

		it("throws NotFoundError on HTTP 404", async () => {
			globalThis.fetch = mock(() =>
				Promise.resolve(new Response("Not Found", { status: 404, statusText: "Not Found" })),
			)

			await expect(fetchRegistryIndex("https://registry.example.com")).rejects.toThrow(
				NotFoundError,
			)
		})

		it("throws NetworkError on malformed JSON response", async () => {
			globalThis.fetch = mock(() =>
				Promise.resolve(
					new Response("not valid json {{{", {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
				),
			)

			await expect(fetchRegistryIndex("https://registry.example.com")).rejects.toThrow(NetworkError)
			await expect(fetchRegistryIndex("https://registry.example2.com")).rejects.toThrow(
				/invalid json/i,
			)
		})

		it("includes URL in network error message", async () => {
			globalThis.fetch = mock(() => Promise.reject(new Error("connection failed")))

			try {
				await fetchRegistryIndex("https://registry.example.com")
				expect.unreachable("Should have thrown")
			} catch (error) {
				expect(error).toBeInstanceOf(NetworkError)
				expect((error as NetworkError).message).toContain("registry.example.com")
			}
		})
	})

	describe("fetchFileContent network errors", () => {
		it("throws NetworkError on DNS failure", async () => {
			globalThis.fetch = mock(() => Promise.reject(new Error("getaddrinfo ENOTFOUND")))

			await expect(
				fetchFileContent("https://registry.example.com", "button", "index.ts"),
			).rejects.toThrow(NetworkError)
		})

		it("throws NetworkError on connection timeout", async () => {
			globalThis.fetch = mock(() => Promise.reject(new Error("The operation timed out")))

			await expect(
				fetchFileContent("https://registry.example.com", "button", "index.ts"),
			).rejects.toThrow(NetworkError)
		})

		it("includes URL in fetchFileContent network error", async () => {
			globalThis.fetch = mock(() => Promise.reject(new Error("connection refused")))

			try {
				await fetchFileContent("https://registry.example.com", "button", "index.ts")
				expect.unreachable("Should have thrown")
			} catch (error) {
				expect(error).toBeInstanceOf(NetworkError)
				expect((error as NetworkError).message).toContain("registry.example.com")
				expect((error as NetworkError).message).toContain("button")
			}
		})
	})
})

// =============================================================================
// Registry Index Classification Tests
// =============================================================================

describe("classifyRegistryIndexIssue", () => {
	it("returns 'legacy-schema-v1' for top-level array with no $schema", () => {
		const result = classifyRegistryIndexIssue([
			{ name: "button", type: "plugin" },
			{ name: "card", type: "plugin" },
		])

		expect(result).not.toBeNull()
		expect(result?.issue).toBe("legacy-schema-v1")
		expect(result?.remediation).toContain("v2")
	})

	it("returns 'legacy-schema-v1' when $schema is missing", () => {
		const result = classifyRegistryIndexIssue({
			author: "Test Author",
			components: [{ name: "button", type: "plugin", description: "A button" }],
		})

		expect(result).not.toBeNull()
		expect(result?.issue).toBe("legacy-schema-v1")
	})

	it("returns 'legacy-schema-v1' for canonical unversioned schema URL", () => {
		const result = classifyRegistryIndexIssue({
			$schema: REGISTRY_SCHEMA_UNVERSIONED_URL,
		})

		expect(result).not.toBeNull()
		expect(result?.issue).toBe("legacy-schema-v1")
	})

	it("returns 'invalid-schema-url' for empty schema string", () => {
		const result = classifyRegistryIndexIssue({
			$schema: "",
		})

		expect(result).not.toBeNull()
		expect(result?.issue).toBe("invalid-schema-url")
	})

	it("returns 'invalid-schema-url' for foreign schema URL", () => {
		const result = classifyRegistryIndexIssue({
			$schema: "https://example.com/registry.json",
		})

		expect(result).not.toBeNull()
		expect(result?.issue).toBe("invalid-schema-url")
	})

	it("returns 'invalid-schema-url' for credentialed canonical URL", () => {
		const result = classifyRegistryIndexIssue({
			$schema: "https://user:pass@ocx.kdco.dev/schemas/v2/registry.json",
		})

		expect(result).not.toBeNull()
		expect(result?.issue).toBe("invalid-schema-url")
	})

	it("returns 'invalid-schema-url' for explicit-port canonical URL", () => {
		const result = classifyRegistryIndexIssue({
			$schema: "https://ocx.kdco.dev:8443/schemas/v2/registry.json",
		})

		expect(result).not.toBeNull()
		expect(result?.issue).toBe("invalid-schema-url")
	})

	it("returns 'invalid-schema-url' for explicit default HTTPS port (:443)", () => {
		const result = classifyRegistryIndexIssue({
			$schema: "https://ocx.kdco.dev:443/schemas/v2/registry.json",
		})

		expect(result).not.toBeNull()
		expect(result?.issue).toBe("invalid-schema-url")
	})

	it("returns 'unsupported-schema-version' for unsupported major", () => {
		const result = classifyRegistryIndexIssue({
			$schema: "https://ocx.kdco.dev/schemas/v3/registry.json",
		})

		expect(result).not.toBeNull()
		expect(result?.issue).toBe("unsupported-schema-version")
	})

	it("returns 'invalid-schema-url' for zero-padded canonical major", () => {
		const result = classifyRegistryIndexIssue({
			$schema: "https://ocx.kdco.dev/schemas/v02/registry.json",
		})

		expect(result).not.toBeNull()
		expect(result?.issue).toBe("invalid-schema-url")
	})

	it("returns null for supported v2 schema URL", () => {
		const result = classifyRegistryIndexIssue({
			$schema: REGISTRY_SCHEMA_V2_URL,
			author: "Test Author",
			components: [{ name: "button", type: "plugin", description: "A button" }],
		})

		expect(result).toBeNull()
	})

	it("returns null for null/undefined/primitive data", () => {
		expect(classifyRegistryIndexIssue(null)).toBeNull()
		expect(classifyRegistryIndexIssue(undefined)).toBeNull()
		expect(classifyRegistryIndexIssue("string")).toBeNull()
		expect(classifyRegistryIndexIssue(42)).toBeNull()
	})

	it("returns 'legacy-schema-v1' for empty array", () => {
		const result = classifyRegistryIndexIssue([])
		expect(result).not.toBeNull()
		expect(result?.issue).toBe("legacy-schema-v1")
	})
})

describe("fetchRegistryIndex compatibility detection", () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
		_clearFetcherCacheForTests()
	})

	it("adapts legacy v1 object index when schema URL is missing", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						author: "Test",
						components: [{ name: "button", type: "ocx:plugin", description: "Button" }],
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
			),
		)

		const index = await fetchRegistryIndex("https://legacy.example.com")
		expect(index.components).toHaveLength(1)
		expect(index.components[0]?.type).toBe("plugin")
	})

	it("adapts legacy v1 object index for canonical unversioned schema URL", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						$schema: REGISTRY_SCHEMA_UNVERSIONED_URL,
						author: "Test",
						components: [{ name: "workspace", type: "ocx:bundle", description: "Bundle" }],
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
			),
		)

		const index = await fetchRegistryIndex("https://incomplete.example.com")
		expect(index.components[0]?.type).toBe("bundle")
	})

	it("loads legacy fixture index for kdco/workspace", async () => {
		const fixtureRegistry = startLegacyFixtureRegistry("kdco")

		try {
			const index = await fetchRegistryIndex(fixtureRegistry.url)
			expect(index.components.map((component) => component.name)).toContain("workspace")
			expect(index.components[0]?.type).toBe("bundle")
		} finally {
			fixtureRegistry.stop()
		}
	})

	it("throws RegistryCompatibilityError for invalid schema URL", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						$schema: "https://foreign.example.com/registry.json",
						author: "Test",
						components: [],
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
			),
		)

		try {
			await fetchRegistryIndex("https://random.example.com")
			expect.unreachable("Should have thrown")
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryCompatibilityError)
			const compatError = error as RegistryCompatibilityError
			expect(compatError.issue).toBe("invalid-schema-url")
		}
	})

	it("throws RegistryCompatibilityError for unsupported schema major", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						$schema: "https://ocx.kdco.dev/schemas/v3/registry.json",
						author: "Test",
						components: [],
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
			),
		)

		try {
			await fetchRegistryIndex("https://future.example.com")
			expect.unreachable("Should have thrown")
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryCompatibilityError)
			const compatError = error as RegistryCompatibilityError
			expect(compatError.issue).toBe("unsupported-schema-version")
		}
	})

	it("throws RegistryCompatibilityError for zero-padded schema major", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						$schema: "https://ocx.kdco.dev/schemas/v02/registry.json",
						author: "Test",
						components: [],
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
			),
		)

		try {
			await fetchRegistryIndex("https://zero-padded.example.com")
			expect.unreachable("Should have thrown")
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryCompatibilityError)
			const compatError = error as RegistryCompatibilityError
			expect(compatError.issue).toBe("invalid-schema-url")
		}
	})

	it("uses fallback template with schema error for schema-valid-shape but invalid data", async () => {
		// Has author and components (passes classifier) but components have invalid format
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						$schema: REGISTRY_SCHEMA_V2_URL,
						author: "Test",
						components: [{ invalid: true }],
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
			),
		)

		try {
			await fetchRegistryIndex("https://schema-fail.example.com")
			expect.unreachable("Should have thrown")
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryCompatibilityError)
			const compatError = error as RegistryCompatibilityError
			expect(compatError.issue).toBe("invalid-format")
			expect(compatError.message).toContain("unrecognized index format")
			expect(compatError.message).toContain("Schema error:")
		}
	})

	it("fails loud for legacy array payloads that cannot be adapted", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify([{ name: "button", type: "plugin" }]), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
		)

		try {
			await fetchRegistryIndex("https://legacy-array.example.com")
			expect.unreachable("Should have thrown")
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryCompatibilityError)
			expect((error as RegistryCompatibilityError).issue).toBe("legacy-schema-v1")
		}
	})

	it("does not cache failed compatibility errors (subsequent call re-fetches)", async () => {
		let callCount = 0

		// Return unsupported schema each time to force compatibility failure.
		globalThis.fetch = mock(() => {
			callCount++
			return Promise.resolve(
				new Response(
					JSON.stringify({
						$schema: "https://ocx.kdco.dev/schemas/v3/registry.json",
						author: "Test",
						components: [],
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
			)
		})

		// First call should fail
		try {
			await fetchRegistryIndex("https://cache-test.example.com")
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryCompatibilityError)
			expect((error as RegistryCompatibilityError).issue).toBe("unsupported-schema-version")
		}

		expect(callCount).toBe(1)

		// Second call should re-fetch (not return cached error)
		try {
			await fetchRegistryIndex("https://cache-test.example.com")
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryCompatibilityError)
			expect((error as RegistryCompatibilityError).issue).toBe("unsupported-schema-version")
		}

		expect(callCount).toBe(2)
	})
})

describe("fetchComponentVersion legacy manifest adaptation", () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
		_clearFetcherCacheForTests()
	})

	it("adapts .opencode/plugin target and ocx:* type to v2 manifest", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						name: "legacy-plugin",
						"dist-tags": { latest: "1.4.6" },
						versions: {
							"1.4.6": {
								name: "legacy-plugin",
								type: "ocx:plugin",
								description: "Legacy plugin",
								files: [{ path: "plugin.ts", target: ".opencode/plugin/legacy-plugin.ts" }],
								dependencies: [],
							},
						},
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
			),
		)

		const { manifest } = await fetchComponentVersion("https://legacy.example.com", "legacy-plugin")
		expect(manifest.type).toBe("plugin")
		expect(manifest.files[0]).toEqual({ path: "plugin.ts", target: "plugins/legacy-plugin.ts" })
	})

	it("loads legacy fixture manifests for kit/ws and kit/omo", async () => {
		const fixtureRegistry = startLegacyFixtureRegistry("kit")

		try {
			const ws = await fetchComponentVersion(fixtureRegistry.url, "ws")
			expect(ws.manifest.name).toBe("ws")
			expect(ws.manifest.type).toBe("profile")
			expect(
				ws.manifest.files.map((file) => (typeof file === "string" ? file : file.target)),
			).toEqual(["profiles/ws/ocx.jsonc", "profiles/ws/opencode.jsonc"])

			const omo = await fetchComponentVersion(fixtureRegistry.url, "omo")
			expect(omo.manifest.name).toBe("omo")
			expect(omo.manifest.type).toBe("profile")
			expect(
				omo.manifest.files.map((file) => (typeof file === "string" ? file : file.target)),
			).toEqual(["profiles/omo/ocx.jsonc", "profiles/omo/opencode.jsonc"])
		} finally {
			fixtureRegistry.stop()
		}
	})

	const unsafeTargets = [
		{
			target: ".opencode/plugin/../../escape.ts",
			reason: "traversal",
		},
		{
			target: ".opencode/plugin/%2e%2e/escape.ts",
			reason: "encoded",
		},
		{
			target: ".opencode\\plugin\\escape.ts",
			reason: "Windows separators",
		},
		{
			target: ".opencode/plugin//escape.ts",
			reason: "empty path segments",
		},
	]

	for (const unsafe of unsafeTargets) {
		it(`rejects unsafe canonicalization target: ${unsafe.target}`, async () => {
			globalThis.fetch = mock(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							name: "unsafe-plugin",
							"dist-tags": { latest: "1.4.6" },
							versions: {
								"1.4.6": {
									name: "unsafe-plugin",
									type: "ocx:plugin",
									description: "Unsafe plugin",
									files: [{ path: "plugin.ts", target: unsafe.target }],
									dependencies: [],
								},
							},
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					),
				),
			)

			try {
				await fetchComponentVersion("https://legacy.example.com", "unsafe-plugin")
				expect.unreachable("Should have thrown")
			} catch (error) {
				expect(error).toBeInstanceOf(ValidationError)
				expect((error as ValidationError).message).toContain("Unsafe target")
				expect((error as ValidationError).message).toContain(unsafe.reason)
			}
		})
	}
})
