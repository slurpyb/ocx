import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parseFromOption } from "../src/commands/profile/add"
import { validateSafePath } from "../src/schemas/registry"
import { ValidationError } from "../src/utils/errors"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

// =============================================================================
// UNIT TESTS: parseFromOption()
// =============================================================================

describe("parseFromOption()", () => {
	it("parses registry reference (namespace/component)", () => {
		const result = parseFromOption("kdco/minimal")
		expect(result).toEqual({ type: "registry", namespace: "kdco", component: "minimal" })
	})

	it("parses local profile name (no slash)", () => {
		const result = parseFromOption("my-profile")
		expect(result).toEqual({ type: "local-profile", name: "my-profile" })
	})

	it("handles multiple slashes as local profile name", () => {
		// More than one slash is not a registry ref (which requires exactly one)
		// Multiple slashes are treated as a profile name, not a registry ref
		const result = parseFromOption("namespace/component/extra")
		expect(result.type).toBe("local-profile")
		if (result.type === "local-profile") {
			expect(result.name).toBe("namespace/component/extra")
		}
	})

	it("throws on empty input", () => {
		expect(() => parseFromOption("")).toThrow(ValidationError)
	})

	it("throws on whitespace-only input", () => {
		expect(() => parseFromOption("   ")).toThrow(ValidationError)
	})

	it("throws on invalid registry reference format", () => {
		// Empty component part
		expect(() => parseFromOption("kdco/")).toThrow(ValidationError)
	})

	it("trims whitespace from input", () => {
		const result = parseFromOption("  kdco/minimal  ")
		expect(result).toEqual({ type: "registry", namespace: "kdco", component: "minimal" })
	})

	it("trims whitespace around slash in registry reference", () => {
		const result = parseFromOption("kdco / minimal")
		expect(result).toEqual({ type: "registry", namespace: "kdco", component: "minimal" })
	})
})

// =============================================================================
// UNIT TESTS: Path Security (validateSafePath)
// =============================================================================

describe("Path security", () => {
	describe("validateSafePath()", () => {
		it("accepts normal relative paths", () => {
			expect(() => validateSafePath("ocx.jsonc")).not.toThrow()
			expect(() => validateSafePath("opencode.jsonc")).not.toThrow()
			expect(() => validateSafePath("plugin/foo.ts")).not.toThrow()
		})

		it("rejects path traversal with ../", () => {
			expect(() => validateSafePath("../etc/passwd")).toThrow(ValidationError)
			// Note: foo/../bar normalizes to "bar" which is safe (no traversal escape)
		})

		it("rejects path traversal that escapes the directory", () => {
			expect(() => validateSafePath("foo/../../bar")).toThrow(ValidationError)
			expect(() => validateSafePath("foo/bar/../../../baz")).toThrow(ValidationError)
		})

		it("rejects absolute paths starting with /", () => {
			expect(() => validateSafePath("/etc/passwd")).toThrow(ValidationError)
		})

		it("rejects home directory paths starting with ~", () => {
			expect(() => validateSafePath("~/.ssh/id_rsa")).toThrow(ValidationError)
		})

		it("accepts paths that normalize to safe values", () => {
			// foo/../bar normalizes to "bar" which is safe (no escape)
			expect(() => validateSafePath("foo/../bar")).not.toThrow()
			// ./foo/bar normalizes to "foo/bar" which is safe
			expect(() => validateSafePath("./foo/bar")).not.toThrow()
		})
	})
})

// =============================================================================
// INTEGRATION TESTS: Global Registry Requirement
// =============================================================================

