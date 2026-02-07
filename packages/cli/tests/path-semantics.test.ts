import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { _clearFetcherCacheForTests } from "../src/registry/fetcher"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

describe("OCX path semantics contract", () => {
	let testDir: string
	let registry: MockRegistry

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	afterEach(async () => {
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	async function setupLocalProject(name: string): Promise<string> {
		const dir = await createTempDir(name)
		const initResult = await runCLI(["init"], dir)
		expect(initResult.exitCode).toBe(0)

		const configPath = join(dir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		return dir
	}

	it("local add installs component files under .opencode and not repo root", async () => {
		testDir = await setupLocalProject("path-semantics-local-add")

		const { exitCode } = await runCLI(["add", "kdco/test-agent"], testDir)
		expect(exitCode).toBe(0)

		expect(existsSync(join(testDir, ".opencode", "agents", "test-agent.md"))).toBe(true)
		expect(existsSync(join(testDir, ".opencode", "skills", "test-skill", "SKILL.md"))).toBe(true)
		expect(existsSync(join(testDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(true)

		expect(existsSync(join(testDir, "agents", "test-agent.md"))).toBe(false)
		expect(existsSync(join(testDir, "skills", "test-skill", "SKILL.md"))).toBe(false)
		expect(existsSync(join(testDir, "plugins", "test-plugin.ts"))).toBe(false)
	})

	it("local update writes updated files in .opencode path", async () => {
		testDir = await setupLocalProject("path-semantics-local-update")

		const addResult = await runCLI(["add", "kdco/test-plugin"], testDir)
		expect(addResult.exitCode).toBe(0)

		registry.setFileContent("test-plugin", "index.ts", "// updated in .opencode")
		_clearFetcherCacheForTests()

		const { exitCode } = await runCLI(["update", "kdco/test-plugin"], testDir)
		expect(exitCode).toBe(0)

		const localPluginPath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		expect(await readFile(localPluginPath, "utf-8")).toBe("// updated in .opencode")
		expect(existsSync(join(testDir, "plugins", "test-plugin.ts"))).toBe(false)
	})

	it("local remove deletes .opencode-tracked component files", async () => {
		testDir = await setupLocalProject("path-semantics-local-remove")

		const addResult = await runCLI(["add", "kdco/test-plugin"], testDir)
		expect(addResult.exitCode).toBe(0)

		expect(existsSync(join(testDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(true)
		expect(existsSync(join(testDir, "plugins", "test-plugin.ts"))).toBe(false)

		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			installed: Record<string, unknown>
		}
		const pluginKey = Object.keys(receipt.installed).find((key) => key.includes("test-plugin"))
		expect(pluginKey).toBeDefined()
		if (!pluginKey) throw new Error("Expected installed test-plugin entry")

		const { exitCode } = await runCLI(["remove", pluginKey], testDir)
		expect(exitCode).toBe(0)

		expect(existsSync(join(testDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(false)
		expect(existsSync(join(testDir, "plugins", "test-plugin.ts"))).toBe(false)
	})

	it("local verify treats .opencode component files as integrity source of truth", async () => {
		testDir = await setupLocalProject("path-semantics-local-verify")

		const addResult = await runCLI(["add", "kdco/test-plugin"], testDir)
		expect(addResult.exitCode).toBe(0)

		await mkdir(join(testDir, ".opencode", "plugins"), { recursive: true })
		await writeFile(
			join(testDir, ".opencode", "plugins", "test-plugin.ts"),
			"// local-only mutation",
		)

		const { exitCode, output } = await runCLI(["verify"], testDir)
		expect(exitCode).not.toBe(0)
		expect(output).toContain("integrity check failed")
	})

	it("profile mode remains flattened in profile scope", async () => {
		testDir = await createTempDir("path-semantics-profile")

		const profileDir = join(testDir, "opencode", "profiles", "path-contract")
		await mkdir(profileDir, { recursive: true })
		await writeFile(
			join(profileDir, "ocx.jsonc"),
			JSON.stringify(
				{
					registries: {
						kdco: { url: registry.url },
					},
				},
				null,
				2,
			),
		)

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		const { exitCode } = await runCLI(
			["add", "kdco/test-plugin", "--profile", "path-contract"],
			workDir,
			{
				env: { XDG_CONFIG_HOME: testDir },
			},
		)
		expect(exitCode).toBe(0)

		expect(existsSync(join(profileDir, "plugins", "test-plugin.ts"))).toBe(true)
		expect(existsSync(join(profileDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(false)

		expect(existsSync(join(workDir, "plugins", "test-plugin.ts"))).toBe(false)
		expect(existsSync(join(workDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(false)
	})

	it("global mode remains flattened in global scope", async () => {
		testDir = await createTempDir("path-semantics-global")

		const initResult = await runCLI(["init", "--global"], testDir, {
			env: { XDG_CONFIG_HOME: testDir },
		})
		expect(initResult.exitCode).toBe(0)

		const globalRoot = join(testDir, "opencode")
		const globalConfigPath = join(globalRoot, "ocx.jsonc")
		const globalConfig = parseJsonc(await readFile(globalConfigPath, "utf-8")) as Record<
			string,
			unknown
		>
		globalConfig.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(globalConfigPath, JSON.stringify(globalConfig, null, 2))

		const workDir = join(testDir, "workspace")
		await mkdir(workDir, { recursive: true })

		const { exitCode } = await runCLI(["add", "kdco/test-plugin", "--global"], workDir, {
			env: { XDG_CONFIG_HOME: testDir },
		})
		expect(exitCode).toBe(0)

		expect(existsSync(join(globalRoot, "plugins", "test-plugin.ts"))).toBe(true)
		expect(existsSync(join(globalRoot, ".opencode", "plugins", "test-plugin.ts"))).toBe(false)

		expect(existsSync(join(workDir, "plugins", "test-plugin.ts"))).toBe(false)
		expect(existsSync(join(workDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(false)
	})
})
