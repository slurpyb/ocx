import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { ValidationError } from "../src/utils/errors"
import { getGlobalConfigPath, globalDirectoryExists, resolveTargetPath } from "../src/utils/paths"

describe("global utilities", () => {
	describe("getGlobalConfigPath", () => {
		const originalXdg = process.env.XDG_CONFIG_HOME

		afterEach(() => {
			if (originalXdg) {
				process.env.XDG_CONFIG_HOME = originalXdg
			} else {
				delete process.env.XDG_CONFIG_HOME
			}
		})

		it("returns ~/.config/opencode by default", () => {
			delete process.env.XDG_CONFIG_HOME
			const result = getGlobalConfigPath()
			expect(result).toBe(join(homedir(), ".config", "opencode"))
		})

		it("uses XDG_CONFIG_HOME when set and absolute", () => {
			process.env.XDG_CONFIG_HOME = "/custom/config"
			const result = getGlobalConfigPath()
			expect(result).toBe("/custom/config/opencode")
		})

		it("ignores XDG_CONFIG_HOME when relative", () => {
			process.env.XDG_CONFIG_HOME = "relative/path"
			const result = getGlobalConfigPath()
			expect(result).toBe(join(homedir(), ".config", "opencode"))
		})
	})

	describe("globalDirectoryExists", () => {
		const testDir = join(homedir(), ".config", "opencode-test-temp")

		beforeEach(() => {
			if (existsSync(testDir)) {
				rmSync(testDir, { recursive: true })
			}
		})

		afterEach(() => {
			if (existsSync(testDir)) {
				rmSync(testDir, { recursive: true })
			}
		})

		it("returns false when directory does not exist", async () => {
			// Point to non-existent dir via XDG
			const originalXdg = process.env.XDG_CONFIG_HOME
			process.env.XDG_CONFIG_HOME = join(homedir(), ".config", "nonexistent-test-dir")

			const result = await globalDirectoryExists()
			expect(result).toBe(false)

			if (originalXdg) {
				process.env.XDG_CONFIG_HOME = originalXdg
			} else {
				delete process.env.XDG_CONFIG_HOME
			}
		})
	})

	describe("resolveTargetPath", () => {
		it("V2: always uses root-relative paths (flattened mode)", () => {
			const result = resolveTargetPath("plugins/foo.ts", true)
			expect(result).toBe("plugins/foo.ts")
		})

		it("uses .opencode-prefixed paths in local mode", () => {
			const result = resolveTargetPath("plugins/foo.ts", false)
			expect(result).toBe(".opencode/plugins/foo.ts")
		})

		it("V2: handles nested paths correctly when flattened", () => {
			const result = resolveTargetPath("agents/researcher/index.ts", true)
			expect(result).toBe("agents/researcher/index.ts")
		})

		it("handles nested paths correctly in local mode", () => {
			const result = resolveTargetPath("agents/researcher/index.ts", false)
			expect(result).toBe(".opencode/agents/researcher/index.ts")
		})

		it("keeps already-prefixed local targets without adding duplicate prefix", () => {
			const result = resolveTargetPath(".opencode/plugins/foo.ts", false)
			expect(result).toBe(".opencode/plugins/foo.ts")
		})

		it("rejects local traversal targets that escape .opencode", () => {
			expect(() => resolveTargetPath("../plugins/escape.ts", false)).toThrow(ValidationError)
			expect(() => resolveTargetPath(".opencode/../plugins/escape.ts", false)).toThrow(
				ValidationError,
			)
		})

		it("rejects local absolute-like targets", () => {
			expect(() => resolveTargetPath("/etc/passwd", false)).toThrow(ValidationError)
			expect(() => resolveTargetPath("C:\\Windows\\System32\\drivers\\etc\\hosts", false)).toThrow(
				ValidationError,
			)
		})
	})
})