describe("ocx profile add --from (global registry requirement)", () => {
	let testDir: string
	let registry: MockRegistry
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	beforeEach(async () => {
		testDir = await createTempDir("profile-registry")
		process.env.XDG_CONFIG_HOME = testDir
	})

	afterEach(async () => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("fails with ConfigError when registry is not configured globally", async () => {
		// Create global config directory but without registry configured
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })

		// Create global ocx.jsonc without the registry
		await writeFile(join(globalConfigDir, "ocx.jsonc"), JSON.stringify({ registries: {} }, null, 2))

		// Create a dummy default profile to satisfy initialization
		await mkdir(join(profilesDir, "default"), { recursive: true })
		await writeFile(join(profilesDir, "default", "ocx.jsonc"), "{}")

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		const { exitCode, output } = await runCLI(
			["profile", "add", "test-profile", "--from", "kdco/minimal"],
			workDir,
		)

		expect(exitCode).not.toBe(0)
		// Verify error message contains key information for user action
		expect(output).toContain("not configured globally")
		expect(output).toContain("ocx registry add")
	})

	it("fails when registry is only configured locally (not globally)", async () => {
		// Create global config without registry
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })
		await writeFile(join(globalConfigDir, "ocx.jsonc"), JSON.stringify({ registries: {} }, null, 2))

		// Create default profile
		await mkdir(join(profilesDir, "default"), { recursive: true })
		await writeFile(join(profilesDir, "default", "ocx.jsonc"), "{}")

		// Create local project with registry configured locally
		const workDir = join(testDir, "workspace")
		const localConfigDir = join(workDir, ".opencode")
		await mkdir(localConfigDir, { recursive: true })

		// Local config has the registry, but global does not
		await writeFile(
			join(localConfigDir, "ocx.jsonc"),
			JSON.stringify({ registries: { kdco: { url: registry.url } } }, null, 2),
		)

		const { exitCode, output } = await runCLI(
			["profile", "add", "test-profile", "--from", "kdco/minimal"],
			workDir,
		)

		expect(exitCode).not.toBe(0)
		// Should fail because registry must be configured globally for profile installation
		expect(output).toContain("not configured globally")
	})
})

// =============================================================================
// INTEGRATION TESTS: Conflict Detection
// =============================================================================

describe("ocx profile add (conflict detection)", () => {
	let testDir: string
	let registry: MockRegistry
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	beforeEach(async () => {
		testDir = await createTempDir("profile-conflict")
		process.env.XDG_CONFIG_HOME = testDir
	})

	afterEach(async () => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("creates profile successfully when it does not exist", async () => {
		// Setup global config
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })
		await writeFile(
			join(globalConfigDir, "ocx.jsonc"),
			JSON.stringify({ registries: { kdco: { url: registry.url } } }, null, 2),
		)

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		// V2: Create global profile with --global flag
		const { exitCode } = await runCLI(["profile", "add", "new-profile", "--global"], workDir, {
			env: { XDG_CONFIG_HOME: testDir },
			isolated: true,
		})

		expect(exitCode).toBe(0)
		expect(existsSync(join(profilesDir, "new-profile"))).toBe(true)
	})

	it("fails when profile exists without --force (with actionable error)", async () => {
		// Setup global config
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })
		await writeFile(
			join(globalConfigDir, "ocx.jsonc"),
			JSON.stringify({ registries: { kdco: { url: registry.url } } }, null, 2),
		)

		// Create default profile
		await mkdir(join(profilesDir, "default"), { recursive: true })
		await writeFile(join(profilesDir, "default", "ocx.jsonc"), "{}")

		// Create existing profile manually
		await mkdir(join(profilesDir, "existing-profile"), { recursive: true })
		await writeFile(
			join(profilesDir, "existing-profile", "ocx.jsonc"),
			JSON.stringify({ some: "config" }, null, 2),
		)

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		const { exitCode, output } = await runCLI(
			["profile", "add", "existing-profile", "--global"],
			workDir,
		)

		expect(exitCode).toBe(6)
		// Verify error message contains key information for user action
		expect(output).toContain("already exists")
		expect(output).toContain("ocx profile rm existing-profile")
	})

	it("allows adding profile after explicit removal", async () => {
		// Setup global config
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })
		await writeFile(
			join(globalConfigDir, "ocx.jsonc"),
			JSON.stringify({ registries: { kdco: { url: registry.url } } }, null, 2),
		)

		// Create default profile
		await mkdir(join(profilesDir, "default"), { recursive: true })
		await writeFile(join(profilesDir, "default", "ocx.jsonc"), "{}")

		// Create existing profile manually
		await mkdir(join(profilesDir, "existing-profile"), { recursive: true })
		await writeFile(
			join(profilesDir, "existing-profile", "ocx.jsonc"),
			JSON.stringify({ some: "config" }, null, 2),
		)

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		const env = { XDG_CONFIG_HOME: testDir }

		// Remove the profile
		const { exitCode: rmExitCode } = await runCLI(
			["profile", "rm", "existing-profile", "--global"],
			workDir,
			{
				env,
				isolated: true,
			},
		)
		expect(rmExitCode).toBe(0)

		// Then add the profile fresh (V2: with --global flag)
		const { exitCode } = await runCLI(["profile", "add", "existing-profile", "--global"], workDir, {
			env,
			isolated: true,
		})

		expect(exitCode).toBe(0)

		// Verify the profile was recreated
		const profileDir = join(profilesDir, "existing-profile")
		const newContent = await readFile(join(profileDir, "ocx.jsonc"), "utf-8")
		expect(newContent).not.toContain("content-that-will-be-overwritten")
	})
})

