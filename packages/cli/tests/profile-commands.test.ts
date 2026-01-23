/**
 * Profile Commands Tests
 *
 * Comprehensive tests for profile show, config, and remove commands.
 * Uses unique componentPath values as sentinels to verify correct profile selection.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { chmod, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, runCLI } from "./helpers"

// Sentinel values - unique componentPath per profile to prove correct selection
// componentPath is a valid schema field that gets preserved
const SENTINEL_DEFAULT = "components/default-12345"
const SENTINEL_TEST = "components/test-67890"
const SENTINEL_OTHER = "components/other-ABCDE"

// Snapshot only the keys we touch
const ENV_KEYS = ["XDG_CONFIG_HOME", "OCX_PROFILE", "EDITOR", "VISUAL"] as const
let envSnapshot: Map<string, string | undefined>
let testDir: string

beforeEach(async () => {
	// Snapshot env state
	envSnapshot = new Map(ENV_KEYS.map((k) => [k, process.env[k]]))

	testDir = await createTempDir("profile-commands")
	process.env.XDG_CONFIG_HOME = testDir
	delete process.env.OCX_PROFILE
	delete process.env.EDITOR
	delete process.env.VISUAL

	// Create fixture structure
	const configDir = join(testDir, "opencode")
	await mkdir(join(configDir, "profiles", "default"), { recursive: true })
	await mkdir(join(configDir, "profiles", "test-profile"), { recursive: true })
	await mkdir(join(configDir, "profiles", "other-profile"), { recursive: true })

	// Global config
	await Bun.write(join(configDir, "ocx.jsonc"), JSON.stringify({ registries: {} }, null, 2))

	// Profile configs with UNIQUE componentPath values as sentinels
	// Using componentPath since it's preserved by the schema
	await Bun.write(
		join(configDir, "profiles", "default", "ocx.jsonc"),
		JSON.stringify({ componentPath: SENTINEL_DEFAULT }, null, 2),
	)
	await Bun.write(
		join(configDir, "profiles", "test-profile", "ocx.jsonc"),
		JSON.stringify({ componentPath: SENTINEL_TEST }, null, 2),
	)
	await Bun.write(
		join(configDir, "profiles", "other-profile", "ocx.jsonc"),
		JSON.stringify({ componentPath: SENTINEL_OTHER }, null, 2),
	)
})

afterEach(async () => {
	// Restore env: delete if was unset, otherwise restore value
	for (const [key, value] of envSnapshot) {
		if (value === undefined) {
			delete process.env[key]
		} else {
			process.env[key] = value
		}
	}
	await cleanupTempDir(testDir)
})

/**
 * Fail-fast helper for waiting on file creation.
 */
async function waitForFile(filePath: string, timeoutMs = 2000): Promise<void> {
	const startTime = Date.now()
	while (!existsSync(filePath)) {
		if (Date.now() - startTime > timeoutMs) {
			throw new Error(`Timeout: ${filePath} not created within ${timeoutMs}ms`)
		}
		await Bun.sleep(50)
	}
}

// =============================================================================
// Profile Remove Tests
// =============================================================================

