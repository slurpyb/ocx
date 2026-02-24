import { join } from "node:path"
import type { Server } from "bun"

export interface LegacyFixtureRegistry {
	server: Server<unknown>
	url: string
	stop: () => void
}

async function readFixtureFile(filePath: string): Promise<string | null> {
	const file = Bun.file(filePath)
	if (!(await file.exists())) {
		return null
	}

	return file.text()
}

export function startLegacyFixtureRegistry(fixtureName: string): LegacyFixtureRegistry {
	const fixtureRoot = join(import.meta.dir, "fixtures", "legacy-v1", fixtureName)

	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url)
			const pathname = url.pathname

			if (pathname === "/index.json") {
				const payload = await readFixtureFile(join(fixtureRoot, "index.json"))
				if (!payload) {
					return new Response("Not Found", { status: 404 })
				}

				return new Response(payload, {
					status: 200,
					headers: { "content-type": "application/json" },
				})
			}

			const componentPackumentMatch = pathname.match(/^\/components\/([^/]+)\.json$/)
			if (componentPackumentMatch) {
				const componentName = componentPackumentMatch[1]
				if (!componentName) {
					return new Response("Not Found", { status: 404 })
				}

				const payload = await readFixtureFile(
					join(fixtureRoot, "components", `${componentName}.json`),
				)
				if (!payload) {
					return new Response("Not Found", { status: 404 })
				}

				return new Response(payload, {
					status: 200,
					headers: { "content-type": "application/json" },
				})
			}

			const componentFileMatch = pathname.match(/^\/components\/([^/]+)\/(.+)$/)
			if (componentFileMatch) {
				const componentName = componentFileMatch[1]
				const filePath = componentFileMatch[2]
				if (!componentName || !filePath) {
					return new Response("Not Found", { status: 404 })
				}

				return new Response(`legacy fixture content for ${componentName}/${filePath}`, {
					status: 200,
					headers: { "content-type": "text/plain" },
				})
			}

			return new Response("Not Found", { status: 404 })
		},
	})

	return {
		server,
		url: `http://localhost:${server.port}`,
		stop: () => server.stop(),
	}
}