// =============================================================================
// INTEGRATION TESTS: Profile Type Validation
// =============================================================================

describe("ocx profile add --from (type validation)", () => {
	let testDir: string
	let registry: MockRegistry
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	beforeEach(async () => {
		testDir = await createTempDir("profile-type")
		process.env.XDG_CONFIG_HOME = testDir
	})

	afterEach(async () => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("fails when component type is not ocx:profile", async () => {
		// Setup global config with registry
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })
		await writeFile(
			join(globalConfigDir, "ocx.jsonc"),
			JSON.stringify({ registries: { kdco: { url: registry.url } } }, null, 2),
		)

		// Create default profile
		await mkdir(join(profilesDir, "default"), { recursive: true })
		await writeFile(join(profilesDir, "default", "ocx.jsonc"), "{}")

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		// Try to install test-agent (which is type agent, not profile)
		const { exitCode, output } = await runCLI(
			["profile", "add", "agent-as-profile", "--from", "kdco/test-agent", "--global"],
			workDir,
			{
				env: { XDG_CONFIG_HOME: testDir },
				isolated: true,
			},
		)

		expect(exitCode).not.toBe(0)
		// V2: Error message uses type without ocx: prefix
		expect(output).toContain("agent")
		expect(output).toContain("profile")
	})

	it("fails when trying to install a plugin as a profile", async () => {
		// Setup global config with registry
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })
		await writeFile(
			join(globalConfigDir, "ocx.jsonc"),
			JSON.stringify({ registries: { kdco: { url: registry.url } } }, null, 2),
		)

		// Create default profile
		await mkdir(join(profilesDir, "default"), { recursive: true })
		await writeFile(join(profilesDir, "default", "ocx.jsonc"), "{}")

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		// Try to install test-plugin (which is type plugin, not profile)
		const { exitCode, output } = await runCLI(
			["profile", "add", "plugin-as-profile", "--from", "kdco/test-plugin", "--global"],
			workDir,
			{
				env: { XDG_CONFIG_HOME: testDir },
				isolated: true,
			},
		)

		expect(exitCode).not.toBe(0)
		// V2: Error message uses type without ocx: prefix
		expect(output).toContain("plugin")
		expect(output).toContain("profile")
	})
})

// =============================================================================
// INTEGRATION TESTS: Profile Cloning from Local Profile
// =============================================================================

