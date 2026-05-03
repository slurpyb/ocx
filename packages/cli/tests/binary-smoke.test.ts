/**
 * Smoke tests against compiled standalone binaries.
 *
 * Prerequisites: Run `bun run build:binary:all` first, or pass explicit targets
 * with OCX_BINARY_SMOKE_TARGETS separated by path.delimiter.
 * To run: bun run test:binary-smoke
 */
import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { basename, delimiter, join } from "node:path"

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
const WINDOWS_BINARY_NAMES = ["ocx-windows-x64.exe", "ocx-windows-x64-baseline.exe"] as const

function getDefaultBinaryName(): string {
	if (process.platform === "darwin" && process.arch === "arm64") return "ocx-darwin-arm64"
	if (process.platform === "darwin") return "ocx-darwin-x64"
	if (process.platform === "linux" && process.arch === "arm64") return "ocx-linux-arm64"
	return "ocx-linux-x64"
}

function getWindowsSmokeTargets(): SmokeTarget[] {
	return WINDOWS_BINARY_NAMES.map((name) => ({
		label: name,
		path: join(DIST_BIN_DIR, name),
	}))
}

function getSmokeTargets(): SmokeTarget[] {
	const explicitTargets = process.env.OCX_BINARY_SMOKE_TARGETS
	if (explicitTargets) {
		return explicitTargets
			.split(delimiter)
			.filter(Boolean)
			.map((targetPath) => ({
				label: basename(targetPath),
				path: targetPath,
			}))
	}

	if (process.platform === "win32") {
		return getWindowsSmokeTargets()
	}

	const defaultPath = join(DIST_BIN_DIR, getDefaultBinaryName())
	const defaultTargets = existsSync(defaultPath)
		? [{ label: basename(defaultPath), path: defaultPath }]
		: []
	const windowsTargets = getWindowsSmokeTargets().filter((target) => existsSync(target.path))

	return [...defaultTargets, ...windowsTargets]
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

function assertBinaryExists(target: SmokeTarget): void {
	if (existsSync(target.path)) return

	throw new Error(
		`Missing compiled binary for smoke target ${target.label} at ${target.path}. Run bun run build:binary:all or bun run build:binary:windows before bun run test:binary-smoke.`,
	)
}

function canExecuteSmokeTarget(target: SmokeTarget): boolean {
	if (process.platform === "win32") return true

	return !target.path.toLowerCase().endsWith(".exe")
}

;(SKIP ? describe.skip : describe)("compiled binary smoke", () => {
	const smokeTargets = getSmokeTargets()

	it("finds at least one compiled binary target", () => {
		expect(smokeTargets.length).toBeGreaterThan(0)
	})

	for (const target of smokeTargets) {
		describe(target.label, () => {
			const runExecutableTest = canExecuteSmokeTarget(target) ? it : it.skip

			it("exists before smoke execution", () => {
				assertBinaryExists(target)
			})

			if (!canExecuteSmokeTarget(target)) {
				it.skip(
					`${target.label} execution requires a Windows runner; CI release smoke executes this .exe on windows-latest`,
				)
			}

			runExecutableTest("prints version", () => {
				assertBinaryExists(target)

				const result = runBinary(target.path, ["--version"])
				const stdout = outputText(result.stdout)
				const stderr = outputText(result.stderr)

				expect(result.exitCode).toBe(0)
				expect(stdout).toContain(packageVersion)
				expect(stdout).toMatch(/\d+\.\d+\.\d+/)
				expect(stdout).not.toMatch(REQUIRED_ERROR_TEXT)
				expect(stderr).not.toMatch(UNHANDLED_ERROR_TEXT)
			})

			runExecutableTest("prints help", () => {
				const result = runBinary(target.path, ["--help"])
				expectHelpOutput(result)
			})

			runExecutableTest("prints help subcommand", () => {
				const result = runBinary(target.path, ["help"])
				expectHelpOutput(result)
			})

			runExecutableTest("prints no-argument help", () => {
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
