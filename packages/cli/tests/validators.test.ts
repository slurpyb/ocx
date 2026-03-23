import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	loadRegistrySource,
	validatePluginLoadability,
	validateRegistrySchema,
	validateRegistrySource,
	validateRegistryWithOptions,
	validateSourceFiles,
} from "../src/lib/validators"
import {
	cleanupTempDir,
	createLocalPackageFixture,
	createTempDir,
	listPluginValidationTempDirs,
} from "./helpers"

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

	it("should treat equivalent target paths as duplicates", async () => {
		const filesDir = join(testDir, "files")
		await mkdir(filesDir, { recursive: true })
		await writeFile(join(filesDir, "a.ts"), "// a")
		await writeFile(join(filesDir, "b.ts"), "// b")

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
					files: [{ path: "a.ts", target: "./plugins/shared.ts" }],
					dependencies: [],
				},
				{
					name: "comp-b",
					type: "plugin" as const,
					description: "Component B",
					files: [{ path: "b.ts", target: "plugins/./shared.ts" }],
					dependencies: [],
				},
			],
		}

		const errors: string[] = []
		for await (const error of validateRegistryWithOptions(registry, testDir, {
			skipDuplicateTargets: false,
		})) {
			errors.push(error)
		}

		expect(errors).toContain(
			'Duplicate target "plugins/shared.ts" in components "comp-a" and "comp-b"',
		)
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

describe("loadRegistrySource", () => {
	let testDir: string

	beforeEach(async () => {
		testDir = await createTempDir("load-registry-test")
	})

	afterEach(async () => {
		await cleanupTempDir(testDir)
	})

	it("should load and parse registry.json file", async () => {
		const registryData = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [],
		}

		await writeFile(join(testDir, "registry.json"), JSON.stringify(registryData))

		const result = await loadRegistrySource(testDir)

		expect(result.success).toBe(true)
		expect(result.data).toEqual(registryData)
	})

	it("should load and parse registry.jsonc file", async () => {
		const registryData = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [],
		}

		// Write JSONC with comments and trailing commas
		await writeFile(
			join(testDir, "registry.jsonc"),
			`{
  // Comment
  "$schema": "https://ocx.kdco.dev/schemas/v2/registry.json",
  "name": "Test Registry",
  "namespace": "test",
  "version": "1.0.0",
  "author": "Test Author",
  "components": [],
}`,
		)

		const result = await loadRegistrySource(testDir)

		expect(result.success).toBe(true)
		expect(result.data).toEqual(registryData)
	})

	it("should prefer registry.jsonc over registry.json when both exist", async () => {
		const jsonData = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "JSON Registry",
			namespace: "json",
			version: "1.0.0",
			author: "JSON Author",
			components: [],
		}

		const jsoncData = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "JSONC Registry",
			namespace: "jsonc",
			version: "1.0.0",
			author: "JSONC Author",
			components: [],
		}

		await writeFile(join(testDir, "registry.json"), JSON.stringify(jsonData))
		await writeFile(join(testDir, "registry.jsonc"), JSON.stringify(jsoncData))

		const result = await loadRegistrySource(testDir)

		expect(result.success).toBe(true)
		expect((result.data as { name?: string } | undefined)?.name).toBe("JSONC Registry")
	})

	it("should return error when no registry file exists", async () => {
		const result = await loadRegistrySource(testDir)

		expect(result.success).toBe(false)
		expect(result.error).toContain("No registry.jsonc or registry.json found")
	})

	it("should return error when registry.jsonc contains malformed JSON", async () => {
		// Write malformed JSONC with syntax error
		await writeFile(
			join(testDir, "registry.jsonc"),
			`{
  "$schema": "https://ocx.kdco.dev/schemas/v2/registry.json",
  "name": "Test Registry",
  "namespace": "test",
  "version": "1.0.0",
  "author": "Test Author",
  "components": [
  // Missing closing bracket
}`,
		)

		const result = await loadRegistrySource(testDir)

		expect(result.success).toBe(false)
		expect(result.error).toBeDefined()
		expect(result.error).toContain("Invalid JSONC")
	})

	it("should return error when registry.json contains malformed JSON", async () => {
		// Write malformed JSON with syntax error
		await writeFile(
			join(testDir, "registry.json"),
			`{
  "$schema": "https://ocx.kdco.dev/schemas/v2/registry.json",
  "name": "Test Registry"
  "namespace": "test"
}`,
		)

		const result = await loadRegistrySource(testDir)

		expect(result.success).toBe(false)
		expect(result.error).toBeDefined()
		expect(result.error).toContain("Invalid JSONC")
	})

	it("should include parse error details in error message", async () => {
		// Write JSONC with unexpected token
		await writeFile(
			join(testDir, "registry.jsonc"),
			`{
  "$schema": "https://ocx.kdco.dev/schemas/v2/registry.json",
  "name": "Test Registry",
  ]
}`,
		)

		const result = await loadRegistrySource(testDir)

		expect(result.success).toBe(false)
		expect(result.error).toBeDefined()
		// Error should contain both the error type and location info
		expect(result.error).toMatch(/Invalid JSONC.*offset/)
	})
})

