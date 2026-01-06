import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

describe("ocx registry", () => {
	let testDir: string
	let registry: MockRegistry

	beforeEach(async () => {
		testDir = await createTempDir("registry-test")
		registry = startMockRegistry()
		await runCLI(["init", "--force"], testDir)
	})

	afterEach(async () => {
		registry.stop()
		await cleanupTempDir(testDir)
	})

	it("should add a registry", async () => {
		const { exitCode, output } = await runCLI(
			["registry", "add", registry.url, "--name", "test-reg"],
			testDir,
		)

		if (exitCode !== 0) {
			console.log(output)
		}
		expect(exitCode).toBe(0)
		expect(output).toContain("Added registry: test-reg")

		const configPath = join(testDir, "ocx.jsonc")
		const configContent = await Bun.file(configPath).text()
		const config = parseJsonc(configContent)
		expect(config.registries["test-reg"]).toBeDefined()
		expect(config.registries["test-reg"].url).toBe(registry.url)
	})

	it("should list configured registries", async () => {
		await runCLI(["registry", "add", registry.url, "--name", "test-reg"], testDir)

		const { exitCode, output } = await runCLI(["registry", "list"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("test-reg")
		expect(output).toContain(registry.url)
	})

	it("should remove a registry", async () => {
		await runCLI(["registry", "add", registry.url, "--name", "test-reg"], testDir)

		const { exitCode, output } = await runCLI(["registry", "remove", "test-reg"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("Removed registry: test-reg")

		const configPath = join(testDir, "ocx.jsonc")
		const configContent = await Bun.file(configPath).text()
		const config = parseJsonc(configContent)
		expect(config.registries["test-reg"]).toBeUndefined()
	})

	it("should fail if adding to locked registries", async () => {
		// Manually lock registries
		const configPath = join(testDir, "ocx.jsonc")
		const configContent = await Bun.file(configPath).text()
		const config = parseJsonc(configContent)
		config.lockRegistries = true
		await Bun.write(configPath, JSON.stringify(config, null, 2))

		const { exitCode, output } = await runCLI(["registry", "add", "http://example.com"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("Registries are locked")
	})
})
