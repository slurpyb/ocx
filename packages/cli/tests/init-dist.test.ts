/**
 * Smoke tests against the built dist/index.js artifact.
 *
 * These tests verify the CLI works when bundled (catches packaging bugs).
 *
 * Prerequisites: Run `bun run build` first.
 * To run: OCX_DIST_TESTS=1 bun test init-dist.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const DIST_CLI = join(import.meta.dir, "../dist/index.js")
const SKIP = process.env.OCX_DIST_TESTS !== "1"

;(SKIP ? describe.skip : describe)("init --registry (dist)", () => {
	const testDir = join(import.meta.dir, "fixtures/tmp-dist-test")

	beforeAll(() => {
		if (!existsSync(DIST_CLI)) {
			throw new Error(
				"dist/index.js not found. Run 'bun run build' before running dist tests.\n" +
					"Then run: OCX_DIST_TESTS=1 bun test init-dist.test.ts",
			)
		}
		// Clean up any previous test artifacts
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true })
		}
		mkdirSync(testDir, { recursive: true })
	})

	afterAll(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true })
		}
	})

	it("should scaffold registry from release template (no --canary)", async () => {
		const registryDir = join(testDir, "release-registry")

		const result = Bun.spawnSync(
			[
				"bun",
				"run",
				DIST_CLI,
				"init",
				"--registry",
				"release-registry",
				"--namespace",
				"test-ns",
				"--author",
				"test",
			],
			{ cwd: testDir },
		)

		expect(result.exitCode).toBe(0)
		expect(existsSync(join(registryDir, "registry.jsonc"))).toBe(true)
		expect(existsSync(join(registryDir, "package.json"))).toBe(true)
	}, 30000)

	it("should scaffold registry with --canary flag", async () => {
		const registryDir = join(testDir, "canary-registry")

		const result = Bun.spawnSync(
			[
				"bun",
				"run",
				DIST_CLI,
				"init",
				"--registry",
				"canary-registry",
				"--namespace",
				"test-ns",
				"--author",
				"test",
				"--canary",
			],
			{ cwd: testDir },
		)

		expect(result.exitCode).toBe(0)
		expect(existsSync(join(registryDir, "registry.jsonc"))).toBe(true)
	}, 30000)
})
