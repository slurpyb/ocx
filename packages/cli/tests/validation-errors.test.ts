import { describe, expect, it } from "bun:test"
import { categorizeValidationErrors } from "../src/utils/validation-errors"

describe("categorizeValidationErrors", () => {
	it("should categorize file errors", () => {
		const errors = [
			"comp-a: Source file not found at path/to/file.ts",
			"comp-b: Source file not found at another/file.ts",
		]

		const result = categorizeValidationErrors(errors)

		expect(result.file).toEqual(errors)
		expect(result.circular).toEqual([])
		expect(result.duplicate).toEqual([])
	})

	it("should categorize circular dependency errors", () => {
		const errors = ["Circular dependency detected: comp-a -> comp-b -> comp-a"]

		const result = categorizeValidationErrors(errors)

		expect(result.file).toEqual([])
		expect(result.circular).toEqual(errors)
		expect(result.duplicate).toEqual([])
	})

	it("should categorize duplicate target errors", () => {
		const errors = ['Duplicate target "plugins/test.ts" in components "comp-a" and "comp-b"']

		const result = categorizeValidationErrors(errors)

		expect(result.file).toEqual([])
		expect(result.circular).toEqual([])
		expect(result.duplicate).toEqual(errors)
	})

	it("should categorize mixed errors", () => {
		const errors = [
			"comp-a: Source file not found at file.ts",
			"Circular dependency detected: comp-a -> comp-b -> comp-a",
			'Duplicate target "plugins/test.ts" in components "comp-a" and "comp-b"',
			"comp-c: Source file not found at another.ts",
		]

		const result = categorizeValidationErrors(errors)

		expect(result.file).toEqual([
			"comp-a: Source file not found at file.ts",
			"comp-c: Source file not found at another.ts",
		])
		expect(result.circular).toEqual(["Circular dependency detected: comp-a -> comp-b -> comp-a"])
		expect(result.duplicate).toEqual([
			'Duplicate target "plugins/test.ts" in components "comp-a" and "comp-b"',
		])
	})

	it("should return empty arrays for empty input", () => {
		const result = categorizeValidationErrors([])

		expect(result.file).toEqual([])
		expect(result.circular).toEqual([])
		expect(result.duplicate).toEqual([])
	})
})
