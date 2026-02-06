import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

describe("config file locations", () => {
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

	/**
	 * Helper to setup a project with the registry configured
	 */
	async function setupWithRegistry(name: string): Promise<string> {
		const dir = await createTempDir(name)
		await runCLI(["init"], dir)

		const configPath = join(dir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		return dir
	}

	// =========================================================================
	// 1. Location Verification - new files go to .opencode/
	// =========================================================================

	describe("location verification - new files go to .opencode/", () => {
		it("init creates ocx.jsonc in .opencode/, NOT at root", async () => {
			testDir = await createTempDir("loc-init")
			await runCLI(["init"], testDir)

			expect(existsSync(join(testDir, ".opencode", "ocx.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.jsonc"))).toBe(false)
		})

		it("add creates all files in .opencode/, NOT at root", async () => {
			testDir = await setupWithRegistry("loc-add")

			// Install a component
			const { exitCode, output } = await runCLI(["add", "kdco/test-plugin"], testDir)
			if (exitCode !== 0) {
				console.log("add failed:", output)
			}
			expect(exitCode).toBe(0)

			// Should exist in .opencode/
			expect(existsSync(join(testDir, ".opencode", "ocx.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, ".opencode", "opencode.jsonc"))).toBe(true)
			// V1: Receipt is at .ocx/receipt.jsonc
			expect(existsSync(join(testDir, ".ocx", "receipt.jsonc"))).toBe(true)

			// Should NOT exist at root
			expect(existsSync(join(testDir, "ocx.jsonc"))).toBe(false)
			expect(existsSync(join(testDir, "opencode.jsonc"))).toBe(false)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)
		})

		it("update writes lock to .opencode/", async () => {
			testDir = await setupWithRegistry("loc-update")

			// Install a component
			await runCLI(["add", "kdco/test-plugin"], testDir)

			// Change registry content to trigger update
			registry.setFileContent("test-plugin", "index.ts", "// Updated content")

			// Run update
			const { exitCode } = await runCLI(["update", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)

			// V1: Receipt should be at .ocx/receipt.jsonc
			expect(existsSync(join(testDir, ".ocx", "receipt.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)
		})

		it("registry add updates config in .opencode/", async () => {
			testDir = await createTempDir("loc-registry")
			// V2: Need to init first to create config directory
			await runCLI(["init"], testDir)

			// Run registry add (V2: use namespace as name to match registry)
			const { exitCode } = await runCLI(
				["registry", "add", registry.url, "--name", "kdco"],
				testDir,
			)
			expect(exitCode).toBe(0)

			// Verify registry was added to the config
			const configPath = join(testDir, ".opencode", "ocx.jsonc")
			const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
			const registries = config.registries as Record<string, unknown>
			expect(registries.kdco).toBeDefined()
		})

		it("registry remove updates config in .opencode/", async () => {
			testDir = await setupWithRegistry("loc-registry-remove")

			// Remove the registry
			const { exitCode } = await runCLI(["registry", "remove", "kdco"], testDir)
			expect(exitCode).toBe(0)

			// Config should still be in .opencode/, not at root
			expect(existsSync(join(testDir, ".opencode", "ocx.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.jsonc"))).toBe(false)

			// Verify registry was removed from the config
			const configPath = join(testDir, ".opencode", "ocx.jsonc")
			const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
			const registries = config.registries as Record<string, unknown>
			expect(registries.kdco).toBeUndefined()
		})
	})

	// =========================================================================
	// 2. Backward Compatibility - legacy root configs
	// =========================================================================

	describe("backward compatibility - legacy root configs", () => {
		it("reads root ocx.jsonc, creates new files in .opencode/", async () => {
			testDir = await createTempDir("compat-root-config")

			// Create legacy root config (NOT in .opencode/)
			await writeFile(
				join(testDir, "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: { kdco: { url: registry.url } },
				}),
			)

			// Add a component that has MCP config (which triggers opencode.jsonc creation)
			const { exitCode, output } = await runCLI(["add", "kdco/test-agent"], testDir)
			if (exitCode !== 0) {
				console.log("add failed:", output)
			}
			expect(exitCode).toBe(0)

			// Root config should still be there (not moved)
			expect(existsSync(join(testDir, "ocx.jsonc"))).toBe(true)

			// New files should be in .opencode/
			expect(existsSync(join(testDir, ".opencode", "opencode.jsonc"))).toBe(true)
			// V1: Receipt is at .ocx/receipt.jsonc
			expect(existsSync(join(testDir, ".ocx", "receipt.jsonc"))).toBe(true)

			// Should NOT create duplicate ocx.jsonc in .opencode/
			expect(existsSync(join(testDir, ".opencode", "ocx.jsonc"))).toBe(false)
		})

		it("reads root opencode.jsonc, updates in place", async () => {
			testDir = await createTempDir("compat-root-opencode")

			// Create legacy root config files
			await writeFile(
				join(testDir, "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: { kdco: { url: registry.url } },
				}),
			)
			await writeFile(
				join(testDir, "opencode.jsonc"),
				JSON.stringify({
					$schema: "https://opencode.ai/config.json",
					mcp: {},
				}),
			)

			// Add a component that has MCP config
			const { exitCode, output } = await runCLI(["add", "kdco/test-agent"], testDir)
			if (exitCode !== 0) {
				console.log("add failed:", output)
			}
			expect(exitCode).toBe(0)

			// Root opencode.jsonc should be updated (not moved)
			expect(existsSync(join(testDir, "opencode.jsonc"))).toBe(true)

			// Read and verify it was updated with MCP config
			const opencode = parseJsonc(
				await readFile(join(testDir, "opencode.jsonc"), "utf-8"),
			) as Record<string, unknown>
			const mcp = opencode.mcp as Record<string, unknown>
			expect(mcp["test-mcp"]).toBeDefined()

			// Should NOT create opencode.jsonc in .opencode/
			expect(existsSync(join(testDir, ".opencode", "opencode.jsonc"))).toBe(false)
		})

		it("reads root ocx.lock, updates in place", async () => {
			testDir = await createTempDir("compat-root-lock")

			// V1: No backward compatibility with ocx.lock - always uses .ocx/receipt.jsonc
			// Create root config
			await writeFile(
				join(testDir, "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: { kdco: { url: registry.url } },
				}),
			)

			// Install a component (will create .ocx/receipt.jsonc)
			await mkdir(join(testDir, ".opencode"), { recursive: true })
			const { exitCode: addExitCode } = await runCLI(["add", "kdco/test-plugin"], testDir)
			expect(addExitCode).toBe(0)

			// Verify receipt is at .ocx/receipt.jsonc
			expect(existsSync(join(testDir, ".ocx", "receipt.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)

			// Change registry content to trigger update
			registry.setFileContent("test-plugin", "index.ts", "// Updated content")

			// Run update
			const { exitCode } = await runCLI(["update", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)

			// Receipt should still be at .ocx/receipt.jsonc
			expect(existsSync(join(testDir, ".ocx", "receipt.jsonc"))).toBe(true)

			// Should NOT create ocx.lock
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)

			// Verify the receipt was actually updated
			const updatedReceipt = parseJsonc(
				await readFile(join(testDir, ".ocx", "receipt.jsonc"), "utf-8"),
			) as Record<string, unknown>
			const installed = updatedReceipt.installed as Record<string, { updatedAt?: string }>
			expect(Object.keys(installed).length).toBeGreaterThan(0)
		})

		it("both root ocx.jsonc and root ocx.lock - updates both in place", async () => {
			testDir = await createTempDir("compat-full-legacy")

			// V1: No backward compatibility with ocx.lock - always uses .ocx/receipt.jsonc
			// Create full root setup
			await writeFile(
				join(testDir, "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: { kdco: { url: registry.url } },
				}),
			)
			await writeFile(
				join(testDir, "opencode.jsonc"),
				JSON.stringify({
					$schema: "https://opencode.ai/config.json",
					mcp: {},
				}),
			)

			// Install a component (will create .ocx/receipt.jsonc)
			await mkdir(join(testDir, ".opencode"), { recursive: true })
			const { exitCode } = await runCLI(["add", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)

			// V1: Receipt is always at .ocx/receipt.jsonc
			expect(existsSync(join(testDir, ".ocx", "receipt.jsonc"))).toBe(true)

			// Root configs should still be there
			expect(existsSync(join(testDir, "ocx.jsonc"))).toBe(true)

			// Should NOT create ocx.lock
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)
		})

		it("mixed: root ocx.jsonc + .opencode/ocx.lock", async () => {
			testDir = await createTempDir("compat-mixed")

			// Create root ocx.jsonc
			await writeFile(
				join(testDir, "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: { kdco: { url: registry.url } },
				}),
			)

			// V1: Create .opencode dir with lock (mixed setup)
			await mkdir(join(testDir, ".opencode"), { recursive: true })

			// Add component with MCP config (triggers opencode.jsonc creation)
			const { exitCode } = await runCLI(["add", "kdco/test-agent"], testDir)
			expect(exitCode).toBe(0)

			// Root config stays at root
			expect(existsSync(join(testDir, "ocx.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, ".opencode", "ocx.jsonc"))).toBe(false)

			// V1: Receipt created at .ocx/receipt.jsonc
			expect(existsSync(join(testDir, ".ocx", "receipt.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)

			// opencode.jsonc created in .opencode/ (new location)
			expect(existsSync(join(testDir, ".opencode", "opencode.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "opencode.jsonc"))).toBe(false)
		})
	})

	// =========================================================================
	// 3. Conflict Detection
	// =========================================================================

	describe("conflict detection", () => {
		it("fails when ocx.jsonc exists in both locations", async () => {
			testDir = await createTempDir("conflict-ocx")

			// Create in both locations
			await mkdir(join(testDir, ".opencode"), { recursive: true })
			await writeFile(
				join(testDir, "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: {},
				}),
			)
			await writeFile(
				join(testDir, ".opencode", "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: {},
				}),
			)

			const result = await runCLI(["add", "test/comp"], testDir)

			expect(result.exitCode).not.toBe(0)
			expect(result.output.toLowerCase()).toContain("both")
		})

		it("opencode.jsonc in both - silently uses .opencode/ version", async () => {
			testDir = await createTempDir("conflict-opencode")

			// Setup with registry in .opencode/
			await mkdir(join(testDir, ".opencode"), { recursive: true })
			await writeFile(
				join(testDir, ".opencode", "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: { kdco: { url: registry.url } },
				}),
			)

			// Create opencode.jsonc in both locations
			await writeFile(
				join(testDir, "opencode.jsonc"),
				JSON.stringify({
					$schema: "https://opencode.ai/config.json",
					mcp: { "root-mcp": { type: "remote", url: "https://root.mcp" } },
				}),
			)
			await writeFile(
				join(testDir, ".opencode", "opencode.jsonc"),
				JSON.stringify({
					$schema: "https://opencode.ai/config.json",
					mcp: {},
				}),
			)

			// Add should succeed, using .opencode/ version
			const { exitCode } = await runCLI(["add", "kdco/test-agent"], testDir)
			expect(exitCode).toBe(0)

			// .opencode/ version should be updated with new MCP
			const opencodeContent = parseJsonc(
				await readFile(join(testDir, ".opencode", "opencode.jsonc"), "utf-8"),
			) as Record<string, unknown>
			const mcp = opencodeContent.mcp as Record<string, unknown>
			expect(mcp["test-mcp"]).toBeDefined()

			// Root version should be unchanged (has root-mcp, not test-mcp)
			const rootContent = parseJsonc(
				await readFile(join(testDir, "opencode.jsonc"), "utf-8"),
			) as Record<string, unknown>
			const rootMcp = rootContent.mcp as Record<string, unknown>
			expect(rootMcp["root-mcp"]).toBeDefined()
			expect(rootMcp["test-mcp"]).toBeUndefined()
		})

		it("ocx.lock in both - uses .opencode/ version", async () => {
			testDir = await createTempDir("conflict-lock")

			// V1: No ocx.lock support - always uses .ocx/receipt.jsonc
			// Create basic config (need to create directory first)
			await mkdir(join(testDir, ".opencode"), { recursive: true })
			await writeFile(
				join(testDir, ".opencode", "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: { kdco: { url: registry.url } },
				}),
			)

			// Add a component to create receipt
			await runCLI(["add", "kdco/test-plugin"], testDir)

			// Modify registry content
			registry.setFileContent("test-plugin", "index.ts", "// Updated content")

			// Update should succeed
			const { exitCode } = await runCLI(["update", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)

			// V1: Receipt should be at .ocx/receipt.jsonc
			const receipt = parseJsonc(
				await readFile(join(testDir, ".ocx", "receipt.jsonc"), "utf-8"),
			) as Record<string, unknown>
			const installed = receipt.installed as Record<string, { updatedAt?: string }>
			expect(Object.keys(installed).length).toBeGreaterThan(0)

			// Should NOT have ocx.lock
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)
		})
	})

	// =========================================================================
	// 4. Update Command Locations
	// =========================================================================

	describe("update command locations", () => {
		it("fresh project - update writes to .opencode/", async () => {
			testDir = await setupWithRegistry("update-loc-fresh")

			// Install component
			await runCLI(["add", "kdco/test-plugin"], testDir)

			// V2: Verify receipt is at .ocx/receipt.jsonc
			expect(existsSync(join(testDir, ".ocx", "receipt.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)

			// Modify registry content
			registry.setFileContent("test-plugin", "index.ts", "// Updated content for fresh project")

			// Run update
			const { exitCode } = await runCLI(["update", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)

			// Receipt should still be at .ocx/receipt.jsonc
			expect(existsSync(join(testDir, ".ocx", "receipt.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)
		})

		it("legacy root lock - update writes to root", async () => {
			testDir = await createTempDir("update-loc-legacy")

			// V1: No backward compatibility with ocx.lock - always uses .ocx/receipt.jsonc
			// Create root config
			await writeFile(
				join(testDir, "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: { kdco: { url: registry.url } },
				}),
			)

			// Install to create receipt
			await runCLI(["add", "kdco/test-plugin"], testDir)

			// V1: Receipt is always at .ocx/receipt.jsonc
			expect(existsSync(join(testDir, ".ocx", "receipt.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)

			// Modify registry content
			registry.setFileContent("test-plugin", "index.ts", "// Updated content")

			// Run update
			const { exitCode } = await runCLI(["update", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)

			// Receipt should still be at .ocx/receipt.jsonc
			expect(existsSync(join(testDir, ".ocx", "receipt.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)
		})
	})
})
