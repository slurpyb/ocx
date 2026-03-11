import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, runCLI } from "./helpers"

const REGISTRY_SCHEMA_V2_URL = "https://ocx.kdco.dev/schemas/v2/registry.json"

describe("ocx validate", () => {
	let testDir: string

	beforeEach(async () => {
		testDir = await createTempDir("validate-test")
	})

	afterEach(async () => {
		await cleanupTempDir(testDir)
	})

	it("should validate a valid registry source", async () => {
		const sourceDir = join(testDir, "registry")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			$schema: REGISTRY_SCHEMA_V2_URL,
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "test-component",
					type: "plugin",
					description: "Test component",
					files: [{ path: "test.ts", target: "plugins/test.ts" }],
					dependencies: [],
				},
			],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		const filesDir = join(sourceDir, "files")
		await mkdir(filesDir, { recursive: true })
		await writeFile(join(filesDir, "test.ts"), "// test file")

		const { exitCode, output } = await runCLI(["validate", "registry"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("✓")
		expect(output).toContain("valid")
	})

	it("should report validation errors for missing source files", async () => {
		const sourceDir = join(testDir, "registry")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			$schema: REGISTRY_SCHEMA_V2_URL,
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "test-component",
					type: "plugin",
					description: "Test component",
					files: [{ path: "missing.ts", target: "plugins/missing.ts" }],
					dependencies: [],
				},
			],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		const filesDir = join(sourceDir, "files")
		await mkdir(filesDir, { recursive: true })

		const { exitCode, output } = await runCLI(["validate", "registry"], testDir)

		expect(exitCode).toBe(1)
		expect(output).toContain("missing.ts")
	})

	it("should report schema validation errors", async () => {
		const sourceDir = join(testDir, "registry")
		await mkdir(sourceDir, { recursive: true })

		const invalidRegistryJson = {
			$schema: REGISTRY_SCHEMA_V2_URL,
			name: "Test Registry",
			// Missing required 'version' field
			author: "Test Author",
			components: [],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(invalidRegistryJson, null, 2))

		const { exitCode, output } = await runCLI(["validate", "registry"], testDir)

		expect(exitCode).toBe(1)
		expect(output).toContain("validation")
	})

	it("should detect circular dependencies", async () => {
		const sourceDir = join(testDir, "registry")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			$schema: REGISTRY_SCHEMA_V2_URL,
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "component-a",
					type: "plugin",
					description: "Component A",
					files: [],
					dependencies: ["component-b"],
				},
				{
					name: "component-b",
					type: "plugin",
					description: "Component B",
					files: [],
					dependencies: ["component-c"],
				},
				{
					name: "component-c",
					type: "plugin",
					description: "Component C",
					files: [],
					dependencies: ["component-a"], // Creates circular dependency
				},
			],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		const filesDir = join(sourceDir, "files")
		await mkdir(filesDir, { recursive: true })

		const { exitCode, output } = await runCLI(["validate", "registry"], testDir)

		expect(exitCode).toBe(1)
		expect(output.toLowerCase()).toContain("circular")
	})

	it("should detect duplicate file targets across components", async () => {
		const sourceDir = join(testDir, "registry")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			$schema: REGISTRY_SCHEMA_V2_URL,
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "component-a",
					type: "plugin",
					description: "Component A",
					files: [{ path: "file-a.ts", target: "plugins/shared.ts" }],
					dependencies: [],
				},
				{
					name: "component-b",
					type: "plugin",
					description: "Component B",
					files: [{ path: "file-b.ts", target: "plugins/shared.ts" }], // Duplicate target
					dependencies: [],
				},
			],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		const filesDir = join(sourceDir, "files")
		await mkdir(filesDir, { recursive: true })
		await writeFile(join(filesDir, "file-a.ts"), "// file a")
		await writeFile(join(filesDir, "file-b.ts"), "// file b")

		const { exitCode, output } = await runCLI(["validate", "registry"], testDir)

		expect(exitCode).toBe(1)
		expect(output.toLowerCase()).toContain("duplicate")
	})

	it("should exit with code 1 in strict mode when validation fails", async () => {
		const sourceDir = join(testDir, "registry")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			$schema: REGISTRY_SCHEMA_V2_URL,
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "test-component",
					type: "plugin",
					description: "Test component",
					files: [{ path: "missing.ts", target: "plugins/missing.ts" }],
					dependencies: [],
				},
			],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		const filesDir = join(sourceDir, "files")
		await mkdir(filesDir, { recursive: true })

		const { exitCode } = await runCLI(["validate", "registry", "--strict"], testDir)

		expect(exitCode).toBe(1)
	})

	it("should exit with code 0 in strict mode when validation passes", async () => {
		const sourceDir = join(testDir, "registry")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			$schema: REGISTRY_SCHEMA_V2_URL,
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "test-component",
					type: "plugin",
					description: "Test component",
					files: [{ path: "test.ts", target: "plugins/test.ts" }],
					dependencies: [],
				},
			],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		const filesDir = join(sourceDir, "files")
		await mkdir(filesDir, { recursive: true })
		await writeFile(join(filesDir, "test.ts"), "// test file")

		const { exitCode } = await runCLI(["validate", "registry", "--strict"], testDir)

		expect(exitCode).toBe(0)
	})
})
