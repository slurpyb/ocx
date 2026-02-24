import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, runCLI } from "./helpers"

const REGISTRY_SCHEMA_V2_URL = "https://ocx.kdco.dev/schemas/v2/registry.json"

describe("ocx build", () => {
	let testDir: string

	beforeEach(async () => {
		testDir = await createTempDir("build-test")
	})

	afterEach(async () => {
		await cleanupTempDir(testDir)
	})

	it("should build a valid registry from source", async () => {
		// Create registry source
		const sourceDir = join(testDir, "registry")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			$schema: REGISTRY_SCHEMA_V2_URL,
			name: "Test Registry",
			namespace: "kdco",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "comp-1",
					type: "plugin", // V2: No ocx: prefix
					description: "Test component 1",
					files: [{ path: "index.ts", target: "plugins/comp-1.ts" }], // V2: root-relative
					dependencies: [],
				},
				{
					name: "comp-2",
					type: "agent", // V2: No ocx: prefix
					description: "Test component 2",
					files: [{ path: "agent.md", target: "agents/comp-2.md" }], // V2: root-relative
					dependencies: ["comp-1"],
				},
			],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		// Create the files directory and source files
		const filesDir = join(sourceDir, "files")
		await mkdir(filesDir, { recursive: true })
		await writeFile(join(filesDir, "index.ts"), "// Test plugin content")
		await writeFile(join(filesDir, "agent.md"), "# Test agent content")

		// Run build
		const outDir = "dist"
		const { exitCode, output } = await runCLI(["build", "registry", "--out", outDir], testDir)

		if (exitCode !== 0) {
			console.log(output)
		}
		expect(exitCode).toBe(0)
		expect(output).toContain("Built 2 components")

		// Verify output files
		const fullOutDir = join(testDir, outDir)
		expect(existsSync(join(fullOutDir, "index.json"))).toBe(true)
		expect(existsSync(join(fullOutDir, "components", "comp-1.json"))).toBe(true)
		expect(existsSync(join(fullOutDir, "components", "comp-2.json"))).toBe(true)
		expect(existsSync(join(fullOutDir, ".well-known", "ocx.json"))).toBe(true)

		// Verify .well-known/ocx.json content (discovery endpoint)
		const discovery = JSON.parse(
			await readFile(join(fullOutDir, ".well-known", "ocx.json"), "utf-8"),
		)
		expect(discovery.registry).toBe("/index.json")

		// Verify index.json content
		const index = JSON.parse(await readFile(join(fullOutDir, "index.json"), "utf-8"))
		expect(index.name).toBe("Test Registry")
		expect(index.components.length).toBe(2)
		expect(index.components[0].name).toBe("comp-1")
	})

	it("should fail if component name is invalid", async () => {
		const sourceDir = join(testDir, "registry-invalid")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			$schema: REGISTRY_SCHEMA_V2_URL,
			name: "Invalid Registry",
			namespace: "kdco",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "INVALID_NAME",
					type: "plugin", // V2: No ocx: prefix
					description: "Invalid component",
					files: [{ path: "index.ts", target: "plugins/invalid.ts" }], // V2: root-relative
					dependencies: [],
				},
			],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		const { exitCode, output } = await runCLI(["build", "registry-invalid"], testDir)

		expect(exitCode).not.toBe(0)
		// Match the actual Zod error message for invalid component name
		expect(output).toContain("Must be lowercase")
	})

	it("should fail on missing dependencies", async () => {
		const sourceDir = join(testDir, "registry-missing-dep")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			$schema: REGISTRY_SCHEMA_V2_URL,
			name: "Missing Dep Registry",
			namespace: "kdco",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "comp",
					type: "plugin", // V2: No ocx: prefix
					description: "Component with missing dep",
					files: [{ path: "index.ts", target: "plugins/comp.ts" }], // V2: root-relative
					dependencies: ["non-existent"],
				},
			],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		const { exitCode, output } = await runCLI(["build", "registry-missing-dep"], testDir)

		expect(exitCode).not.toBe(0)
		// Match the actual Zod error message
		expect(output).toContain(
			"Bare dependencies must reference components that exist in the registry",
		)
	})

	it("should build from registry.jsonc with comments", async () => {
		const sourceDir = join(testDir, "registry-jsonc")
		await mkdir(sourceDir, { recursive: true })

		// JSONC content with inline and block comments
		const registryJsonc = `{
	// This is an inline comment
	"$schema": "${REGISTRY_SCHEMA_V2_URL}",
	"name": "JSONC Registry",
	"namespace": "test",
	"version": "1.0.0",
	"author": "Test Author",
	/*
	 * Block comment describing components
	 */
	"components": [
		{
			"name": "jsonc-comp",
			"type": "plugin",
			"description": "Component from JSONC", // trailing comment
			"files": [{ "path": "index.ts", "target": "plugins/jsonc-comp.ts" }],
			"dependencies": [],
		}
	],
}`

		await writeFile(join(sourceDir, "registry.jsonc"), registryJsonc)

		// Create the files directory and source files
		const filesDir = join(sourceDir, "files")
		await mkdir(filesDir, { recursive: true })
		await writeFile(join(filesDir, "index.ts"), "// JSONC test content")

		// Run build
		const outDir = "dist-jsonc"
		const { exitCode, output } = await runCLI(["build", "registry-jsonc", "--out", outDir], testDir)

		if (exitCode !== 0) {
			console.log(output)
		}
		expect(exitCode).toBe(0)
		expect(output).toContain("Built 1 component")

		// Verify output files
		const fullOutDir = join(testDir, outDir)
		expect(existsSync(join(fullOutDir, "index.json"))).toBe(true)
		expect(existsSync(join(fullOutDir, "components", "jsonc-comp.json"))).toBe(true)

		// Verify index.json content
		const index = JSON.parse(await readFile(join(fullOutDir, "index.json"), "utf-8"))
		expect(index.name).toBe("JSONC Registry")
	})

	it("should prefer registry.jsonc over registry.json when both exist", async () => {
		const sourceDir = join(testDir, "registry-both")
		await mkdir(sourceDir, { recursive: true })

		// Create registry.json with one name
		const registryJson = {
			$schema: REGISTRY_SCHEMA_V2_URL,
			name: "JSON Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "from-json",
					type: "plugin", // V2: No ocx: prefix
					description: "Component from JSON",
					files: [{ path: "index.ts", target: "plugins/from-json.ts" }], // V2: root-relative
					dependencies: [],
				},
			],
		}

		// Create registry.jsonc with a different name
		const registryJsonc = `{
	// JSONC should be preferred
	"$schema": "${REGISTRY_SCHEMA_V2_URL}",
	"name": "JSONC Registry Preferred",
	"namespace": "test",
	"version": "1.0.0",
	"author": "Test Author",
	"components": [
		{
			"name": "from-jsonc",
			"type": "plugin",
			"description": "Component from JSONC",
			"files": [{ "path": "index.ts", "target": "plugins/from-jsonc.ts" }],
			"dependencies": [],
		}
	]
}`

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))
		await writeFile(join(sourceDir, "registry.jsonc"), registryJsonc)

		// Create the files directory and source files
		const filesDir = join(sourceDir, "files")
		await mkdir(filesDir, { recursive: true })
		await writeFile(join(filesDir, "index.ts"), "// Test content")

		// Run build
		const outDir = "dist-both"
		const { exitCode, output } = await runCLI(["build", "registry-both", "--out", outDir], testDir)

		if (exitCode !== 0) {
			console.log(output)
		}
		expect(exitCode).toBe(0)

		// Verify the JSONC version was used (check for JSONC registry name)
		const fullOutDir = join(testDir, outDir)
		const index = JSON.parse(await readFile(join(fullOutDir, "index.json"), "utf-8"))
		expect(index.name).toBe("JSONC Registry Preferred")
		expect(index.components[0].name).toBe("from-jsonc")
	})

	it("should fail when schema URL is missing (legacy v1)", async () => {
		const sourceDir = join(testDir, "registry-missing-schema")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			name: "Missing Schema Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		const { exitCode, output } = await runCLI(["build", "registry-missing-schema"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("legacy-schema-v1")
		expect(output).toContain("v2")
	})

	it("should fail when schema major is unsupported", async () => {
		const sourceDir = join(testDir, "registry-unsupported-schema")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			$schema: "https://ocx.kdco.dev/schemas/v3/registry.json",
			name: "Unsupported Schema Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		const { exitCode, output } = await runCLI(["build", "registry-unsupported-schema"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("unsupported-schema-version")
		expect(output).toContain("v2")
	})

	it("should fail when schema URL is non-canonical", async () => {
		const sourceDir = join(testDir, "registry-invalid-schema")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			$schema: "https://example.com/registry.json",
			name: "Invalid Schema URL Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		const { exitCode, output } = await runCLI(["build", "registry-invalid-schema"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("invalid-schema-url")
		expect(output).toContain(REGISTRY_SCHEMA_V2_URL)
	})

	it("should fail when schema URL includes explicit default HTTPS port (:443)", async () => {
		const sourceDir = join(testDir, "registry-invalid-schema-443")
		await mkdir(sourceDir, { recursive: true })

		const registryJson = {
			$schema: "https://ocx.kdco.dev:443/schemas/v2/registry.json",
			name: "Invalid Schema URL Port Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [],
		}

		await writeFile(join(sourceDir, "registry.json"), JSON.stringify(registryJson, null, 2))

		const { exitCode, output } = await runCLI(["build", "registry-invalid-schema-443"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("invalid-schema-url")
		expect(output).toContain(REGISTRY_SCHEMA_V2_URL)
	})
})
