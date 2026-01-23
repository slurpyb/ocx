/**
 * ConfigResolver Unit Tests
 *
 * Tests for profile resolution and config merging.
 * Uses the tmpdir fixture for isolated temporary directories.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ConfigResolver } from "../../src/config/resolver"
import { tmpdir } from "../fixture"

// =============================================================================
// PROFILE RESOLUTION TESTS
// =============================================================================

describe("ConfigResolver", () => {
	describe("profile resolution", () => {
		let originalXdgConfigHome: string | undefined
		let originalOcxProfile: string | undefined
		let xdgDir: string

		beforeEach(async () => {
			// Create isolated XDG directory
			xdgDir = path.join(os.tmpdir(), `ocx-test-xdg-${Math.random().toString(36).slice(2)}`)
			await fs.mkdir(xdgDir, { recursive: true })

			// Save and override XDG_CONFIG_HOME
			originalXdgConfigHome = process.env.XDG_CONFIG_HOME
			originalOcxProfile = process.env.OCX_PROFILE
			process.env.XDG_CONFIG_HOME = xdgDir
		})

		afterEach(async () => {
			// Restore environment
			if (originalXdgConfigHome === undefined) {
				delete process.env.XDG_CONFIG_HOME
			} else {
				process.env.XDG_CONFIG_HOME = originalXdgConfigHome
			}
			if (originalOcxProfile === undefined) {
				delete process.env.OCX_PROFILE
			} else {
				process.env.OCX_PROFILE = originalOcxProfile
			}
			// Cleanup XDG directory
			await fs.rm(xdgDir, { recursive: true, force: true })
		})

		it("resolves profile from explicit option (highest priority)", async () => {
			await using tmp = await tmpdir({
				git: true,
				profile: { name: "work", ocxConfig: { registries: {} } },
			})

			// Also create a "personal" profile
			const personalDir = path.join(xdgDir, "opencode", "profiles", "personal")
			await fs.mkdir(personalDir, { recursive: true })
			await Bun.write(path.join(personalDir, "ocx.jsonc"), JSON.stringify({ registries: {} }))

			// Set env to personal, but pass work as explicit option
			process.env.OCX_PROFILE = "personal"

			const resolver = await ConfigResolver.create(tmp.path, { profile: "work" })
			const config = resolver.resolve()

			expect(config.profileName).toBe("work") // NOT "personal"
		})

		it("resolves profile from OCX_PROFILE env when no explicit option", async () => {
			await using tmp = await tmpdir({
				git: true,
				profile: { name: "personal", ocxConfig: { registries: {} } },
			})

			// Also create default profile
			const defaultDir = path.join(xdgDir, "opencode", "profiles", "default")
			await fs.mkdir(defaultDir, { recursive: true })
			await Bun.write(path.join(defaultDir, "ocx.jsonc"), JSON.stringify({ registries: {} }))

			process.env.OCX_PROFILE = "personal"

			const resolver = await ConfigResolver.create(tmp.path)
			const config = resolver.resolve()

			expect(config.profileName).toBe("personal") // NOT "default"
		})

		it("falls back to 'default' profile when no option or env", async () => {
			await using tmp = await tmpdir({
				git: true,
				profile: { name: "default", ocxConfig: { registries: {} } },
			})

			// Also create another profile to prove we're not just picking first
			const workDir = path.join(xdgDir, "opencode", "profiles", "work")
			await fs.mkdir(workDir, { recursive: true })
			await Bun.write(path.join(workDir, "ocx.jsonc"), JSON.stringify({ registries: {} }))

			delete process.env.OCX_PROFILE

			const resolver = await ConfigResolver.create(tmp.path)
			const config = resolver.resolve()

			expect(config.profileName).toBe("default")
		})

		it("returns null profileName when no profiles exist", async () => {
			await using tmp = await tmpdir({ git: true })

			delete process.env.OCX_PROFILE

			const resolver = await ConfigResolver.create(tmp.path)
			const config = resolver.resolve()

			expect(config.profileName).toBeNull()
		})
	})

	// =============================================================================
	// CONFIG MERGING TESTS
	// =============================================================================

	describe("config merging", () => {
		let originalXdgConfigHome: string | undefined
		let originalOcxProfile: string | undefined
		let xdgDir: string

		beforeEach(async () => {
			xdgDir = path.join(os.tmpdir(), `ocx-test-xdg-${Math.random().toString(36).slice(2)}`)
			await fs.mkdir(xdgDir, { recursive: true })

			originalXdgConfigHome = process.env.XDG_CONFIG_HOME
			originalOcxProfile = process.env.OCX_PROFILE
			process.env.XDG_CONFIG_HOME = xdgDir
			delete process.env.OCX_PROFILE
		})

		afterEach(async () => {
			if (originalXdgConfigHome === undefined) {
				delete process.env.XDG_CONFIG_HOME
			} else {
				process.env.XDG_CONFIG_HOME = originalXdgConfigHome
			}
			if (originalOcxProfile === undefined) {
				delete process.env.OCX_PROFILE
			} else {
				process.env.OCX_PROFILE = originalOcxProfile
			}
			await fs.rm(xdgDir, { recursive: true, force: true })
		})

		it("deep merges nested objects (local overrides profile)", async () => {
			await using tmp = await tmpdir({
				git: true,
				profile: {
					name: "default",
					ocxConfig: { registries: {}, exclude: [], include: [] },
					opencodeConfig: {
						nested: { fromProfile: "yes", shared: "profile-value" },
						topLevel: "profile",
					},
				},
				opencodeConfig: {
					nested: { fromLocal: "yes", shared: "local-value" },
					topLevel: "local",
				},
			})

			const resolver = await ConfigResolver.create(tmp.path)
			const config = resolver.resolve()

			// Deep merge: all nested keys preserved, local wins on conflicts
			const nested = config.opencode.nested as Record<string, unknown>
			expect(nested.fromProfile).toBe("yes")
			expect(nested.fromLocal).toBe("yes")
			expect(nested.shared).toBe("local-value") // Local wins
			expect(config.opencode.topLevel).toBe("local") // Local wins
		})
	})

	// =============================================================================
	// REGISTRY SCOPE ISOLATION TESTS
	// =============================================================================

	describe("registry scope isolation", () => {
		let originalXdgConfigHome: string | undefined
		let originalOcxProfile: string | undefined
		let xdgDir: string

		beforeEach(async () => {
			xdgDir = path.join(os.tmpdir(), `ocx-test-xdg-${Math.random().toString(36).slice(2)}`)
			await fs.mkdir(xdgDir, { recursive: true })

			originalXdgConfigHome = process.env.XDG_CONFIG_HOME
			originalOcxProfile = process.env.OCX_PROFILE
			process.env.XDG_CONFIG_HOME = xdgDir
			delete process.env.OCX_PROFILE
		})

		afterEach(async () => {
			if (originalXdgConfigHome === undefined) {
				delete process.env.XDG_CONFIG_HOME
			} else {
				process.env.XDG_CONFIG_HOME = originalXdgConfigHome
			}
			if (originalOcxProfile === undefined) {
				delete process.env.OCX_PROFILE
			} else {
				process.env.OCX_PROFILE = originalOcxProfile
			}
			await fs.rm(xdgDir, { recursive: true, force: true })
		})

		it("isolates registries - profile active uses only profile registries", async () => {
			// Setup: profile with registries + local with DIFFERENT registries
			// + include pattern to make shouldLoadLocal=true
			await using tmp = await tmpdir({
				git: true,
				profile: {
					name: "work",
					ocxConfig: {
						registries: {
							"profile-only": { url: "https://profile.example/registry" },
						},
						exclude: ["**/.opencode/**"],
						include: ["./.opencode/**"], // Forces shouldLoadLocal=true
					},
					opencodeConfig: { profileSentinel: "loaded" },
				},
				ocxConfig: {
					registries: {
						"local-only": { url: "https://local.example/registry" },
					},
				},
				opencodeConfig: { localSentinel: "loaded" },
			})

			const resolver = await ConfigResolver.create(tmp.path, { profile: "work" })
			const config = resolver.resolve()

			// Verify profile was used
			expect(config.profileName).toBe("work")

			// KEY: Verify opencode config merged (proves shouldLoadLocal=true)
			expect(config.opencode.localSentinel).toBe("loaded")
			expect(config.opencode.profileSentinel).toBe("loaded")

			// KEY: Verify registries are ISOLATED (profile only, no local)
			expect(config.registries["profile-only"]).toBeDefined()
			expect(config.registries["profile-only"].url).toBe("https://profile.example/registry")
			expect(config.registries["local-only"]).toBeUndefined()
			expect(Object.keys(config.registries)).toEqual(["profile-only"])
		})

		it("no profile uses local registries only", async () => {
			await using tmp = await tmpdir({
				git: true,
				// No profile!
				ocxConfig: {
					registries: {
						"local-only": { url: "https://local.example/registry" },
					},
				},
			})

			const resolver = await ConfigResolver.create(tmp.path) // No profile option
			const config = resolver.resolve()

			expect(config.profileName).toBeNull()
			expect(config.registries["local-only"]).toBeDefined()
			expect(config.registries["local-only"].url).toBe("https://local.example/registry")
			expect(Object.keys(config.registries).sort()).toEqual(["local-only"])
		})

		it("opencode config merges while registries remain isolated", async () => {
			await using tmp = await tmpdir({
				git: true,
				profile: {
					name: "work",
					ocxConfig: {
						registries: {
							"profile-reg": { url: "https://profile.example/registry" },
						},
						exclude: ["**/.opencode/**"],
						include: ["./.opencode/**"],
					},
					opencodeConfig: {
						model: "profile-model",
						nested: { fromProfile: true },
					},
				},
				ocxConfig: {
					registries: {
						"local-reg": { url: "https://local.example/registry" },
					},
				},
				opencodeConfig: {
					theme: "local-theme",
					nested: { fromLocal: true },
				},
			})

			const resolver = await ConfigResolver.create(tmp.path, { profile: "work" })
			const config = resolver.resolve()

			// OpenCode config MERGED (deep merge)
			expect(config.opencode.model).toBe("profile-model")
			expect(config.opencode.theme).toBe("local-theme")
			expect(config.opencode.nested?.fromProfile).toBe(true)
			expect(config.opencode.nested?.fromLocal).toBe(true)

			// Registries ISOLATED (profile only)
			expect(config.registries["profile-reg"]).toBeDefined()
			expect(config.registries["local-reg"]).toBeUndefined()
		})
	})
})
