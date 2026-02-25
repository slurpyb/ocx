/**
 * Profile Layering Tests
 *
 * Tests for current ProfileManager layering scope covering:
 * - Global profile loading via getLayered
 * - Profile-not-found behavior when the global profile is missing
 * - Hard-fail checks when a local profile directory exists
 * - AGENTS.md discovery for global profiles
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ProfileManager } from "../../src/profile/manager"
import { getLocalProfileDir, getProfileDir } from "../../src/profile/paths"

// =============================================================================
// HELPERS
// =============================================================================

async function createTempConfigDir(name: string): Promise<string> {
	const dir = join(import.meta.dir, "fixtures", `tmp-${name}-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	return dir
}

async function cleanupTempDir(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true })
}

// =============================================================================
// PROFILE LAYERING TESTS
// =============================================================================

describe.serial("Profile Layering - getLayered()", () => {
	let testDir: string
	let projectDir: string
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeEach(async () => {
		testDir = await createTempConfigDir("profile-layering")
		projectDir = join(testDir, "project")
		process.env.XDG_CONFIG_HOME = testDir

		// Create project directory with .git to prevent walking up to find repo's .opencode
		await mkdir(projectDir, { recursive: true })
		await mkdir(join(projectDir, ".git"), { recursive: true })
	})

	afterEach(async () => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		await cleanupTempDir(testDir)
	})

	describe("Base Cases", () => {
		it("should return global profile when no local exists", async () => {
			// Create global profile
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "ocx.jsonc"),
				JSON.stringify({
					registries: { "global-reg": { url: "https://global.com" } },
					exclude: ["*.log"],
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			expect(profile.name).toBe("default")
			expect(profile.ocx.registries).toEqual({
				"global-reg": { url: "https://global.com" },
			})
			expect(profile.ocx.exclude).toEqual(["*.log"])
		})

		it("should throw ProfileNotFoundError when global profile doesn't exist", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			expect(manager.getLayered("nonexistent", projectDir)).rejects.toThrow(
				/Profile "nonexistent" not found/,
			)
		})

		// PHASE 1 RED: getLayered must reject when local profile directory exists
		it("should hard error when local profile directory exists", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "ocx.jsonc"),
				JSON.stringify({
					registries: { "global-reg": { url: "https://global.com" } },
				}),
			)

			// Create local profile directory — this must trigger a hard error
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(join(localProfileDir, "ocx.jsonc"), JSON.stringify({ registries: {} }))

			// getLayered must throw because local profiles are unsupported
			expect(manager.getLayered("default", projectDir)).rejects.toThrow(
				/local.*profile.*unsupported|local.*profile.*not.*allowed/i,
			)
		})
	})

	describe("AGENTS.md Discovery", () => {
		it("should detect AGENTS.md when only global has it", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Global profile has AGENTS.md by default (created by initialize)
			const globalProfile = await manager.get("default")
			expect(globalProfile.hasAgents).toBe(true)

			// With global-only profiles, getLayered returns global profile directly
			// No local profile directory should exist
			const profile = await manager.getLayered("default", projectDir)

			// hasAgents should be true (global has it)
			expect(profile.hasAgents).toBe(true)
		})
	})
})