describe("validateRegistrySchema", () => {
	it("should validate a valid registry schema", () => {
		const validRegistry = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "Test Registry",
			namespace: "test",
			version: "1.0.0",
			author: "Test Author",
			components: [],
		}

		const result = validateRegistrySchema(validRegistry, "/test/path")

		expect(result.valid).toBe(true)
		expect(result.errors).toEqual([])
		expect(result.data).toBeDefined()
	})

	it("should detect schema compatibility issues", () => {
		const incompatibleRegistry = {
			// Missing $schema field - v1 format
			name: "Old Registry",
			version: "1.0.0",
			author: "Test",
			components: [],
		}

		const result = validateRegistrySchema(incompatibleRegistry, "/test/path")

		expect(result.valid).toBe(false)
		expect(result.errors.length).toBeGreaterThan(0)
		expect(result.errors[0]).toContain("schema")
	})

	it("should detect schema validation errors", () => {
		const invalidRegistry = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "Test Registry",
			// Missing required 'version' field
			author: "Test Author",
			components: [],
		}

		const result = validateRegistrySchema(invalidRegistry, "/test/path")

		expect(result.valid).toBe(false)
		expect(result.errors.length).toBeGreaterThan(0)
	})

	it("should return parsed data on success", () => {
		const validRegistry = {
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
					files: [],
					dependencies: [],
				},
			],
		}

		const result = validateRegistrySchema(validRegistry, "/test/path")

		expect(result.valid).toBe(true)
		expect(result.data).toBeDefined()
		expect(result.data?.name).toBe("Test Registry")
		expect(result.data?.components.length).toBe(1)
	})
})

