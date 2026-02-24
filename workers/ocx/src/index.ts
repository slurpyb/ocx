import type { Context } from "hono"
import { Hono } from "hono"
import { etag } from "hono/etag"
import { logger } from "hono/logger"
import { secureHeaders } from "hono/secure-headers"
import { trimTrailingSlash } from "hono/trailing-slash"
import localSchema from "../../../docs/schemas/local.schema.json"
import lockSchema from "../../../docs/schemas/lock.schema.json"
import ocxSchema from "../../../docs/schemas/ocx.schema.json"
import profileSchema from "../../../docs/schemas/profile.schema.json"
import receiptSchema from "../../../docs/schemas/receipt.schema.json"
import registrySchemaV2 from "../../../docs/schemas/registry.schema.json"
import registrySchemaV1 from "../../../docs/schemas/registry.v1.schema.json"

const MINTLIFY_HOST = "kdco.mintlify.app"
const DEFAULT_SCHEMA_CACHE_CONTROL = "public, max-age=300, s-maxage=3600"
const LATEST_SCHEMA_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400"
const VERSIONED_SCHEMA_CACHE_CONTROL = "public, max-age=31536000, immutable"

const VALID_SCHEMAS = ["ocx", "profile", "local", "lock", "registry", "receipt"] as const
type SchemaName = (typeof VALID_SCHEMAS)[number]

const REGISTRY_SCHEMAS_BY_VERSION = {
	v1: registrySchemaV1,
	v2: registrySchemaV2,
} as const

const SCHEMA_PAYLOADS: Record<SchemaName, unknown> = {
	ocx: ocxSchema,
	profile: profileSchema,
	local: localSchema,
	lock: lockSchema,
	registry: registrySchemaV2,
	receipt: receiptSchema,
}

function respondWithSchema(
	c: Context<{ Bindings: Env }>,
	schemaPayload: unknown,
	cacheControl: string,
): Response {
	return c.json(schemaPayload, 200, {
		"Cache-Control": cacheControl,
		Vary: "Accept-Encoding",
	})
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

	const versionedRegistryMatch = nameWithExt.match(/^v(\d+)\/registry\.json$/)
	if (versionedRegistryMatch) {
		const versionToken = versionedRegistryMatch[1]
		const versionKey = `v${versionToken}`
		const schemaPayload =
			REGISTRY_SCHEMAS_BY_VERSION[versionKey as keyof typeof REGISTRY_SCHEMAS_BY_VERSION]

		if (!schemaPayload) {
			return c.json(
				{
					error: "Unsupported registry schema version",
					supportedSchemas: Object.keys(REGISTRY_SCHEMAS_BY_VERSION).map(
						(version) => `${version}/registry.json`,
					),
				},
				400,
			)
		}

		return respondWithSchema(c, schemaPayload, VERSIONED_SCHEMA_CACHE_CONTROL)
	}

	const name = nameWithExt.replace(/\.json$/, "") // "registry"

	// Validate against allowed schemas
	if (!VALID_SCHEMAS.includes(name as SchemaName)) {
		return c.json(
			{
				error: "Invalid schema",
				validSchemas: [
					...VALID_SCHEMAS.map((schemaName) => `${schemaName}.json`),
					...Object.keys(REGISTRY_SCHEMAS_BY_VERSION).map((version) => `${version}/registry.json`),
				],
			},
			400,
		)
	}

	const schemaPayload = SCHEMA_PAYLOADS[name as SchemaName]
	const cacheControl =
		name === "registry" ? LATEST_SCHEMA_CACHE_CONTROL : DEFAULT_SCHEMA_CACHE_CONTROL

	return respondWithSchema(c, schemaPayload, cacheControl)
})

export default app
