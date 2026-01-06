/**
 * Ghost Config Loader Tests
 *
 * Tests for the ghost mode configuration module:
 * - Path resolution (XDG-compliant)
 * - Config existence checks
 * - Loading and parsing config
 * - Saving config
 * - OpenCode config extraction
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { GhostConfigProvider } from "../../src/config/provider.js"
import {
	getGhostConfigDir,
	getGhostConfigPath,
	getGhostOpencodeConfigPath,
	ghostConfigExists,
	loadGhostConfig,
	loadGhostOpencodeConfig,
	saveGhostConfig,
} from "../../src/ghost/config.js"
import { GhostConfigError, GhostNotInitializedError } from "../../src/utils/errors.js"

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
// PATH RESOLUTION TESTS
// =============================================================================

describe("ghost config path resolution", () => {
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	afterEach(() => {
		// Restore original XDG_CONFIG_HOME
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
	})

	it("should return correct XDG path when XDG_CONFIG_HOME is not set", () => {
		delete process.env.XDG_CONFIG_HOME

		const configPath = getGhostConfigPath()
		const expectedPath = join(homedir(), ".config", "ocx", "ghost.jsonc")

		expect(configPath).toBe(expectedPath)
	})

	it("should use XDG_CONFIG_HOME when set", () => {
		const customConfigHome = "/custom/config/path"
		process.env.XDG_CONFIG_HOME = customConfigHome

		const configPath = getGhostConfigPath()
		const expectedPath = join(customConfigHome, "ocx", "ghost.jsonc")

		expect(configPath).toBe(expectedPath)
	})

	it("should return config dir matching XDG spec", () => {
		delete process.env.XDG_CONFIG_HOME

		const configDir = getGhostConfigDir()
		const expectedDir = join(homedir(), ".config", "ocx")

		expect(configDir).toBe(expectedDir)
	})

	it("should return config dir using XDG_CONFIG_HOME when set", () => {
		const customConfigHome = "/my/custom/config"
		process.env.XDG_CONFIG_HOME = customConfigHome

		const configDir = getGhostConfigDir()
		const expectedDir = join(customConfigHome, "ocx")

		expect(configDir).toBe(expectedDir)
	})
})

// =============================================================================
// CONFIG EXISTENCE TESTS
// =============================================================================

describe("ghostConfigExists", () => {
	let testDir: string
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeEach(async () => {
		testDir = await createTempConfigDir("ghost-exists")
		// Point XDG_CONFIG_HOME to test directory so config operations use temp location
		process.env.XDG_CONFIG_HOME = testDir
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

	it("should return false when no config file exists", async () => {
		const exists = await ghostConfigExists()

		expect(exists).toBe(false)
	})

	it("should return true when config file exists", async () => {
		// Create the config directory and file
		const configDir = getGhostConfigDir()
		await mkdir(configDir, { recursive: true })
		const configPath = getGhostConfigPath()
		await Bun.write(configPath, '{"registries": {}}')

		const exists = await ghostConfigExists()

		expect(exists).toBe(true)
	})
})

// =============================================================================
// LOAD CONFIG TESTS
// =============================================================================

describe("loadGhostConfig", () => {
	let testDir: string
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeEach(async () => {
		testDir = await createTempConfigDir("ghost-load")
		process.env.XDG_CONFIG_HOME = testDir
	})

	afterEach(async () => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		await cleanupTempDir(testDir)
	})

	it("should throw GhostNotInitializedError when config does not exist", async () => {
		expect(loadGhostConfig()).rejects.toThrow(GhostNotInitializedError)
	})

	it("should parse valid config correctly", async () => {
		const configDir = getGhostConfigDir()
		await mkdir(configDir, { recursive: true })
		const configPath = getGhostConfigPath()

		const validConfig = {
			registries: {
				default: { url: "https://registry.opencode.ai" },
				custom: { url: "https://example.com", version: "1.0.0" },
			},
			componentPath: "src/components",
		}
		await Bun.write(configPath, JSON.stringify(validConfig))

		const loaded = await loadGhostConfig()

		expect(loaded.registries.default.url).toBe("https://registry.opencode.ai")
		expect(loaded.registries.custom.url).toBe("https://example.com")
		expect(loaded.componentPath).toBe("src/components")
	})

	it("should parse JSONC config with comments", async () => {
		const configDir = getGhostConfigDir()
		await mkdir(configDir, { recursive: true })
		const configPath = getGhostConfigPath()

		const jsoncContent = `{
			// This is a comment
			"registries": {
				"default": {
					"url": "https://registry.opencode.ai"
				}
			}
			/* Multi-line
			   comment */
		}`
		await Bun.write(configPath, jsoncContent)

		const loaded = await loadGhostConfig()

		expect(loaded.registries.default.url).toBe("https://registry.opencode.ai")
	})

	it("should throw GhostConfigError for invalid config structure", async () => {
		const configDir = getGhostConfigDir()
		await mkdir(configDir, { recursive: true })
		const configPath = getGhostConfigPath()

		// Note: jsonc-parser is very lenient and doesn't throw on malformed JSON
		// It silently returns what it can parse. So we test schema validation instead.
		// Write an array instead of object (wrong root type)
		await Bun.write(configPath, "[1, 2, 3]")

		expect(loadGhostConfig()).rejects.toThrow(GhostConfigError)
	})

	it("should throw GhostConfigError for schema-invalid config", async () => {
		const configDir = getGhostConfigDir()
		await mkdir(configDir, { recursive: true })
		const configPath = getGhostConfigPath()

		// Missing required 'url' field in registry
		const invalidConfig = {
			registries: {
				broken: { notUrl: "missing url field" },
			},
		}
		await Bun.write(configPath, JSON.stringify(invalidConfig))

		expect(loadGhostConfig()).rejects.toThrow(GhostConfigError)
	})

	it("should apply defaults for missing optional fields", async () => {
		const configDir = getGhostConfigDir()
		await mkdir(configDir, { recursive: true })
		const configPath = getGhostConfigPath()

		// Minimal valid config
		await Bun.write(configPath, "{}")

		const loaded = await loadGhostConfig()

		expect(loaded.registries).toEqual({})
		expect(loaded.componentPath).toBeUndefined()
	})
})

// =============================================================================
// SAVE CONFIG TESTS
// =============================================================================

describe("saveGhostConfig", () => {
	let testDir: string
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeEach(async () => {
		testDir = await createTempConfigDir("ghost-save")
		process.env.XDG_CONFIG_HOME = testDir
	})

	afterEach(async () => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		await cleanupTempDir(testDir)
	})

	it("should write config correctly", async () => {
		const config = {
			registries: {
				myRegistry: { url: "https://my.registry.com" },
			},
			componentPath: "lib/components",
		}

		await saveGhostConfig(config)

		const configPath = getGhostConfigPath()
		const content = await Bun.file(configPath).text()
		const parsed = JSON.parse(content)

		expect(parsed.registries.myRegistry.url).toBe("https://my.registry.com")
		expect(parsed.componentPath).toBe("lib/components")
	})

	it("should create config directory if it does not exist", async () => {
		const config = {
			registries: {},
		}

		await saveGhostConfig(config)

		const configPath = getGhostConfigPath()
		const file = Bun.file(configPath)
		const exists = await file.exists()

		expect(exists).toBe(true)
	})

	it("should overwrite existing config", async () => {
		// Write initial config
		const configDir = getGhostConfigDir()
		await mkdir(configDir, { recursive: true })
		const configPath = getGhostConfigPath()
		await Bun.write(configPath, '{"registries": {"old": {"url": "https://old.com"}}}')

		// Save new config
		const newConfig = {
			registries: {
				new: { url: "https://new.com" },
			},
		}
		await saveGhostConfig(newConfig)

		// Verify new content
		const content = await Bun.file(configPath).text()
		const parsed = JSON.parse(content)

		expect(parsed.registries.old).toBeUndefined()
		expect(parsed.registries.new.url).toBe("https://new.com")
	})

	it("should throw GhostConfigError for invalid config", async () => {
		const invalidConfig = {
			registries: {
				broken: { notUrl: "this should fail" },
			},
		}

		// Cast to any to bypass TypeScript since we're testing runtime validation
		expect(saveGhostConfig(invalidConfig as never)).rejects.toThrow(GhostConfigError)
	})
})

// =============================================================================
// OPENCODE CONFIG EXTRACTION TESTS
// =============================================================================

describe("loadGhostOpencodeConfig", () => {
	let testDir: string
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeEach(async () => {
		testDir = await createTempConfigDir("ghost-opencode-config")
		process.env.XDG_CONFIG_HOME = testDir
	})

	afterEach(async () => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		await cleanupTempDir(testDir)
	})

	it("should return empty object when opencode.jsonc doesn't exist", async () => {
		const configDir = getGhostConfigDir()
		await mkdir(configDir, { recursive: true })

		const config = await loadGhostOpencodeConfig()

		expect(config).toEqual({})
	})

	it("should load opencode.jsonc correctly", async () => {
		const configDir = getGhostConfigDir()
		await mkdir(configDir, { recursive: true })
		const opencodeConfigPath = getGhostOpencodeConfigPath()

		const opencodeConfig = {
			model: "anthropic/claude-sonnet-4-20250514",
			theme: "dark",
			customSetting: "value",
		}
		await Bun.write(opencodeConfigPath, JSON.stringify(opencodeConfig))

		const loaded = await loadGhostOpencodeConfig()

		expect(loaded.model).toBe("anthropic/claude-sonnet-4-20250514")
		expect(loaded.theme).toBe("dark")
		expect(loaded.customSetting).toBe("value")
	})

	it("should parse JSONC with comments", async () => {
		const configDir = getGhostConfigDir()
		await mkdir(configDir, { recursive: true })
		const opencodeConfigPath = getGhostOpencodeConfigPath()

		const jsoncContent = `{
			// This is a comment
			"model": "test-model",
			/* Multi-line comment */
			"theme": "light"
		}`
		await Bun.write(opencodeConfigPath, jsoncContent)

		const loaded = await loadGhostOpencodeConfig()

		expect(loaded.model).toBe("test-model")
		expect(loaded.theme).toBe("light")
	})

	it("should return correct path for opencode.jsonc", () => {
		const configDir = getGhostConfigDir()
		const opencodeConfigPath = getGhostOpencodeConfigPath()

		expect(opencodeConfigPath).toBe(join(configDir, "opencode.jsonc"))
	})
})

// =============================================================================
// GHOST CONFIG PROVIDER TESTS
// =============================================================================

describe("GhostConfigProvider", () => {
	let testDir: string
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

	beforeEach(async () => {
		testDir = await createTempConfigDir("ghost-provider")
		process.env.XDG_CONFIG_HOME = testDir
	})

	afterEach(async () => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
		await cleanupTempDir(testDir)
	})

	it("should use ghost config directory as cwd, not passed cwd", async () => {
		// Create a valid ghost config
		const configDir = getGhostConfigDir()
		await mkdir(configDir, { recursive: true })
		const configPath = getGhostConfigPath()
		await Bun.write(
			configPath,
			JSON.stringify({
				registries: { default: { url: "https://registry.opencode.ai" } },
			}),
		)

		// Create provider with a different cwd - should be ignored
		const differentCwd = "/some/other/directory"
		const provider = await GhostConfigProvider.create(differentCwd)

		// The provider's cwd should be the ghost config directory, NOT the passed cwd
		expect(provider.cwd).toBe(configDir)
		expect(provider.cwd).not.toBe(differentCwd)
	})

	it("should return correct registries from ghost config", async () => {
		const configDir = getGhostConfigDir()
		await mkdir(configDir, { recursive: true })
		const configPath = getGhostConfigPath()
		await Bun.write(
			configPath,
			JSON.stringify({
				registries: {
					default: { url: "https://registry.opencode.ai" },
					custom: { url: "https://custom.registry.com" },
				},
			}),
		)

		const provider = await GhostConfigProvider.create("/any/path")

		const registries = provider.getRegistries()
		expect(registries.default.url).toBe("https://registry.opencode.ai")
		expect(registries.custom.url).toBe("https://custom.registry.com")
	})
})