describe("ocx profile add --from (local profile cloning)", () => {
	let testDir: string
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeEach(async () => {
		testDir = await createTempDir("profile-clone")
		process.env.XDG_CONFIG_HOME = testDir
	})

	afterEach(async () => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("clones settings from existing global profile (global to global)", async () => {
		// Setup global config
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })
		await writeFile(join(globalConfigDir, "ocx.jsonc"), JSON.stringify({ registries: {} }, null, 2))

		// Create source profile with specific config
		const sourceProfileDir = join(profilesDir, "source-profile")
		await mkdir(sourceProfileDir, { recursive: true })
		const sourceConfig = {
			registries: {
				custom: { url: "https://custom.registry.com" },
			},
			exclude: ["**/SECRET.md"],
		}
		await writeFile(join(sourceProfileDir, "ocx.jsonc"), JSON.stringify(sourceConfig, null, 2))

		// Create default profile
		await mkdir(join(profilesDir, "default"), { recursive: true })
		await writeFile(join(profilesDir, "default", "ocx.jsonc"), "{}")

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		// Clone from source-profile (V2: with --global flag)
		const { exitCode, output } = await runCLI(
			["profile", "add", "cloned-profile", "--from", "source-profile", "--global"],
			workDir,
			{
				env: { XDG_CONFIG_HOME: testDir },
				isolated: true,
			},
		)

		expect(exitCode).toBe(0)
		expect(output).toContain("cloned from")

		// Verify cloned profile has source's config
		const clonedConfig = parseJsonc(
			await readFile(join(profilesDir, "cloned-profile", "ocx.jsonc"), "utf-8"),
		) as typeof sourceConfig

		expect(clonedConfig.registries?.custom?.url).toBe("https://custom.registry.com")
		expect(clonedConfig.exclude).toContain("**/SECRET.md")
	})

	it("clones settings from existing local profile (local to local)", async () => {
		// Setup global config
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })
		await writeFile(join(globalConfigDir, "ocx.jsonc"), JSON.stringify({ registries: {} }, null, 2))

		// Create default profile
		await mkdir(join(profilesDir, "default"), { recursive: true })
		await writeFile(join(profilesDir, "default", "ocx.jsonc"), "{}")

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		// Create local source profile with specific config
		const localProfilesDir = join(workDir, ".opencode", "profiles")
		const sourceProfileDir = join(localProfilesDir, "local-source")
		await mkdir(sourceProfileDir, { recursive: true })
		const sourceConfig = {
			registries: {
				local: { url: "https://local.registry.com" },
			},
			exclude: ["**/LOCAL.md"],
		}
		await writeFile(join(sourceProfileDir, "ocx.jsonc"), JSON.stringify(sourceConfig, null, 2))

		// Clone from source-profile (local to local, no --global flag)
		const { exitCode, output } = await runCLI(
			["profile", "add", "local-cloned", "--from", "local-source"],
			workDir,
			{
				env: { XDG_CONFIG_HOME: testDir },
				isolated: true,
			},
		)

		expect(exitCode).toBe(0)
		expect(output).toContain("cloned from")
		expect(output).toContain("local profile")

		// Verify cloned profile has source's config
		const clonedConfig = parseJsonc(
			await readFile(join(localProfilesDir, "local-cloned", "ocx.jsonc"), "utf-8"),
		) as typeof sourceConfig

		expect(clonedConfig.registries?.local?.url).toBe("https://local.registry.com")
		expect(clonedConfig.exclude).toContain("**/LOCAL.md")
	})

	it("fails when source profile exists only in wrong scope", async () => {
		// Setup global config
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })
		await writeFile(join(globalConfigDir, "ocx.jsonc"), JSON.stringify({ registries: {} }, null, 2))

		// Create default profile
		await mkdir(join(profilesDir, "default"), { recursive: true })
		await writeFile(join(profilesDir, "default", "ocx.jsonc"), "{}")

		// Create GLOBAL source profile
		const sourceProfileDir = join(profilesDir, "global-only-profile")
		await mkdir(sourceProfileDir, { recursive: true })
		await writeFile(join(sourceProfileDir, "ocx.jsonc"), "{}")

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		// Try to clone from global profile to LOCAL (should fail - wrong scope)
		const { exitCode, output } = await runCLI(
			["profile", "add", "wrong-scope-clone", "--from", "global-only-profile"],
			workDir,
			{
				env: { XDG_CONFIG_HOME: testDir },
				isolated: true,
			},
		)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("not found")
		expect(output).toContain("local scope")
	})

	it("fails when source profile does not exist", async () => {
		// Setup global config
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })
		await writeFile(join(globalConfigDir, "ocx.jsonc"), JSON.stringify({ registries: {} }, null, 2))

		// Create default profile
		await mkdir(join(profilesDir, "default"), { recursive: true })
		await writeFile(join(profilesDir, "default", "ocx.jsonc"), "{}")

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		// Try to clone from non-existent profile (V2: with --global flag)
		const { exitCode, output } = await runCLI(
			["profile", "add", "cloned-from-nothing", "--from", "nonexistent-profile", "--global"],
			workDir,
			{
				env: { XDG_CONFIG_HOME: testDir },
				isolated: true,
			},
		)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("not found")
	})
})

// =============================================================================
// INTEGRATION TESTS: Registry Profile Installation (Happy Path)
// =============================================================================

