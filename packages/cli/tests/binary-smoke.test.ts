/**
 * Smoke tests against compiled standalone binaries.
 *
 * Prerequisites: Run `bun run scripts/build-binary.ts` first, or pass explicit
 * targets with OCX_BINARY_SMOKE_TARGETS separated by path.delimiter.
 * To run: OCX_DIST_TESTS=1 bun test tests/binary-smoke.test.ts
 */
import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { delimiter, join } from "node:path"

interface SmokeTarget {
	label: string
	path: string
}

const DIST_BIN_DIR = join(import.meta.dir, "../dist/bin")
const PACKAGE_JSON = join(import.meta.dir, "../package.json")
const SKIP = process.env.OCX_DIST_TESTS !== "1"
const REQUIRED_ERROR_TEXT = /required|missing required/i
const UNHANDLED_ERROR_TEXT = /(?:unhandled|uncaught|exception|\n\s*at\s+)/i

const packageVersion = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8")).version as string

function getDefaultBinaryName(): string {
	if (process.platform === "win32") return "ocx-windows-x64-baseline.exe"
	if (process.platform === "darwin" && process.arch === "arm64") return "ocx-darwin-arm64"
	if (process.platform === "darwin") return "ocx-darwin-x64"
	if (process.platform === "linux" && process.arch === "arm64") return "ocx-linux-arm64"
	return "ocx-linux-x64"
}

function getSmokeTargets(): SmokeTarget[] {
	const explicitTargets = process.env.OCX_BINARY_SMOKE_TARGETS
	if (explicitTargets) {
		return explicitTargets.split(delimiter).map((targetPath) => ({
			label: targetPath,
			path: targetPath,
		}))
	}

	const defaultPath = join(DIST_BIN_DIR, getDefaultBinaryName())
	if (existsSync(defaultPath)) {
		return [{ label: defaultPath, path: defaultPath }]
	}

	const windowsTargets = ["ocx-windows-x64.exe", "ocx-windows-x64-baseline.exe"]
		.map((name) => join(DIST_BIN_DIR, name))
		.filter((targetPath) => existsSync(targetPath))

	return windowsTargets.map((targetPath) => ({ label: targetPath, path: targetPath }))
}

function runBinary(binaryPath: string, args: string[] = []) {
	return Bun.spawnSync([binaryPath, ...args], {
		cwd: DIST_BIN_DIR,
		stderr: "pipe",
		stdout: "pipe",
	})
}

function outputText(output: Buffer | Uint8Array | null): string {
	if (!output) return ""
	return new TextDecoder().decode(output)
}

function expectHelpOutput(result: ReturnType<typeof runBinary>): void {
	const stdout = outputText(result.stdout)
	const stderr = outputText(result.stderr)

	expect(result.exitCode).toBe(0)
	expect(stdout.length).toBeGreaterThan(0)
	expect(stdout).toContain("Usage:")
	expect(stdout).toContain("ocx")
	expect(stderr).not.toMatch(UNHANDLED_ERROR_TEXT)
}

;(SKIP ? describe.skip : describe)("compiled binary smoke", () => {
	const smokeTargets = getSmokeTargets()

	it("finds at least one compiled binary target", () => {
		expect(smokeTargets.length).toBeGreaterThan(0)
	})

	for (const target of smokeTargets) {
		describe(target.label, () => {
			it("prints version", () => {
				expect(existsSync(target.path)).toBe(true)

				const result = runBinary(target.path, ["--version"])
				const stdout = outputText(result.stdout)
				const stderr = outputText(result.stderr)

				expect(result.exitCode).toBe(0)
				expect(stdout).toContain(packageVersion)
				expect(stdout).toMatch(/\d+\.\d+\.\d+/)
				expect(stdout).not.toMatch(REQUIRED_ERROR_TEXT)
				expect(stderr).not.toMatch(UNHANDLED_ERROR_TEXT)
			})

			it("prints help", () => {
				const result = runBinary(target.path, ["--help"])
				expectHelpOutput(result)
			})

			it("prints help subcommand", () => {
				const result = runBinary(target.path, ["help"])
				expectHelpOutput(result)
			})

			it("prints no-argument help", () => {
				const result = runBinary(target.path)
				const stdout = outputText(result.stdout)
				const stderr = outputText(result.stderr)

				expect(result.exitCode).toBe(0)
				expect(stdout.length).toBeGreaterThan(0)
				expect(stdout).toMatch(/Usage:|help/i)
				expect(stderr).not.toMatch(UNHANDLED_ERROR_TEXT)
			})
		})
	}
})
