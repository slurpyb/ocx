import { isAbsolute, join, relative, resolve } from "node:path"

type FixtureName = "kdco" | "kit"

interface CliOptions {
	port: number
	fixtureName?: FixtureName
	rootDir?: string
	placeholderFiles: boolean
}

function usage(): string {
	return [
		"Usage:",
		"  bun run scripts/serve-legacy-fixture.ts --fixture <kdco|kit> --port <port>",
		"  bun run scripts/serve-legacy-fixture.ts --root <absolute-or-relative-path> --port <port>",
		"",
		"Options:",
		"  --fixture <kdco|kit>  Serve pinned fixtures from tests/fixtures/legacy-v1",
		"  --root <path>         Serve fixtures from a custom directory",
		"  --port <number>       Port to bind (required)",
		"  --strict-files        Return 404 for missing component file blobs",
	].join("\n")
}

function parseOptions(argv: string[]): CliOptions {
	const raw: {
		fixtureName?: string
		rootDir?: string
		port?: string
		placeholderFiles: boolean
	} = {
		placeholderFiles: true,
	}

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index]
		if (!token) continue

		if (token === "--strict-files") {
			raw.placeholderFiles = false
			continue
		}

		if (!token.startsWith("--")) {
			throw new Error(`Unexpected argument: ${token}\n\n${usage()}`)
		}

		const value = argv[index + 1]
		if (!value || value.startsWith("--")) {
			throw new Error(`Missing value for ${token}\n\n${usage()}`)
		}

		switch (token) {
			case "--fixture":
				raw.fixtureName = value
				break
			case "--root":
				raw.rootDir = value
				break
			case "--port":
				raw.port = value
				break
			default:
				throw new Error(`Unknown option: ${token}\n\n${usage()}`)
		}

		index += 1
	}

	if (raw.fixtureName && raw.rootDir) {
		throw new Error(`Use either --fixture or --root (not both).\n\n${usage()}`)
	}

	if (!raw.fixtureName && !raw.rootDir) {
		throw new Error(`Missing fixture source. Provide --fixture or --root.\n\n${usage()}`)
	}

	if (!raw.port) {
		throw new Error(`Missing --port.\n\n${usage()}`)
	}

	const port = Number.parseInt(raw.port, 10)
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid port "${raw.port}". Expected integer 1-65535.`)
	}

	if (raw.fixtureName && raw.fixtureName !== "kdco" && raw.fixtureName !== "kit") {
		throw new Error(`Invalid fixture "${raw.fixtureName}". Expected one of: kdco, kit.`)
	}

	return {
		port,
		fixtureName: raw.fixtureName as FixtureName | undefined,
		rootDir: raw.rootDir,
		placeholderFiles: raw.placeholderFiles,
	}
}

function resolveRoot(options: CliOptions): { root: string; label: string } {
	if (options.fixtureName) {
		const root = join(import.meta.dir, "..", "tests", "fixtures", "legacy-v1", options.fixtureName)
		return {
			root,
			label: `fixture:${options.fixtureName}`,
		}
	}

	if (!options.rootDir) {
		throw new Error("Internal error: rootDir is required when fixtureName is not provided")
	}

	return {
		root: resolve(options.rootDir),
		label: `root:${resolve(options.rootDir)}`,
	}
}

function isSafeRelativePath(pathname: string): boolean {
	if (!pathname) return false
	if (pathname.includes("\\")) return false
	if (pathname.includes("\0")) return false

	const segments = pathname.split("/")
	if (segments.some((segment) => segment.length === 0)) return false
	if (segments.some((segment) => segment === "." || segment === "..")) return false

	return true
}

function decodeUriComponentRecursively(value: string): string | null {
	let decoded = value

	for (let round = 0; round < 3; round += 1) {
		let next: string
		try {
			next = decodeURIComponent(decoded)
		} catch {
			return null
		}

		if (next === decoded) {
			return decoded
		}

		decoded = next
	}

	return decoded
}

function isSafeComponentName(componentName: string): boolean {
	if (!componentName) return false
	if (componentName.includes("/")) return false
	if (componentName.includes("\\")) return false
	if (componentName.includes("\0")) return false

	const decoded = decodeUriComponentRecursively(componentName)
	if (!decoded) return false
	if (decoded === "." || decoded === "..") return false
	if (decoded.includes("/")) return false
	if (decoded.includes("\\")) return false
	if (decoded.includes("\0")) return false

	return true
}

function isSafeComponentPath(componentPath: string): boolean {
	if (!isSafeRelativePath(componentPath)) {
		return false
	}

	const decoded = decodeUriComponentRecursively(componentPath)
	if (!decoded) {
		return false
	}

	return isSafeRelativePath(decoded)
}

function isWithinDirectory(candidatePath: string, rootDirectory: string): boolean {
	const relativePath = relative(rootDirectory, candidatePath)
	if (relativePath === "") return true

	return !relativePath.startsWith("..") && !isAbsolute(relativePath)
}

async function readJsonFixtureResponse(filePath: string): Promise<Response | null> {
	const file = Bun.file(filePath)
	if (!(await file.exists())) {
		return null
	}

	return new Response(file, {
		headers: {
			"content-type": "application/json",
		},
	})
}

const options = parseOptions(Bun.argv.slice(2))
const fixture = resolveRoot(options)
const componentsRoot = resolve(fixture.root, "components")

const indexFile = Bun.file(join(fixture.root, "index.json"))
if (!(await indexFile.exists())) {
	throw new Error(`Fixture root missing index.json: ${fixture.root}`)
}

const server = Bun.serve({
	port: options.port,
	async fetch(request) {
		const { pathname } = new URL(request.url)

		if (pathname === "/index.json") {
			const response = await readJsonFixtureResponse(join(fixture.root, "index.json"))
			return response ?? new Response("Not Found", { status: 404 })
		}

		const componentPackumentMatch = pathname.match(/^\/components\/([^/]+)\.json$/)
		if (componentPackumentMatch) {
			const componentName = componentPackumentMatch[1]
			if (!componentName || !isSafeComponentName(componentName)) {
				return new Response("Not Found", { status: 404 })
			}

			const response = await readJsonFixtureResponse(
				join(fixture.root, "components", `${componentName}.json`),
			)
			return response ?? new Response("Not Found", { status: 404 })
		}

		const componentFileMatch = pathname.match(/^\/components\/([^/]+)\/(.+)$/)
		if (componentFileMatch) {
			const componentName = componentFileMatch[1]
			const componentPath = componentFileMatch[2]

			if (!componentName || !componentPath) {
				return new Response("Not Found", { status: 404 })
			}

			if (!isSafeComponentName(componentName) || !isSafeComponentPath(componentPath)) {
				return new Response("Not Found", { status: 404 })
			}

			const resolvedFilePath = resolve(componentsRoot, componentName, componentPath)
			if (!isWithinDirectory(resolvedFilePath, componentsRoot)) {
				return new Response("Not Found", { status: 404 })
			}

			const file = Bun.file(resolvedFilePath)
			if (await file.exists()) {
				return new Response(file)
			}

			if (options.placeholderFiles) {
				return new Response(`legacy fixture content for ${componentName}/${componentPath}`, {
					headers: { "content-type": "text/plain" },
				})
			}

			return new Response("Not Found", { status: 404 })
		}

		return new Response("Not Found", { status: 404 })
	},
})

console.log(
	`[legacy-fixture-server] Serving ${fixture.label} on http://localhost:${server.port} (placeholder-files=${options.placeholderFiles ? "on" : "off"})`,
)

const shutdown = () => {
	server.stop(true)
	process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
