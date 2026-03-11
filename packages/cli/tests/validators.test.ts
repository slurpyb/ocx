import { describe, expect, it } from "bun:test"
import { validateRegistrySource } from "../src/lib/validators"

describe("validateRegistrySource", () => {
	describe("schema validation", () => {
		it("should validate a valid registry schema", () => {
			const validRegistry = {
				$schema: "https://ocx.kdco.dev/schemas/v2/registry.json",
				name: "Test Registry",
				namespace: "test",
				version: "1.0.0",
				author: "Test Author",
				components: [],
			}

			const result = validateRegistrySource(validRegistry, "/fake/path")

			expect(result.valid).toBe(true)
			expect(result.errors).toEqual([])
		})
	})
})
