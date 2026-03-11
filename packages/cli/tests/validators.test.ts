import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	validateRegistrySource,
	validateRegistryWithOptions,
	validateSourceFiles,
} from "../src/lib/validators"
import { cleanupTempDir, createTempDir } from "./helpers"

describe("validateRegistrySource", () => {
	describe("schema validation", () => {
		it("should validate a valid registry schema", () => {
			const validRegistry = {
				$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
				name: "Test Registry",
				namespace: "test",
				version: "1.0.0",
				author: "Test Author",
				components: [],
			}

			const result = validateRegistrySource(validRegistry, "/fake/path")

			expect(result.valid).toBe(true)
			expect(result.errors).toEqual([])
		})
	})
})

describe("validateSourceFiles", () => {
	let testDir: string

	beforeEach(async () => {
		testDir = await createTempDir("validate-files-test")
	})

	afterEach(async () => {
		await cleanupTempDir(testDir)
	})

	it("should validate when all source files exist", async () => {
		const filesDir = join(testDir, "files")
		await mkdir(filesDir, { recursive: true })
		await writeFile(join(filesDir, "test.ts"), "// test file")

		const registry = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "test-component",
					type: "plugin" as const,
					description: "Test",
					files: [{ path: "test.ts", target: "plugins/test.ts" }],
					dependencies: [],
				},
			],
		}

		const result = await validateSourceFiles(registry, testDir)

		expect(result.valid).toBe(true)
		expect(result.errors).toEqual([])
	})

	it("should report error when source file is missing", async () => {
		const filesDir = join(testDir, "files")
		await mkdir(filesDir, { recursive: true })

		const registry = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "test-component",
					type: "plugin" as const,
					description: "Test",
					files: [{ path: "missing.ts", target: "plugins/missing.ts" }],
					dependencies: [],
				},
			],
		}

		const result = await validateSourceFiles(registry, testDir)

		expect(result.valid).toBe(false)
		expect(result.errors.length).toBeGreaterThan(0)
		expect(result.errors[0]).toContain("missing.ts")
	})
})

describe("validateRegistryWithOptions", () => {
	let testDir: string

	beforeEach(async () => {
		testDir = await createTempDir("validate-registry-test")
	})

	afterEach(async () => {
		await cleanupTempDir(testDir)
	})

	it("should yield validation errors from all validators", async () => {
		const filesDir = join(testDir, "files")
		await mkdir(filesDir, { recursive: true })

		const registry = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "comp-a",
					type: "plugin" as const,
					description: "Component A",
					files: [{ path: "missing.ts", target: "plugins/a.ts" }],
					dependencies: ["comp-b"],
				},
				{
					name: "comp-b",
					type: "plugin" as const,
					description: "Component B",
					files: [{ path: "b.ts", target: "plugins/a.ts" }],
					dependencies: ["comp-a"],
				},
			],
		}

		const errors: string[] = []
		for await (const error of validateRegistryWithOptions(registry, testDir, {
			skipDuplicateTargets: false,
		})) {
			errors.push(error)
		}

		// Should have errors from:
		// 1. Missing source file (missing.ts)
		// 2. Circular dependency (comp-a <-> comp-b)
		// 3. Duplicate target (plugins/a.ts used twice)
		expect(errors.length).toBeGreaterThan(0)
		expect(errors.some((e) => e.includes("missing.ts"))).toBe(true)
		expect(errors.some((e) => e.includes("Circular dependency"))).toBe(true)
		expect(errors.some((e) => e.includes("Duplicate target"))).toBe(true)
	})

	it("should skip duplicate target validation when option is set", async () => {
		const filesDir = join(testDir, "files")
		await mkdir(filesDir, { recursive: true })
		await writeFile(join(filesDir, "test.ts"), "// test")

		const registry = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "comp-a",
					type: "plugin" as const,
					description: "Component A",
					files: [{ path: "test.ts", target: "plugins/same.ts" }],
					dependencies: [],
				},
				{
					name: "comp-b",
					type: "plugin" as const,
					description: "Component B",
					files: [{ path: "test.ts", target: "plugins/same.ts" }],
					dependencies: [],
				},
			],
		}

		const errors: string[] = []
		for await (const error of validateRegistryWithOptions(registry, testDir, {
			skipDuplicateTargets: true,
		})) {
			errors.push(error)
		}

		// Should NOT have duplicate target error
		expect(errors.some((e) => e.includes("Duplicate target"))).toBe(false)
	})
})
