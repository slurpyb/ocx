/**
 * Integration tests for init --registry template fetching.
 *
 * These tests make real network requests to GitHub.
 *
 * To run: OCX_INTEGRATION_TESTS=1 bun test init-integration.test.ts
 *
 * For rate limit avoidance, set GITHUB_TOKEN in your environment.
 * Tests have 30s timeout to handle slow network conditions.
 */
import { afterEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, runCLI } from "./helpers"

const SKIP = process.env.OCX_INTEGRATION_TESTS !== "1"

;(SKIP ? describe.skip : describe)("init --registry integration", () => {
	let testDir: string

	afterEach(async () => {
		if (testDir) await cleanupTempDir(testDir)
	})

	it("should scaffold registry from canary template (--canary)", async () => {
		testDir = await createTempDir("integration-canary")

		const result = await runCLI(
			[
				"init",
				"--registry",
				"test-registry",
				"--namespace",
				"test-ns",
				"--author",
				"test",
				"--canary",
			],
			testDir,
		)

		expect(result.exitCode).toBe(0)
		expect(existsSync(join(testDir, "test-registry", "registry.jsonc"))).toBe(true)
		expect(existsSync(join(testDir, "test-registry", "package.json"))).toBe(true)
	}, 30000)

	it("should fail gracefully in dev mode without --canary", async () => {
		testDir = await createTempDir("integration-release")

		// In dev/test mode, __VERSION__ is not defined, so this should fail
		// with a helpful error message directing user to use --canary
		const result = await runCLI(
			["init", "--registry", "test-registry", "--namespace", "test-ns", "--author", "test"],
			testDir,
		)

		expect(result.exitCode).not.toBe(0)
		expect(result.output).toContain("--canary")
	}, 30000)
})
