import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { runCompleteValidation } from "../src/lib/validation-runner"
import { cleanupTempDir, createTempDir } from "./helpers"

describe("runCompleteValidation", () => {
	let testDir: string

	beforeEach(async () => {
		testDir = await createTempDir("validation-runner-test")
	})

	afterEach(async () => {
		await cleanupTempDir(testDir)
	})

	it("should return success for a valid registry", async () => {
		// Create registry file
		const registryContent = {
			$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
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

		await writeFile(join(testDir, "registry.json"), JSON.stringify(registryContent, null, 2))

		// Create source file
		const filesDir = join(testDir, "files")
		await mkdir(filesDir, { recursive: true })
		await writeFile(join(filesDir, "test.ts"), "// test file")

		const result = await runCompleteValidation(testDir, {
			skipDuplicateTargets: false,
		})

		expect(result.success).toBe(true)
		expect(result.errors).toEqual([])
		expect(result.registry).toBeDefined()
		expect(result.registry?.name).toBe("Test Registry")
	})
})
