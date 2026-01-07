import { describe, expect, it } from "bun:test"
import { filterExcludedPaths } from "../src/utils/pattern-filter.js"

describe("filterExcludedPaths", () => {
	// Test: No patterns returns original set unchanged
	it("returns original set when no include patterns provided", () => {
		const excluded = new Set(["AGENTS.md", ".opencode/skills/test.md"])
		const result = filterExcludedPaths(excluded, undefined, undefined)
		expect(result).toEqual(excluded)
	})

	it("returns original set when include patterns is empty array", () => {
		const excluded = new Set(["AGENTS.md"])
		const result = filterExcludedPaths(excluded, [], undefined)
		expect(result).toEqual(excluded)
	})

	// Test: Include pattern removes from exclusions
	it("removes matching files from exclusions when include pattern matches", () => {
		const excluded = new Set(["AGENTS.md", "opencode.jsonc"])
		const result = filterExcludedPaths(excluded, ["AGENTS.md"], undefined)
		expect(result).toEqual(new Set(["opencode.jsonc"]))
	})

	// Test: Glob patterns work
	it("supports ** glob pattern for recursive matching", () => {
		const excluded = new Set([
			"AGENTS.md",
			"docs/AGENTS.md",
			"src/nested/AGENTS.md",
			"opencode.jsonc",
		])
		const result = filterExcludedPaths(excluded, ["**/AGENTS.md"], undefined)
		expect(result).toEqual(new Set(["opencode.jsonc"]))
	})

	// Test: .opencode directory patterns
	it("supports directory glob patterns", () => {
		const excluded = new Set([
			".opencode/skills/foo.md",
			".opencode/plugins/bar.ts",
			".opencode/config.json",
			"AGENTS.md",
		])
		const result = filterExcludedPaths(excluded, [".opencode/skills/**"], undefined)
		expect(result).toEqual(
			new Set([".opencode/plugins/bar.ts", ".opencode/config.json", "AGENTS.md"]),
		)
	})

	// Test: Exclude filters include results
	it("exclude patterns filter out from include results", () => {
		const excluded = new Set(["AGENTS.md", "vendor/AGENTS.md", "opencode.jsonc"])
		const result = filterExcludedPaths(excluded, ["**/AGENTS.md"], ["**/vendor/**"])
		// AGENTS.md is included, vendor/AGENTS.md stays excluded
		expect(result).toEqual(new Set(["vendor/AGENTS.md", "opencode.jsonc"]))
	})

	// Test: Multiple patterns
	it("supports multiple include patterns", () => {
		const excluded = new Set([
			"AGENTS.md",
			"CLAUDE.md",
			".opencode/skills/test.md",
			"opencode.jsonc",
		])
		const result = filterExcludedPaths(excluded, ["**/AGENTS.md", ".opencode/skills/**"], undefined)
		expect(result).toEqual(new Set(["CLAUDE.md", "opencode.jsonc"]))
	})

	// Test: Returns new Set (immutability)
	it("returns a new Set and does not mutate input", () => {
		const excluded = new Set(["AGENTS.md", "opencode.jsonc"])
		const original = new Set(excluded)
		const result = filterExcludedPaths(excluded, ["AGENTS.md"], undefined)
		expect(excluded).toEqual(original) // Original unchanged
		expect(result).not.toBe(excluded) // Different reference
	})
})
