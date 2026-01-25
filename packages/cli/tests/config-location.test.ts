import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

interface LockFile {
	installed: Record<string, unknown>
}

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
		await runCLI(["init", "--force"], dir)

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
			const { exitCode, output } = await runCLI(["add", "kdco/test-plugin", "--force"], testDir)
			if (exitCode !== 0) {
				console.log("add failed:", output)
			}
			expect(exitCode).toBe(0)

			// Should exist in .opencode/
			expect(existsSync(join(testDir, ".opencode", "ocx.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, ".opencode", "opencode.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, ".opencode", "ocx.lock"))).toBe(true)

			// Should NOT exist at root
			expect(existsSync(join(testDir, "ocx.jsonc"))).toBe(false)
			expect(existsSync(join(testDir, "opencode.jsonc"))).toBe(false)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)
		}, 25000)

		it("update writes lock to .opencode/", async () => {
			testDir = await setupWithRegistry("loc-update")

			// Install a component
			await runCLI(["add", "kdco/test-plugin", "--force"], testDir)

			// Change registry content to trigger update
			registry.setFileContent("test-plugin", "index.ts", "// Updated content")

			// Run update
			const { exitCode } = await runCLI(["update", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)

			// Lock should still be in .opencode/
			expect(existsSync(join(testDir, ".opencode", "ocx.lock"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)
		}, 25000)

		it("registry add updates config in .opencode/", async () => {
			testDir = await createTempDir("loc-registry-add")
			await runCLI(["init"], testDir)

			// Add a registry
			await runCLI(["registry", "add", registry.url, "--name", "test"], testDir)

			// Config should be in .opencode/, not at root
			expect(existsSync(join(testDir, ".opencode", "ocx.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.jsonc"))).toBe(false)

			// Verify registry was added to the config
			const configPath = join(testDir, ".opencode", "ocx.jsonc")
			const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
			const registries = config.registries as Record<string, unknown>
			expect(registries.test).toBeDefined()
		}, 25000)

		it("registry remove updates config in .opencode/", async () => {
			testDir = await setupWithRegistry("loc-registry-remove")

			// Remove registry
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
		}, 25000)
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
			const { exitCode, output } = await runCLI(["add", "kdco/test-agent", "--force"], testDir)
			if (exitCode !== 0) {
				console.log("add failed:", output)
			}
			expect(exitCode).toBe(0)

			// Root config should still be there (not moved)
			expect(existsSync(join(testDir, "ocx.jsonc"))).toBe(true)

			// New files should be in .opencode/
			expect(existsSync(join(testDir, ".opencode", "opencode.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, ".opencode", "ocx.lock"))).toBe(true)

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
			const { exitCode, output } = await runCLI(["add", "kdco/test-agent", "--force"], testDir)
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
			testDir = await createTempDir("legacy-root-lock")

			// Create legacy root config files
			const rootOcxJsoncPath = join(testDir, "ocx.jsonc")
			await writeFile(
				rootOcxJsoncPath,
				JSON.stringify({ registries: { kdco: { url: registry.url } } }, null, 2),
			)

			const rootOcxLockPath = join(testDir, "ocx.lock")
			const initialLock = { installed: { "kdco/test-plugin": { version: "1.0.0" } } }
			await writeFile(rootOcxLockPath, JSON.stringify(initialLock, null, 2))

			// Change registry content to trigger update
			registry.setFileContent("test-plugin", "index.ts", "// Updated for legacy lock test")

			// Run update
			const { exitCode } = await runCLI(["update", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)

			// Lock should still be at root, not in .opencode/
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(true)
			expect(existsSync(join(testDir, ".opencode", "ocx.lock"))).toBe(false)

			// Verify lock content was updated
			const updatedLock = parseJsonc(await readFile(rootOcxLockPath, "utf-8")) as LockFile
			expect(updatedLock.installed["kdco/test-plugin"]).toBeDefined()
		}, 25000)

		it("both root ocx.jsonc and root ocx.lock - updates both in place", async () => {
			testDir = await createTempDir("compat-full-legacy")

			// Create full legacy setup at root
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

			// Add component to create lock
			await runCLI(["add", "kdco/test-plugin", "--force"], testDir)

			// Move lock to root
			const lockContent = await readFile(join(testDir, ".opencode", "ocx.lock"), "utf-8")
			await writeFile(join(testDir, "ocx.lock"), lockContent)
			const { rm } = await import("node:fs/promises")
			await rm(join(testDir, ".opencode", "ocx.lock"))

			// Change content
			registry.setFileContent("test-plugin", "index.ts", "// Full legacy update")

			// Run update
			const { exitCode } = await runCLI(["update", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)

			// All configs should stay at root
			expect(existsSync(join(testDir, "ocx.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "opencode.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(true)

			// Nothing new in .opencode/ except component files
			expect(existsSync(join(testDir, ".opencode", "ocx.jsonc"))).toBe(false)
			expect(existsSync(join(testDir, ".opencode", "ocx.lock"))).toBe(false)
		}, 25000)

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

			// Create .opencode dir with lock (mixed setup)
			await mkdir(join(testDir, ".opencode"), { recursive: true })

			// Add component with MCP config (triggers opencode.jsonc creation)
			const { exitCode } = await runCLI(["add", "kdco/test-agent", "--force"], testDir)
			expect(exitCode).toBe(0)

			// Root config stays at root
			expect(existsSync(join(testDir, "ocx.jsonc"))).toBe(true)
			expect(existsSync(join(testDir, ".opencode", "ocx.jsonc"))).toBe(false)

			// Lock created in .opencode/ (new location)
			expect(existsSync(join(testDir, ".opencode", "ocx.lock"))).toBe(true)
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
			const { exitCode } = await runCLI(["add", "kdco/test-agent", "--force"], testDir)
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

			// Setup with registry in .opencode/
			await mkdir(join(testDir, ".opencode"), { recursive: true })
			await writeFile(
				join(testDir, ".opencode", "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: { kdco: { url: registry.url } },
				}),
			)

			// Add a component to create lock in .opencode/
			await runCLI(["add", "kdco/test-plugin", "--force"], testDir)

			// Copy lock to root (creating conflict)
			const lockContent = await readFile(join(testDir, ".opencode", "ocx.lock"), "utf-8")
			await writeFile(join(testDir, "ocx.lock"), lockContent)

			// Modify registry content
			registry.setFileContent("test-plugin", "index.ts", "// Lock conflict test")

			// Update should succeed, using .opencode/ version
			const { exitCode } = await runCLI(["update", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)

			// .opencode/ lock should be updated
			const opencodeLock = parseJsonc(
				await readFile(join(testDir, ".opencode", "ocx.lock"), "utf-8"),
			) as Record<string, unknown>
			const installed = opencodeLock.installed as Record<string, { updatedAt?: string }>
			expect(installed["kdco/test-plugin"].updatedAt).toBeDefined()

			// Verify root lock was NOT updated (should not have updatedAt)
			const rootLockContent = parseJsonc(
				await readFile(join(testDir, "ocx.lock"), "utf-8"),
			) as Record<string, unknown>
			const rootInstalled = rootLockContent.installed as Record<string, { updatedAt?: string }>
			expect(rootInstalled["kdco/test-plugin"].updatedAt).toBeUndefined()
		}, 25000)
	})

	// =========================================================================
	// 4. Update Command Locations
	// =========================================================================

	describe("update command locations", () => {
		it("fresh project - update writes to .opencode/", async () => {
			testDir = await setupWithRegistry("update-loc-fresh")

			// Install component
			await runCLI(["add", "kdco/test-plugin", "--force"], testDir)

			// Verify lock is in .opencode/
			expect(existsSync(join(testDir, ".opencode", "ocx.lock"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)

			// Modify registry content
			registry.setFileContent("test-plugin", "index.ts", "// Fresh update")

			// Run update
			const { exitCode } = await runCLI(["update", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)

			// Lock should still be in .opencode/, not at root
			expect(existsSync(join(testDir, ".opencode", "ocx.lock"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)
		}, 25000)

		it("legacy root lock - update writes to root", async () => {
			testDir = await createTempDir("update-loc-legacy")

			// Create legacy setup with root configs
			await writeFile(
				join(testDir, "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: { kdco: { url: registry.url } },
				}),
			)

			// Install to create lock (will go to .opencode by default)
			await runCLI(["add", "kdco/test-plugin", "--force"], testDir)

			// Move lock to root to simulate legacy
			const lockContent = await readFile(join(testDir, ".opencode", "ocx.lock"), "utf-8")
			await writeFile(join(testDir, "ocx.lock"), lockContent)
			const { rm } = await import("node:fs/promises")
			await rm(join(testDir, ".opencode", "ocx.lock"))

			// Verify: lock at root, not in .opencode
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(true)
			expect(existsSync(join(testDir, ".opencode", "ocx.lock"))).toBe(false)

			// Modify registry content
			registry.setFileContent("test-plugin", "index.ts", "// Legacy update")

			// Run update
			const { exitCode } = await runCLI(["update", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)

			// Lock should still be at root (in-place update)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(true)
			expect(existsSync(join(testDir, ".opencode", "ocx.lock"))).toBe(false)
		}, 25000)
	})

	// =========================================================================
	// 5. Diff Command Locations
	// =========================================================================

	describe("diff command locations", () => {
		it("fresh project - diff reads from .opencode/", async () => {
			testDir = await setupWithRegistry("diff-loc-fresh")

			// Install component
			await runCLI(["add", "kdco/test-plugin", "--force"], testDir)

			// Verify lock locations before running diff
			expect(existsSync(join(testDir, ".opencode", "ocx.lock"))).toBe(true)
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(false)

			// Modify local file
			const pluginPath = join(testDir, ".opencode/plugin/test-plugin.ts")
			await writeFile(pluginPath, "// Modified locally for diff test")

			// Run diff
			const { exitCode, output } = await runCLI(["diff", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)
			expect(output).toContain("Diff for kdco/test-plugin")
			expect(output).toContain("Modified locally for diff test")
		}, 25000)

		it("legacy root lock - diff reads from root", async () => {
			testDir = await createTempDir("diff-loc-legacy")

			// Create legacy setup
			await writeFile(
				join(testDir, "ocx.jsonc"),
				JSON.stringify({
					$schema: "https://ocx.kdco.dev/schemas/ocx.json",
					registries: { kdco: { url: registry.url } },
				}),
			)

			// Install to create lock
			await runCLI(["add", "kdco/test-plugin", "--force"], testDir)

			// Move lock to root
			const lockContent = await readFile(join(testDir, ".opencode", "ocx.lock"), "utf-8")
			await writeFile(join(testDir, "ocx.lock"), lockContent)
			const { rm } = await import("node:fs/promises")
			await rm(join(testDir, ".opencode", "ocx.lock"))

			// Verify lock is at root, not in .opencode
			expect(existsSync(join(testDir, "ocx.lock"))).toBe(true)
			expect(existsSync(join(testDir, ".opencode", "ocx.lock"))).toBe(false)

			// Modify local file
			const pluginPath = join(testDir, ".opencode/plugin/test-plugin.ts")
			await writeFile(pluginPath, "// Legacy diff modification")

			// Run diff - should work with root lock
			const { exitCode, output } = await runCLI(["diff", "kdco/test-plugin"], testDir)
			expect(exitCode).toBe(0)
			expect(output).toContain("Diff for kdco/test-plugin")
			expect(output).toContain("Legacy diff modification")
		}, 25000)
	})
})