describe("ocx profile add --from (registry installation)", () => {
	let testDir: string
	let registry: MockRegistry
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	beforeEach(async () => {
		testDir = await createTempDir("profile-registry-install")
		process.env.XDG_CONFIG_HOME = testDir
	})

	afterEach(async () => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("installs profile from registry with all files and lockfile", async () => {
		// Setup global config with registry configured
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })
		await writeFile(
			join(globalConfigDir, "ocx.jsonc"),
			JSON.stringify({ registries: { kdco: { url: registry.url } } }, null, 2),
		)

		// Create default profile (required for initialization)
		await mkdir(join(profilesDir, "default"), { recursive: true })
		await writeFile(join(profilesDir, "default", "ocx.jsonc"), "{}")

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		// Install profile from registry
		const { exitCode, output } = await runCLI(
			["profile", "add", "work", "--from", "kdco/test-profile"],
			workDir,
		)

		if (exitCode !== 0) {
			console.log("Output:", output)
		}
		expect(exitCode).toBe(0)

		// Verify profile files created
		const profileDir = join(profilesDir, "work")
		expect(existsSync(join(profileDir, "ocx.jsonc"))).toBe(true)
		expect(existsSync(join(profileDir, "opencode.jsonc"))).toBe(true)
		expect(existsSync(join(profileDir, "AGENTS.md"))).toBe(true)

		// Verify lockfile created
		expect(existsSync(join(profileDir, "ocx.lock"))).toBe(true)
		const lockContent = parseJsonc(await readFile(join(profileDir, "ocx.lock"), "utf-8")) as {
			installedFrom: { registry: string; component: string }
		}
		expect(lockContent.installedFrom.registry).toBe("kdco")
		expect(lockContent.installedFrom.component).toBe("test-profile")
	})

	it("should install profile dependencies flat (not in .opencode/)", async () => {
		// Setup global config with registry configured
		const globalConfigDir = join(testDir, "opencode")
		const profilesDir = join(globalConfigDir, "profiles")
		await mkdir(profilesDir, { recursive: true })
		await writeFile(
			join(globalConfigDir, "ocx.jsonc"),
			JSON.stringify({ registries: { kdco: { url: registry.url } } }, null, 2),
		)

		// Create default profile (required for initialization)
		await mkdir(join(profilesDir, "default"), { recursive: true })
		await writeFile(join(profilesDir, "default", "ocx.jsonc"), "{}")

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		// Install profile with dependencies from registry (V2: with --global flag)
		const { exitCode, output } = await runCLI(
			["profile", "add", "test-with-deps", "--from", "kdco/test-profile-with-deps", "--global"],
			workDir,
			{
				env: { XDG_CONFIG_HOME: testDir },
				isolated: true,
			},
		)

		if (exitCode !== 0) {
			console.log("Output:", output)
		}
		expect(exitCode).toBe(0)

		const profileDir = join(profilesDir, "test-with-deps")

		// Verify profile files exist at root
		expect(existsSync(join(profileDir, "ocx.jsonc"))).toBe(true)
		expect(existsSync(join(profileDir, "opencode.jsonc"))).toBe(true)
		expect(existsSync(join(profileDir, "AGENTS.md"))).toBe(true)

		// V2: Verify dependency files are FLAT at root with root-relative paths
		expect(existsSync(join(profileDir, "plugins", "test-plugin.ts"))).toBe(true)

		// Verify NO .opencode/ directory exists - this is the key regression check
		expect(existsSync(join(profileDir, ".opencode"))).toBe(false)

		// V2: Verify receipt file instead of ocx.lock
		const receiptPath = join(profileDir, ".ocx", "receipt.jsonc")
		expect(existsSync(receiptPath)).toBe(true)
		const receiptContent = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			version: number
			installed: Record<string, unknown>
		}
		// V2: Receipt doesn't have installedFrom field - that's stored in ocx.jsonc metadata
		expect(receiptContent.version).toBe(2)
		expect(Object.keys(receiptContent.installed).length).toBeGreaterThan(0)
	})
})

// =============================================================================
// INTEGRATION TESTS: Global Config Edge Cases
// =============================================================================

describe("ocx profile add (global config edge cases)", () => {
	let testDir: string
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeEach(async () => {
		testDir = await createTempDir("profile-global-config")
		process.env.XDG_CONFIG_HOME = testDir
	})

	afterEach(async () => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("handles missing global config directory gracefully", async () => {
		// Don't create any global config - XDG_CONFIG_HOME points to empty temp dir
		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		// Try to add a profile - should fail gracefully with clear error
		const { exitCode, output } = await runCLI(["profile", "add", "new-profile"], workDir)

		// Should fail but with a clear, actionable error message
		expect(exitCode).not.toBe(0)
		// Error should indicate profiles need to be initialized
		expect(
			output.includes("not initialized") ||
				output.includes("Run 'ocx init") ||
				output.includes("profiles"),
		).toBe(true)
	})
})
