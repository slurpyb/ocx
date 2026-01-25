import { expect, type Mock, spyOn } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { parse } from "jsonc-parser"

// Type for fetch mock
type FetchMock = Mock<typeof fetch>

let fetchMock: FetchMock | null = null

export interface CLIResult {
	stdout: string
	stderr: string
	output: string
	exitCode: number
}

/**
 * Strip ANSI escape codes from a string.
 * Useful for cleaning up output that contains color codes.
 */
export function stripAnsiCodes(text: string): string {
	// ANSI escape code pattern: \x1b[...m or \x1b[...K, etc.
	// This regex matches all ANSI escape sequences
	const escapeChar = String.fromCharCode(27)
	const ansiRegex = new RegExp(`${escapeChar}\\[[0-9;?]*[a-zA-Z]`, "g")
	return text.replace(ansiRegex, "")
}

/**
 * Extract JSON from the beginning of output that may contain additional text.
 * This handles the case where CLI outputs JSON but Bun's auto-install adds text after.
 */
export function extractJsonFromOutput(output: string): string {
	const cleanOutput = stripAnsiCodes(output)

	// Try to find the end of the JSON object
	let braceCount = 0
	let inString = false
	let escapeNext = false
	let jsonEnd = -1

	for (let i = 0; i < cleanOutput.length; i++) {
		const char = cleanOutput[i]

		if (escapeNext) {
			escapeNext = false
			continue
		}

		if (char === "\\") {
			escapeNext = true
			continue
		}

		if (char === '"' && !escapeNext) {
			inString = !inString
			continue
		}

		if (!inString) {
			if (char === "{") {
				braceCount++
			} else if (char === "}") {
				braceCount--
				if (braceCount === 0) {
					// Found the end of the JSON object
					jsonEnd = i + 1
					break
				}
			}
		}
	}

	if (jsonEnd > 0) {
		return cleanOutput.substring(0, jsonEnd)
	}

	// If we couldn't parse properly, return the original
	return cleanOutput
}

export interface IsolatedEnv {
	env: Record<string, string>
	tempDir: string
	cleanup: () => Promise<void>
}

export interface RunCLIOptions {
	/** Custom environment variables to merge with isolated defaults (caller wins) */
	env?: Record<string, string | undefined>
	/** Skip isolation entirely, use host environment (for rare debugging only) */
	inheritHostEnv?: boolean
}

/**
 * Creates a complete isolated environment for deterministic testing.
 * Auto-creates a unique temp directory with XDG structure.
 * Returns env, tempDir path, and cleanup function.
 */
export async function createIsolatedEnv(): Promise<IsolatedEnv> {
	// Create unique temp dir: use crypto.randomUUID() for parallel safety
	const tempDir = join(process.env.TMPDIR ?? "/tmp", `ocx-test-${randomUUID()}`)

	// Create XDG subdirs
	await mkdir(join(tempDir, ".config"), { recursive: true })
	await mkdir(join(tempDir, ".local/share"), { recursive: true })
	await mkdir(join(tempDir, ".cache"), { recursive: true })

	// Build isolated env with allowlist
	const env: Record<string, string> = {
		// Inherited from host (allowlist)
		PATH: process.env.PATH ?? "",
		TMPDIR: process.env.TMPDIR ?? "/tmp",
		TERM: process.env.TERM ?? "dumb",
		NO_COLOR: "1",
		FORCE_COLOR: "0",
		// Bun paths if set - inherit from host to avoid re-installation
		...(process.env.BUN_INSTALL && { BUN_INSTALL: process.env.BUN_INSTALL }),
		...(process.env.BUNV_DIR && { BUNV_DIR: process.env.BUNV_DIR }),
		// Additional environment variables needed for Bun/more comprehensive testing
		...(process.env.HOME && { REAL_HOME: process.env.HOME }),
		...(process.env.SHELL && { SHELL: process.env.SHELL }),
		...(process.env.USER && { USER: process.env.USER }),
		...(process.env.LOGNAME && { LOGNAME: process.env.LOGNAME }),
		...(process.env.NODE_ENV && { NODE_ENV: process.env.NODE_ENV }),
		// Enable Bun auto-install (tests were working with this before)
		BUNV_AUTO_INSTALL: "1",
		// Forced values (deterministic locale)
		LANG: "C",
		LC_ALL: "C",
		// Constructed values (temp isolation)
		HOME: tempDir,
		XDG_CONFIG_HOME: join(tempDir, ".config"),
		XDG_DATA_HOME: join(tempDir, ".local/share"),
		XDG_CACHE_HOME: join(tempDir, ".cache"),
		// npm_config_user_agent is OMITTED entirely (not set to "")
	}

	// Cleanup function - best-effort, swallow ENOENT, warn on other errors
	const cleanup = async () => {
		try {
			await rm(tempDir, { recursive: true, force: true })
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				console.warn(`[ocx-test] Failed to cleanup temp dir ${tempDir}:`, error)
			}
		}
	}

	return { env, tempDir, cleanup }
}

