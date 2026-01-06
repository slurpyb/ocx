import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

describe("ocx diff", () => {
	let testDir: string
	let registry: MockRegistry

	beforeEach(async () => {
		testDir = await createTempDir("diff-test")
		registry = startMockRegistry()
		await runCLI(["init", "--force"], testDir)
		await runCLI(["registry", "add", registry.url, "--name", "kdco"], testDir)
	})

	afterEach(async () => {
		registry.stop()
		await cleanupTempDir(testDir)
	})

	it("should show no changes when local matches upstream", async () => {
		// Mock an install
		await runCLI(["add", "kdco/test-plugin", "--yes"], testDir)

		const { exitCode, output } = await runCLI(["diff", "kdco/test-plugin"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("No changes")
	})

	it("should detect changes when local file is modified", async () => {
		// Mock an install
		await runCLI(["add", "kdco/test-plugin", "--yes"], testDir)

		// Modify the local file
		const pluginPath = join(testDir, ".opencode/plugin/test-plugin.ts")
		await writeFile(pluginPath, "console.log('modified')")

		const { exitCode, output } = await runCLI(["diff", "kdco/test-plugin"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("Diff for kdco/test-plugin")
		expect(output).toContain("+console.log('modified')")
	})
})
