import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { cleanupTempDir, createTempDir, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

describe("ocx search", () => {
	let testDir: string
	let registry: MockRegistry

	beforeEach(async () => {
		testDir = await createTempDir("search-test")
		registry = startMockRegistry()
		await runCLI(["init", "--force"], testDir)
		const addResult = await runCLI(["registry", "add", registry.url, "--name", "kdco"], testDir)
		if (addResult.exitCode !== 0) {
			console.log("Failed to add registry in search test:", addResult.output)
		}
	})

	afterEach(async () => {
		registry.stop()
		await cleanupTempDir(testDir)
	})

	it("should find components across registries", async () => {
		const { exitCode, output } = await runCLI(["search", "test", "--verbose"], testDir)

		if (exitCode !== 0 || !output.includes("kdco/test-agent")) {
			console.log(output)
		}
		expect(exitCode).toBe(0)
		expect(output).toContain("kdco/test-agent")
		expect(output).toContain("kdco/test-skill")
		expect(output).toContain("kdco/test-plugin")
	})

	it("should filter by query", async () => {
		const { exitCode, output } = await runCLI(["search", "agent"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("kdco/test-agent")
		expect(output).not.toContain("kdco/test-skill")
	})

	it("should list installed components with --installed", async () => {
		// Install one component
		await runCLI(["add", "kdco/test-plugin", "--yes"], testDir)

		const { exitCode, output } = await runCLI(["search", "--installed"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("kdco/test-plugin")
		expect(output).not.toContain("kdco/test-agent")
	})

	it("should output JSON when requested", async () => {
		const { exitCode, output } = await runCLI(["search", "test", "--json"], testDir)

		expect(exitCode).toBe(0)
		const json = JSON.parse(output)
		expect(json.success).toBe(true)
		expect(json.data.components).toBeDefined()
		expect(json.data.components.length).toBeGreaterThan(0)
	})
})
