import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { BuildRegistryError, buildRegistry } from "../src/lib/build-registry"
import { ValidationFailedError } from "../src/utils/errors"
import { cleanupTempDir, createTempDir } from "./helpers"

const REGISTRY_SCHEMA_V2_URL = "https://ocx.kdco.dev/schemas/v2/registry.json"

describe("buildRegistry (programmatic)", () => {
	let testDir: string

	beforeEach(async () => {
		testDir = await createTempDir("build-registry")
	})

	afterEach(async () => {
		await cleanupTempDir(testDir)
	})

	it("throws BuildRegistryError when registry file is missing", async () => {
		const sourceDir = join(testDir, "missing-source")
		await mkdir(sourceDir, { recursive: true })

		await expect(
			buildRegistry({
				source: sourceDir,
				out: join(testDir, "dist"),
			}),
		).rejects.toBeInstanceOf(BuildRegistryError)
	})

	it("throws BuildRegistryError for schema parse/validation failures", async () => {
		const sourceDir = join(testDir, "schema-source")
		await mkdir(sourceDir, { recursive: true })

		await writeFile(
			join(sourceDir, "registry.json"),
			JSON.stringify({
				$schema: REGISTRY_SCHEMA_V2_URL,
				name: "Invalid Registry",
				author: "Test",
				components: [],
			}),
		)

		await expect(
			buildRegistry({
				source: sourceDir,
				out: join(testDir, "dist"),
			}),
		).rejects.toBeInstanceOf(BuildRegistryError)
	})

	it("throws ValidationFailedError for post-load plugin validation failures", async () => {
		const sourceDir = join(testDir, "plugin-invalid")
		await mkdir(join(sourceDir, "files", "plugins"), { recursive: true })

		await writeFile(
			join(sourceDir, "registry.json"),
			JSON.stringify({
				$schema: REGISTRY_SCHEMA_V2_URL,
				name: "Plugin Invalid",
				version: "1.0.0",
				author: "Test",
				components: [
					{
						name: "plugin-invalid",
						type: "plugin",
						description: "invalid plugin",
						files: [{ path: "plugins/main.ts", target: "plugins/main.ts" }],
						dependencies: [],
					},
				],
			}),
		)

		await writeFile(
			join(sourceDir, "files", "plugins", "main.ts"),
			'import x from "left-pad"\nexport default x\n',
		)

		await expect(
			buildRegistry({
				source: sourceDir,
				out: join(testDir, "dist"),
			}),
		).rejects.toBeInstanceOf(ValidationFailedError)
	})

	it("returns dry-run structured validation and no writes on fatal validation", async () => {
		const sourceDir = join(testDir, "dry-run-invalid")
		const outDir = join(testDir, "dry-run-dist")
		await mkdir(join(sourceDir, "files", "plugins"), { recursive: true })

		await writeFile(
			join(sourceDir, "registry.json"),
			JSON.stringify({
				$schema: REGISTRY_SCHEMA_V2_URL,
				name: "Dry Run Invalid",
				version: "1.0.0",
				author: "Test",
				components: [
					{
						name: "plugin-invalid",
						type: "plugin",
						description: "invalid plugin",
						files: [{ path: "plugins/main.ts", target: "plugins/main.ts" }],
						dependencies: [],
					},
				],
			}),
		)

		await writeFile(
			join(sourceDir, "files", "plugins", "main.ts"),
			'import missing from "missing-package"\nexport default missing\n',
		)

		const result = await buildRegistry({ source: sourceDir, out: outDir, dryRun: true })
		expect("dryRun" in result && result.dryRun).toBe(true)
		if (!("dryRun" in result) || !result.dryRun) {
			throw new Error("Expected dry-run result")
		}

		expect(result.validation.passed).toBe(false)
		expect(result.validation.errors?.some((error) => error.includes("Plugin loadability"))).toBe(
			true,
		)
		expect(result.validation.issues?.length).toBeGreaterThan(0)
		expect(existsSync(join(outDir, "index.json"))).toBe(false)
	})

	it("keeps warnings-only plugin outcomes successful in dry-run", async () => {
		const sourceDir = join(testDir, "dry-run-warning")
		const outDir = join(testDir, "dry-run-warning-dist")
		await mkdir(sourceDir, { recursive: true })

		await writeFile(
			join(sourceDir, "registry.json"),
			JSON.stringify({
				$schema: REGISTRY_SCHEMA_V2_URL,
				name: "Dry Run Warning",
				version: "1.0.0",
				author: "Test",
				components: [
					{
						name: "warning-component",
						type: "skill",
						description: "warning component",
						files: [],
						dependencies: [],
						opencode: {
							plugin: ["example-plugin"],
						},
					},
				],
			}),
		)

		const result = await buildRegistry({ source: sourceDir, out: outDir, dryRun: true })
		expect("dryRun" in result && result.dryRun).toBe(true)
		if (!("dryRun" in result) || !result.dryRun) {
			throw new Error("Expected dry-run result")
		}

		expect(result.validation.passed).toBe(true)
		expect(
			result.validation.warnings?.some((warning) => warning.includes("non-deterministic")),
		).toBe(true)
	})
})
