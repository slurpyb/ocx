/**
 * Profile Layering Tests
 *
 * Tests for the ProfileManager layering functionality covering:
 * - Global + local profile merging (getLayered)
 * - Registry merging
 * - Scalar field override behavior
 * - Array replacement vs concatenation
 * - AGENTS.md discovery from both layers
 *
 * PHASE 1 RED: Local profile layering is being removed.
 * All tests that depend on local profile directories are marked with
 * `.todo` to indicate they conflict with the global-only profiles plan.
 * These tests will either be removed or rewritten in Phase 2 (GREEN).
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

	describe("Registry Merging", () => {
		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should merge global and local registries (no conflicts)", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile with one registry
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "ocx.jsonc"),
				JSON.stringify({
					registries: { "global-reg": { url: "https://global.com" } },
				}),
			)

			// Create local profile with different registry
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(
				join(localProfileDir, "ocx.jsonc"),
				JSON.stringify({
					registries: { "local-reg": { url: "https://local.com" } },
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Both registries should be present
			expect(profile.ocx.registries).toEqual({
				"global-reg": { url: "https://global.com" },
				"local-reg": { url: "https://local.com" },
			})
		})

		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should override global registry with same name", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "ocx.jsonc"),
				JSON.stringify({
					registries: { shared: { url: "https://global.com" } },
				}),
			)

			// Create local profile with conflicting registry name
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(
				join(localProfileDir, "ocx.jsonc"),
				JSON.stringify({
					registries: { shared: { url: "https://local.com" } },
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Local should win
			expect(profile.ocx.registries.shared).toEqual({ url: "https://local.com" })
		})
	})

	describe("Scalar Field Overrides", () => {
		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should override componentPath with local value", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "ocx.jsonc"),
				JSON.stringify({
					componentPath: "global-components",
				}),
			)

			// Create local profile
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(
				join(localProfileDir, "ocx.jsonc"),
				JSON.stringify({
					componentPath: "local-components",
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Local should win
			expect(profile.ocx.componentPath).toBe("local-components")
		})

		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should override renameWindow with local value", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile with renameWindow: true
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "ocx.jsonc"),
				JSON.stringify({
					renameWindow: true,
				}),
			)

			// Create local profile with renameWindow: false
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(
				join(localProfileDir, "ocx.jsonc"),
				JSON.stringify({
					renameWindow: false,
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Local should win
			expect(profile.ocx.renameWindow).toBe(false)
		})

		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should override bin with local value", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "ocx.jsonc"),
				JSON.stringify({
					bin: "/usr/bin/opencode",
				}),
			)

			// Create local profile
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(
				join(localProfileDir, "ocx.jsonc"),
				JSON.stringify({
					bin: "/custom/opencode",
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Local should win
			expect(profile.ocx.bin).toBe("/custom/opencode")
		})
	})

	describe("Array Field Behavior", () => {
		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should replace exclude array (not concatenate)", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "ocx.jsonc"),
				JSON.stringify({
					exclude: ["*.log", "*.tmp"],
				}),
			)

			// Create local profile with different exclude
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(
				join(localProfileDir, "ocx.jsonc"),
				JSON.stringify({
					exclude: ["*.cache"],
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Local should replace (not concatenate)
			expect(profile.ocx.exclude).toEqual(["*.cache"])
		})

		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should replace include array (not concatenate)", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "ocx.jsonc"),
				JSON.stringify({
					include: ["*.important"],
				}),
			)

			// Create local profile
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(
				join(localProfileDir, "ocx.jsonc"),
				JSON.stringify({
					include: ["*.critical"],
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Local should replace
			expect(profile.ocx.include).toEqual(["*.critical"])
		})

		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should use schema defaults when local doesn't explicitly set arrays", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile with custom exclude/include
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "ocx.jsonc"),
				JSON.stringify({
					registries: {},
					exclude: ["*.log"],
					include: ["*.important"],
				}),
			)

			// Create local profile with only componentPath (no exclude/include defined)
			// Since exclude/include have Zod defaults, they will be set to schema defaults
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(
				join(localProfileDir, "ocx.jsonc"),
				JSON.stringify({
					registries: {},
					componentPath: "local-path",
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Schema defaults should be applied (since local config triggers parsing with defaults)
			expect(profile.ocx.exclude).toEqual([
				"**/CLAUDE.md",
				"**/CONTEXT.md",
				"**/.opencode/**",
				"**/opencode.jsonc",
				"**/opencode.json",
			])
			expect(profile.ocx.include).toEqual([])
			// But componentPath should be from local
			expect(profile.ocx.componentPath).toBe("local-path")
		})
	})

	describe("OpenCode Config Plugin Array Concatenation", () => {
		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should concatenate plugin arrays from global and local", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile with plugin
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "opencode.jsonc"),
				JSON.stringify({
					plugin: ["global-plugin"],
				}),
			)

			// Create local profile with different plugin
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(join(localProfileDir, "ocx.jsonc"), JSON.stringify({ registries: {} }))
			await writeFile(
				join(localProfileDir, "opencode.jsonc"),
				JSON.stringify({
					plugin: ["local-plugin"],
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Plugins should be concatenated
			expect(profile.opencode?.plugin).toEqual(["global-plugin", "local-plugin"])
		})

		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should deduplicate plugin arrays", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "opencode.jsonc"),
				JSON.stringify({
					plugin: ["shared-plugin", "global-only"],
				}),
			)

			// Create local profile with overlapping plugin
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(join(localProfileDir, "ocx.jsonc"), JSON.stringify({ registries: {} }))
			await writeFile(
				join(localProfileDir, "opencode.jsonc"),
				JSON.stringify({
					plugin: ["shared-plugin", "local-only"],
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Plugins should be deduplicated by canonical name (last-wins)
			// "shared-plugin" appears in both global and local; local (later) wins,
			// so the global occurrence is removed and replaced by the local one.
			expect(profile.opencode?.plugin).toEqual(["global-only", "shared-plugin", "local-only"])
		})

		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should concatenate instructions arrays from global and local", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile with instructions
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "opencode.jsonc"),
				JSON.stringify({
					instructions: ["global-instructions.md"],
				}),
			)

			// Create local profile with different instructions
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(join(localProfileDir, "ocx.jsonc"), JSON.stringify({ registries: {} }))
			await writeFile(
				join(localProfileDir, "opencode.jsonc"),
				JSON.stringify({
					instructions: ["local-instructions.md"],
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Instructions should be concatenated
			expect(profile.opencode?.instructions).toEqual([
				"global-instructions.md",
				"local-instructions.md",
			])
		})
	})

	describe("AGENTS.md Discovery", () => {
		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should discover both global and local AGENTS.md files", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile with AGENTS.md
			const globalProfileDir = getProfileDir("default")
			await writeFile(join(globalProfileDir, "AGENTS.md"), "# Global Instructions")

			// Create local profile with AGENTS.md
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(join(localProfileDir, "ocx.jsonc"), JSON.stringify({ registries: {} }))
			await writeFile(join(localProfileDir, "AGENTS.md"), "# Local Instructions")

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// hasAgents should be true since both have AGENTS.md
			expect(profile.hasAgents).toBe(true)
		})

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

		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should detect AGENTS.md when only local has it", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Remove AGENTS.md from global profile
			const globalProfileDir = getProfileDir("default")
			await rm(join(globalProfileDir, "AGENTS.md"), { force: true })

			// Create local profile with AGENTS.md
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(join(localProfileDir, "ocx.jsonc"), JSON.stringify({ registries: {} }))
			await writeFile(join(localProfileDir, "AGENTS.md"), "# Local Instructions")

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// hasAgents should be true (local has it)
			expect(profile.hasAgents).toBe(true)
		})
	})

	describe("Complex Merging Scenarios", () => {
		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should correctly merge complex nested opencode config", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile with nested config
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "opencode.jsonc"),
				JSON.stringify({
					model: "global-model",
					env: {
						GLOBAL_VAR: "global-value",
					},
					plugin: ["global-plugin"],
				}),
			)

			// Create local profile with overlapping config
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(join(localProfileDir, "ocx.jsonc"), JSON.stringify({ registries: {} }))
			await writeFile(
				join(localProfileDir, "opencode.jsonc"),
				JSON.stringify({
					model: "local-model", // Override scalar
					env: {
						LOCAL_VAR: "local-value", // Merge objects
					},
					plugin: ["local-plugin"], // Concatenate array
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Scalars: local wins
			expect(profile.opencode?.model).toBe("local-model")

			// Objects: deep merge
			expect(profile.opencode?.env).toEqual({
				GLOBAL_VAR: "global-value",
				LOCAL_VAR: "local-value",
			})

			// Plugin arrays: concatenate
			expect(profile.opencode?.plugin).toEqual(["global-plugin", "local-plugin"])
		})

		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should handle minimal local profile gracefully", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile with full config
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "ocx.jsonc"),
				JSON.stringify({
					registries: { "global-reg": { url: "https://global.com" } },
					exclude: ["*.log"],
					renameWindow: true,
					componentPath: "global-path",
				}),
			)

			// Create minimal local profile (only override bin)
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(
				join(localProfileDir, "ocx.jsonc"),
				JSON.stringify({
					registries: {},
					bin: "/local/opencode",
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// Global values should remain for non-overridden fields
			expect(profile.ocx.registries).toEqual({
				"global-reg": { url: "https://global.com" },
			})
			expect(profile.ocx.renameWindow).toBe(true)
			expect(profile.ocx.componentPath).toBe("global-path")
			// But bin should be from local
			expect(profile.ocx.bin).toBe("/local/opencode")
		})

		// PHASE 1 RED: Local profiles are unsupported — this test expects local overlay merging
		it.todo("should handle local profile completely overriding global", async () => {
			const manager = ProfileManager.create(projectDir)
			await manager.initialize()

			// Create global profile
			const globalProfileDir = getProfileDir("default")
			await writeFile(
				join(globalProfileDir, "ocx.jsonc"),
				JSON.stringify({
					registries: { "global-reg": { url: "https://global.com" } },
					exclude: ["*.log"],
					componentPath: "global-path",
					renameWindow: true,
				}),
			)

			// Create local profile that overrides everything
			const localProfileDir = getLocalProfileDir("default", projectDir)
			await mkdir(localProfileDir, { recursive: true })
			await writeFile(
				join(localProfileDir, "ocx.jsonc"),
				JSON.stringify({
					registries: { "local-reg": { url: "https://local.com" } },
					exclude: ["*.cache"],
					componentPath: "local-path",
					renameWindow: false,
				}),
			)

			// Get layered profile
			const profile = await manager.getLayered("default", projectDir)

			// All values should be from local (merged for registries)
			expect(profile.ocx.registries).toEqual({
				"global-reg": { url: "https://global.com" },
				"local-reg": { url: "https://local.com" },
			})
			expect(profile.ocx.exclude).toEqual(["*.cache"])
			expect(profile.ocx.componentPath).toBe("local-path")
			expect(profile.ocx.renameWindow).toBe(false)
		})
	})
})
