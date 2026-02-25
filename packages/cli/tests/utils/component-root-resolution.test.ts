import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { resolveComponentTargetRoot } from "../../src/utils/component-root-resolution"
import { ConflictError, ValidationError } from "../../src/utils/errors"
import { cleanupTempDir, createTempDir } from "../helpers"

describe("resolveComponentTargetRoot", () => {
	let testDir: string

	afterEach(async () => {
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("uses singular root when only singular directory exists", async () => {
		testDir = await createTempDir("component-root-singular")
		await mkdir(join(testDir, "command"), { recursive: true })

		expect(resolveComponentTargetRoot("commands/test-command.md", testDir)).toBe(
			"command/test-command.md",
		)
	})

	it("uses plural root when only plural directory exists", async () => {
		testDir = await createTempDir("component-root-plural")
		await mkdir(join(testDir, "commands"), { recursive: true })

		expect(resolveComponentTargetRoot("command/test-command.md", testDir)).toBe(
			"commands/test-command.md",
		)
	})

	it("prefers plural root when both singular and plural directories exist", async () => {
		testDir = await createTempDir("component-root-both")
		await mkdir(join(testDir, "command"), { recursive: true })
		await mkdir(join(testDir, "commands"), { recursive: true })

		expect(resolveComponentTargetRoot("command/test-command.md", testDir)).toBe(
			"commands/test-command.md",
		)
	})

	it("defaults to plural root when neither root exists", async () => {
		testDir = await createTempDir("component-root-default-plural")

		expect(resolveComponentTargetRoot("command/test-command.md", testDir)).toBe(
			"commands/test-command.md",
		)
	})

	it("fails loud when a candidate root exists but is not a directory", async () => {
		testDir = await createTempDir("component-root-candidate-not-directory")
		await writeFile(join(testDir, "command"), "not-a-directory")

		expect(() => resolveComponentTargetRoot("command/test-command.md", testDir)).toThrow(
			ValidationError,
		)
	})

	it("fails loud on cross-root logical collisions", async () => {
		testDir = await createTempDir("component-root-cross-collision")
		await mkdir(join(testDir, "command"), { recursive: true })
		await mkdir(join(testDir, "commands"), { recursive: true })
		await writeFile(join(testDir, "command", "test-command.md"), "existing")

		expect(() => resolveComponentTargetRoot("commands/test-command.md", testDir)).toThrow(
			ConflictError,
		)
	})

	it("preserves the nested suffix path exactly while rewriting the root", async () => {
		testDir = await createTempDir("component-root-preserve-suffix")
		await mkdir(join(testDir, "agent"), { recursive: true })

		expect(resolveComponentTargetRoot("agents/research/deep/path.md", testDir)).toBe(
			"agent/research/deep/path.md",
		)
	})

	it("defaults to plural roots for every recognized pair when no roots exist", async () => {
		testDir = await createTempDir("component-root-all-pairs")

		const cases = [
			{ singular: "agent", plural: "agents" },
			{ singular: "command", plural: "commands" },
			{ singular: "plugin", plural: "plugins" },
			{ singular: "skill", plural: "skills" },
			{ singular: "tool", plural: "tools" },
			{ singular: "bundle", plural: "bundles" },
			{ singular: "profile", plural: "profiles" },
		] as const

		for (const testCase of cases) {
			expect(resolveComponentTargetRoot(`${testCase.singular}/x.md`, testDir)).toBe(
				`${testCase.plural}/x.md`,
			)
		}
	})
})
