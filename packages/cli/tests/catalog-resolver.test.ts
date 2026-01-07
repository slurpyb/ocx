/**
 * Tests for catalog resolution in the dependency resolver
 * Tests catalog:X expansion, pinned deps, bare deps, and scoped packages
 */

import { describe, expect, it } from "bun:test"
import { resolveDependencySpec } from "../src/registry/resolver"
import { ValidationError } from "../src/utils/errors"

describe("catalog resolution", () => {
	describe("resolveDependencySpec", () => {
		it("should expand catalog:X to version from catalog", () => {
			const catalog = { zod: "^4.3.5", lodash: "^4.17.21" }
			const result = resolveDependencySpec("catalog:zod", catalog, "kdco/test-component")

			expect(result.kind).toBe("catalog")
			expect(result.name).toBe("zod")
			if (result.kind === "catalog") {
				expect(result.version).toBe("^4.3.5")
				expect(result.catalogKey).toBe("zod")
			}
			expect(result.declaredBy).toBe("kdco/test-component")
		})

		it("should throw ValidationError for missing catalog entry", () => {
			const catalog = { zod: "^4.3.5" }

			expect(() => {
				resolveDependencySpec("catalog:nonexistent", catalog, "kdco/test-component")
			}).toThrow(ValidationError)

			expect(() => {
				resolveDependencySpec("catalog:nonexistent", catalog, "kdco/test-component")
			}).toThrow('Catalog reference "catalog:nonexistent" not found in registry')
		})

		it("should throw ValidationError when catalog is undefined", () => {
			expect(() => {
				resolveDependencySpec("catalog:zod", undefined, "kdco/test-component")
			}).toThrow(ValidationError)
		})

		it("should throw ValidationError when catalog is empty", () => {
			expect(() => {
				resolveDependencySpec("catalog:zod", {}, "kdco/test-component")
			}).toThrow(ValidationError)

			expect(() => {
				resolveDependencySpec("catalog:zod", {}, "kdco/test-component")
			}).toThrow("Available catalog entries:")
		})

		it("should parse pinned dependency (name@version)", () => {
			const result = resolveDependencySpec("lodash@4.17.21", undefined, "kdco/test-component")

			expect(result.kind).toBe("pinned")
			expect(result.name).toBe("lodash")
			if (result.kind === "pinned") {
				expect(result.version).toBe("4.17.21")
			}
			expect(result.declaredBy).toBe("kdco/test-component")
		})

		it("should parse pinned dependency with semver range", () => {
			const result = resolveDependencySpec("zod@^4.3.5", undefined, "kdco/test-component")

			expect(result.kind).toBe("pinned")
			expect(result.name).toBe("zod")
			if (result.kind === "pinned") {
				expect(result.version).toBe("^4.3.5")
			}
		})

		it("should parse bare dependency (name only)", () => {
			const result = resolveDependencySpec("lodash", undefined, "kdco/test-component")

			expect(result.kind).toBe("bare")
			expect(result.name).toBe("lodash")
			expect(result.declaredBy).toBe("kdco/test-component")
		})

		it("should handle scoped packages with pinned version", () => {
			const result = resolveDependencySpec("@types/node@20.0.0", undefined, "kdco/test-component")

			expect(result.kind).toBe("pinned")
			expect(result.name).toBe("@types/node")
			if (result.kind === "pinned") {
				expect(result.version).toBe("20.0.0")
			}
		})

		it("should handle scoped packages with semver range", () => {
			const result = resolveDependencySpec(
				"@ai-sdk/openai@^1.0.0",
				undefined,
				"kdco/test-component",
			)

			expect(result.kind).toBe("pinned")
			expect(result.name).toBe("@ai-sdk/openai")
			if (result.kind === "pinned") {
				expect(result.version).toBe("^1.0.0")
			}
		})

		it("should handle bare scoped packages", () => {
			const result = resolveDependencySpec("@types/node", undefined, "kdco/test-component")

			expect(result.kind).toBe("bare")
			expect(result.name).toBe("@types/node")
		})

		it("should list available catalog entries in error message", () => {
			const catalog = { zod: "^4.3.5", lodash: "^4.17.21", react: "^19.0.0" }

			try {
				resolveDependencySpec("catalog:nonexistent", catalog, "kdco/test-component")
				expect.unreachable("Should have thrown")
			} catch (error) {
				expect(error).toBeInstanceOf(ValidationError)
				const message = (error as ValidationError).message
				expect(message).toContain("zod")
				expect(message).toContain("lodash")
				expect(message).toContain("react")
			}
		})

		it("should throw ValidationError for empty version in pinned dep", () => {
			expect(() => {
				resolveDependencySpec("lodash@", undefined, "kdco/test")
			}).toThrow("Invalid dependency specifier")
		})

		it("should throw ValidationError for empty version in scoped package", () => {
			expect(() => {
				resolveDependencySpec("@types/node@", undefined, "kdco/test")
			}).toThrow("Invalid dependency specifier")
		})
	})
})
