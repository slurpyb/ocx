/**
 * Profile Commands Tests
 *
 * Comprehensive tests for profile show and remove commands.
 * Uses unique componentPath values as sentinels to verify correct profile selection.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
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
