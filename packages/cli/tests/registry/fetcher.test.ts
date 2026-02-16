import { afterEach, describe, expect, it, mock } from "bun:test"
import {
	_clearFetcherCacheForTests,
	classifyRegistryIndexIssue,
	fetchFileContent,
	fetchRegistryIndex,
} from "../../src/registry/fetcher"
import { NetworkError, NotFoundError, RegistryCompatibilityError } from "../../src/utils/errors"

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
	it("returns 'ancient-format' for top-level array", () => {
		const result = classifyRegistryIndexIssue([
			{ name: "button", type: "plugin" },
			{ name: "card", type: "plugin" },
		])

		expect(result).not.toBeNull()
		expect(result!.issue).toBe("ancient-format")
		expect(result!.remediation).toContain("legacy array-based format")
	})

	it("returns 'missing-metadata' for object with signals but missing required keys", () => {
		// Has 'components' signal but no 'author'
		const result = classifyRegistryIndexIssue({
			components: [{ name: "button", type: "plugin", description: "A button" }],
		})

		expect(result).not.toBeNull()
		expect(result!.issue).toBe("missing-metadata")
		expect(result!.remediation).toContain("author")
	})

	it("returns 'missing-metadata' when only $schema is present", () => {
		const result = classifyRegistryIndexIssue({
			$schema: "https://example.com/schema.json",
		})

		expect(result).not.toBeNull()
		expect(result!.issue).toBe("missing-metadata")
		expect(result!.remediation).toContain("author")
		expect(result!.remediation).toContain("components")
	})

	it("returns 'missing-metadata' when 'ocx' signal present but missing required keys", () => {
		const result = classifyRegistryIndexIssue({
			ocx: "1.0.0",
		})

		expect(result).not.toBeNull()
		expect(result!.issue).toBe("missing-metadata")
	})

	it("returns 'missing-metadata' when 'opencode' signal present but missing required keys", () => {
		const result = classifyRegistryIndexIssue({
			opencode: "1.0.0",
		})

		expect(result).not.toBeNull()
		expect(result!.issue).toBe("missing-metadata")
	})

	it("returns 'invalid-format' for object with no recognized signals", () => {
		const result = classifyRegistryIndexIssue({
			foo: "bar",
			baz: 123,
		})

		expect(result).not.toBeNull()
		expect(result!.issue).toBe("invalid-format")
		expect(result!.remediation).toContain("OCX registry specification")
	})

	it("returns null for object with all required keys and signals", () => {
		const result = classifyRegistryIndexIssue({
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

	it("returns null for empty array (classified as ancient-format)", () => {
		const result = classifyRegistryIndexIssue([])
		expect(result).not.toBeNull()
		expect(result!.issue).toBe("ancient-format")
	})
})

describe("fetchRegistryIndex compatibility detection", () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
		_clearFetcherCacheForTests()
	})

	it("throws RegistryCompatibilityError for ancient-format (array)", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify([{ name: "button" }]), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
		)

		try {
			await fetchRegistryIndex("https://legacy.example.com")
			expect.unreachable("Should have thrown")
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryCompatibilityError)
			const compatError = error as RegistryCompatibilityError
			expect(compatError.issue).toBe("ancient-format")
			expect(compatError.url).toContain("legacy.example.com")
			expect(compatError.remediation).toContain("legacy")
		}
	})

	it("throws RegistryCompatibilityError for missing-metadata", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ components: [] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
		)

		try {
			await fetchRegistryIndex("https://incomplete.example.com")
			expect.unreachable("Should have thrown")
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryCompatibilityError)
			const compatError = error as RegistryCompatibilityError
			expect(compatError.issue).toBe("missing-metadata")
			expect(compatError.remediation).toContain("author")
		}
	})

	it("throws RegistryCompatibilityError for invalid-format (unrecognized object)", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ foo: "bar", count: 42 }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
		)

		try {
			await fetchRegistryIndex("https://random.example.com")
			expect.unreachable("Should have thrown")
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryCompatibilityError)
			const compatError = error as RegistryCompatibilityError
			expect(compatError.issue).toBe("invalid-format")
		}
	})

	it("uses fallback template with schema error for schema-valid-shape but invalid data", async () => {
		// Has author and components (passes classifier) but components have invalid format
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
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

	it("does not cache failed compatibility errors (subsequent call re-fetches)", async () => {
		let callCount = 0

		// First call: return invalid data
		globalThis.fetch = mock(() => {
			callCount++
			return Promise.resolve(
				new Response(JSON.stringify([{ name: "legacy" }]), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			)
		})

		// First call should fail
		try {
			await fetchRegistryIndex("https://cache-test.example.com")
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryCompatibilityError)
		}

		expect(callCount).toBe(1)

		// Second call should re-fetch (not return cached error)
		try {
			await fetchRegistryIndex("https://cache-test.example.com")
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryCompatibilityError)
		}

		expect(callCount).toBe(2)
	})
})
