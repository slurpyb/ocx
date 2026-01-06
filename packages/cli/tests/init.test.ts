import { afterEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"

describe("ocx init", () => {
	let testDir: string

	afterEach(async () => {
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("should create ocx.jsonc with default config", async () => {
		testDir = await createTempDir("init-basic")
		const { exitCode, output } = await runCLI(["init"], testDir)

		expect(exitCode).toBe(0)
		// Success message from logger.success
		expect(output).toContain("Initialized OCX configuration")

		const configPath = join(testDir, "ocx.jsonc")
		expect(existsSync(configPath)).toBe(true)

		const content = await readFile(configPath, "utf-8")
		const config = parseJsonc(content)
		expect(config.registries).toBeDefined()
		expect(config.lockRegistries).toBe(false)
	})

	it("should error if ocx.jsonc already exists", async () => {
		testDir = await createTempDir("init-exists")
		const configPath = join(testDir, "ocx.jsonc")
		await Bun.write(configPath, "{}")

		const { exitCode, output } = await runCLI(["init"], testDir)
		expect(exitCode).not.toBe(0)
		expect(output).toContain("ocx.jsonc already exists")
		expect(output).toContain("To reset")
		expect(output).toContain("rm")
	})

	it("should output JSON when requested", async () => {
		testDir = await createTempDir("init-json")
		const { exitCode, output } = await runCLI(["init", "--json"], testDir)

		expect(exitCode).toBe(0)
		const json = JSON.parse(output)
		expect(json.success).toBe(true)
		expect(json.path).toContain("ocx.jsonc")
	})
})
