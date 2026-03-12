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

	it("should skip duplicate target validation when --no-duplicate-targets is used", async () => {
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

		const { exitCode, output } = await runCLI(
			["validate", "registry", "--no-duplicate-targets"],
			testDir,
		)

		expect(exitCode).toBe(0)
		expect(output.toLowerCase()).not.toContain("duplicate")
	})

	// Violation 4: JSON output on failure tests
	it("should output JSON on validation failure when --json flag is used", async () => {
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

		const { exitCode, stdout, stderr } = await runCLI(["validate", "registry", "--json"], testDir)

		expect(exitCode).toBe(1)
		expect(stderr).toBe("") // No error output to stderr in JSON mode

		// Parse JSON output
		const result = JSON.parse(stdout)
		expect(result.valid).toBe(false)
		expect(Array.isArray(result.errors)).toBe(true)
		expect(result.errors.length).toBeGreaterThan(0)
		expect(result.errors[0]).toContain("missing.ts")
	})

	it("should output JSON on schema validation failure when --json flag is used", async () => {
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

		const { exitCode, stdout, stderr } = await runCLI(["validate", "registry", "--json"], testDir)

		expect(exitCode).toBe(1)
		expect(stderr).toBe("") // No error output to stderr in JSON mode

		// Parse JSON output
		const result = JSON.parse(stdout)
		expect(result.valid).toBe(false)
		expect(Array.isArray(result.errors)).toBe(true)
		expect(result.errors.length).toBeGreaterThan(0)
	})

	it("should output JSON on load failure when --json flag is used", async () => {
		const sourceDir = join(testDir, "nonexistent")

		const { exitCode, stdout, stderr } = await runCLI(["validate", sourceDir, "--json"], testDir)

		expect(exitCode).toBe(1)
		expect(stderr).toBe("") // No error output to stderr in JSON mode

		// Parse JSON output
		const result = JSON.parse(stdout)
		expect(result.valid).toBe(false)
		expect(Array.isArray(result.errors)).toBe(true)
		expect(result.errors.length).toBeGreaterThan(0)
	})

	// Violation 4: Quiet mode tests
	it("should suppress all output when --quiet flag is used on failure", async () => {
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

		const { exitCode, stdout, stderr } = await runCLI(["validate", "registry", "--quiet"], testDir)

		expect(exitCode).toBe(1)
		expect(stdout).toBe("") // No output to stdout in quiet mode
		expect(stderr).toBe("") // No output to stderr in quiet mode
	})

	it("should suppress all output when --quiet flag is used on schema failure", async () => {
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

		const { exitCode, stdout, stderr } = await runCLI(["validate", "registry", "--quiet"], testDir)

		expect(exitCode).toBe(1)
		expect(stdout).toBe("") // No output to stdout in quiet mode
		expect(stderr).toBe("") // No output to stderr in quiet mode
	})

	// Violation 4: JSON + Quiet interaction test
	it("should output JSON even with --quiet flag (JSON takes precedence)", async () => {
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

		const { exitCode, stdout, stderr } = await runCLI(
			["validate", "registry", "--json", "--quiet"],
			testDir,
		)

		expect(exitCode).toBe(1)
		expect(stderr).toBe("") // No error output to stderr

		// Parse JSON output - should still have JSON even with --quiet
		const result = JSON.parse(stdout)
		expect(result.valid).toBe(false)
		expect(Array.isArray(result.errors)).toBe(true)
		expect(result.errors.length).toBeGreaterThan(0)
	})
})