/**
 * Run the CLI with the given arguments.
 * Uses isolation by default, with per-call temporary directories.
 */
export async function runCLI(
	args: string[],
	cwd: string,
	options?: RunCLIOptions,
): Promise<CLIResult> {
	const indexPath = join(import.meta.dir, "..", "src/index.ts")
	await mkdir(cwd, { recursive: true })

	// Early exit: skip isolation if inheritHostEnv is true
	if (options?.inheritHostEnv) {
		const env = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...options?.env }
		const proc = Bun.spawn(["bun", "run", indexPath, ...args], {
			cwd,
			env,
			stdout: "pipe",
			stderr: "pipe",
		})

		// Add timeout to prevent hanging
		const timeoutPromise = new Promise<number>((_, reject) => {
			setTimeout(() => reject(new Error("CLI execution timeout")), 45000)
		})

		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		])

		// Race between process completion and timeout
		const exitCode = await Promise.race([proc.exited, timeoutPromise])

		// Ensure process is fully cleaned up
		if (typeof proc.kill === "function") {
			proc.kill()
		}

		return { stdout, stderr, output: stdout + stderr, exitCode: exitCode as number }
	}

	// Default: isolated execution with per-call temp dir
	const isolated = await createIsolatedEnv()

	// Merge: isolated env + caller overrides (caller wins)
	const env: Record<string, string> = { ...isolated.env }
	if (options?.env) {
		for (const [key, value] of Object.entries(options.env)) {
			if (value !== undefined) {
				env[key] = value
			}
		}
	}

	// Disable auto-install only when no XDG_CONFIG_HOME override to prevent hanging
	// Profile tests override XDG_CONFIG_HOME and need auto-install enabled
	if (!options?.env?.XDG_CONFIG_HOME) {
		env.BUNV_AUTO_INSTALL = "0"
	}

	// If caller overrides XDG_CONFIG_HOME, ensure HOME is consistent
	if (options?.env?.XDG_CONFIG_HOME) {
		const xdgConfig = options.env.XDG_CONFIG_HOME
		// Set HOME to parent of XDG_CONFIG_HOME if it ends with .config
		// e.g., /tmp/test/.config -> HOME=/tmp/test
		// Otherwise just use the XDG_CONFIG_HOME value directly as the config root
		if (xdgConfig.endsWith("/.config")) {
			env.HOME = xdgConfig.slice(0, -"/.config".length)
		} else {
			// Test is using XDG_CONFIG_HOME directly as config root
			// Keep isolated HOME but ensure XDG takes precedence
		}
	}

	// Ensure NO_COLOR and FORCE_COLOR are always set (unless inheritHostEnv)
	env.NO_COLOR = "1"
	env.FORCE_COLOR = "0"

	try {
		const proc = Bun.spawn(["bun", "run", indexPath, ...args], {
			cwd,
			env,
			stdout: "pipe",
			stderr: "pipe",
		})

		// Add timeout to prevent hanging
		const timeoutPromise = new Promise<number>((_, reject) => {
			setTimeout(() => reject(new Error("CLI execution timeout")), 45000)
		})

		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		])

		// Race between process completion and timeout
		const exitCode = await Promise.race([proc.exited, timeoutPromise])

		// Ensure process is fully cleaned up
		if (typeof proc.kill === "function") {
			proc.kill()
		}

		return { stdout, stderr, output: stdout + stderr, exitCode: exitCode as number }
	} finally {
		await isolated.cleanup()
	}
}

