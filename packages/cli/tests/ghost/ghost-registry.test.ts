/**
 * Ghost Registry Command Tests
 *
 * Tests for the `ocx ghost registry` subcommands:
 * - registry add: adds a registry to ghost config
 * - registry add: throws if already exists (or updates)
 * - registry remove: removes a registry from config
 * - registry remove: throws if registry not found
 * - registry list: outputs all registries
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { getGhostConfigPath, loadGhostConfig } from "../../src/ghost/config.js"

// =============================================================================
// HELPERS
// =============================================================================

interface CLIResult {
	stdout: string
	stderr: string
	output: string
	exitCode: number
}

async function createTempConfigDir(name: string): Promise<string> {
	const dir = join(import.meta.dir, "fixtures", `tmp-${name}-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	return dir
}

async function cleanupTempDir(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true })
}

async function runGhostCLI(args: string[], env: Record<string, string> = {}): Promise<CLIResult> {
	const indexPath = join(import.meta.dir, "..", "..", "src/index.ts")

	const proc = Bun.spawn(["bun", "run", indexPath, "ghost", ...args], {
		env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...env },
		stdout: "pipe",
		stderr: "pipe",
	})

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	])

	const exitCode = await proc.exited

	return {
		stdout,
		stderr,
		output: stdout + stderr,
		exitCode,
	}
}

// =============================================================================
// TESTS
// =============================================================================

describe("ocx ghost registry", () => {
	let testDir: string
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeEach(async () => {
		testDir = await createTempConfigDir("ghost-registry")
		// Initialize ghost config for each test
		await runGhostCLI(["init"], { XDG_CONFIG_HOME: testDir })
		// Set XDG_CONFIG_HOME for loadGhostConfig calls
		process.env.XDG_CONFIG_HOME = testDir
	})

	afterEach(async () => {
		// Restore original XDG_CONFIG_HOME
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		await cleanupTempDir(testDir)
	})

	// ===========================================================================
	// REGISTRY ADD
	// ===========================================================================

	describe("registry add", () => {
		it("should add a registry to ghost config", async () => {
			const { exitCode, output } = await runGhostCLI(
				["registry", "add", "https://my.registry.com", "--name", "my-registry"],
				{ XDG_CONFIG_HOME: testDir },
			)

			if (exitCode !== 0) {
				console.log("Output:", output)
			}
			expect(exitCode).toBe(0)
			expect(output).toContain("Added registry")
			expect(output).toContain("my-registry")

			// Verify config was updated
			const config = await loadGhostConfig()
			expect(config.registries["my-registry"]).toBeDefined()
			expect(config.registries["my-registry"].url).toBe("https://my.registry.com")
		})

		it("should update registry if it already exists", async () => {
			// Add initial registry
			await runGhostCLI(["registry", "add", "https://old.com", "--name", "test-reg"], {
				XDG_CONFIG_HOME: testDir,
			})

			// Update same registry
			const { exitCode, output } = await runGhostCLI(
				["registry", "add", "https://new.com", "--name", "test-reg"],
				{ XDG_CONFIG_HOME: testDir },
			)

			expect(exitCode).toBe(0)
			expect(output).toContain("Updated registry")

			// Verify config was updated
			const config = await loadGhostConfig()
			expect(config.registries["test-reg"].url).toBe("https://new.com")
		})

		it("should fail if ghost mode is not initialized", async () => {
			// Create a fresh temp dir without initialization
			const freshDir = await createTempConfigDir("ghost-registry-fresh")

			const { exitCode, output } = await runGhostCLI(
				["registry", "add", "https://test.com", "--name", "test"],
				{ XDG_CONFIG_HOME: freshDir },
			)

			expect(exitCode).not.toBe(0)
			expect(output).toContain("not initialized")

			await cleanupTempDir(freshDir)
		})

		it("should output JSON when --json flag is used", async () => {
			const { exitCode, output } = await runGhostCLI(
				["registry", "add", "https://json.test.com", "--name", "json-reg", "--json"],
				{ XDG_CONFIG_HOME: testDir },
			)

			expect(exitCode).toBe(0)

			const json = JSON.parse(output)
			expect(json.success).toBe(true)
			expect(json.data.name).toBe("json-reg")
			expect(json.data.url).toBe("https://json.test.com")
		})

		it("should derive name from hostname when --name is not provided", async () => {
			const { exitCode, output } = await runGhostCLI(
				["registry", "add", "https://my.custom.registry.com"],
				{ XDG_CONFIG_HOME: testDir },
			)

			expect(exitCode).toBe(0)
			expect(output).toContain("Added registry")
			expect(output).toContain("my-custom-registry-com")

			// Verify config was updated with derived name
			const config = await loadGhostConfig()
			expect(config.registries["my-custom-registry-com"]).toBeDefined()
			expect(config.registries["my-custom-registry-com"].url).toBe("https://my.custom.registry.com")
		})
	})

	// ===========================================================================
	// REGISTRY REMOVE
	// ===========================================================================

	describe("registry remove", () => {
		it("should remove a registry from ghost config", async () => {
			// Add a registry first
			await runGhostCLI(["registry", "add", "https://remove.me", "--name", "to-remove"], {
				XDG_CONFIG_HOME: testDir,
			})

			// Remove it
			const { exitCode, output } = await runGhostCLI(["registry", "remove", "to-remove"], {
				XDG_CONFIG_HOME: testDir,
			})

			expect(exitCode).toBe(0)
			expect(output).toContain("Removed registry")
			expect(output).toContain("to-remove")

			// Verify it was removed
			const config = await loadGhostConfig()
			expect(config.registries["to-remove"]).toBeUndefined()
		})

		it("should throw if registry is not found", async () => {
			const { exitCode, output } = await runGhostCLI(["registry", "remove", "nonexistent"], {
				XDG_CONFIG_HOME: testDir,
			})

			expect(exitCode).not.toBe(0)
			expect(output).toContain("not found")
		})

		it("should fail if ghost mode is not initialized", async () => {
			const freshDir = await createTempConfigDir("ghost-registry-remove-fresh")

			const { exitCode, output } = await runGhostCLI(["registry", "remove", "test"], {
				XDG_CONFIG_HOME: freshDir,
			})

			expect(exitCode).not.toBe(0)
			expect(output).toContain("not initialized")

			await cleanupTempDir(freshDir)
		})

		it("should output JSON when --json flag is used", async () => {
			// Add a registry first
			await runGhostCLI(["registry", "add", "https://remove.me", "--name", "json-remove"], {
				XDG_CONFIG_HOME: testDir,
			})

			const { exitCode, output } = await runGhostCLI(
				["registry", "remove", "json-remove", "--json"],
				{ XDG_CONFIG_HOME: testDir },
			)

			expect(exitCode).toBe(0)

			const json = JSON.parse(output)
			expect(json.success).toBe(true)
			expect(json.data.removed).toBe("json-remove")
		})
	})

	// ===========================================================================
	// REGISTRY LIST
	// ===========================================================================

	describe("registry list", () => {
		it("should output all registries", async () => {
			// Add some registries
			await runGhostCLI(["registry", "add", "https://one.com", "--name", "reg-one"], {
				XDG_CONFIG_HOME: testDir,
			})
			await runGhostCLI(["registry", "add", "https://two.com", "--name", "reg-two"], {
				XDG_CONFIG_HOME: testDir,
			})

			const { exitCode, output } = await runGhostCLI(["registry", "list"], {
				XDG_CONFIG_HOME: testDir,
			})

			expect(exitCode).toBe(0)
			expect(output).toContain("reg-one")
			expect(output).toContain("https://one.com")
			expect(output).toContain("reg-two")
			expect(output).toContain("https://two.com")
		})

		it("should show message when no registries are configured", async () => {
			// Remove default registry if it exists
			process.env.XDG_CONFIG_HOME = testDir
			const configPath = getGhostConfigPath()
			await Bun.write(configPath, '{"registries": {}, "opencode": {}}')

			const { exitCode, output } = await runGhostCLI(["registry", "list"], {
				XDG_CONFIG_HOME: testDir,
			})

			expect(exitCode).toBe(0)
			expect(output).toContain("No registries configured")
		})

		it("should fail if ghost mode is not initialized", async () => {
			const freshDir = await createTempConfigDir("ghost-registry-list-fresh")

			const { exitCode, output } = await runGhostCLI(["registry", "list"], {
				XDG_CONFIG_HOME: freshDir,
			})

			expect(exitCode).not.toBe(0)
			expect(output).toContain("not initialized")

			await cleanupTempDir(freshDir)
		})

		it("should output JSON when --json flag is used", async () => {
			// Add a registry
			await runGhostCLI(["registry", "add", "https://list.com", "--name", "json-list"], {
				XDG_CONFIG_HOME: testDir,
			})

			const { exitCode, output } = await runGhostCLI(["registry", "list", "--json"], {
				XDG_CONFIG_HOME: testDir,
			})

			expect(exitCode).toBe(0)

			const json = JSON.parse(output)
			expect(json.success).toBe(true)
			expect(json.data.registries).toBeDefined()
			expect(Array.isArray(json.data.registries)).toBe(true)

			const jsonListReg = json.data.registries.find((r: { name: string }) => r.name === "json-list")
			expect(jsonListReg).toBeDefined()
			expect(jsonListReg.url).toBe("https://list.com")
		})
	})
})
