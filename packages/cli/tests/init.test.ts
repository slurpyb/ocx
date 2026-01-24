import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { getReleaseTag, getTemplateUrl, TEMPLATE_REPO } from "../src/commands/init"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"

/** Path to the registry-template test fixture */
const REGISTRY_FIXTURE = join(dirname(import.meta.path), "fixtures/registry-template")

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
		// Success message from logger.info
		expect(output).toContain("Created")

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		expect(existsSync(configPath)).toBe(true)

		const content = await readFile(configPath, "utf-8")
		const config = parseJsonc(content)
		expect(config.registries).toBeDefined()
		expect(config.lockRegistries).toBe(false)
	})

	it("should error if ocx.jsonc already exists", async () => {
		testDir = await createTempDir("init-exists")
		const configDir = join(testDir, ".opencode")
		await mkdir(configDir, { recursive: true })
		const configPath = join(configDir, "ocx.jsonc")
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

describe("init --registry", () => {
	let testDir: string

	afterEach(async () => {
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("should replace placeholders in registry.jsonc", async () => {
		testDir = await createTempDir("init-registry-placeholders")

		const { exitCode, output } = await runCLI(
			[
				"init",
				"--registry",
				"--local",
				REGISTRY_FIXTURE,
				"--namespace",
				"test-namespace",
				"--author",
				"Test Author",
			],
			testDir,
		)

		expect(exitCode).toBe(0)
		expect(output).toContain("Next steps:")

		// Read the generated registry.jsonc
		const registryPath = join(testDir, "registry.jsonc")
		expect(existsSync(registryPath)).toBe(true)

		const content = await readFile(registryPath, "utf-8")

		// Positive assertions - new values present
		expect(content).toContain('"namespace": "test-namespace"')
		expect(content).toContain('"author": "Test Author"')

		// CRITICAL: Negative assertions - template placeholders GONE
		// These are the original template values that should be replaced
		expect(content).not.toContain('"namespace": "my-registry"')
		expect(content).not.toContain('"author": "Your Name"')
	})

	it("should reference registry.jsonc in output message", async () => {
		testDir = await createTempDir("init-registry-output")

		const { exitCode, output } = await runCLI(
			["init", "--registry", "--local", REGISTRY_FIXTURE, "--namespace", "my-ns", "--author", "Me"],
			testDir,
		)

		expect(exitCode).toBe(0)
		// Should mention registry.jsonc, not registry.json
		expect(output).toContain("registry.jsonc")
		expect(output).not.toMatch(/registry\.json\b/)
	})

	it("should replace namespace in package.json name field", async () => {
		testDir = await createTempDir("init-registry-package")

		const { exitCode } = await runCLI(
			[
				"init",
				"--registry",
				"--local",
				REGISTRY_FIXTURE,
				"--namespace",
				"custom-namespace",
				"--author",
				"Test",
			],
			testDir,
		)

		expect(exitCode).toBe(0)

		const packagePath = join(testDir, "package.json")
		const content = await readFile(packagePath, "utf-8")

		// Positive: new namespace should be present
		expect(content).toContain('"name": "custom-namespace"')

		// Negative: template placeholder should be gone
		expect(content).not.toContain('"name": "my-registry"')
	})
})

describe("init --global", () => {
	let testDir: string

	beforeEach(async () => {
		testDir = await createTempDir("init-global")
	})

	afterEach(async () => {
		await cleanupTempDir(testDir)
	})

	// 4.1: Test creates all 4 files with correct CONTENT
	it("should create all 4 files with correct content", async () => {
		const { exitCode } = await runCLI(["init", "--global"], testDir, {
			env: { XDG_CONFIG_HOME: testDir },
		})
		expect(exitCode).toBe(0)

		const configDir = join(testDir, "opencode")

		// Check global config exists and has correct content
		const globalConfigPath = join(configDir, "ocx.jsonc")
		expect(existsSync(globalConfigPath)).toBe(true)
		const globalConfig = parseJsonc(await Bun.file(globalConfigPath).text()) as {
			$schema?: string
			registries?: Record<string, unknown>
		}
		expect(globalConfig.$schema).toBe("https://ocx.kdco.dev/schemas/ocx.json")
		expect(globalConfig.registries).toEqual({})

		// Check profile ocx.jsonc
		const profileOcxPath = join(configDir, "profiles/default/ocx.jsonc")
		expect(existsSync(profileOcxPath)).toBe(true)
		const profileOcx = parseJsonc(await Bun.file(profileOcxPath).text()) as {
			$schema?: string
			registries?: Record<string, unknown>
		}
		expect(profileOcx.$schema).toBeDefined()
		expect(profileOcx.registries).toEqual({})

		// Check profile opencode.jsonc
		const profileOpencodePath = join(configDir, "profiles/default/opencode.jsonc")
		expect(existsSync(profileOpencodePath)).toBe(true)
		const profileOpencode = parseJsonc(await Bun.file(profileOpencodePath).text())
		expect(profileOpencode).toEqual({})

		// Check profile AGENTS.md
		const agentsPath = join(configDir, "profiles/default/AGENTS.md")
		expect(existsSync(agentsPath)).toBe(true)
		const agentsContent = await Bun.file(agentsPath).text()
		expect(agentsContent).toContain("# Profile Instructions")
	})

	// 4.2: Test idempotency with SENTINEL content
	it("should not overwrite existing files (sentinel test)", async () => {
		const configDir = join(testDir, "opencode")
		const profileDir = join(configDir, "profiles/default")

		// Pre-create directories
		await mkdir(profileDir, { recursive: true })

		// Pre-create files with SENTINEL content
		const globalConfigPath = join(configDir, "ocx.jsonc")
		const sentinelGlobal = {
			$schema: "SENTINEL",
			registries: { SENTINEL: { url: "https://sentinel.test" } },
		}
		await Bun.write(globalConfigPath, JSON.stringify(sentinelGlobal, null, 2))

		const profileOcxPath = join(profileDir, "ocx.jsonc")
		const sentinelProfileOcx = { SENTINEL_PROFILE: true }
		await Bun.write(profileOcxPath, JSON.stringify(sentinelProfileOcx, null, 2))

		const profileOpencodePath = join(profileDir, "opencode.jsonc")
		const sentinelOpencode = { SENTINEL_OPENCODE: true }
		await Bun.write(profileOpencodePath, JSON.stringify(sentinelOpencode, null, 2))

		const agentsPath = join(profileDir, "AGENTS.md")
		const sentinelAgents = "SENTINEL_DO_NOT_REMOVE\n"
		await Bun.write(agentsPath, sentinelAgents)

		// Run init --global TWICE
		const result1 = await runCLI(["init", "--global"], testDir, {
			env: { XDG_CONFIG_HOME: testDir },
		})
		expect(result1.exitCode).toBe(0)
		const result2 = await runCLI(["init", "--global"], testDir, {
			env: { XDG_CONFIG_HOME: testDir },
		})
		expect(result2.exitCode).toBe(0)

		// Verify all files are BYTE-FOR-BYTE unchanged
		expect(await Bun.file(globalConfigPath).text()).toBe(JSON.stringify(sentinelGlobal, null, 2))
		expect(await Bun.file(profileOcxPath).text()).toBe(JSON.stringify(sentinelProfileOcx, null, 2))
		expect(await Bun.file(profileOpencodePath).text()).toBe(
			JSON.stringify(sentinelOpencode, null, 2),
		)
		expect(await Bun.file(agentsPath).text()).toBe(sentinelAgents)
	})

	// 4.3: Test partial convergence
	it("should create only missing files (partial convergence)", async () => {
		const configDir = join(testDir, "opencode")
		const profileDir = join(configDir, "profiles/default")

		// Pre-create ONLY global config with sentinel
		await mkdir(configDir, { recursive: true })
		const globalConfigPath = join(configDir, "ocx.jsonc")
		const sentinelGlobal = { SENTINEL: "global" }
		await Bun.write(globalConfigPath, JSON.stringify(sentinelGlobal, null, 2))

		// Run init --global
		const { exitCode } = await runCLI(["init", "--global"], testDir, {
			env: { XDG_CONFIG_HOME: testDir },
		})
		expect(exitCode).toBe(0)

		// Verify global config unchanged (sentinel preserved)
		const globalContent = await Bun.file(globalConfigPath).text()
		expect(globalContent).toBe(JSON.stringify(sentinelGlobal, null, 2))

		// Verify profile files were created
		expect(existsSync(join(profileDir, "ocx.jsonc"))).toBe(true)
		expect(existsSync(join(profileDir, "opencode.jsonc"))).toBe(true)
		expect(existsSync(join(profileDir, "AGENTS.md"))).toBe(true)
	})

	// 4.4: Test --json output with filesystem cross-check
	it("should output correct JSON that matches filesystem", async () => {
		const { exitCode, output } = await runCLI(["init", "--global", "--json"], testDir, {
			env: { XDG_CONFIG_HOME: testDir },
		})
		expect(exitCode).toBe(0)

		const json = JSON.parse(output) as {
			success: boolean
			files: {
				globalConfig: string
				profileOcx: string
				profileOpencode: string
				profileAgents: string
			}
			created: string[]
			existed: string[]
		}
		expect(json.success).toBe(true)

		// Verify files object has all 4 paths
		expect(json.files.globalConfig).toBeDefined()
		expect(json.files.profileOcx).toBeDefined()
		expect(json.files.profileOpencode).toBeDefined()
		expect(json.files.profileAgents).toBeDefined()

		// Cross-check: all files should exist
		expect(existsSync(json.files.globalConfig)).toBe(true)
		expect(existsSync(json.files.profileOcx)).toBe(true)
		expect(existsSync(json.files.profileOpencode)).toBe(true)
		expect(existsSync(json.files.profileAgents)).toBe(true)

		// All should be created (fresh run)
		expect(json.created).toContain("globalConfig")
		expect(json.created).toContain("profileOcx")
		expect(json.created).toContain("profileOpencode")
		expect(json.created).toContain("profileAgents")
		expect(json.existed).toEqual([])

		// Run again - should all be "existed"
		const { output: output2 } = await runCLI(["init", "--global", "--json"], testDir, {
			env: { XDG_CONFIG_HOME: testDir },
		})
		const json2 = JSON.parse(output2) as { created: string[]; existed: string[] }
		expect(json2.created).toEqual([])
		expect(json2.existed).toContain("globalConfig")
		expect(json2.existed).toContain("profileOcx")
		expect(json2.existed).toContain("profileOpencode")
		expect(json2.existed).toContain("profileAgents")
	})

	// 4.5: Test --quiet produces no stdout
	it("should produce no stdout with --quiet", async () => {
		const { exitCode, output } = await runCLI(["init", "--global", "--quiet"], testDir, {
			env: { XDG_CONFIG_HOME: testDir },
		})
		expect(exitCode).toBe(0)
		expect(output.trim()).toBe("")

		// Files should still be created
		const configDir = join(testDir, "opencode")
		expect(existsSync(join(configDir, "ocx.jsonc"))).toBe(true)
	})

	// 4.6: Test --quiet --json precedence (--json still outputs)
	it("should output JSON even with --quiet flag", async () => {
		const { exitCode, output } = await runCLI(["init", "--global", "--quiet", "--json"], testDir, {
			env: { XDG_CONFIG_HOME: testDir },
		})
		expect(exitCode).toBe(0)

		// JSON output should still be present (--json wins for structured output)
		const json = JSON.parse(output) as { success: boolean }
		expect(json.success).toBe(true)

		// Files should still be created
		const configDir = join(testDir, "opencode")
		expect(existsSync(join(configDir, "ocx.jsonc"))).toBe(true)
	})

	// 4.7: Test path isolation
	it("should only create files under XDG_CONFIG_HOME", async () => {
		const { exitCode } = await runCLI(["init", "--global"], testDir, {
			env: { XDG_CONFIG_HOME: testDir },
		})
		expect(exitCode).toBe(0)

		// All created paths should be under testDir
		const configDir = join(testDir, "opencode")
		const globalConfigPath = join(configDir, "ocx.jsonc")
		const profileOcxPath = join(configDir, "profiles/default/ocx.jsonc")

		// Verify paths start with XDG_CONFIG_HOME
		expect(realpathSync(globalConfigPath).startsWith(realpathSync(testDir))).toBe(true)
		expect(realpathSync(profileOcxPath).startsWith(realpathSync(testDir))).toBe(true)
	})
})

describe("getReleaseTag", () => {
	it("should throw ValidationError in development mode (when __VERSION__ is undefined)", () => {
		// In source/test mode, __VERSION__ is not defined, so this should throw
		expect(() => getReleaseTag()).toThrow("Cannot fetch release template in development mode")
	})

	it("should provide helpful guidance in error message", () => {
		try {
			getReleaseTag()
			expect.unreachable("Should have thrown")
		} catch (error) {
			expect((error as Error).message).toContain("--canary")
		}
	})
})

describe("getTemplateUrl", () => {
	it("should use heads/main ref for canary", () => {
		const url = getTemplateUrl("main")
		expect(url).toBe(`https://github.com/${TEMPLATE_REPO}/archive/refs/heads/main.tar.gz`)
	})

	it("should use tags ref for release version", () => {
		const url = getTemplateUrl("v1.4.1")
		expect(url).toBe(`https://github.com/${TEMPLATE_REPO}/archive/refs/tags/v1.4.1.tar.gz`)
	})

	it("should handle pre-release versions", () => {
		const url = getTemplateUrl("v2.0.0-beta.1")
		expect(url).toBe(`https://github.com/${TEMPLATE_REPO}/archive/refs/tags/v2.0.0-beta.1.tar.gz`)
	})
})
