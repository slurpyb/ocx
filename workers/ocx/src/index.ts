import type { Context } from "hono"
import { Hono } from "hono"
import { etag } from "hono/etag"
import { logger } from "hono/logger"
import { secureHeaders } from "hono/secure-headers"
import { trimTrailingSlash } from "hono/trailing-slash"

const MINTLIFY_HOST = "kdco.mintlify.app"

const VALID_SCHEMAS = ["ocx", "profile", "local", "lock", "registry"] as const
type SchemaName = (typeof VALID_SCHEMAS)[number]

const SCHEMA_FILES: Record<SchemaName, string> = {
	ocx: "docs/schemas/ocx.schema.json",
	profile: "docs/schemas/profile.json",
	local: "docs/schemas/local.json",
	lock: "docs/schemas/lock.schema.json",
	registry: "docs/schemas/registry.schema.json",
}

const app = new Hono<{ Bindings: Env }>()

app.use("*", logger())
app.use("*", secureHeaders())
// Skip trailing-slash normalization for /docs — Mintlify controls its own URL structure
app.use("*", async (c, next) => {
	const path = new URL(c.req.url).pathname
	if (path === "/docs" || path.startsWith("/docs/")) return next()
	return trimTrailingSlash()(c, next)
})
app.use("*", etag())

app.get("/", (c) => {
	return c.redirect(`https://github.com/${c.env.GITHUB_REPO}`)
})

app.get("/install.sh", async (c) => {
	const githubRawBase = `https://raw.githubusercontent.com/${c.env.GITHUB_REPO}/${c.env.GITHUB_BRANCH}`
	const response = await fetch(`${githubRawBase}/packages/cli/scripts/install.sh`)
	if (!response.ok) {
		return c.text("Install script not found", 404)
	}
	const content = await response.text()
	return c.text(content, 200, {
		"Content-Type": "text/plain; charset=utf-8",
		"Cache-Control": "public, max-age=300, must-revalidate",
		"Content-Disposition": 'inline; filename="install.sh"',
		Vary: "Accept-Encoding",
	})
})

// Proxy /docs to Mintlify, forwarding method/body and rewriting redirects
async function proxyToMintlify(c: Context<{ Bindings: Env }>): Promise<Response> {
	const originUrl = new URL(c.req.url)
	const upstreamUrl = new URL(originUrl.pathname + originUrl.search, `https://${MINTLIFY_HOST}`)

	const headers: Record<string, string> = {
		Host: MINTLIFY_HOST,
		"X-Forwarded-Host": originUrl.host,
		"X-Forwarded-Proto": "https",
	}
	const connectingIp = c.req.header("CF-Connecting-IP")
	if (connectingIp) headers["CF-Connecting-IP"] = connectingIp

	const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD"

	let upstreamResponse: Response
	try {
		upstreamResponse = await fetch(upstreamUrl.toString(), {
			method: c.req.method,
			headers,
			body: hasBody ? c.req.raw.body : undefined,
			redirect: "manual",
		})
	} catch {
		return c.text("Documentation service unavailable", 502)
	}

	// Rewrite Location headers from Mintlify back to our domain
	const responseHeaders = new Headers(upstreamResponse.headers)
	const location = responseHeaders.get("Location")
	if (location) {
		responseHeaders.set(
			"Location",
			location.replaceAll(`https://${MINTLIFY_HOST}`, originUrl.origin),
		)
	}

	return new Response(upstreamResponse.body, {
		status: upstreamResponse.status,
		headers: responseHeaders,
	})
}

app.all("/docs", proxyToMintlify)
app.all("/docs/*", proxyToMintlify)

// Unified schema route
app.get("/schemas/:name{.+\\.json}", async (c) => {
	const nameWithExt = c.req.param("name") // "registry.json"
	const name = nameWithExt.replace(/\.json$/, "") // "registry"

	// Validate against allowed schemas
	if (!VALID_SCHEMAS.includes(name as SchemaName)) {
		return c.json(
			{ error: "Invalid schema", validSchemas: VALID_SCHEMAS.map((s) => `${s}.json`) },
			400,
		)
	}

	const filePath = SCHEMA_FILES[name as SchemaName]

	const res = await fetch(
		`https://raw.githubusercontent.com/${c.env.GITHUB_REPO}/${c.env.GITHUB_BRANCH}/${filePath}`,
		{ cf: { cacheTtl: 3600, cacheEverything: true } },
	)

	if (!res.ok) {
		const status = res.status === 404 ? 404 : 502
		return c.json({ error: "Failed to fetch schema" }, status)
	}

	try {
		const content = await res.json()
		return c.json(content, 200, {
			"Cache-Control": "public, max-age=300, s-maxage=3600",
			Vary: "Accept-Encoding",
		})
	} catch {
		return c.json({ error: "Invalid schema format from upstream" }, 502)
	}
})

export default app
