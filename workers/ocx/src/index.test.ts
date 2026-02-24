import { afterEach, describe, expect, it, mock } from "bun:test"
import app from "./index"

const TEST_ENV: Env = {
	GITHUB_REPO: "kdcokenny/ocx",
	GITHUB_BRANCH: "main",
}

const LATEST_SCHEMA_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400"
const VERSIONED_SCHEMA_CACHE_CONTROL = "public, max-age=31536000, immutable"

const originalFetch = globalThis.fetch

function installUnexpectedFetchMock() {
	const fetchMock = mock((_input: string | URL | Request) =>
		Promise.reject(new Error("Schema routes must not fetch GitHub")),
	)
	globalThis.fetch = fetchMock as unknown as typeof fetch
	return fetchMock
}

describe("schema routes", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it("serves legacy registry schema v1 at /schemas/v1/registry.json", async () => {
		const fetchMock = installUnexpectedFetchMock()

		const response = await app.request(
			"https://ocx.kdco.dev/schemas/v1/registry.json",
			{},
			TEST_ENV,
		)

		expect(response.status).toBe(200)
		expect(fetchMock).not.toHaveBeenCalled()
		expect(response.headers.get("cache-control")).toBe(VERSIONED_SCHEMA_CACHE_CONTROL)

		const payload = (await response.json()) as { $id?: string }
		expect(payload.$id).toBe("https://ocx.kdco.dev/registry.schema.json")
	})

	it("serves v2 registry schema at /schemas/v2/registry.json", async () => {
		const fetchMock = installUnexpectedFetchMock()

		const response = await app.request(
			"https://ocx.kdco.dev/schemas/v2/registry.json",
			{},
			TEST_ENV,
		)

		expect(response.status).toBe(200)
		expect(fetchMock).not.toHaveBeenCalled()
		expect(response.headers.get("cache-control")).toBe(VERSIONED_SCHEMA_CACHE_CONTROL)

		const payload = (await response.json()) as { $id?: string }
		expect(payload.$id).toBe("https://ocx.kdco.dev/schemas/v2/registry.json")
	})

	it("keeps unversioned /schemas/registry.json mapped to current default", async () => {
		const fetchMock = installUnexpectedFetchMock()

		const response = await app.request("https://ocx.kdco.dev/schemas/registry.json", {}, TEST_ENV)

		expect(response.status).toBe(200)
		expect(fetchMock).not.toHaveBeenCalled()
		expect(response.headers.get("cache-control")).toBe(LATEST_SCHEMA_CACHE_CONTROL)

		const payload = (await response.json()) as { $id?: string }
		expect(payload.$id).toBe("https://ocx.kdco.dev/schemas/v2/registry.json")
	})

	it("rejects unsupported registry schema versions with 400", async () => {
		const fetchMock = installUnexpectedFetchMock()

		const response = await app.request(
			"https://ocx.kdco.dev/schemas/v3/registry.json",
			{},
			TEST_ENV,
		)

		expect(response.status).toBe(400)
		expect(fetchMock).not.toHaveBeenCalled()
		const payload = (await response.json()) as { error?: string; supportedSchemas?: string[] }
		expect(payload.error).toBe("Unsupported registry schema version")
		expect(payload.supportedSchemas).toEqual(["v1/registry.json", "v2/registry.json"])
	})
})

describe("non-schema routes", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it("keeps /docs proxy behavior", async () => {
		const upstreamResponse = new Response("<html>docs</html>", {
			status: 200,
			headers: {
				"Content-Type": "text/html; charset=utf-8",
			},
		})
		const fetchMock = mock((_input: string | URL | Request, _init?: RequestInit) =>
			Promise.resolve(upstreamResponse),
		)
		globalThis.fetch = fetchMock as unknown as typeof fetch

		const response = await app.request("https://ocx.kdco.dev/docs", {}, TEST_ENV)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe("<html>docs</html>")
		expect(fetchMock).toHaveBeenCalledTimes(1)

		const [upstreamUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(upstreamUrl).toBe("https://kdco.mintlify.app/docs")
		expect(init.method).toBe("GET")
		expect(init.redirect).toBe("manual")
		expect(init.headers).toEqual({
			Host: "kdco.mintlify.app",
			"X-Forwarded-Host": "ocx.kdco.dev",
			"X-Forwarded-Proto": "https",
		})
	})

	it("keeps /install.sh behavior and response headers", async () => {
		const installScript = "#!/usr/bin/env bash\necho install\n"
		const fetchMock = mock((input: string | URL | Request, _init?: RequestInit) => {
			expect(input).toBe(
				"https://raw.githubusercontent.com/kdcokenny/ocx/main/packages/cli/scripts/install.sh",
			)
			return Promise.resolve(new Response(installScript, { status: 200 }))
		})
		globalThis.fetch = fetchMock as unknown as typeof fetch

		const response = await app.request("https://ocx.kdco.dev/install.sh", {}, TEST_ENV)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe(installScript)
		expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8")
		expect(response.headers.get("cache-control")).toBe("public, max-age=300, must-revalidate")
		expect(response.headers.get("content-disposition")).toBe('inline; filename="install.sh"')
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})
})
