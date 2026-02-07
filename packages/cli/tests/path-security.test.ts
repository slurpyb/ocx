import { describe, expect, it } from "bun:test"
import { safeRelativePathSchema } from "../src/schemas/common"
import { isPathSafe, PathValidationError, validatePath } from "../src/utils/path-security"

describe("validatePath", () => {
	const base = "/trusted/base"

	// From Turborepo: allows paths within root
	describe("safe paths", () => {
		it("allows simple relative paths", () => {
			expect(isPathSafe(base, "file.txt")).toBe(true)
			expect(isPathSafe(base, "subdir/file.txt")).toBe(true)
			expect(isPathSafe(base, "a/b/c/file.txt")).toBe(true)
		})

		it("allows paths with .. that stay within root", () => {
			// foo/../bar resolves to just "bar" - still within root
			expect(isPathSafe(base, "foo/../bar")).toBe(true)
			expect(isPathSafe(base, "a/b/../c")).toBe(true)
		})

		// From Docker: file with dots (false positive prevention)
		it("allows files with dots in name", () => {
			expect(isPathSafe(base, "file..with.dots")).toBe(true)
			expect(isPathSafe(base, "..file")).toBe(true)
		})

		it("allows filenames with consecutive dots", () => {
			// Regression test: component..v2.ts should pass validation
			expect(isPathSafe(base, "component..v2.ts")).toBe(true)
			expect(isPathSafe(base, "src/component..v2.ts")).toBe(true)
			expect(isPathSafe(base, "lib/file..backup.js")).toBe(true)
		})
	})

	// From Turborepo: path traversal
	describe("path traversal attacks", () => {
		it("blocks basic traversal", () => {
			expect(isPathSafe(base, "../etc/passwd")).toBe(false)
			expect(isPathSafe(base, "../../etc/passwd")).toBe(false)
			expect(isPathSafe(base, "../../../etc/passwd")).toBe(false)
		})

		it("blocks traversal hidden in nested paths", () => {
			expect(isPathSafe(base, "foo/../../../etc/passwd")).toBe(false)
			expect(isPathSafe(base, "foo/bar/../../../etc/passwd")).toBe(false)
		})
	})

	// From resolve-path: null byte injection
	describe("null byte injection", () => {
		it("blocks paths with null bytes", () => {
			expect(() => validatePath(base, "file\0.txt")).toThrow(PathValidationError)
			expect(() => validatePath(base, "hi\0there")).toThrow(PathValidationError)
		})
	})

	// From Turborepo + resolve-path: absolute paths
	describe("absolute path injection", () => {
		it("blocks POSIX absolute paths", () => {
			expect(isPathSafe(base, "/etc/passwd")).toBe(false)
		})

		it("blocks Windows drive letters", () => {
			expect(isPathSafe(base, "C:\\Windows")).toBe(false)
			expect(isPathSafe(base, "D:\\")).toBe(false)
		})

		it("blocks UNC paths", () => {
			expect(isPathSafe(base, "\\\\server\\share")).toBe(false)
		})
	})

	// Windows reserved names
	describe("Windows reserved names", () => {
		it("blocks reserved device names", () => {
			expect(() => validatePath(base, "CON")).toThrow(PathValidationError)
			expect(() => validatePath(base, "NUL")).toThrow(PathValidationError)
			expect(() => validatePath(base, "foo/NUL.txt")).toThrow(PathValidationError)
		})
	})

	// Mixed separators
	describe("mixed separators", () => {
		it("normalizes backslashes", () => {
			// Should normalize and allow if safe
			expect(isPathSafe(base, "foo\\bar\\baz.txt")).toBe(true)
		})

		it("blocks traversal with backslashes", () => {
			expect(isPathSafe(base, "foo\\..\\..\\etc")).toBe(false)
		})
	})
})

describe("safeRelativePathSchema", () => {
	it("accepts valid relative paths", () => {
		expect(() => safeRelativePathSchema.parse("src/components")).not.toThrow()
		expect(() => safeRelativePathSchema.parse("lib/ui")).not.toThrow()
		expect(() => safeRelativePathSchema.parse("file.ts")).not.toThrow()
		expect(() => safeRelativePathSchema.parse(".opencode/agents")).not.toThrow()
	})

	it("accepts paths with dots in filenames", () => {
		expect(() => safeRelativePathSchema.parse("src/file.config.ts")).not.toThrow()
		expect(() => safeRelativePathSchema.parse(".hidden/file")).not.toThrow()
	})

	it("rejects path traversal with ..", () => {
		expect(() => safeRelativePathSchema.parse("../etc")).toThrow()
		expect(() => safeRelativePathSchema.parse("src/../../etc")).toThrow()
		expect(() => safeRelativePathSchema.parse("..")).toThrow()
	})

	it("rejects traversal in middle of path", () => {
		expect(() => safeRelativePathSchema.parse("src/../../../etc/passwd")).toThrow()
	})

	it("rejects absolute paths", () => {
		expect(() => safeRelativePathSchema.parse("/etc/passwd")).toThrow()
		expect(() => safeRelativePathSchema.parse("/usr/local/bin")).toThrow()
	})

	it("rejects null bytes", () => {
		expect(() => safeRelativePathSchema.parse("src\0/file")).toThrow()
		expect(() => safeRelativePathSchema.parse("file\0.ts")).toThrow()
	})

	it("rejects Windows-style traversal", () => {
		expect(() => safeRelativePathSchema.parse("..\\etc")).toThrow()
		expect(() => safeRelativePathSchema.parse("src\\..\\..\\etc")).toThrow()
	})

	it("rejects Windows UNC paths on any platform", () => {
		expect(() => safeRelativePathSchema.parse("\\\\server\\share")).toThrow()
		expect(() => safeRelativePathSchema.parse("\\\\server\\share\\file.txt")).toThrow()
	})

	it("rejects Windows drive paths on any platform", () => {
		expect(() => safeRelativePathSchema.parse("C:\\folder")).toThrow()
		expect(() => safeRelativePathSchema.parse("D:\\Users\\file.txt")).toThrow()
		expect(() => safeRelativePathSchema.parse("c:\\folder")).toThrow()
	})
})
