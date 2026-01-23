import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

/** Type for parsed ocx config in tests */
interface TestOcxConfig {
	registries: Record<string, { url: string }>
	lockRegistries?: boolean
}

describe("ocx registry", () => {
	let testDir: string
	let registry: MockRegistry

	beforeEach(async () => {
		testDir = await createTempDir("registry-test")
		registry = startMockRegistry()
		await runCLI(["init", "--force"], testDir)
	})

	afterEach(async () => {
		registry.stop()
		await cleanupTempDir(testDir)
	})

	it("should add a registry", async () => {
		const { exitCode, output } = await runCLI(
			["registry", "add", registry.url, "--name", "test-reg"],
			testDir,
		)

		if (exitCode !== 0) {
			console.log(output)
		}
		expect(exitCode).toBe(0)
		expect(output).toContain("Added registry to local config: test-reg")

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const configContent = await Bun.file(configPath).text()
		const config = parseJsonc(configContent) as TestOcxConfig
		expect(config.registries["test-reg"]).toBeDefined()
		expect(config.registries["test-reg"].url).toBe(registry.url)
	})

	it("should list configured registries", async () => {
		await runCLI(["registry", "add", registry.url, "--name", "test-reg"], testDir)

		const { exitCode, output } = await runCLI(["registry", "list"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("test-reg")
		expect(output).toContain(registry.url)
	})

	it("should remove a registry", async () => {
		await runCLI(["registry", "add", registry.url, "--name", "test-reg"], testDir)

		const { exitCode, output } = await runCLI(["registry", "remove", "test-reg"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("Removed registry from local config: test-reg")

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const configContent = await Bun.file(configPath).text()
		const config = parseJsonc(configContent) as TestOcxConfig
		expect(config.registries["test-reg"]).toBeUndefined()
	})

	it("should fail if adding to locked registries", async () => {
		// Manually lock registries
		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const configContent = await Bun.file(configPath).text()
		const config = parseJsonc(configContent) as TestOcxConfig
		config.lockRegistries = true
		await Bun.write(configPath, JSON.stringify(config, null, 2))

		const { exitCode, output } = await runCLI(["registry", "add", "http://example.com"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("Registries are locked")
	})
})

describe("ocx registry --global", () => {
	let globalTestDir: string
	let globalConfigDir: string
	let testDir: string
	let registry: MockRegistry
	let env: Record<string, string>

	// Helper to read and parse config file
	async function readConfig(configPath: string): Promise<TestOcxConfig | null> {
		const file = Bun.file(configPath)
		if (!(await file.exists())) return null
		return parseJsonc(await file.text()) as TestOcxConfig
	}

	// Helper to check file doesn't exist
	async function assertFileNotExists(filePath: string): Promise<void> {
		const exists = await Bun.file(filePath).exists()
		expect(exists).toBe(false)
	}

	beforeEach(async () => {
		globalTestDir = await mkdtemp(join(tmpdir(), "registry-global-"))
		testDir = await createTempDir("registry-global-local")

		// Create global config directory and file
		globalConfigDir = join(globalTestDir, "opencode")
		await mkdir(globalConfigDir, { recursive: true })
		await Bun.write(join(globalConfigDir, "ocx.jsonc"), JSON.stringify({ registries: {} }, null, 2))

		registry = startMockRegistry()
		env = { XDG_CONFIG_HOME: globalTestDir }
	})

	afterEach(async () => {
		registry.stop()
		await rm(globalTestDir, { recursive: true, force: true })
		await cleanupTempDir(testDir)
	})

	// Core functionality tests
	it("should add a registry to global config", async () => {
		const result = await runCLI(
			["registry", "add", "--global", registry.url, "--name", "test-global"],
			testDir,
			{ env },
		)
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("Added registry to global config")

		// Verify correct data written to global config
		const globalConfig = await readConfig(join(globalConfigDir, "ocx.jsonc"))
		expect(globalConfig).not.toBeNull()
		expect(globalConfig!.registries["test-global"]).toEqual({ url: registry.url })

		// Verify local config was NOT created/modified
		await assertFileNotExists(join(testDir, ".opencode", "ocx.jsonc"))
	})

	it("should list registries from global config", async () => {
		// Setup: Create BOTH global and local configs with different registries
		await Bun.write(
			join(globalConfigDir, "ocx.jsonc"),
			JSON.stringify({ registries: { "global-only": { url: registry.url } } }, null, 2),
		)

		// Create a local config with a different registry
		const projectDir = join(testDir, "project")
		const localConfigDir = join(projectDir, ".opencode")
		await mkdir(localConfigDir, { recursive: true })
		await Bun.write(
			join(localConfigDir, "ocx.jsonc"),
			JSON.stringify({ registries: { "local-only": { url: "http://local.test" } } }, null, 2),
		)

		// Capture original file contents for side-effect check
		const originalGlobalConfig = await Bun.file(join(globalConfigDir, "ocx.jsonc")).text()
		const originalLocalConfig = await Bun.file(join(localConfigDir, "ocx.jsonc")).text()

		// Run from project directory but with --global
		const result = await runCLI(["registry", "list", "--global"], projectDir, { env })

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("(global)")
		expect(result.stdout).toContain("global-only")
		expect(result.stdout).toContain(registry.url) // Should show global URL
		expect(result.stdout).not.toContain("local-only") // Must NOT show local registry name
		expect(result.stdout).not.toContain("http://local.test") // Must NOT show local URL

		// Verify no side effects - configs unchanged
		expect(await Bun.file(join(globalConfigDir, "ocx.jsonc")).text()).toBe(originalGlobalConfig)
		expect(await Bun.file(join(localConfigDir, "ocx.jsonc")).text()).toBe(originalLocalConfig)
	})

	it("should remove a registry from global config", async () => {
		// First add a registry
		await runCLI(["registry", "add", "--global", registry.url, "--name", "test-remove"], testDir, {
			env,
		})

		// Verify it was added
		let globalConfig = await readConfig(join(globalConfigDir, "ocx.jsonc"))
		expect(globalConfig).not.toBeNull()
		expect(globalConfig!.registries["test-remove"]).toBeDefined()

		// Now remove it
		const result = await runCLI(["registry", "remove", "--global", "test-remove"], testDir, { env })
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("Removed registry from global config")

		// Verify it was ACTUALLY removed from file
		globalConfig = await readConfig(join(globalConfigDir, "ocx.jsonc"))
		expect(globalConfig).not.toBeNull()
		expect(globalConfig!.registries["test-remove"]).toBeUndefined()

		// Verify local config was NOT created as side effect
		await assertFileNotExists(join(testDir, ".opencode", "ocx.jsonc"))
		await assertFileNotExists(join(testDir, "ocx.jsonc"))
	})

	// Error handling tests
	it("should error when --global and --cwd are both provided", async () => {
		// Create a temp directory to use as --cwd target
		const cwdTarget = join(testDir, "cwd-target")
		await mkdir(cwdTarget, { recursive: true })

		// Capture original global config state
		const originalGlobalConfig = await Bun.file(join(globalConfigDir, "ocx.jsonc")).text()

		const result = await runCLI(
			["registry", "add", "--global", "--cwd", cwdTarget, registry.url],
			testDir,
			{ env },
		)
		expect(result.exitCode).not.toBe(0)
		expect(result.stderr).toContain("Cannot use --global and --cwd together")

		// Verify NO side effects - global config unchanged
		expect(await Bun.file(join(globalConfigDir, "ocx.jsonc")).text()).toBe(originalGlobalConfig)

		// Verify --cwd target was not modified (no .opencode or ocx.jsonc created)
		await assertFileNotExists(join(cwdTarget, ".opencode", "ocx.jsonc"))
		await assertFileNotExists(join(cwdTarget, "ocx.jsonc"))

		// Verify testDir local config was not created either
		await assertFileNotExists(join(testDir, ".opencode", "ocx.jsonc"))
	})

	it("should error when global config is missing (add)", async () => {
		// Remove global config
		await rm(join(globalConfigDir, "ocx.jsonc"))

		const result = await runCLI(["registry", "add", "--global", registry.url], testDir, { env })
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain("No ocx.jsonc found in target scope")

		// Verify global config was NOT created as side effect
		await assertFileNotExists(join(globalConfigDir, "ocx.jsonc"))

		// Verify local config was NOT created as fallback
		await assertFileNotExists(join(testDir, ".opencode", "ocx.jsonc"))
	})

	it("should warn when global config is missing (list)", async () => {
		// Remove global config
		await rm(join(globalConfigDir, "ocx.jsonc"))

		const result = await runCLI(["registry", "list", "--global"], testDir, { env })
		expect(result.exitCode).toBe(0) // Should NOT error, just warn
		expect(result.stderr).toContain("No ocx.jsonc found in target scope")

		// Verify global config was NOT created
		await assertFileNotExists(join(globalConfigDir, "ocx.jsonc"))

		// Verify local config was NOT created as side effect
		await assertFileNotExists(join(testDir, ".opencode", "ocx.jsonc"))
		await assertFileNotExists(join(testDir, "ocx.jsonc"))
	})

	// CLI ordering tests
	it("should work with --global before URL", async () => {
		const result = await runCLI(
			["registry", "add", "--global", registry.url, "--name", "order1"],
			testDir,
			{ env },
		)
		expect(result.exitCode).toBe(0)

		// Verify data was actually written
		const globalConfig = await readConfig(join(globalConfigDir, "ocx.jsonc"))
		expect(globalConfig).not.toBeNull()
		expect(globalConfig!.registries.order1).toEqual({ url: registry.url })

		// Verify local config was NOT created as side effect
		await assertFileNotExists(join(testDir, ".opencode", "ocx.jsonc"))
		await assertFileNotExists(join(testDir, "ocx.jsonc"))
	})

	it("should work with --global after URL", async () => {
		const result = await runCLI(
			["registry", "add", registry.url, "--global", "--name", "order2"],
			testDir,
			{ env },
		)
		expect(result.exitCode).toBe(0)

		// Verify data was actually written
		const globalConfig = await readConfig(join(globalConfigDir, "ocx.jsonc"))
		expect(globalConfig).not.toBeNull()
		expect(globalConfig!.registries.order2).toEqual({ url: registry.url })

		// Verify local config was NOT created as side effect
		await assertFileNotExists(join(testDir, ".opencode", "ocx.jsonc"))
		await assertFileNotExists(join(testDir, "ocx.jsonc"))
	})

	it("should work with --global at end", async () => {
		const result = await runCLI(
			["registry", "add", registry.url, "--name", "order3", "--global"],
			testDir,
			{ env },
		)
		expect(result.exitCode).toBe(0)

		// Verify data was actually written
		const globalConfig = await readConfig(join(globalConfigDir, "ocx.jsonc"))
		expect(globalConfig).not.toBeNull()
		expect(globalConfig!.registries.order3).toEqual({ url: registry.url })

		// Verify local config was NOT created as side effect
		await assertFileNotExists(join(testDir, ".opencode", "ocx.jsonc"))
		await assertFileNotExists(join(testDir, "ocx.jsonc"))
	})

	// Edge cases
	it("should handle locked registries in global config", async () => {
		// Write locked config
		const lockedConfig = { registries: {}, lockRegistries: true }
		await Bun.write(join(globalConfigDir, "ocx.jsonc"), JSON.stringify(lockedConfig, null, 2))

		// Capture original file content
		const originalGlobalConfig = await Bun.file(join(globalConfigDir, "ocx.jsonc")).text()

		const result = await runCLI(
			["registry", "add", "--global", registry.url, "--name", "blocked"],
			testDir,
			{ env },
		)
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain("locked")

		// Verify global config was COMPLETELY unchanged (not just registries empty)
		const afterGlobalConfig = await Bun.file(join(globalConfigDir, "ocx.jsonc")).text()
		expect(afterGlobalConfig).toBe(originalGlobalConfig)

		// Verify local config was NOT created as fallback
		await assertFileNotExists(join(testDir, ".opencode", "ocx.jsonc"))
		await assertFileNotExists(join(testDir, "ocx.jsonc"))
	})

	it("should auto-generate name from URL for global registry", async () => {
		const result = await runCLI(["registry", "add", "--global", registry.url], testDir, { env })
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("Added registry to global config")

		// Verify auto-generated name was written
		const globalConfig = await readConfig(join(globalConfigDir, "ocx.jsonc"))
		expect(globalConfig).not.toBeNull()
		const keys = Object.keys(globalConfig!.registries)
		expect(keys).toHaveLength(1)

		// Name should be derived from hostname (localhost or 127-0-0-1 depending on registry.url)
		const generatedName = keys[0]
		expect(generatedName).toMatch(/^(localhost|127-0-0-1)$/)
		expect(globalConfig!.registries[generatedName]).toEqual({ url: registry.url })

		// Verify local config was NOT created as side effect
		await assertFileNotExists(join(testDir, ".opencode", "ocx.jsonc"))
		await assertFileNotExists(join(testDir, "ocx.jsonc"))
	})
})

describe("ocx registry --profile", () => {
	let globalTestDir: string
	let globalConfigDir: string
	let profilesDir: string
	let testDir: string
	let registry: MockRegistry
	let env: Record<string, string>

	// Helper to read and parse config file
	async function readConfig(configPath: string): Promise<TestOcxConfig | null> {
		const file = Bun.file(configPath)
		if (!(await file.exists())) return null
		return parseJsonc(await file.text()) as TestOcxConfig
	}

	// Helper to check file doesn't exist
	async function assertFileNotExists(filePath: string): Promise<void> {
		const exists = await Bun.file(filePath).exists()
		expect(exists).toBe(false)
	}

	// Helper to check file content is unchanged
	async function assertFileUnchanged(filePath: string, originalContent: string): Promise<void> {
		const currentContent = await Bun.file(filePath).text()
		expect(currentContent).toBe(originalContent)
	}

	// Helper to create a profile with config
	async function createProfile(
		name: string,
		config: TestOcxConfig = { registries: {} },
	): Promise<string> {
		const profileDir = join(profilesDir, name)
		await mkdir(profileDir, { recursive: true })
		await Bun.write(join(profileDir, "ocx.jsonc"), JSON.stringify(config, null, 2))
		return profileDir
	}

	beforeEach(async () => {
		globalTestDir = await mkdtemp(join(tmpdir(), "registry-profile-"))
		testDir = await createTempDir("registry-profile-local")

		// Create global config directory structure
		globalConfigDir = join(globalTestDir, "opencode")
		profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })

		// Create global base config
		await Bun.write(join(globalConfigDir, "ocx.jsonc"), JSON.stringify({ registries: {} }, null, 2))

		registry = startMockRegistry()
		env = { XDG_CONFIG_HOME: globalTestDir }
	})

	afterEach(async () => {
		registry.stop()
		await rm(globalTestDir, { recursive: true, force: true })
		await cleanupTempDir(testDir)
	})

	it("should add a registry to profile config", async () => {
		// Setup: Create a profile directory
		const profileDir = await createProfile("work")
		const originalGlobalConfig = await Bun.file(join(globalConfigDir, "ocx.jsonc")).text()

		const result = await runCLI(
			["registry", "add", "--profile", "work", registry.url, "--name", "test-profile"],
			testDir,
			{ env },
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("Added registry to profile")

		// Verify registry written to profile config
		const profileConfig = await readConfig(join(profileDir, "ocx.jsonc"))
		expect(profileConfig).not.toBeNull()
		expect(profileConfig?.registries["test-profile"]).toEqual({ url: registry.url })

		// Verify global config UNTOUCHED
		await assertFileUnchanged(join(globalConfigDir, "ocx.jsonc"), originalGlobalConfig)

		// Verify local config NOT created
		await assertFileNotExists(join(testDir, ".opencode", "ocx.jsonc"))
	})

	it("should list registries from profile config", async () => {
		// Setup: Create profile with unique registry
		await createProfile("work", {
			registries: { "profile-only-reg": { url: "http://profile.test" } },
		})

		// Create local config with different registry
		const localConfigDir = join(testDir, ".opencode")
		await mkdir(localConfigDir, { recursive: true })
		await Bun.write(
			join(localConfigDir, "ocx.jsonc"),
			JSON.stringify({ registries: { "local-only": { url: "http://local.test" } } }, null, 2),
		)

		// Create global config with another registry
		await Bun.write(
			join(globalConfigDir, "ocx.jsonc"),
			JSON.stringify({ registries: { "global-only": { url: "http://global.test" } } }, null, 2),
		)

		const result = await runCLI(["registry", "list", "--profile", "work"], testDir, { env })

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("profile-only-reg")
		expect(result.stdout).toContain("http://profile.test")

		// Must NOT contain local or global registries (isolation)
		expect(result.stdout).not.toContain("local-only")
		expect(result.stdout).not.toContain("http://local.test")
		expect(result.stdout).not.toContain("global-only")
		expect(result.stdout).not.toContain("http://global.test")
	})

	it("should remove a registry from profile config", async () => {
		// Setup: Create profile with registry to remove
		const profileDir = await createProfile("work", {
			registries: { "test-reg": { url: "http://test.registry" } },
		})

		// Verify registry exists before removal
		let profileConfig = await readConfig(join(profileDir, "ocx.jsonc"))
		expect(profileConfig?.registries["test-reg"]).toBeDefined()

		const result = await runCLI(["registry", "remove", "--profile", "work", "test-reg"], testDir, {
			env,
		})

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("Removed registry from profile")

		// Verify registry removed from file
		profileConfig = await readConfig(join(profileDir, "ocx.jsonc"))
		expect(profileConfig?.registries["test-reg"]).toBeUndefined()
	})

	it("should error when --profile and --cwd are both provided", async () => {
		// Setup: Create profile
		await createProfile("work")

		// Create a cwd target directory
		const cwdTarget = join(testDir, "project")
		await mkdir(cwdTarget, { recursive: true })

		const result = await runCLI(
			["registry", "add", "--profile", "work", "--cwd", cwdTarget, registry.url],
			testDir,
			{ env },
		)

		// ConfigError uses EXIT_CODES.CONFIG (78)
		expect(result.exitCode).not.toBe(0)
		expect(result.stderr).toContain("Cannot use --profile")
		expect(result.stderr).toContain("--cwd")
	})

	it("should NOT error when --profile is used with default cwd", async () => {
		// Setup: Create profile
		await createProfile("work")

		// Run with --profile but NO --cwd (implicit cwd is OK)
		const result = await runCLI(["registry", "list", "--profile", "work"], testDir, { env })

		// Should succeed - proves isCwdExplicit logic works
		expect(result.exitCode).toBe(0)
	})

	it("should error on invalid profile name (path traversal)", async () => {
		const result = await runCLI(["registry", "add", "--profile", "../bad", registry.url], testDir, {
			env,
		})

		// ValidationError uses EXIT_CODES.GENERAL (1)
		expect(result.exitCode).not.toBe(0)
		// Should contain a validation error about the profile name
		expect(result.stderr).toMatch(/invalid.*profile/i)
	})
})
