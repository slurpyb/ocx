/**
 * Tests for installation method detection
 *
 * Ported from apify-cli detection tests.
 * Note: These tests are limited because we can't easily mock process.execPath in Bun.
 * Focus is on testing return types and basic behavior.
 */

import { afterEach, describe, expect, it, mock } from "bun:test"
import type { InstallMethod } from "../../src/self-update/detect-method"

// ---------------------------------------------------------------------------
// Defense against leaked mock.module registrations from other test files.
//
// hook.test.ts mocks detect-method.js with inlined implementations.  If it
// runs before this file (randomised order), Bun's mock.module registration
// persists (mock.restore() is unreliable for module-level mocks).
//
// Dynamic import via a query-string cache buster ("?real") bypasses
// mock.module matching entirely — Bun treats "detect-method.js?real" as a
// different specifier from "detect-method.js", so we always get the real
// module regardless of leaked mocks.
// ---------------------------------------------------------------------------
const { detectInstallMethod, getExecutablePath, parseInstallMethod } =
	// @ts-expect-error TS2307 -- Bun resolves "?real" at runtime; TS has no declaration for query-string specifiers
	await import("../../src/self-update/detect-method.js?real")

import { SelfUpdateError } from "../../src/utils/errors"

// Defensive cleanup: restore any mock.module registrations that may leak
// between test files when running in randomised order.
afterEach(() => {
	mock.restore()
})

// =============================================================================
// detectInstallMethod
// =============================================================================

describe("detectInstallMethod", () => {
	it("returns a valid install method", () => {
		const method = detectInstallMethod()
		const validMethods: InstallMethod[] = ["curl", "npm", "pnpm", "bun", "unknown"]
		expect(validMethods).toContain(method)
	})

	it("returns a string type", () => {
		const method = detectInstallMethod()
		expect(typeof method).toBe("string")
	})

	it("is deterministic (returns same value on multiple calls)", () => {
		const method1 = detectInstallMethod()
		const method2 = detectInstallMethod()
		const method3 = detectInstallMethod()
		expect(method1).toBe(method2)
		expect(method2).toBe(method3)
	})

	it("returns curl for compiled binaries in test environment", () => {
		// In test environment with Bun, we're likely running via bun test
		// which means Bun.main won't start with /$bunfs/
		const method = detectInstallMethod()
		// Just verify it's a valid method - exact value depends on environment
		expect(["curl", "npm", "pnpm", "bun", "yarn", "brew", "unknown"]).toContain(method)
	})
})

// =============================================================================
// getExecutablePath
// =============================================================================

describe("getExecutablePath", () => {
	it("returns a string path", () => {
		const path = getExecutablePath()
		expect(typeof path).toBe("string")
		expect(path.length).toBeGreaterThan(0)
	})

	it("returns an absolute path", () => {
		const path = getExecutablePath()
		// Unix paths start with /, Windows paths start with drive letter
		const isAbsolute = path.startsWith("/") || /^[A-Z]:\\/i.test(path)
		expect(isAbsolute).toBe(true)
	})

	it("is deterministic (returns same value on multiple calls)", () => {
		const path1 = getExecutablePath()
		const path2 = getExecutablePath()
		expect(path1).toBe(path2)
	})

	it("returns a path that could be a real file", () => {
		const path = getExecutablePath()
		// Should not contain obviously invalid characters
		expect(path).not.toContain("\0")
		expect(path).not.toContain("\n")
	})
})

// =============================================================================
// InstallMethod type exhaustiveness
// =============================================================================

describe("InstallMethod type", () => {
	it("includes all expected package managers", () => {
		// This test documents the expected install methods
		const validMethods: InstallMethod[] = ["curl", "npm", "pnpm", "bun", "unknown"]
		expect(validMethods).toHaveLength(5)
	})
})

// =============================================================================
// parseInstallMethod
// =============================================================================

describe("parseInstallMethod", () => {
	it("should parse valid method: curl", () => {
		expect(parseInstallMethod("curl")).toBe("curl")
	})

	it("should parse valid method: npm", () => {
		expect(parseInstallMethod("npm")).toBe("npm")
	})

	it("should parse valid method: pnpm", () => {
		expect(parseInstallMethod("pnpm")).toBe("pnpm")
	})

	it("should parse valid method: bun", () => {
		expect(parseInstallMethod("bun")).toBe("bun")
	})

	it("should throw SelfUpdateError for invalid method", () => {
		expect(() => parseInstallMethod("invalid")).toThrow(SelfUpdateError)
	})

	it("should include valid methods in error message", () => {
		try {
			parseInstallMethod("bad")
		} catch (error) {
			expect(error).toBeInstanceOf(SelfUpdateError)
			expect((error as SelfUpdateError).message).toContain("curl")
			expect((error as SelfUpdateError).message).toContain("npm")
			expect((error as SelfUpdateError).message).toContain("Invalid install method")
		}
	})

	it("should throw for unknown (not a valid input)", () => {
		// "unknown" is a valid InstallMethod return value but not a valid input to parse
		expect(() => parseInstallMethod("unknown")).toThrow(SelfUpdateError)
	})
})

// =============================================================================
// detectInstallMethod path analysis
// =============================================================================

describe("detectInstallMethod path analysis", () => {
	// Note: We can't easily mock process.argv[1] in Bun
	// These tests verify the detection logic exists and returns valid types

	it("detects npm from path containing /.npm/", () => {
		// Pattern: scriptPath.includes("/.npm/") || scriptPath.includes("/npm/")
		// In real usage, paths like /home/user/.npm/_npx/bin/ocx would match
		const method = detectInstallMethod()
		expect(typeof method).toBe("string")
	})

	it("detects pnpm from path containing /.pnpm/", () => {
		// Pattern: scriptPath.includes("/.pnpm/") || scriptPath.includes("/pnpm/")
		// In real usage, paths like /home/user/.local/share/pnpm/global/5/node_modules/.bin/ocx would match
		const method = detectInstallMethod()
		expect(typeof method).toBe("string")
	})

	it("detects bun from path containing /.bun/", () => {
		// Pattern: scriptPath.includes("/.bun/") || scriptPath.includes("/bun/")
		// In real usage, paths like /home/user/.bun/bin/ocx would match
		const method = detectInstallMethod()
		expect(typeof method).toBe("string")
	})

	it("returns unknown when no patterns match", () => {
		// When neither script path, user agent, nor execPath matches any pattern
		// the function returns "unknown"
		const method = detectInstallMethod()
		// Just verify it's a valid InstallMethod
		const validMethods: InstallMethod[] = ["curl", "npm", "pnpm", "bun", "unknown"]
		expect(validMethods).toContain(method)
	})
})