describe("validatePluginLoadability", () => {
	let testDir: string

	beforeEach(async () => {
		testDir = await createTempDir("plugin-loadability-test")
		await mkdir(join(testDir, "files"), { recursive: true })
	})

	afterEach(async () => {
		await cleanupTempDir(testDir)
	})

	function createRegistry(
		files: Array<{ path: string; target: string }>,
		extras?: Record<string, unknown>,
	) {
		return {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "Plugin Registry",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "plugin-component",
					type: "plugin" as const,
					description: "Plugin component",
					files,
					dependencies: [],
					...extras,
				},
			],
		}
	}

	it("validates helper imports outside plugins via staged install tree", async () => {
		await mkdir(join(testDir, "files", "plugins"), { recursive: true })
		await mkdir(join(testDir, "files", "shared"), { recursive: true })
		await writeFile(
			join(testDir, "files", "plugins", "foo.ts"),
			'import { value } from "../shared/bar"\nexport default value\n',
		)
		await writeFile(join(testDir, "files", "shared", "bar.ts"), "export const value = 42\n")

		const registry = createRegistry([
			{ path: "plugins/foo.ts", target: "plugins/foo.ts" },
			{ path: "shared/bar.ts", target: "shared/bar.ts" },
		])

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(true)
		expect(result.errors).toEqual([])
	})

	it("discovers and validates nested plugin entrypoints recursively", async () => {
		await mkdir(join(testDir, "files", "plugins", "nested"), { recursive: true })
		await writeFile(
			join(testDir, "files", "plugins", "nested", "deep.ts"),
			'import leftPad from "left-pad"\nexport default leftPad\n',
		)

		const registry = createRegistry([
			{ path: "plugins/nested/deep.ts", target: "plugins/nested/deep.ts" },
		])

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(false)
		expect(result.errors.some((error) => error.includes("not declared in npmDependencies"))).toBe(
			true,
		)
		expect(
			result.issues.some(
				(issue) =>
					issue.code === "plugin_external_dependency_undeclared" &&
					issue.affectedEntrypoints.includes(".opencode/plugins/nested/deep.ts"),
			),
		).toBe(true)
	})

	it("keeps runtime smoke parsing stable when plugin entrypoints log to stdout", async () => {
		await mkdir(join(testDir, "files", "plugins"), { recursive: true })
		await writeFile(
			join(testDir, "files", "plugins", "logged.ts"),
			'console.log("plugin initialized")\nexport default { ok: true }\n',
		)

		const registry = createRegistry([{ path: "plugins/logged.ts", target: "plugins/logged.ts" }])
		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(true)
		expect(result.errors).toEqual([])
	})

	it("fails on missing transitive helper files", async () => {
		await mkdir(join(testDir, "files", "plugins"), { recursive: true })
		await writeFile(
			join(testDir, "files", "plugins", "missing-helper.ts"),
			'import "../shared/does-not-exist"\nexport default {}\n',
		)

		const registry = createRegistry([
			{ path: "plugins/missing-helper.ts", target: "plugins/missing-helper.ts" },
		])

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(false)
		expect(result.errors.some((error) => error.includes("Cannot resolve static import"))).toBe(true)
	})

	it("fails on invalid syntax in reachable helper files", async () => {
		await mkdir(join(testDir, "files", "plugins"), { recursive: true })
		await mkdir(join(testDir, "files", "shared"), { recursive: true })
		await writeFile(
			join(testDir, "files", "plugins", "syntax.ts"),
			'export * from "../shared/bad"\n',
		)
		await writeFile(join(testDir, "files", "shared", "bad.ts"), "export const = broken\n")

		const registry = createRegistry([
			{ path: "plugins/syntax.ts", target: "plugins/syntax.ts" },
			{ path: "shared/bad.ts", target: "shared/bad.ts" },
		])

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(false)
		expect(result.errors.some((error) => error.includes("Invalid syntax"))).toBe(true)
	})

	it("supports Bun-style extensionless local resolution with re-export reachability", async () => {
		await mkdir(join(testDir, "files", "plugins"), { recursive: true })
		await mkdir(join(testDir, "files", "shared"), { recursive: true })
		await writeFile(
			join(testDir, "files", "plugins", "entry.ts"),
			'export * from "../shared/reexport"\n',
		)
		await writeFile(join(testDir, "files", "shared", "reexport.ts"), 'export * from "./leaf"\n')
		await writeFile(join(testDir, "files", "shared", "leaf.ts"), "export const leaf = true\n")

		const registry = createRegistry([
			{ path: "plugins/entry.ts", target: "plugins/entry.ts" },
			{ path: "shared/reexport.ts", target: "shared/reexport.ts" },
			{ path: "shared/leaf.ts", target: "shared/leaf.ts" },
		])

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(true)
	})

	it("fails unresolved external packages when not declared", async () => {
		await mkdir(join(testDir, "files", "plugins"), { recursive: true })
		await writeFile(
			join(testDir, "files", "plugins", "external.ts"),
			'import leftPad from "left-pad"\nexport default leftPad\n',
		)

		const registry = createRegistry([
			{ path: "plugins/external.ts", target: "plugins/external.ts" },
		])
		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(false)
		expect(result.errors.some((error) => error.includes("not declared in npmDependencies"))).toBe(
			true,
		)
	})

	it("ignores type-only imports and exports for dependency checks", async () => {
		await mkdir(join(testDir, "files", "plugins"), { recursive: true })
		await mkdir(join(testDir, "files", "shared"), { recursive: true })
		await writeFile(
			join(testDir, "files", "plugins", "types-only.ts"),
			'import type { Foo } from "left-pad"\nexport type { TypeA } from "../shared/types"\nexport default {}\n',
		)
		await writeFile(join(testDir, "files", "shared", "types.ts"), "export type TypeA = string\n")

		const registry = createRegistry([
			{ path: "plugins/types-only.ts", target: "plugins/types-only.ts" },
			{ path: "shared/types.ts", target: "shared/types.ts" },
		])

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(true)
		expect(result.errors).toEqual([])
	})

	it("fails eager dynamic imports but ignores lazy unreachable dynamic imports in precheck", async () => {
		await mkdir(join(testDir, "files", "plugins"), { recursive: true })
		await writeFile(
			join(testDir, "files", "plugins", "eager.ts"),
			'await import("../shared/missing-dynamic")\nexport default {}\n',
		)
		await writeFile(
			join(testDir, "files", "plugins", "lazy.ts"),
			'export function lazy() { return import("../shared/missing-dynamic") }\nexport default {}\n',
		)

		const registry = createRegistry([
			{ path: "plugins/eager.ts", target: "plugins/eager.ts" },
			{ path: "plugins/lazy.ts", target: "plugins/lazy.ts" },
		])

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(false)
		expect(result.errors.some((error) => error.includes("Runtime import failed"))).toBe(true)
		expect(result.errors.some((error) => error.includes("Cannot resolve static import"))).toBe(
			false,
		)
	})

	it("accepts host-provided runtime packages without manifest declarations", async () => {
		await mkdir(join(testDir, "files", "plugins"), { recursive: true })
		await writeFile(
			join(testDir, "files", "plugins", "host.ts"),
			'import { tool } from "@opencode-ai/plugin"\nexport default tool\n',
		)

		const registry = createRegistry([{ path: "plugins/host.ts", target: "plugins/host.ts" }])
		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(true)
		expect(result.errors).toEqual([])
	})

	it("validates opencode.plugin package imports from deterministic local fixtures", async () => {
		const localPlugin = await createLocalPackageFixture(testDir, {
			name: "fixture-plugin",
			entrypointCode: "export default { name: 'fixture-plugin' }\n",
		})

		const registry = createRegistry([], {
			opencode: {
				plugin: [localPlugin.specifier],
			},
		})

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(true)
		expect(result.errors).toEqual([])
	})

	it("reports runtime failure for broken opencode.plugin package imports", async () => {
		const brokenPlugin = await createLocalPackageFixture(testDir, {
			name: "broken-plugin",
			entrypointCode: 'import "./missing.js"\nexport default {}\n',
		})

		const registry = createRegistry([], {
			opencode: {
				plugin: [brokenPlugin.specifier],
			},
		})

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(false)
		expect(result.errors.some((error) => error.includes("Package plugin"))).toBe(true)
	})

	it("warns for non-deterministic opencode.plugin specs without failing", async () => {
		const registry = createRegistry([], {
			opencode: {
				plugin: ["example-plugin"],
			},
		})

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(true)
		expect(result.errors).toEqual([])
		expect(result.warnings.some((warning) => warning.includes("non-deterministic"))).toBe(true)
	})

	it("preserves all owning components for shared opencode.plugin diagnostics", async () => {
		const registry = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "Multi-owner Plugin Registry",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "component-a",
					type: "skill" as const,
					description: "component a",
					files: [],
					dependencies: [],
					opencode: {
						plugin: ["example-plugin"],
					},
				},
				{
					name: "component-b",
					type: "skill" as const,
					description: "component b",
					files: [],
					dependencies: [],
					opencode: {
						plugin: ["example-plugin"],
					},
				},
			],
		}

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(true)
		const warningIssue = result.issues.find(
			(issue) => issue.code === "plugin_package_spec_nondeterministic",
		)
		expect(warningIssue).toBeDefined()
		expect(warningIssue?.affectedComponents).toEqual(["component-a", "component-b"])
	})

	it("reports unsupported qualified cross-registry plugin dependencies", async () => {
		const registry = createRegistry([], {
			opencode: {
				plugin: ["kdco/another-plugin"],
			},
		})

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(false)
		expect(
			result.errors.some((error) => error.includes("Unsupported qualified cross-registry")),
		).toBe(true)
	})

	it("fails loud on dependency merge conflicts between npmDependencies and npmDevDependencies", async () => {
		const localDep = await createLocalPackageFixture(testDir, {
			name: "shared-dep",
			entrypointCode: "export const value = 1\n",
		})

		await mkdir(join(testDir, "files", "plugins"), { recursive: true })
		await writeFile(
			join(testDir, "files", "plugins", "conflict.ts"),
			'import { value } from "shared-dep"\nexport default value\n',
		)

		const registry = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
			name: "Conflict Registry",
			version: "1.0.0",
			author: "Test Author",
			components: [
				{
					name: "plugin-a",
					type: "plugin" as const,
					description: "A",
					files: [{ path: "plugins/conflict.ts", target: "plugins/conflict.ts" }],
					dependencies: [],
					npmDependencies: [localDep.specifier],
				},
				{
					name: "plugin-b",
					type: "plugin" as const,
					description: "B",
					files: [],
					dependencies: [],
					npmDevDependencies: [localDep.specifier],
				},
			],
		}

		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(false)
		expect(
			result.errors.some((error) => error.includes("both dependencies and devDependencies")),
		).toBe(true)
	})

	it("supports .js plugin entrypoints", async () => {
		await mkdir(join(testDir, "files", "plugins"), { recursive: true })
		await writeFile(join(testDir, "files", "plugins", "plain.js"), "export default { ok: true }\n")

		const registry = createRegistry([{ path: "plugins/plain.js", target: "plugins/plain.js" }])
		const result = await validatePluginLoadability(registry, testDir)

		expect(result.valid).toBe(true)
	})

	it("cleans up ocx-plugin-validation-* workspaces on failure", async () => {
		await mkdir(join(testDir, "files", "plugins"), { recursive: true })
		await writeFile(
			join(testDir, "files", "plugins", "cleanup.ts"),
			'import "../shared/missing"\nexport default {}\n',
		)

		const registry = createRegistry([{ path: "plugins/cleanup.ts", target: "plugins/cleanup.ts" }])
		const before = await listPluginValidationTempDirs()

		await validatePluginLoadability(registry, testDir)

		const after = await listPluginValidationTempDirs()
		expect(after).toEqual(before)
	})
})
