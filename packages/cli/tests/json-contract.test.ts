import { afterAll, afterEach, beforeAll, describe, it } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	type CLIResult,
	cleanupTempDir,
	createTempDir,
	expectStrictJsonFailure,
	expectStrictJsonSuccess,
	parseJsonc,
	runCLIIsolated,
} from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

describe("strict JSON contract (RED)", () => {
	let registry: MockRegistry
	const tempDirs: string[] = []

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	afterEach(async () => {
		for (const dir of tempDirs) {
			await cleanupTempDir(dir)
		}
		tempDirs.length = 0
	})

	async function createTrackedTempDir(name: string): Promise<string> {
		const dir = await createTempDir(name)
		tempDirs.push(dir)
		return dir
	}

	function expectSetupSuccess(result: CLIResult, context: string): void {
		if (result.exitCode === 0) {
			return
		}

		throw new Error(
			`Setup failed: ${context}\nexitCode=${result.exitCode}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n--------------`,
		)
	}

	function createGlobalProfileEnv(dir: string): Record<string, string> {
		return {
			XDG_CONFIG_HOME: join(dir, "xdg-config"),
			OCX_SELF_UPDATE: "off",
		}
	}

	function createLocalProjectEnv(dir: string): Record<string, string> {
		return {
			XDG_CONFIG_HOME: join(dir, "xdg-config"),
			OCX_SELF_UPDATE: "off",
		}
	}

	async function setupInitializedProject(name: string): Promise<string> {
		const dir = await createTrackedTempDir(name)
		const initResult = await runCLIIsolated(["init"], dir, createLocalProjectEnv(dir))
		expectSetupSuccess(initResult, `init (${name})`)

		const configPath = join(dir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		return dir
	}

	async function installTestPluginAndGetCanonicalId(dir: string): Promise<string> {
		const addResult = await runCLIIsolated(
			["add", "kdco/test-plugin"],
			dir,
			createLocalProjectEnv(dir),
		)
		expectSetupSuccess(addResult, "add kdco/test-plugin")

		const receiptPath = join(dir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			installed: Record<string, unknown>
		}

		const canonicalId = Object.keys(receipt.installed)[0]
		if (!canonicalId) {
			throw new Error("Expected one installed component in receipt")
		}

		return canonicalId
	}

	it("reproducer: add kdco/researcher --json must print only strict JSON", async () => {
		const dir = await setupInitializedProject("json-repro-researcher")
		const result = await runCLIIsolated(
			["add", "kdco/researcher", "--json"],
			dir,
			createLocalProjectEnv(dir),
		)

		expectStrictJsonSuccess(result)
	})

	it("matrix slice: add --json success must satisfy strict contract", async () => {
		const dir = await setupInitializedProject("json-matrix-add")
		const result = await runCLIIsolated(
			["add", "kdco/test-plugin", "--json"],
			dir,
			createLocalProjectEnv(dir),
		)

		expectStrictJsonSuccess(result)
	})

	it("matrix slice: update --json success must satisfy strict contract", async () => {
		const dir = await setupInitializedProject("json-matrix-update")
		await installTestPluginAndGetCanonicalId(dir)

		const result = await runCLIIsolated(
			["update", "kdco/test-plugin", "--json"],
			dir,
			createLocalProjectEnv(dir),
		)
		expectStrictJsonSuccess(result)
	})

	it("matrix slice: remove --json success must satisfy strict contract", async () => {
		const dir = await setupInitializedProject("json-matrix-remove")
		const canonicalId = await installTestPluginAndGetCanonicalId(dir)

		const result = await runCLIIsolated(
			["remove", canonicalId, "--json"],
			dir,
			createLocalProjectEnv(dir),
		)
		expectStrictJsonSuccess(result)
	})

	it("matrix slice: verify --json success must satisfy strict contract", async () => {
		const dir = await setupInitializedProject("json-matrix-verify")
		await installTestPluginAndGetCanonicalId(dir)

		const result = await runCLIIsolated(["verify", "--json"], dir, createLocalProjectEnv(dir))
		expectStrictJsonSuccess(result)
	})

	it("matrix slice: registry list --json success must satisfy strict contract", async () => {
		const dir = await setupInitializedProject("json-matrix-registry-list")
		const result = await runCLIIsolated(
			["registry", "list", "--json"],
			dir,
			createLocalProjectEnv(dir),
		)

		expectStrictJsonSuccess(result)
	})

	it("missing support: profile add --json should satisfy strict success contract", async () => {
		const dir = await createTrackedTempDir("json-profile-add")
		const env = createGlobalProfileEnv(dir)
		const initResult = await runCLIIsolated(["init", "--global"], dir, env)
		expectSetupSuccess(initResult, "init --global for profile add")

		const result = await runCLIIsolated(
			["profile", "add", "json-new", "--global", "--json"],
			dir,
			env,
		)
		expectStrictJsonSuccess(result)
	})

	it("missing support: profile remove --json should satisfy strict success contract", async () => {
		const dir = await createTrackedTempDir("json-profile-remove")
		const env = createGlobalProfileEnv(dir)
		const initResult = await runCLIIsolated(["init", "--global"], dir, env)
		expectSetupSuccess(initResult, "init --global for profile remove")

		const profileAddResult = await runCLIIsolated(
			["profile", "add", "json-remove", "--global"],
			dir,
			env,
		)
		expectSetupSuccess(profileAddResult, "profile add json-remove --global")

		const result = await runCLIIsolated(
			["profile", "remove", "json-remove", "--global", "--json"],
			dir,
			env,
		)
		expectStrictJsonSuccess(result)
	})

	it("missing support: profile move --json should satisfy strict success contract", async () => {
		const dir = await createTrackedTempDir("json-profile-move")
		const env = createGlobalProfileEnv(dir)
		const initResult = await runCLIIsolated(["init", "--global"], dir, env)
		expectSetupSuccess(initResult, "init --global for profile move")

		const profileAddResult = await runCLIIsolated(
			["profile", "add", "json-source", "--global"],
			dir,
			env,
		)
		expectSetupSuccess(profileAddResult, "profile add json-source --global")

		const result = await runCLIIsolated(
			["profile", "move", "json-source", "json-target", "--global", "--json"],
			dir,
			env,
		)
		expectStrictJsonSuccess(result)
	})

	it("missing support: self uninstall --json should satisfy strict success contract", async () => {
		const dir = await createTrackedTempDir("json-self-uninstall")
		const result = await runCLIIsolated(["self", "uninstall", "--dry-run", "--json"], dir, {
			XDG_CONFIG_HOME: dir,
		})

		expectStrictJsonSuccess(result)
	})

	it("missing support + boundary: self update invalid method should return strict JSON error", async () => {
		const dir = await createTrackedTempDir("json-self-update-error")
		const result = await runCLIIsolated(
			["self", "update", "--method", "invalid-method", "--json"],
			dir,
			{ XDG_CONFIG_HOME: dir },
		)

		expectStrictJsonFailure(result)
	})

	it("boundary: update invalid flags with --json should return strict JSON error", async () => {
		const dir = await setupInitializedProject("json-boundary-update-invalid-flags")
		await installTestPluginAndGetCanonicalId(dir)

		const result = await runCLIIsolated(
			["update", "--all", "--registry", "kdco", "--json"],
			dir,
			createLocalProjectEnv(dir),
		)
		expectStrictJsonFailure(result)
	})
})
