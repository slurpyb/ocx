/**
 * Tests for dependency invalidation after `ocx add` updates package.json.
 *
 * Bug: `ocx add` writes deps into `.opencode/package.json` (or flattened manifest)
 * but does not ensure install. Upstream OpenCode may skip install if
 * `@opencode-ai/plugin` matches, causing missing deps at runtime.
 *
 * Mitigation: if dependency declarations changed, invalidate adjacent
 * `node_modules` to force reinstall on next OpenCode launch.
 */

import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, lstatSync } from "node:fs"
import { mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cleanupTempDir, createTempDir } from "./helpers"

// ---------------------------------------------------------------------------
// Unit tests for the invalidation helper (pure utility)
// ---------------------------------------------------------------------------

// NOTE: These imports will fail until the production module exists.
// That's the RED phase — tests are written before implementation.

import {
	buildInvalidationDryRunAction,
	computeDependencyDelta,
	type InvalidationResult,
	invalidateNodeModules,
} from "../src/utils/dep-invalidation"

describe("invalidateNodeModules", () => {
	let testDir: string

	afterEach(async () => {
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	// (a) local mode dep change invalidates .opencode/node_modules
	it("removes node_modules directory when it exists", async () => {
		testDir = await createTempDir("dep-inv-basic")
		const nodeModulesDir = join(testDir, "node_modules")
		await mkdir(nodeModulesDir, { recursive: true })
		await writeFile(join(nodeModulesDir, "marker.txt"), "exists")

		const result = await invalidateNodeModules(testDir)

		expect(result.success).toBe(true)
		expect(result.action).toBe("removed")
		expect(existsSync(nodeModulesDir)).toBe(false)
	})

	// (c) no dependency delta => no invalidation
	it("treats missing node_modules as success (no-op)", async () => {
		testDir = await createTempDir("dep-inv-missing")
		// No node_modules created

		const result = await invalidateNodeModules(testDir)

		expect(result.success).toBe(true)
		expect(result.action).toBe("none")
	})

	// (e) invalidation failure => warning + command still succeeds
	it("returns failure result on EPERM/EACCES without throwing", async () => {
		testDir = await createTempDir("dep-inv-eperm")
		const nodeModulesDir = join(testDir, "node_modules")
		await mkdir(nodeModulesDir, { recursive: true })

		// Simulate a failure by passing a mock rm function that throws EPERM
		const epermError = Object.assign(new Error("EPERM"), { code: "EPERM" })
		const failingRm = async () => {
			throw epermError
		}

		const result = await invalidateNodeModules(testDir, { rmImpl: failingRm })

		expect(result.success).toBe(false)
		expect(result.action).toBe("failed")
		expect(result.error).toBeDefined()
		expect(result.error?.code).toBe("EPERM")
	})

	// (g) symlinked node_modules => symlink removed/unlinked, target untouched
	it("removes symlink without deleting the target directory", async () => {
		testDir = await createTempDir("dep-inv-symlink")
		const targetDir = join(testDir, "real_node_modules")
		await mkdir(targetDir, { recursive: true })
		await writeFile(join(targetDir, "marker.txt"), "should-survive")

		const symlinkPath = join(testDir, "node_modules")
		await symlink(targetDir, symlinkPath, "dir")

		// Verify symlink exists before invalidation
		expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true)

		const result = await invalidateNodeModules(testDir)

		expect(result.success).toBe(true)
		expect(result.action).toBe("unlinked")
		// Symlink should be gone
		expect(existsSync(symlinkPath)).toBe(false)
		// Target should be untouched
		expect(existsSync(join(targetDir, "marker.txt"))).toBe(true)
	})

	// (f) concurrent invalidation of same packageDir => no crash
	it("handles concurrent invalidation without crashing", async () => {
		testDir = await createTempDir("dep-inv-concurrent")
		const nodeModulesDir = join(testDir, "node_modules")
		await mkdir(nodeModulesDir, { recursive: true })

		// Run two invalidations concurrently on the same directory
		const results = await Promise.all([
			invalidateNodeModules(testDir),
			invalidateNodeModules(testDir),
		])

		// Contract: never crashes, both return a result, and node_modules is gone.
		// One call may see a transient FS state during the other's rm and report
		// a non-success result — that's acceptable. The critical invariants are:
		// 1) No unhandled exception (Promise.all would reject)
		// 2) At least one succeeded
		// 3) node_modules is actually removed
		const atLeastOneSucceeded = results.some((r: InvalidationResult) => r.success)
		expect(atLeastOneSucceeded).toBe(true)
		expect(existsSync(nodeModulesDir)).toBe(false)
	})

	// Retry logic: EBUSY should be retried
	it("retries on EBUSY with bounded exponential backoff", async () => {
		testDir = await createTempDir("dep-inv-ebusy")
		const nodeModulesDir = join(testDir, "node_modules")
		await mkdir(nodeModulesDir, { recursive: true })

		let attempts = 0
		const ebusyThenSucceed = async (
			path: string,
			opts?: { recursive?: boolean; force?: boolean },
		) => {
			attempts++
			if (attempts < 3) {
				throw Object.assign(new Error("EBUSY"), { code: "EBUSY" })
			}
			await rm(path, opts)
		}

		const result = await invalidateNodeModules(testDir, { rmImpl: ebusyThenSucceed })

		expect(result.success).toBe(true)
		expect(result.action).toBe("removed")
		expect(attempts).toBe(3) // failed twice, succeeded on third
	})

	// Exhausted retries: EBUSY persists beyond MAX_RETRIES => failure with error code
	it("fails after exhausting retries on persistent EBUSY", async () => {
		testDir = await createTempDir("dep-inv-ebusy-exhausted")
		const nodeModulesDir = join(testDir, "node_modules")
		await mkdir(nodeModulesDir, { recursive: true })

		let attempts = 0
		const alwaysEbusy = async () => {
			attempts++
			throw Object.assign(new Error("resource busy"), { code: "EBUSY" })
		}

		const result = await invalidateNodeModules(testDir, { rmImpl: alwaysEbusy })

		expect(result.success).toBe(false)
		expect(result.action).toBe("failed")
		expect(result.error?.code).toBe("EBUSY")
		// MAX_RETRIES is 3, so 4 total attempts (0..3 inclusive)
		expect(attempts).toBe(4)
	})

	// Retry logic: ENOTEMPTY should be retried the same as EBUSY
	it("retries on ENOTEMPTY and succeeds when transient", async () => {
		testDir = await createTempDir("dep-inv-enotempty")
		const nodeModulesDir = join(testDir, "node_modules")
		await mkdir(nodeModulesDir, { recursive: true })

		let attempts = 0
		const enotemptyThenSucceed = async (
			path: string,
			opts?: { recursive?: boolean; force?: boolean },
		) => {
			attempts++
			if (attempts < 2) {
				throw Object.assign(new Error("ENOTEMPTY"), { code: "ENOTEMPTY" })
			}
			await rm(path, opts)
		}

		const result = await invalidateNodeModules(testDir, { rmImpl: enotemptyThenSucceed })

		expect(result.success).toBe(true)
		expect(result.action).toBe("removed")
		expect(attempts).toBe(2) // failed once, succeeded on second
	})
})

// ---------------------------------------------------------------------------
// Unit tests for dependency update metadata
// ---------------------------------------------------------------------------

describe("computeDependencyDelta", () => {
	it("detects added dependencies", () => {
		const before: Record<string, string> = {}
		const after: Record<string, string> = { lodash: "^4.17.21" }

		const delta = computeDependencyDelta(before, after)

		expect(delta.changed).toBe(true)
		expect(delta.entries).toHaveLength(1)
		expect(delta.entries[0]).toEqual({
			name: "lodash",
			from: null,
			to: "^4.17.21",
		})
	})

	it("detects changed versions", () => {
		const before: Record<string, string> = { lodash: "^4.0.0" }
		const after: Record<string, string> = { lodash: "^4.17.21" }

		const delta = computeDependencyDelta(before, after)

		expect(delta.changed).toBe(true)
		expect(delta.entries).toHaveLength(1)
		expect(delta.entries[0]).toEqual({
			name: "lodash",
			from: "^4.0.0",
			to: "^4.17.21",
		})
	})

	it("returns changed=false when deps are identical", () => {
		const deps: Record<string, string> = { lodash: "^4.17.21" }

		const delta = computeDependencyDelta(deps, { ...deps })

		expect(delta.changed).toBe(false)
		expect(delta.entries).toHaveLength(0)
	})

	it("returns changed=false when both are empty", () => {
		const delta = computeDependencyDelta({}, {})

		expect(delta.changed).toBe(false)
		expect(delta.entries).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// Dry-run: no deletion but action reports planned invalidation
// ---------------------------------------------------------------------------

describe("dep invalidation dry-run reporting", () => {
	// (d) dry-run => no deletion, but dry-run action reports planned invalidation
	it("should report planned invalidation action in dry-run format", () => {
		// This tests the DryRunAction shape returned for invalidation
		// The production code should produce a DryRunAction with:
		//   action: "delete"
		//   target: "<path>/node_modules"
		//   details.reason and details.path

		const action = buildInvalidationDryRunAction("/some/path", [
			{ name: "lodash", from: null, to: "^4.17.21" },
		])

		expect(action.action).toBe("delete")
		expect(action.target).toContain("node_modules")
		expect(action.details).toBeDefined()
		expect(action.details?.reason).toContain("dependency")
		expect(action.details?.path).toBe("/some/path/node_modules")
	})
})
