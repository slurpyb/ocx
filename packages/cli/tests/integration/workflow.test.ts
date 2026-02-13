import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCLI } from "../helpers"
import { type MockRegistry, startMockRegistry } from "../mock-registry"

describe("Integration: Global Workflow", () => {
	let testDir: string
	let globalDir: string
	let env: { XDG_CONFIG_HOME: string }
	let registry: MockRegistry

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "ocx-integration-global-"))
		globalDir = await mkdtemp(join(tmpdir(), "ocx-global-"))
		env = { XDG_CONFIG_HOME: globalDir }
		registry = startMockRegistry()
	})

	afterEach(async () => {
		registry.stop()
		await rm(testDir, { recursive: true, force: true })
		await rm(globalDir, { recursive: true, force: true })
	})

	it("should complete full global setup workflow with profile isolation", async () => {
		// Step 1: Initialize global config
		const init = await runCLI(["init", "--global"], testDir, { env })
		expect(init.exitCode).toBe(0)

		// Step 2: Add a registry to global config (V2: use namespace kdco)
		const addGlobal = await runCLI(
			["registry", "add", registry.url, "--name", "kdco", "--global"],
			testDir,
			{ env },
		)
		expect(addGlobal.exitCode).toBe(0)

		// Step 3: Create a new profile (global-only profiles)
		const addProfile = await runCLI(["profile", "add", "work", "--global"], testDir, { env })
		expect(addProfile.exitCode).toBe(0)

		// V2: Create profile ocx.jsonc (profile add doesn't create it)
		const profileDir = join(globalDir, "opencode", "profiles", "work")
		await Bun.write(
			join(profileDir, "ocx.jsonc"),
			JSON.stringify({ $schema: "https://ocx.kdco.dev/schemas/ocx.json", registries: {} }, null, 2),
		)

		// Step 4: Add a registry to the profile (V2: use namespace kdco)
		const addToProfile = await runCLI(
			["registry", "add", registry.url, "--name", "kdco", "--profile", "work"],
			testDir,
			{ env },
		)
		expect(addToProfile.exitCode).toBe(0)

		// Step 5: List profile registries - verify isolation
		// Profile registries should NOT include global registries (isolation check)
		const listProfile = await runCLI(["registry", "list", "--profile", "work", "--json"], testDir, {
			env,
		})
		expect(listProfile.exitCode).toBe(0)
		const profileOutput = JSON.parse(listProfile.stdout)
		const profileRegistries: Array<{ name: string }> =
			profileOutput.data?.registries || profileOutput.registries || []

		// Profile should have kdco
		expect(profileRegistries.find((r) => r.name === "kdco")).toBeDefined()
		// Since both global and profile have same namespace kdco, profile wins (isolation)
		expect(profileRegistries).toHaveLength(1)

		// Step 6: Verify config edit works (using echo as editor stub)
		const edit = await runCLI(["config", "edit", "--profile", "work"], testDir, {
			env: { ...env, EDITOR: "echo", VISUAL: "echo" },
		})
		expect(edit.exitCode).toBe(0)
		// Editor stub echoes the path - verify it contains profile config path
		expect(edit.stdout).toContain("ocx.jsonc")
	})
})

describe("Integration: Local Workflow", () => {
	let testDir: string
	let registry: MockRegistry

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "ocx-integration-local-"))
		registry = startMockRegistry()
	})

	afterEach(async () => {
		registry.stop()
		await rm(testDir, { recursive: true, force: true })
	})

	it("should complete full local project setup", async () => {
		// Step 1: Initialize local config
		const init = await runCLI(["init"], testDir)
		expect(init.exitCode).toBe(0)

		// Step 2: Add a registry (V2: use namespace kdco)
		const add = await runCLI(["registry", "add", registry.url, "--name", "kdco"], testDir)
		expect(add.exitCode).toBe(0)

		// Step 3: List registries - verify it was added
		const list = await runCLI(["registry", "list", "--json"], testDir)
		expect(list.exitCode).toBe(0)
		const listOutput = JSON.parse(list.stdout)
		const registries: Array<{ name: string }> =
			listOutput.data?.registries || listOutput.registries || []
		expect(registries.find((r) => r.name === "kdco")).toBeDefined()

		// Step 4: Remove the registry
		const remove = await runCLI(["registry", "remove", "kdco"], testDir)
		expect(remove.exitCode).toBe(0)

		// Step 5: Verify it's gone
		const listAfter = await runCLI(["registry", "list", "--json"], testDir)
		expect(listAfter.exitCode).toBe(0)
		const afterOutput = JSON.parse(listAfter.stdout)
		const regsAfter: Array<{ name: string }> =
			afterOutput.data?.registries || afterOutput.registries || []
		expect(regsAfter.find((r) => r.name === "kdco")).toBeUndefined()
	})
})
