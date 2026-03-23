import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { type DryRunResult, outputDryRun } from "../../src/utils/dry-run"

describe("dry-run utilities", () => {
	describe("outputDryRun", () => {
		let consoleLogSpy: ReturnType<typeof spyOn>
		let consoleWarnSpy: ReturnType<typeof spyOn>
		let consoleErrorSpy: ReturnType<typeof spyOn>
		let consoleOutput: string[]

		beforeEach(() => {
			consoleOutput = []
			consoleLogSpy = spyOn(console, "log").mockImplementation((...args) => {
				consoleOutput.push(args.map(String).join(" "))
			})
			consoleWarnSpy = spyOn(console, "warn").mockImplementation((...args) => {
				consoleOutput.push(args.map(String).join(" "))
			})
			consoleErrorSpy = spyOn(console, "error").mockImplementation((...args) => {
				consoleOutput.push(args.map(String).join(" "))
			})
		})

		afterEach(() => {
			consoleLogSpy.mockRestore()
			consoleWarnSpy.mockRestore()
			consoleErrorSpy.mockRestore()
		})

		it("outputs JSON when json option is true", () => {
			const result: DryRunResult = {
				dryRun: true,
				command: "test",
				wouldPerform: [{ action: "add", target: "test-target" }],
				validation: { passed: true },
			}

			outputDryRun(result, { json: true })

			expect(consoleOutput.length).toBe(1)
			const parsed = JSON.parse(consoleOutput[0])
			expect(parsed.dryRun).toBe(true)
			expect(parsed.command).toBe("test")
		})

		it("outputs nothing when quiet option is true", () => {
			const result: DryRunResult = {
				dryRun: true,
				command: "test",
				wouldPerform: [{ action: "add", target: "test-target" }],
				validation: { passed: true },
			}

			outputDryRun(result, { quiet: true })

			expect(consoleOutput.length).toBe(0)
		})

		it("includes header and footer in text output", () => {
			const result: DryRunResult = {
				dryRun: true,
				command: "test",
				wouldPerform: [{ action: "add", target: "test-target" }],
				validation: { passed: true },
			}

			outputDryRun(result, {})

			const output = consoleOutput.join("\n")
			expect(output).toContain("DRY RUN")
			expect(output).toContain("--dry-run")
		})

		it("includes validation warnings in output", () => {
			const result: DryRunResult = {
				dryRun: true,
				command: "test",
				wouldPerform: [{ action: "delete", target: "test-target" }],
				validation: { passed: false, warnings: ["File was modified"] },
			}

			outputDryRun(result, {})

			const output = consoleOutput.join("\n")
			expect(output).toContain("File was modified")
		})

		it("includes validation errors in output", () => {
			const result: DryRunResult = {
				dryRun: true,
				command: "test",
				wouldPerform: [],
				validation: { passed: false, errors: ["Component not found"] },
			}

			outputDryRun(result, {})

			const output = consoleOutput.join("\n")
			expect(output).toContain("Component not found")
		})

		it("preserves structured validation issues in JSON output", () => {
			const result: DryRunResult = {
				dryRun: true,
				command: "build",
				wouldPerform: [],
				validation: {
					passed: false,
					errors: ["Plugin loadability: unresolved import"],
					issues: [
						{
							kind: "plugin_loadability",
							code: "plugin_static_local_import_unresolved",
							severity: "error",
							message: "unresolved import",
							rendered: "Plugin loadability: unresolved import",
							affectedComponents: ["plugin-component"],
							affectedEntrypoints: [".opencode/plugins/main.ts"],
						},
					],
				},
			}

			outputDryRun(result, { json: true })

			const parsed = JSON.parse(consoleOutput[0]) as DryRunResult
			expect(parsed.validation.issues?.[0]?.code).toBe("plugin_static_local_import_unresolved")
		})

		it("includes hints in footer", () => {
			const result: DryRunResult = {
				dryRun: true,
				command: "test",
				wouldPerform: [{ action: "add", target: "test-target" }],
				validation: { passed: true },
			}

			outputDryRun(result, { hints: ["Use --force to override"] })

			const output = consoleOutput.join("\n")
			expect(output).toContain("--force")
		})

		it("groups actions by type", () => {
			const result: DryRunResult = {
				dryRun: true,
				command: "test",
				wouldPerform: [
					{ action: "add", target: "target-1" },
					{ action: "add", target: "target-2" },
					{ action: "delete", target: "target-3" },
				],
				validation: { passed: true },
			}

			outputDryRun(result, {})

			const output = consoleOutput.join("\n")
			expect(output).toContain("target-1")
			expect(output).toContain("target-2")
			expect(output).toContain("target-3")
		})
	})
})
