import { describe, expect, it } from "bun:test"
import {
	buildSafeGitArguments,
	parseRepositoryName,
	parseRepositoryOwner,
	parseRepositoryUrl,
} from "../files/plugins/flow-plugin"

describe("flow explorer git safety", () => {
	it("rejects git arguments that can write, execute helpers, or inject config", () => {
		const deniedArguments = [
			["diff", '["--output=/tmp/pwned"]'],
			["diff", '["--no-index", "a", "b"]'],
			["diff", '["--ext-diff"]'],
			["log", '["-c", "core.pager=cat"]'],
			["show", '["--config-env=core.sshCommand=ENV"]'],
		] as const

		for (const [operation, argsJson] of deniedArguments) {
			expect(() => buildSafeGitArguments(operation, argsJson)).toThrow()
		}
	})

	it("rejects unsafe absolute and parent pathspecs", () => {
		expect(() => buildSafeGitArguments("diff", '["--", "/tmp/pwned"]')).toThrow()
		expect(() => buildSafeGitArguments("diff", '["--", "../outside"]')).toThrow()
	})

	it("rejects unknown leading-dash arguments instead of treating them as refs", () => {
		const deniedUnknownFlags = [
			["log", '["--show-signature"]'],
			["show", '["--textconv"]'],
			["diff", '["--help"]'],
			["rev-parse", '["--paginate"]'],
		] as const

		for (const [operation, argsJson] of deniedUnknownFlags) {
			expect(() => buildSafeGitArguments(operation, argsJson)).toThrow()
		}
	})

	it("allows narrow read-only git argument forms", () => {
		expect(buildSafeGitArguments("status", '["--short"]')).toEqual(["--short"])
		expect(buildSafeGitArguments("log", '["--oneline", "--max-count=5", "main"]')).toEqual([
			"--oneline",
			"--max-count=5",
			"main",
		])
		expect(buildSafeGitArguments("diff", '["--stat", "main", "HEAD", "--", "src/index.ts"]')).toEqual([
			"--stat",
			"main",
			"HEAD",
			"--",
			"src/index.ts",
		])
	})
})

describe("flow explorer clone path safety", () => {
	it("rejects dot segments that could target owner dirs or temp root", () => {
		expect(() => parseRepositoryOwner(".")).toThrow()
		expect(() => parseRepositoryOwner("..")).toThrow()
		expect(() => parseRepositoryName(".")).toThrow()
		expect(() => parseRepositoryName("..")).toThrow()
	})

	it("rejects repository URLs with embedded credentials", () => {
		expect(() => parseRepositoryUrl("https://token@example.com/owner/repo.git")).toThrow()
		expect(() => parseRepositoryUrl("https://user:secret@example.com/owner/repo.git")).toThrow()
	})
})
