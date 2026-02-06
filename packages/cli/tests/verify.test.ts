/**
 * Tests for ocx verify command
 * Tests file integrity verification for installed components
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

describe("ocx verify", () => {
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
	 * Helper to initialize project and add registry
	 */
	async function setupProject(name: string): Promise<string> {
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

	/**
	 * Helper to install a component
	 */
	async function installComponent(dir: string, componentName: string): Promise<void> {
		const { exitCode, output } = await runCLI(["add", componentName], dir)
		if (exitCode !== 0) {
			throw new Error(`Failed to install ${componentName}: ${output}`)
		}
	}

	// =========================================================================
	// No components installed
	// =========================================================================

	it("should succeed with no components installed (normal output)", async () => {
		testDir = await setupProject("verify-no-components")

		const { exitCode, output } = await runCLI(["verify"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("No components installed")
	})

	it("should succeed with no components installed (JSON output)", async () => {
		testDir = await setupProject("verify-no-components-json")

		const { exitCode, output } = await runCLI(["verify", "--json"], testDir)

		expect(exitCode).toBe(0)

		const json = JSON.parse(output)
		expect(json.success).toBe(true)
		expect(json.verified).toEqual([])
		expect(json.errors).toEqual([])
	})

	// =========================================================================
	// All components intact
	// =========================================================================

	it("should verify all intact components successfully", async () => {
		testDir = await setupProject("verify-intact")

		// Install components
		await installComponent(testDir, "kdco/test-plugin")
		await installComponent(testDir, "kdco/test-skill")

		const { exitCode, output } = await runCLI(["verify"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("All components verified successfully")
	})

	it("should verify all intact components with JSON output", async () => {
		testDir = await setupProject("verify-intact-json")

		await installComponent(testDir, "kdco/test-plugin")

		const { exitCode, output } = await runCLI(["verify", "--json"], testDir)

		expect(exitCode).toBe(0)

		const json = JSON.parse(output)
		expect(json.success).toBe(true)
		expect(json.verified.length).toBeGreaterThan(0)
		expect(json.errors).toEqual([])

		// Verify structure of verified entry
		const verifiedEntry = json.verified[0]
		expect(verifiedEntry.canonicalId).toBeDefined()
		expect(verifiedEntry.intact).toBe(true)
		expect(verifiedEntry.modified).toEqual([])
		expect(verifiedEntry.missing).toEqual([])
	})

	// =========================================================================
	// Verify specific canonical ID
	// =========================================================================

	it("should verify a specific component by canonical ID", async () => {
		testDir = await setupProject("verify-specific")

		await installComponent(testDir, "kdco/test-plugin")
		await installComponent(testDir, "kdco/test-skill")

		// Read receipt to get canonical ID
		const receiptPath = join(testDir, ".ocx/receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKeys = Object.keys(receipt.installed as Record<string, unknown>)
		const pluginKey = installedKeys.find((k) => k.includes("test-plugin"))

		expect(pluginKey).toBeDefined()
		if (!pluginKey) throw new Error("pluginKey should be defined")

		const { exitCode, output } = await runCLI(["verify", pluginKey], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("All components verified successfully")
	})

	// =========================================================================
	// Modified file detection
	// =========================================================================

	it("should detect modified file and fail with conflict", async () => {
		testDir = await setupProject("verify-modified")

		await installComponent(testDir, "kdco/test-plugin")

		// Modify the installed file
		const filePath = join(testDir, "plugins/test-plugin.ts")
		expect(existsSync(filePath)).toBe(true)
		await writeFile(filePath, "// Modified by user - this is different content")

		const { exitCode, output } = await runCLI(["verify"], testDir)

		// Should fail due to integrity check failure
		expect(exitCode).not.toBe(0)
		expect(output).toContain("integrity check failed")
		expect(output).toContain("Modified")
	})

	it("should report modified files in JSON output", async () => {
		testDir = await setupProject("verify-modified-json")

		await installComponent(testDir, "kdco/test-plugin")

		// Modify the installed file
		const filePath = join(testDir, "plugins/test-plugin.ts")
		await writeFile(filePath, "// Modified content")

		const { exitCode, output } = await runCLI(["verify", "--json"], testDir)

		expect(exitCode).not.toBe(0)

		const json = JSON.parse(output)
		expect(json.success).toBe(false)
		expect(json.errors.length).toBeGreaterThan(0)

		const errorEntry = json.errors[0]
		expect(errorEntry.intact).toBe(false)
		expect(errorEntry.modified.length).toBeGreaterThan(0)
	})

	// =========================================================================
	// Missing file detection
	// =========================================================================

	it("should detect missing file and fail", async () => {
		testDir = await setupProject("verify-missing")

		await installComponent(testDir, "kdco/test-plugin")

		// Delete the installed file
		const filePath = join(testDir, "plugins/test-plugin.ts")
		expect(existsSync(filePath)).toBe(true)
		await Bun.spawn(["rm", filePath]).exited

		const { exitCode, output } = await runCLI(["verify"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("integrity check failed")
		expect(output).toContain("Missing")
	})

	it("should report missing files in JSON output", async () => {
		testDir = await setupProject("verify-missing-json")

		await installComponent(testDir, "kdco/test-plugin")

		// Delete the installed file
		const filePath = join(testDir, "plugins/test-plugin.ts")
		await Bun.spawn(["rm", filePath]).exited

		const { exitCode, output } = await runCLI(["verify", "--json"], testDir)

		expect(exitCode).not.toBe(0)

		const json = JSON.parse(output)
		expect(json.success).toBe(false)
		expect(json.errors.length).toBeGreaterThan(0)

		const errorEntry = json.errors[0]
		expect(errorEntry.intact).toBe(false)
		expect(errorEntry.missing.length).toBeGreaterThan(0)
	})

	// =========================================================================
	// Mixed intact and broken components
	// =========================================================================

	it("should report both verified and errors in JSON when mixed", async () => {
		testDir = await setupProject("verify-mixed")

		// Install two components
		await installComponent(testDir, "kdco/test-plugin")
		await installComponent(testDir, "kdco/test-skill")

		// Modify only the plugin file (skill should remain intact)
		const pluginPath = join(testDir, "plugins/test-plugin.ts")
		await writeFile(pluginPath, "// Modified plugin content")

		const { exitCode, output } = await runCLI(["verify", "--json"], testDir)

		expect(exitCode).not.toBe(0)

		const json = JSON.parse(output)
		expect(json.success).toBe(false)

		// Should have both verified and error entries
		expect(json.verified.length).toBeGreaterThan(0)
		expect(json.errors.length).toBeGreaterThan(0)

		// Verify bucket structure
		const intactEntry = json.verified.find((e: { intact: boolean }) => e.intact === true)
		const brokenEntry = json.errors.find((e: { intact: boolean }) => e.intact === false)

		expect(intactEntry).toBeDefined()
		expect(brokenEntry).toBeDefined()
	})

	// =========================================================================
	// Unknown requested canonical ID
	// =========================================================================

	it("should warn for unknown canonical ID but not fail", async () => {
		testDir = await setupProject("verify-unknown")

		await installComponent(testDir, "kdco/test-plugin")

		// Verify a non-existent component - should warn but exit 0 since
		// the command doesn't fail for unknown components (non-fatal warning)
		const { exitCode, output } = await runCLI(["verify", "unknown-component"], testDir)

		// Command succeeds (warning is non-fatal)
		expect(exitCode).toBe(0)
		expect(output).toContain("not found")
	})

	// =========================================================================
	// Not initialized / no receipt
	// =========================================================================

	it("should fail when project not initialized", async () => {
		testDir = await createTempDir("verify-not-init")

		const { exitCode, output } = await runCLI(["verify"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("ocx init")
	})

	it("should succeed with no receipt (no components installed)", async () => {
		testDir = await setupProject("verify-no-receipt")

		// Project is initialized but no components installed (no receipt)
		const { exitCode, output } = await runCLI(["verify"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("No components installed")
	})
})
