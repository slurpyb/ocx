/**
 * OpenCode Discovery Tests
 *
 * Tests for the OpenCode project file discovery utility.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { discoverProjectFiles } from "../../src/utils/opencode-discovery.js"

// =============================================================================
// HELPERS
// =============================================================================

async function createTempDir(name: string): Promise<string> {
	const dir = join(import.meta.dir, "fixtures", `tmp-${name}-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	return dir
}

async function cleanupTempDir(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true })
}

// =============================================================================
// TESTS
// =============================================================================

describe("discoverProjectFiles", () => {
	let testDir: string

	beforeEach(async () => {
		testDir = await createTempDir("opencode-discovery")
	})

	afterEach(async () => {
		await cleanupTempDir(testDir)
	})

	it("should find opencode.jsonc config file", async () => {
		await Bun.write(join(testDir, "opencode.jsonc"), "{}")

		const excluded = await discoverProjectFiles(testDir, testDir)

		expect(excluded.has(join(testDir, "opencode.jsonc"))).toBe(true)
	})

	it("should find opencode.json config file", async () => {
		await Bun.write(join(testDir, "opencode.json"), "{}")

		const excluded = await discoverProjectFiles(testDir, testDir)

		expect(excluded.has(join(testDir, "opencode.json"))).toBe(true)
	})

	it("should find AGENTS.md rule file", async () => {
		await Bun.write(join(testDir, "AGENTS.md"), "# Agents")

		const excluded = await discoverProjectFiles(testDir, testDir)

		expect(excluded.has(join(testDir, "AGENTS.md"))).toBe(true)
	})

	it("should find CLAUDE.md rule file", async () => {
		await Bun.write(join(testDir, "CLAUDE.md"), "# Claude")

		const excluded = await discoverProjectFiles(testDir, testDir)

		expect(excluded.has(join(testDir, "CLAUDE.md"))).toBe(true)
	})

	it("should find CONTEXT.md rule file", async () => {
		await Bun.write(join(testDir, "CONTEXT.md"), "# Context")

		const excluded = await discoverProjectFiles(testDir, testDir)

		expect(excluded.has(join(testDir, "CONTEXT.md"))).toBe(true)
	})

	it("should find .opencode directory", async () => {
		await mkdir(join(testDir, ".opencode"), { recursive: true })
		await Bun.write(join(testDir, ".opencode", "config.json"), "{}")

		const excluded = await discoverProjectFiles(testDir, testDir)

		expect(excluded.has(join(testDir, ".opencode"))).toBe(true)
	})

	it("should find multiple config files at once", async () => {
		await Bun.write(join(testDir, "opencode.jsonc"), "{}")
		await Bun.write(join(testDir, "AGENTS.md"), "# Agents")
		await mkdir(join(testDir, ".opencode"), { recursive: true })

		const excluded = await discoverProjectFiles(testDir, testDir)

		expect(excluded.size).toBe(3)
		expect(excluded.has(join(testDir, "opencode.jsonc"))).toBe(true)
		expect(excluded.has(join(testDir, "AGENTS.md"))).toBe(true)
		expect(excluded.has(join(testDir, ".opencode"))).toBe(true)
	})

	it("should return empty set when no config files exist", async () => {
		// Create some random files that shouldn't be excluded
		await Bun.write(join(testDir, "package.json"), "{}")
		await Bun.write(join(testDir, "README.md"), "# Readme")

		const excluded = await discoverProjectFiles(testDir, testDir)

		expect(excluded.size).toBe(0)
	})

	it("should find config files in parent directories up to stop", async () => {
		// Create nested structure
		const subDir = join(testDir, "src", "components")
		await mkdir(subDir, { recursive: true })

		// Put config file in parent (testDir)
		await Bun.write(join(testDir, "opencode.jsonc"), "{}")

		// Search from subDir, stopping at testDir
		const excluded = await discoverProjectFiles(subDir, testDir)

		expect(excluded.has(join(testDir, "opencode.jsonc"))).toBe(true)
	})

	it("should not find config files beyond stop directory", async () => {
		// Create nested structure
		const stopDir = join(testDir, "project")
		const subDir = join(stopDir, "src")
		await mkdir(subDir, { recursive: true })

		// Put config file ABOVE the stop directory
		await Bun.write(join(testDir, "opencode.jsonc"), "{}")
		// Put config file IN the stop directory (should be found)
		await Bun.write(join(stopDir, "AGENTS.md"), "# Agents")

		// Search from subDir, stopping at stopDir
		const excluded = await discoverProjectFiles(subDir, stopDir)

		// Should find the one in stopDir
		expect(excluded.has(join(stopDir, "AGENTS.md"))).toBe(true)
		// Should NOT find the one above stopDir
		expect(excluded.has(join(testDir, "opencode.jsonc"))).toBe(false)
	})
})