describe("ocx profile remove", () => {
	it("should remove an existing profile", async () => {
		const configDir = join(testDir, "opencode")
		const profileDir = join(configDir, "profiles", "test-profile")

		// Precondition: profile exists
		expect(existsSync(profileDir)).toBe(true)

		const { exitCode, output } = await runCLI(["profile", "remove", "test-profile"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("Deleted")
		expect(output).toContain("test-profile")

		// Postcondition: profile deleted
		expect(existsSync(profileDir)).toBe(false)

		// Other profiles untouched
		expect(existsSync(join(configDir, "profiles", "default"))).toBe(true)
		expect(existsSync(join(configDir, "profiles", "other-profile"))).toBe(true)
	})

	it("should fail when removing non-existent profile", async () => {
		const { exitCode, output } = await runCLI(["profile", "remove", "nonexistent"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("nonexistent")
	})

	it("should work with rm alias", async () => {
		const configDir = join(testDir, "opencode")
		const profileDir = join(configDir, "profiles", "other-profile")

		// Precondition: profile exists
		expect(existsSync(profileDir)).toBe(true)

		const { exitCode, output } = await runCLI(["profile", "rm", "other-profile"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("Deleted")
		expect(existsSync(profileDir)).toBe(false)
	})

	it("should prevent removing the last profile", async () => {
		const configDir = join(testDir, "opencode")

		// Remove all but one profile
		await runCLI(["profile", "rm", "test-profile"], testDir)
		await runCLI(["profile", "rm", "other-profile"], testDir)

		// Attempt to remove the last profile
		const { exitCode, output } = await runCLI(["profile", "rm", "default"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("last profile")

		// Profile should still exist
		expect(existsSync(join(configDir, "profiles", "default"))).toBe(true)
	})
})

// =============================================================================
// Profile Show Tests
// =============================================================================

describe("ocx profile show", () => {
	it("should show named profile with correct sentinel", async () => {
		const { exitCode, stdout } = await runCLI(["profile", "show", "test-profile"], testDir)

		expect(exitCode).toBe(0)
		expect(stdout).toContain("test-profile")
		expect(stdout).toContain(SENTINEL_TEST)

		// MUST NOT contain other sentinels
		expect(stdout).not.toContain(SENTINEL_DEFAULT)
		expect(stdout).not.toContain(SENTINEL_OTHER)
	})

	it("should show default profile when no name provided", async () => {
		const { exitCode, stdout } = await runCLI(["profile", "show"], testDir)

		expect(exitCode).toBe(0)
		expect(stdout).toContain("default")
		expect(stdout).toContain(SENTINEL_DEFAULT)

		// MUST NOT contain other sentinels
		expect(stdout).not.toContain(SENTINEL_TEST)
		expect(stdout).not.toContain(SENTINEL_OTHER)
	})

	it("should use OCX_PROFILE env var when no name provided", async () => {
		process.env.OCX_PROFILE = "other-profile"

		const { exitCode, stdout } = await runCLI(["profile", "show"], testDir, {
			env: { OCX_PROFILE: "other-profile" },
		})

		expect(exitCode).toBe(0)
		expect(stdout).toContain("other-profile")
		expect(stdout).toContain(SENTINEL_OTHER)

		// MUST NOT contain other sentinels
		expect(stdout).not.toContain(SENTINEL_DEFAULT)
		expect(stdout).not.toContain(SENTINEL_TEST)
	})

	it("should prioritize explicit arg over OCX_PROFILE env", async () => {
		const { exitCode, stdout } = await runCLI(["profile", "show", "test-profile"], testDir, {
			env: { OCX_PROFILE: "other-profile" },
		})

		expect(exitCode).toBe(0)
		// Explicit arg wins
		expect(stdout).toContain("test-profile")
		expect(stdout).toContain(SENTINEL_TEST)

		// Env var should be ignored
		expect(stdout).not.toContain(SENTINEL_OTHER)
	})

	it("should fail for non-existent profile", async () => {
		const { exitCode, output } = await runCLI(["profile", "show", "nonexistent"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("nonexistent")
	})

	describe("JSON mode", () => {
		it("should output valid JSON with correct structure", async () => {
			const { exitCode, stdout } = await runCLI(
				["profile", "show", "test-profile", "--json"],
				testDir,
			)

			expect(exitCode).toBe(0)

			const data = JSON.parse(stdout)
			expect(data.name).toBe("test-profile")
			expect(data.ocx.componentPath).toBe(SENTINEL_TEST)
			expect(data.hasAgents).toBe(false)
		})

		it("should show hasAgents true when AGENTS.md exists", async () => {
			const configDir = join(testDir, "opencode")
			await Bun.write(
				join(configDir, "profiles", "test-profile", "AGENTS.md"),
				"# Test Agent Instructions",
			)

			const { exitCode, stdout } = await runCLI(
				["profile", "show", "test-profile", "--json"],
				testDir,
			)

			expect(exitCode).toBe(0)

			const data = JSON.parse(stdout)
			expect(data.name).toBe("test-profile")
			expect(data.hasAgents).toBe(true)
		})

		it("should include opencode config when present", async () => {
			const configDir = join(testDir, "opencode")
			await Bun.write(
				join(configDir, "profiles", "test-profile", "opencode.jsonc"),
				JSON.stringify({ mcpServers: {} }, null, 2),
			)

			const { exitCode, stdout } = await runCLI(
				["profile", "show", "test-profile", "--json"],
				testDir,
			)

			expect(exitCode).toBe(0)

			const data = JSON.parse(stdout)
			expect(data.opencode).toBeDefined()
			expect(data.opencode.mcpServers).toBeDefined()
		})
	})
})

// =============================================================================
// Profile Config Tests
// =============================================================================

describe("ocx profile config", () => {
	const RACE_TIMEOUT_MS = 500
	let stubPath: string
	let argsPath: string
	let startedPath: string
	let releasePath: string
	let donePath: string

	beforeEach(async () => {
		// Create stub editor with blocking handshake
		stubPath = join(testDir, "stub-editor.sh")
		argsPath = join(testDir, "editor-args.txt")
		startedPath = join(testDir, "editor-started.txt")
		releasePath = join(testDir, "editor-release.txt")
		donePath = join(testDir, "editor-done.txt")

		await Bun.write(
			stubPath,
			`#!/usr/bin/env bash
echo "$@" > "${argsPath}"
touch "${startedPath}"
for i in {1..100}; do
  if [ -f "${releasePath}" ]; then break; fi
  sleep 0.05
done
echo "completed" > "${donePath}"
exit 0`,
		)
		await chmod(stubPath, 0o755)
	})

	it("should invoke editor with correct config path", async () => {
		const configDir = join(testDir, "opencode")
		const expectedPath = join(configDir, "profiles", "test-profile", "ocx.jsonc")

		// Start CLI (non-blocking)
		const cliPromise = runCLI(["profile", "config", "test-profile"], testDir, {
			env: { EDITOR: stubPath },
		})

		// Wait for editor to start
		await waitForFile(startedPath)

		// Read the args passed to the editor
		const args = await Bun.file(argsPath).text()
		expect(args.trim()).toBe(expectedPath)

		// Release the editor
		await Bun.write(releasePath, "release")

		// Wait for CLI to complete
		const { exitCode } = await cliPromise
		expect(exitCode).toBe(0)
	})

	it("should wait for editor to complete", async () => {
		// Start CLI (non-blocking)
		const cliPromise = runCLI(["profile", "config", "test-profile"], testDir, {
			env: { EDITOR: stubPath },
		})

		// Wait for editor to start
		await waitForFile(startedPath)

		// CLI should still be waiting (use Promise.race to verify)
		const raceResult = await Promise.race([
			cliPromise.then(() => "cli-done"),
			Bun.sleep(RACE_TIMEOUT_MS).then(() => "timeout"),
		])

		expect(raceResult).toBe("timeout")

		// Release the editor
		await Bun.write(releasePath, "release")

		// Now CLI should complete
		const { exitCode } = await cliPromise
		expect(exitCode).toBe(0)

		// Verify editor completed
		await waitForFile(donePath)
	})

	it("should fail for non-existent profile before invoking editor", async () => {
		const { exitCode, output } = await runCLI(["profile", "config", "nonexistent"], testDir, {
			env: { EDITOR: stubPath },
		})

		expect(exitCode).not.toBe(0)
		expect(output).toContain("nonexistent")

		// Editor should NOT have been invoked
		expect(existsSync(startedPath)).toBe(false)
	})

	it("should use default profile when no name provided", async () => {
		const configDir = join(testDir, "opencode")
		const expectedPath = join(configDir, "profiles", "default", "ocx.jsonc")

		// Start CLI (non-blocking)
		const cliPromise = runCLI(["profile", "config"], testDir, {
			env: { EDITOR: stubPath },
		})

		// Wait for editor to start
		await waitForFile(startedPath)

		// Read the args passed to the editor
		const args = await Bun.file(argsPath).text()
		expect(args.trim()).toBe(expectedPath)

		// Release the editor
		await Bun.write(releasePath, "release")

		// Wait for CLI to complete
		const { exitCode } = await cliPromise
		expect(exitCode).toBe(0)
	})

	it("should respect OCX_PROFILE env when no name provided", async () => {
		const configDir = join(testDir, "opencode")
		const expectedPath = join(configDir, "profiles", "other-profile", "ocx.jsonc")

		// Start CLI (non-blocking)
		const cliPromise = runCLI(["profile", "config"], testDir, {
			env: { EDITOR: stubPath, OCX_PROFILE: "other-profile" },
		})

		// Wait for editor to start
		await waitForFile(startedPath)

		// Read the args passed to the editor
		const args = await Bun.file(argsPath).text()
		expect(args.trim()).toBe(expectedPath)

		// Release the editor
		await Bun.write(releasePath, "release")

		// Wait for CLI to complete
		const { exitCode } = await cliPromise
		expect(exitCode).toBe(0)
	})

	it("should prioritize explicit arg over OCX_PROFILE env", async () => {
		const configDir = join(testDir, "opencode")
		const expectedPath = join(configDir, "profiles", "test-profile", "ocx.jsonc")

		// Start CLI (non-blocking)
		const cliPromise = runCLI(["profile", "config", "test-profile"], testDir, {
			env: { EDITOR: stubPath, OCX_PROFILE: "other-profile" },
		})

		// Wait for editor to start
		await waitForFile(startedPath)

		// Read the args passed to the editor
		const args = await Bun.file(argsPath).text()
		expect(args.trim()).toBe(expectedPath)

		// Release the editor
		await Bun.write(releasePath, "release")

		// Wait for CLI to complete
		const { exitCode } = await cliPromise
		expect(exitCode).toBe(0)
	})

	it("should use VISUAL when EDITOR not set", async () => {
		const configDir = join(testDir, "opencode")
		const expectedPath = join(configDir, "profiles", "default", "ocx.jsonc")

		// Start CLI with VISUAL instead of EDITOR
		const cliPromise = runCLI(["profile", "config"], testDir, {
			env: { VISUAL: stubPath },
		})

		// Wait for editor to start
		await waitForFile(startedPath)

		// Read the args passed to the editor
		const args = await Bun.file(argsPath).text()
		expect(args.trim()).toBe(expectedPath)

		// Release the editor
		await Bun.write(releasePath, "release")

		// Wait for CLI to complete
		const { exitCode } = await cliPromise
		expect(exitCode).toBe(0)
	})

	it("should report non-zero editor exit code", async () => {
		// Create a failing editor stub
		const failingStub = join(testDir, "failing-editor.sh")
		await Bun.write(
			failingStub,
			`#!/usr/bin/env bash
exit 1`,
		)
		await chmod(failingStub, 0o755)

		const { exitCode, output } = await runCLI(["profile", "config", "test-profile"], testDir, {
			env: { EDITOR: failingStub },
		})

		expect(exitCode).not.toBe(0)
		expect(output).toContain("Editor exited with code 1")
	})
})

// =============================================================================
// Profile Resolution Precedence Tests
// =============================================================================

describe("profile resolution precedence", () => {
	it("should resolve to default when no override", async () => {
		const { exitCode, stdout } = await runCLI(["profile", "show"], testDir)

		expect(exitCode).toBe(0)
		expect(stdout).toContain(SENTINEL_DEFAULT)
	})

	it("should resolve env var over default", async () => {
		const { exitCode, stdout } = await runCLI(["profile", "show"], testDir, {
			env: { OCX_PROFILE: "test-profile" },
		})

		expect(exitCode).toBe(0)
		expect(stdout).toContain(SENTINEL_TEST)
		expect(stdout).not.toContain(SENTINEL_DEFAULT)
	})

	it("should resolve explicit arg over env var and default", async () => {
		const { exitCode, stdout } = await runCLI(["profile", "show", "other-profile"], testDir, {
			env: { OCX_PROFILE: "test-profile" },
		})

		expect(exitCode).toBe(0)
		expect(stdout).toContain(SENTINEL_OTHER)
		expect(stdout).not.toContain(SENTINEL_TEST)
		expect(stdout).not.toContain(SENTINEL_DEFAULT)
	})
})
