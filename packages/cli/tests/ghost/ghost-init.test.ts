/**
 * Ghost Init Command Tests
 *
 * Tests for the `ocx ghost init` command:
 * - Creates config directory if not exists
 * - Creates ghost.jsonc with default content
 * - Errors with helpful message if already initialized
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { getGhostConfigDir, getGhostConfigPath } from "../../src/ghost/config.js"

// =============================================================================
// HELPERS
// =============================================================================

interface CLIResult {
	stdout: string
	stderr: string
	output: string
	exitCode: number
}

async function createTempConfigDir(name: string): Promise<string> {
	const dir = join(import.meta.dir, "fixtures", `tmp-${name}-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	return dir
}

async function cleanupTempDir(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true })
}

async function runGhostCLI(args: string[], env: Record<string, string> = {}): Promise<CLIResult> {
	const indexPath = join(import.meta.dir, "..", "..", "src/index.ts")

	const proc = Bun.spawn(["bun", "run", indexPath, "ghost", ...args], {
		env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...env },
		stdout: "pipe",
		stderr: "pipe",
	})

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	])

	const exitCode = await proc.exited

	return {
		stdout,
		stderr,
		output: stdout + stderr,
		exitCode,
	}
}

// =============================================================================
// TESTS
// =============================================================================

describe("ocx ghost init", () => {
	let testDir: string
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeEach(async () => {
		testDir = await createTempConfigDir("ghost-init")
	})

	afterEach(async () => {
		// Restore original XDG_CONFIG_HOME
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		await cleanupTempDir(testDir)
	})

	it("should create config directory if it does not exist", async () => {
		const { exitCode, output } = await runGhostCLI(["init"], { XDG_CONFIG_HOME: testDir })

		if (exitCode !== 0) {
			console.log("Output:", output)
		}
		expect(exitCode).toBe(0)

		// Verify directory was created
		process.env.XDG_CONFIG_HOME = testDir
		const configDir = getGhostConfigDir()
		// Check if directory exists by checking if the path is a directory
		const dirExists = (await Bun.spawn(["test", "-d", configDir]).exited) === 0
		expect(dirExists).toBe(true)
	})

	it("should create ghost.jsonc with default content", async () => {
		const { exitCode, output } = await runGhostCLI(["init"], { XDG_CONFIG_HOME: testDir })

		expect(exitCode).toBe(0)
		expect(output).toContain("Ghost mode initialized")

		// Verify config file was created with expected content
		process.env.XDG_CONFIG_HOME = testDir
		const configPath = getGhostConfigPath()
		const configFile = Bun.file(configPath)
		const exists = await configFile.exists()
		expect(exists).toBe(true)

		const content = await configFile.text()
		const config = parseJsonc(content) as Record<string, unknown>

		// Check for default structure (opencode config is stored separately in opencode.jsonc)
		expect(config.registries).toBeDefined()
		expect(config.componentPath).toBeDefined()
	})

	it("should error with helpful message if already initialized", async () => {
		// First init should succeed
		const firstResult = await runGhostCLI(["init"], { XDG_CONFIG_HOME: testDir })
		expect(firstResult.exitCode).toBe(0)

		// Second init should fail with helpful error
		const secondResult = await runGhostCLI(["init"], { XDG_CONFIG_HOME: testDir })

		expect(secondResult.exitCode).not.toBe(0)
		expect(secondResult.output).toContain("already initialized")
		expect(secondResult.output).toContain("To reset")
		expect(secondResult.output).toContain("rm")
	})

	it("should output JSON when --json flag is used", async () => {
		const { exitCode, output } = await runGhostCLI(["init", "--json"], {
			XDG_CONFIG_HOME: testDir,
		})

		expect(exitCode).toBe(0)

		const json = JSON.parse(output)
		expect(json.success).toBe(true)
		expect(json.path).toContain("ghost.jsonc")
	})

	it("should suppress output with --quiet flag", async () => {
		const { exitCode, stdout } = await runGhostCLI(["init", "--quiet"], {
			XDG_CONFIG_HOME: testDir,
		})

		expect(exitCode).toBe(0)
		expect(stdout.trim()).toBe("")
	})
})