/**
 * Create a temporary directory for tests.
 */
export async function createTempDir(name: string): Promise<string> {
	const dir = join(import.meta.dir, "fixtures", `tmp-${name}-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	return dir
}

/**
 * Clean up a temporary directory.
 */
export async function cleanupTempDir(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true })
}

/**
 * Parse JSONC content (JSON with comments).
 */
export function parseJsonc(content: string): unknown {
	return parse(content)
}

// =============================================================================
// Network Mocking Helpers
// =============================================================================

/**
 * Mock fetch to reject with an error (simulates DNS failure, connection refused, etc.)
 */
export function mockFetchError(error: Error): FetchMock {
	fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(error) as FetchMock
	return fetchMock
}

/**
 * Mock fetch to return a specific HTTP status code
 */
export function mockFetchStatus(status: number, statusText?: string, body?: string): FetchMock {
	fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(body ?? statusText ?? "", { status, statusText: statusText ?? "" }),
	) as FetchMock
	return fetchMock
}

/**
 * Mock fetch to return malformed JSON
 */
export function mockFetchMalformedJson(): FetchMock {
	fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
		new Response("not valid json {{{", {
			status: 200,
			headers: { "content-type": "application/json" },
		}),
	) as FetchMock
	return fetchMock
}

/**
 * Mock fetch to simulate a timeout (never resolves within reasonable time)
 */
export function mockFetchTimeout(_delayMs: number = 30000): FetchMock {
	// Create a promise that never resolves to simulate timeout
	const timeoutPromise = new Promise<Response>(() => {}) // eslint-disable-line @typescript-eslint/no-empty-function
	fetchMock = spyOn(globalThis, "fetch").mockReturnValue(timeoutPromise) as FetchMock
	return fetchMock
}

/**
 * Restore the original fetch function. Call in afterEach.
 */
export function restoreFetch(): void {
	fetchMock?.mockRestore()
	fetchMock = null
}

// =============================================================================
// Error Assertion Helpers
// =============================================================================

export interface ExpectOCXErrorOptions {
	exitCode: number
	code?: string
	messagePattern?: RegExp
}

/**
 * Assert CLI result is an error with expected exit code and optional message pattern.
 * Validates stderr contains expected content and stdout is empty.
 */
export function expectOCXError(result: CLIResult, options: ExpectOCXErrorOptions): void {
	expect(result.exitCode).toBe(options.exitCode)

	if (options.code) {
		expect(result.stderr.toLowerCase()).toContain(options.code.toLowerCase())
	}

	if (options.messagePattern) {
		expect(result.stderr).toMatch(options.messagePattern)
	}

	// Errors should go to stderr, not stdout (unless --json mode)
	if (!result.stdout.startsWith("{")) {
		expect(result.stdout.trim()).toBe("")
	}
}

export interface JsonErrorOutput {
	success: false
	error: {
		code: string
		message: string
		details?: Record<string, unknown>
	}
	exitCode: number
	meta: {
		timestamp: string
	}
}

export interface ExpectJsonErrorOptions {
	code: string
	exitCode: number
	details?: Record<string, unknown>
	messagePattern?: RegExp
}

/**
 * Parse and validate JSON error output from CLI.
 * Returns the parsed output for additional assertions.
 */
export function expectJsonError(output: string, options: ExpectJsonErrorOptions): JsonErrorOutput {
	let parsed: JsonErrorOutput
	try {
		// Strip ANSI codes that might contaminate JSON output
		const cleanOutput = stripAnsiCodes(output)
		parsed = JSON.parse(cleanOutput) as JsonErrorOutput
	} catch {
		throw new Error(`Failed to parse JSON error output: ${output}`)
	}

	expect(parsed.success).toBe(false)
	expect(parsed.error.code).toBe(options.code)
	expect(parsed.exitCode).toBe(options.exitCode)

	// Validate timestamp is ISO 8601
	expect(parsed.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)

	if (options.messagePattern) {
		expect(parsed.error.message).toMatch(options.messagePattern)
	}

	if (options.details) {
		expect(parsed.error.details).toMatchObject(options.details)
	}

	return parsed
}
