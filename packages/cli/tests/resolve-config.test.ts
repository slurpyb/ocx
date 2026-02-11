import { describe, expect, it } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { ConfigError } from "../src/utils/errors"
import {
	resolveConfigPatterns,
	resolveEnvVars,
	resolveFilePatterns,
} from "../src/utils/resolve-config"

// =============================================================================
// HELPERS
// =============================================================================

async function createTmpDir(name: string): Promise<string> {
	const dir = join(import.meta.dir, "fixtures", `tmp-resolve-${name}-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	return dir
}

// =============================================================================
// resolveEnvVars
// =============================================================================

describe("resolveEnvVars", () => {
	it("replaces a single env token", () => {
		const result = resolveEnvVars('{"key": "{env:MY_VAR}"}', { MY_VAR: "hello" })
		expect(result).toBe('{"key": "hello"}')
	})

	it("replaces multiple env tokens", () => {
		const result = resolveEnvVars('{"a": "{env:X}", "b": "{env:Y}"}', {
			X: "alpha",
			Y: "beta",
		})
		expect(result).toBe('{"a": "alpha", "b": "beta"}')
	})

	it("replaces missing env var with empty string", () => {
		const result = resolveEnvVars('{"key": "{env:MISSING}"}', {})
		expect(result).toBe('{"key": ""}')
	})

	it("replaces undefined env var with empty string", () => {
		const result = resolveEnvVars('{"key": "{env:UNDEF}"}', { UNDEF: undefined })
		expect(result).toBe('{"key": ""}')
	})

	it("leaves text without tokens unchanged", () => {
		const input = '{"key": "plain value"}'
		const result = resolveEnvVars(input, {})
		expect(result).toBe(input)
	})

	it("handles token at start and end of string", () => {
		const result = resolveEnvVars("{env:A}middle{env:B}", { A: "start", B: "end" })
		expect(result).toBe("startmiddleend")
	})

	it("JSON-escapes env values with quotes, backslashes, and newlines", () => {
		const dangerous = 'has "quotes" and \\backslash\\ and\nnewlines\there'
		const input = '{"key": "{env:DANGER}"}'
		const result = resolveEnvVars(input, { DANGER: dangerous })
		// Result must be parseable JSON with the original value preserved
		const parsed = JSON.parse(result)
		expect(parsed.key).toBe(dangerous)
	})
})

// =============================================================================
// resolveFilePatterns
// =============================================================================

describe("resolveFilePatterns", () => {
	it("replaces file token with relative path", async () => {
		const dir = await createTmpDir("file-relative")
		try {
			await writeFile(join(dir, "secret.txt"), "my-api-key")

			const result = resolveFilePatterns('{"key": "{file:secret.txt}"}', dir)
			expect(result).toBe('{"key": "my-api-key"}')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("resolves ~/path via home directory expansion", async () => {
		// Use a file that is very likely to exist in the home directory
		// Create a temp file in the home directory for this test
		const tmpFile = join(homedir(), `.ocx-test-resolve-${Date.now()}.txt`)
		try {
			await writeFile(tmpFile, "home-content")

			const filename = tmpFile.slice(homedir().length + 1) // strip home dir + /
			const result = resolveFilePatterns(`{"key": "{file:~/${filename}}"}`, "/tmp")
			expect(result).toBe('{"key": "home-content"}')
		} finally {
			await rm(tmpFile, { force: true })
		}
	})

	it("JSON-escapes file content with special characters", async () => {
		const dir = await createTmpDir("file-escape")
		try {
			const dangerousContent = 'line1\nline2\t"quoted"\\'
			await writeFile(join(dir, "special.txt"), dangerousContent)

			const result = resolveFilePatterns('{"key": "{file:special.txt}"}', dir)
			// The result should be valid when parsed as part of a JSON string
			const parsed = JSON.parse(result)
			expect(parsed.key).toBe(dangerousContent.trim())
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("trims file content whitespace", async () => {
		const dir = await createTmpDir("file-trim")
		try {
			await writeFile(join(dir, "padded.txt"), "  trimmed  \n\n")

			const result = resolveFilePatterns('{"key": "{file:padded.txt}"}', dir)
			expect(result).toBe('{"key": "trimmed"}')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("throws ConfigError for missing file", async () => {
		const dir = await createTmpDir("file-missing")
		try {
			expect(() => resolveFilePatterns('{"key": "{file:nonexistent.txt}"}', dir)).toThrow(
				ConfigError,
			)

			expect(() => resolveFilePatterns('{"key": "{file:nonexistent.txt}"}', dir)).toThrow(
				/Failed to resolve config file token/,
			)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("returns text unchanged when no file tokens present", async () => {
		const input = '{"key": "no tokens here"}'
		const result = resolveFilePatterns(input, "/tmp")
		expect(result).toBe(input)
	})

	it("resolves absolute path as-is", async () => {
		const dir = await createTmpDir("file-absolute")
		try {
			const absoluteFile = join(dir, "abs.txt")
			await writeFile(absoluteFile, "absolute-content")

			const result = resolveFilePatterns(`{"key": "{file:${absoluteFile}}"}`, "/other")
			expect(result).toBe('{"key": "absolute-content"}')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("replaces duplicate {file:same-path} occurrences correctly", async () => {
		const dir = await createTmpDir("file-duplicate")
		try {
			await writeFile(join(dir, "token.txt"), "shared-secret")

			const input = '{"a": "{file:token.txt}", "b": "{file:token.txt}", "c": "{file:token.txt}"}'
			const result = resolveFilePatterns(input, dir)
			expect(result).toBe('{"a": "shared-secret", "b": "shared-secret", "c": "shared-secret"}')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("does NOT re-substitute {file:...} tokens inside injected file content", async () => {
		const dir = await createTmpDir("file-no-resubstitution")
		try {
			// trap.txt itself contains a {file:...} token — must stay literal
			await writeFile(join(dir, "trap.txt"), "{file:secret.txt}")
			await writeFile(join(dir, "secret.txt"), "SHOULD_NOT_APPEAR")

			const result = resolveFilePatterns('{"key": "{file:trap.txt}"}', dir)
			const parsed = JSON.parse(result)
			expect(parsed.key).toBe("{file:secret.txt}")
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("does NOT re-substitute {env:...} tokens inside injected file content", async () => {
		const dir = await createTmpDir("file-no-env-resubstitution")
		try {
			// File content contains an env token — must stay literal after file resolution
			await writeFile(join(dir, "envtrap.txt"), "{env:SECRET_VAR}")

			const result = resolveFilePatterns('{"key": "{file:envtrap.txt}"}', dir)
			const parsed = JSON.parse(result)
			expect(parsed.key).toBe("{env:SECRET_VAR}")
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})

// =============================================================================
// resolveConfigPatterns (end-to-end)
// =============================================================================

describe("resolveConfigPatterns", () => {
	it("resolves both env and file tokens in one pass", async () => {
		const dir = await createTmpDir("combined")
		try {
			await writeFile(join(dir, "key.txt"), "file-secret")

			const input = '{"api": "{env:API_KEY}", "cert": "{file:key.txt}"}'
			const result = resolveConfigPatterns(input, dir, { API_KEY: "env-secret" })
			expect(result).toBe('{"api": "env-secret", "cert": "file-secret"}')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("resolves env tokens before file tokens", async () => {
		const dir = await createTmpDir("order")
		try {
			await writeFile(join(dir, "data.txt"), "file-value")

			// env resolved first, then file
			const input = '{"env": "{env:VAR}", "file": "{file:data.txt}"}'
			const result = resolveConfigPatterns(input, dir, { VAR: "env-value" })

			const parsed = JSON.parse(result)
			expect(parsed.env).toBe("env-value")
			expect(parsed.file).toBe("file-value")
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("handles text with no tokens at all", async () => {
		const input = '{"plain": "value"}'
		const result = resolveConfigPatterns(input, "/tmp", {})
		expect(result).toBe(input)
	})

	it("does NOT re-substitute tokens injected by file content (end-to-end)", async () => {
		const dir = await createTmpDir("combined-no-resubstitution")
		try {
			// File content contains both {file:...} and {env:...} tokens
			await writeFile(join(dir, "trap.txt"), "{file:secret.txt} and {env:SECRET}")
			await writeFile(join(dir, "secret.txt"), "SHOULD_NOT_APPEAR")

			const input = '{"val": "{file:trap.txt}"}'
			const result = resolveConfigPatterns(input, dir, { SECRET: "LEAKED" })
			const parsed = JSON.parse(result)
			// File content must be preserved verbatim — no second-pass resolution
			expect(parsed.val).toBe("{file:secret.txt} and {env:SECRET}")
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})
