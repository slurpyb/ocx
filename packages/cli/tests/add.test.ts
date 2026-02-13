import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { handleError } from "../src/utils/handle-error"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

let addImportCounter = 0

async function importAddCommandModule() {
	const cacheBuster = addImportCounter++
	return import(`../src/commands/add?test=${cacheBuster}`)
}

describe("ocx add", () => {
	let testDir: string
	let registry: MockRegistry

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	afterEach(async () => {
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("should fail if not initialized", async () => {
		testDir = await createTempDir("add-no-init")
		const { exitCode, output } = await runCLI(["add", "test-comp"], testDir)
		expect(exitCode).not.toBe(0)
		expect(output).toContain("Run 'ocx init' first")
	})

	it("should install a component and its dependencies", async () => {
		testDir = await createTempDir("add-basic")

		// Init and add registry
		await runCLI(["init"], testDir)

		// Manually add registry to config since 'ocx registry add' might be flaky in parallel tests
		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8"))
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install agent which depends on skill which depends on plugin
		const { exitCode, output } = await runCLI(["add", "kdco/test-agent"], testDir)

		if (exitCode !== 0) {
			console.log(output)
		}
		expect(exitCode).toBe(0)

		// Verify files (V2: root-relative paths)
		expect(existsSync(join(testDir, ".opencode", "agents", "test-agent.md"))).toBe(true)
		expect(existsSync(join(testDir, ".opencode", "skills", "test-skill", "SKILL.md"))).toBe(true)
		expect(existsSync(join(testDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(true)

		// V1: Verify receipt file (replaces ocx.lock)
		const receiptPath = join(testDir, ".ocx/receipt.jsonc")
		expect(existsSync(receiptPath)).toBe(true)
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8"))
		// V2: Receipt uses canonical IDs as keys
		const installedKeys = Object.keys(receipt.installed)
		expect(installedKeys.length).toBe(3)
		expect(installedKeys.some((k) => k.includes("test-agent"))).toBe(true)
		expect(installedKeys.some((k) => k.includes("test-skill"))).toBe(true)
		expect(installedKeys.some((k) => k.includes("test-plugin"))).toBe(true)

		// Verify opencode.jsonc patching (new files default to .jsonc)
		const opencodePath = join(testDir, ".opencode", "opencode.jsonc")
		expect(existsSync(opencodePath)).toBe(true)
		const opencode = parseJsonc(await readFile(opencodePath, "utf-8"))
		expect(opencode.mcp["test-mcp"]).toBeDefined()
		expect(opencode.mcp["test-mcp"].url).toBe("https://mcp.test.com")
	})

	it("should skip files with identical content", async () => {
		testDir = await createTempDir("add-skip-identical")

		// Init and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8"))
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install component first time
		const { exitCode: firstExitCode } = await runCLI(["add", "kdco/test-plugin"], testDir)
		expect(firstExitCode).toBe(0)

		// Install same component again (should skip, not fail)
		const { exitCode } = await runCLI(["add", "kdco/test-plugin"], testDir)
		expect(exitCode).toBe(0)
		// File should still exist (V2 path)
		expect(existsSync(join(testDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(true)
	})

	it("should fail on conflict", async () => {
		testDir = await createTempDir("add-conflict-no-yes")

		// Init and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8"))
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install component first time
		await runCLI(["add", "kdco/test-plugin"], testDir)

		// Modify the file to create a conflict (V2 path)
		const filePath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		await writeFile(filePath, "// Modified by user")

		// Try to install again (should fail with conflict)
		const { exitCode, output } = await runCLI(["add", "kdco/test-plugin"], testDir)
		expect(exitCode).not.toBe(0)
		expect(output).toContain("conflict")
		expect(output).toContain("ocx remove")
	})

	it("should preserve mcp from dependencies when main component has no mcp (regression)", async () => {
		testDir = await createTempDir("add-mcp-regression")

		// Init and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8"))
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install test-no-mcp which depends on test-mcp-provider
		// test-mcp-provider has MCP config, test-no-mcp does not
		// This tests the regression where MCP was lost due to undefined overwriting
		const { exitCode, output } = await runCLI(["add", "kdco/test-no-mcp"], testDir)

		if (exitCode !== 0) {
			console.log(output)
		}
		expect(exitCode).toBe(0)

		// Verify opencode.jsonc has MCP from dependency
		const opencodePath = join(testDir, ".opencode", "opencode.jsonc")
		expect(existsSync(opencodePath)).toBe(true)
		const opencode = parseJsonc(await readFile(opencodePath, "utf-8"))

		// MCP from test-mcp-provider should be preserved
		expect(opencode.mcp).toBeDefined()
		expect(opencode.mcp["provider-mcp"]).toBeDefined()
		expect(opencode.mcp["provider-mcp"].url).toBe("https://mcp.provider.com")

		// Tools from test-no-mcp should also be present
		expect(opencode.tools).toBeDefined()
		expect(opencode.tools["some-tool"]).toBe(true)
	})

	it("should concatenate plugin arrays from multiple components", async () => {
		testDir = await createTempDir("add-plugin-concat")

		// Init and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8"))
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install test-no-mcp which depends on test-mcp-provider
		// Both have plugin arrays that should be concatenated
		const { exitCode, output } = await runCLI(["add", "kdco/test-no-mcp"], testDir)

		if (exitCode !== 0) {
			console.log(output)
		}
		expect(exitCode).toBe(0)

		// Verify opencode.jsonc has plugins from both components
		const opencodePath = join(testDir, ".opencode", "opencode.jsonc")
		const opencode = parseJsonc(await readFile(opencodePath, "utf-8"))

		expect(opencode.plugin).toBeDefined()
		expect(opencode.plugin).toContain("provider-plugin")
		expect(opencode.plugin).toContain("no-mcp-plugin")
	})

	it("should fail if integrity check fails", async () => {
		testDir = await createTempDir("add-integrity-fail")

		// Init and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8"))
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// 1. Install normally to create lock entry
		await runCLI(["add", "kdco/test-plugin"], testDir)

		// 2. Tamper with the registry content
		registry.setFileContent("test-plugin", "index.ts", "TAMPERED CONTENT")

		// 3. Try to add again (should fail integrity check)
		const { exitCode, output } = await runCLI(["add", "kdco/test-plugin"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("Integrity verification failed")
		expect(output).toContain("The registry content has changed since this component was locked")
	})
})

describe("ocx add --profile", () => {
	let testDir: string
	let profileDir: string
	let registry: MockRegistry
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	beforeEach(async () => {
		// Create temp directory for XDG_CONFIG_HOME
		testDir = await createTempDir("add-profile")
		process.env.XDG_CONFIG_HOME = testDir

		// Create .git marker to prevent findLocalConfigDir from walking up
		// to the repo root and finding .opencode/profiles/
		await mkdir(join(testDir, ".git"), { recursive: true })

		// Create profile directory with ocx.jsonc containing registry
		profileDir = join(testDir, "opencode", "profiles", "test-profile")
		await mkdir(profileDir, { recursive: true })

		const ocxConfig = {
			registries: {
				kdco: { url: registry.url },
			},
		}
		await writeFile(join(profileDir, "ocx.jsonc"), JSON.stringify(ocxConfig, null, 2))
	})

	afterEach(async () => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("should install to flattened paths in profile directory", async () => {
		// Create a working directory (separate from profile)
		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		const { exitCode, output } = await runCLI(
			["add", "kdco/test-plugin", "--profile", "test-profile"],
			workDir,
		)

		if (exitCode !== 0) {
			console.log(output)
		}
		expect(exitCode).toBe(0)

		// V2: Verify file installed to flattened path (plugins/, not plugins/)
		expect(existsSync(join(profileDir, "plugins", "test-plugin.ts"))).toBe(true)

		// Verify NOT installed to nested .opencode/ path
		expect(existsSync(join(profileDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(false)
	})

	it("should install component with dependencies to flattened paths", async () => {
		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		// Install agent which depends on skill which depends on plugin
		const { exitCode, output } = await runCLI(
			["add", "kdco/test-agent", "--profile", "test-profile"],
			workDir,
		)

		if (exitCode !== 0) {
			console.log(output)
		}
		expect(exitCode).toBe(0)

		// V2: Verify all installed to flattened paths with correct directory names
		expect(existsSync(join(profileDir, "agents", "test-agent.md"))).toBe(true)
		expect(existsSync(join(profileDir, "skills", "test-skill", "SKILL.md"))).toBe(true)
		expect(existsSync(join(profileDir, "plugins", "test-plugin.ts"))).toBe(true)

		// V1: Verify receipt file at profile root/.ocx/
		expect(existsSync(join(profileDir, ".ocx", "receipt.jsonc"))).toBe(true)
	})

	it("should place package.json at profile root, not in .opencode/", async () => {
		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		const { exitCode } = await runCLI(
			["add", "kdco/test-plugin", "--profile", "test-profile"],
			workDir,
		)

		expect(exitCode).toBe(0)

		// package.json should be at profile root
		expect(existsSync(join(profileDir, "package.json"))).toBe(true)

		// NOT in .opencode/
		expect(existsSync(join(profileDir, ".opencode", "package.json"))).toBe(false)
	})

	it("should work without local init when --profile is provided", async () => {
		// Create workspace with NO .opencode/ directory (not initialized)
		const workDir = join(testDir, "uninitialized-project")
		await mkdir(workDir, { recursive: true })

		// Should NOT have .opencode
		expect(existsSync(join(workDir, ".opencode"))).toBe(false)

		const { exitCode, output } = await runCLI(
			["add", "kdco/test-plugin", "--profile", "test-profile"],
			workDir,
		)

		// Should succeed without "Run 'ocx init' first" error
		expect(exitCode).toBe(0)
		expect(output).not.toContain("Run 'ocx init' first")

		// Component installed to profile, not workDir (V2 flattened path: plugins/)
		expect(existsSync(join(profileDir, "plugins", "test-plugin.ts"))).toBe(true)
		expect(existsSync(join(workDir, ".opencode"))).toBe(false)
	})

	it("should detect conflicts at flattened paths", async () => {
		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		// First install
		await runCLI(["add", "kdco/test-plugin", "--profile", "test-profile"], workDir)

		// Modify the file to create a conflict (V2 flattened path: plugins/)
		const filePath = join(profileDir, "plugins", "test-plugin.ts")
		await writeFile(filePath, "// Modified by user")

		// Try to reinstall WITHOUT --force
		const { exitCode, output } = await runCLI(
			["add", "kdco/test-plugin", "--profile", "test-profile"],
			workDir,
		)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("conflict")
	})
})

describe("ocx add --from", () => {
	let testDir: string
	let registry: MockRegistry

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	afterEach(async () => {
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("should install from ephemeral registry URL", async () => {
		testDir = await createTempDir("add-from-basic")

		// Init project (required for local mode)
		await runCLI(["init"], testDir)

		// Install from ephemeral registry (prefix becomes the ephemeral registry alias)
		const { exitCode, output } = await runCLI(
			["add", "kdco/test-plugin", "--from", registry.url],
			testDir,
		)

		if (exitCode !== 0) {
			console.log(output)
		}
		expect(exitCode).toBe(0)

		// Verify file installed
		expect(existsSync(join(testDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(true)

		// Verify receipt created
		const receiptPath = join(testDir, ".ocx/receipt.jsonc")
		expect(existsSync(receiptPath)).toBe(true)
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			installed: Record<string, unknown>
		}
		expect(Object.keys(receipt.installed).some((k) => k.includes("test-plugin"))).toBe(true)
	})

	it("should NOT persist ephemeral registry to ocx.jsonc", async () => {
		testDir = await createTempDir("add-from-no-persist")

		// Init project
		await runCLI(["init"], testDir)

		// Read initial config
		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const initialConfig = parseJsonc(await readFile(configPath, "utf-8")) as {
			registries?: Record<string, unknown>
		}
		const initialRegistryCount = Object.keys(initialConfig.registries ?? {}).length

		// Install from ephemeral registry
		const { exitCode } = await runCLI(["add", "kdco/test-plugin", "--from", registry.url], testDir)
		expect(exitCode).toBe(0)

		// Verify config unchanged - ephemeral registry NOT persisted
		const finalConfig = parseJsonc(await readFile(configPath, "utf-8")) as {
			registries?: Record<string, unknown>
		}
		const finalRegistryCount = Object.keys(finalConfig.registries ?? {}).length
		expect(finalRegistryCount).toBe(initialRegistryCount)

		// Verify the ephemeral registry URL is NOT in the config
		const registryUrls = Object.values(finalConfig.registries ?? {}).map(
			(r) => (r as { url?: string }).url,
		)
		expect(registryUrls).not.toContain(registry.url)
	})

	it("should reject invalid --from URL", async () => {
		testDir = await createTempDir("add-from-invalid-url")

		// Init project
		await runCLI(["init"], testDir)

		// Try with invalid URL
		const { exitCode, output } = await runCLI(
			["add", "kdco/test-plugin", "--from", "not-a-valid-url"],
			testDir,
		)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("Invalid --from URL")
	})

	it("should accept any prefix with --from (prefix becomes ephemeral registry name)", async () => {
		testDir = await createTempDir("add-from-any-prefix")

		// Init project
		await runCLI(["init"], testDir)

		// Use any prefix — it becomes the ephemeral registry name
		const { exitCode } = await runCLI(
			["add", "custom-name/test-plugin", "--from", registry.url],
			testDir,
		)

		expect(exitCode).toBe(0)
	})

	it("should reject mixed prefixes with --from", async () => {
		testDir = await createTempDir("add-from-mixed-prefix")

		// Init project
		await runCLI(["init"], testDir)

		// Try with mixed prefixes (foo/comp1 and bar/comp2 in same --from call)
		const { exitCode, output } = await runCLI(
			["add", "foo/test-plugin", "bar/test-agent", "--from", registry.url],
			testDir,
		)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("Mixed registry prefixes")
	})

	it("should NOT write files or receipt in dry-run mode", async () => {
		testDir = await createTempDir("add-from-dry-run")

		// Init project
		await runCLI(["init"], testDir)

		// Dry-run install from ephemeral registry
		const { exitCode, output } = await runCLI(
			["add", "kdco/test-plugin", "--from", registry.url, "--dry-run"],
			testDir,
		)

		expect(exitCode).toBe(0)
		expect(output).toContain("dry-run") // Should indicate dry-run mode

		// Verify NO files written
		expect(existsSync(join(testDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(false)

		// Verify NO receipt created
		expect(existsSync(join(testDir, ".ocx/receipt.jsonc"))).toBe(false)
	})

	it("should install component with dependencies from ephemeral registry", async () => {
		testDir = await createTempDir("add-from-with-deps")

		// Init project
		await runCLI(["init"], testDir)

		// Install agent which has transitive dependencies (agent -> skill -> plugin)
		const { exitCode, output } = await runCLI(
			["add", "kdco/test-agent", "--from", registry.url],
			testDir,
		)

		if (exitCode !== 0) {
			console.log(output)
		}
		expect(exitCode).toBe(0)

		// Verify all files installed (agent + skill + plugin)
		expect(existsSync(join(testDir, ".opencode", "agents", "test-agent.md"))).toBe(true)
		expect(existsSync(join(testDir, ".opencode", "skills", "test-skill", "SKILL.md"))).toBe(true)
		expect(existsSync(join(testDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(true)

		// Verify receipt contains all 3 components
		const receiptPath = join(testDir, ".ocx/receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			installed: Record<string, unknown>
		}
		const installedKeys = Object.keys(receipt.installed)
		expect(installedKeys.length).toBe(3)
	})
})

describe("ocx add --json mixed-input contract", () => {
	let testDir: string
	let registry: MockRegistry
	const originalFetch = global.fetch

	function getRequestUrl(input: string | URL | Request): string {
		if (typeof input === "string") return input
		if (input instanceof URL) return input.toString()
		return input.url
	}

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	afterEach(async () => {
		mock.restore()
		global.fetch = originalFetch
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("emits exactly one JSON document for mixed npm + registry success", async () => {
		testDir = await createTempDir("add-json-mixed-success")

		const fetchSpy = spyOn(global, "fetch").mockImplementation(
			mock(async (input: string | URL | Request, init?: RequestInit) => {
				const url = getRequestUrl(input)
				if (url.startsWith("https://registry.npmjs.org/test-plugin")) {
					return new Response(
						JSON.stringify({
							name: "test-plugin",
							"dist-tags": { latest: "1.0.0" },
							versions: {},
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					)
				}

				return originalFetch(input as RequestInfo | URL, init)
			}) as unknown as typeof fetch,
		)

		const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {})
		const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})

		const { runAddCore } = await importAddCommandModule()
		const provider = {
			cwd: testDir,
			getRegistries: () => ({ kdco: { url: registry.url } }),
			getComponentPath: () => ".opencode/components",
		}

		await runAddCore(
			["npm:test-plugin", "kdco/test-plugin"],
			{
				json: true,
				quiet: true,
				trust: true,
			},
			provider,
		)

		expect(fetchSpy).toHaveBeenCalled()
		expect(consoleErrorSpy).not.toHaveBeenCalled()
		expect(consoleLogSpy).toHaveBeenCalledTimes(1)

		const output = String(consoleLogSpy.mock.calls[0]?.[0] ?? "")
		const payload = JSON.parse(output) as {
			success: boolean
			plugins?: string[]
			installed?: string[]
		}

		expect(payload.success).toBe(true)
		expect(payload.plugins).toEqual(["test-plugin"])
		expect(payload.installed).toEqual(["kdco/test-plugin"])
	})

	it("emits strict single-channel JSON on mixed-mode conflict failure without stderr contamination", async () => {
		testDir = await createTempDir("add-json-mixed-failure")

		const fetchSpy = spyOn(global, "fetch").mockImplementation(
			mock(async (input: string | URL | Request, init?: RequestInit) => {
				const url = getRequestUrl(input)
				if (url.startsWith("https://registry.npmjs.org/test-plugin")) {
					return new Response(
						JSON.stringify({
							name: "test-plugin",
							"dist-tags": { latest: "1.0.0" },
							versions: {},
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					)
				}

				return originalFetch(input as RequestInfo | URL, init)
			}) as unknown as typeof fetch,
		)

		const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {})
		const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		let capturedExitCode: number | null = null
		const processExitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
			capturedExitCode = code ?? 0
			throw new Error("process.exit called")
		})

		const conflictDir = join(testDir, ".opencode", "plugins")
		await mkdir(conflictDir, { recursive: true })
		await writeFile(join(conflictDir, "test-plugin.ts"), "// local conflicting content\n")

		const { runAddCore } = await importAddCommandModule()
		const provider = {
			cwd: testDir,
			getRegistries: () => ({ kdco: { url: registry.url } }),
			getComponentPath: () => ".opencode/components",
		}

		let thrownError: unknown
		try {
			await runAddCore(
				["npm:test-plugin", "kdco/test-plugin"],
				{
					json: true,
					quiet: true,
					trust: true,
				},
				provider,
			)
		} catch (error) {
			thrownError = error
		}

		expect(thrownError).toBeDefined()
		expect(fetchSpy).toHaveBeenCalled()

		// No partial JSON should be emitted before command-level error handling.
		expect(consoleLogSpy).not.toHaveBeenCalled()

		try {
			handleError(thrownError, { json: true })
		} catch {
			// Expected: process.exit is mocked to throw.
		}

		// Strict contract: exactly one output channel, one JSON document, no human stderr.
		expect(processExitSpy).toHaveBeenCalledTimes(1)
		expect(capturedExitCode).not.toBe(0)
		expect(consoleErrorSpy).not.toHaveBeenCalled()
		expect(consoleLogSpy).toHaveBeenCalledTimes(1)

		const output = String(consoleLogSpy.mock.calls[0]?.[0] ?? "")
		const payload = JSON.parse(output) as {
			success: boolean
			error?: { code?: string; message?: string }
		}

		expect(payload.success).toBe(false)
		expect(payload.error?.code).toBe("CONFLICT")
		expect(payload.error?.message).toContain("conflicts")
	})
})
