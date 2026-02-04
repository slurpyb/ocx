import { describe, expect, it } from "bun:test"
import { mergeOpencodeConfig } from "../../src/registry/merge"
import type { NormalizedOpencodeConfig } from "../../src/schemas/registry"

describe("OpenCode config merge consistency", () => {
	it("concatenates plugin arrays", () => {
		const target: NormalizedOpencodeConfig = { plugin: ["npm:a"] }
		const source: NormalizedOpencodeConfig = { plugin: ["npm:b"] }
		const result = mergeOpencodeConfig(target, source)
		expect(result.plugin).toEqual(["npm:a", "npm:b"])
	})

	it("concatenates instructions arrays", () => {
		const target: NormalizedOpencodeConfig = { instructions: ["a.md"] }
		const source: NormalizedOpencodeConfig = { instructions: ["b.md"] }
		const result = mergeOpencodeConfig(target, source)
		expect(result.instructions).toEqual(["a.md", "b.md"])
	})

	it("deduplicates merged arrays", () => {
		const target: NormalizedOpencodeConfig = { plugin: ["npm:a", "npm:b"] }
		const source: NormalizedOpencodeConfig = { plugin: ["npm:b", "npm:c"] }
		const result = mergeOpencodeConfig(target, source)
		expect(result.plugin).toEqual(["npm:a", "npm:b", "npm:c"])
	})

	it("preserves array when other side is non-array", () => {
		const target: NormalizedOpencodeConfig = { plugin: ["npm:a"] }
		const source = { plugin: "invalid" as unknown }
		const result = mergeOpencodeConfig(target, source as NormalizedOpencodeConfig)
		expect(result.plugin).toEqual(["npm:a"])
	})

	it("preserves array when other side is undefined", () => {
		const target: NormalizedOpencodeConfig = { plugin: ["npm:a"] }
		const source: NormalizedOpencodeConfig = {}
		const result = mergeOpencodeConfig(target, source)
		expect(result.plugin).toEqual(["npm:a"])
	})

	it("uses source array when target is undefined", () => {
		const target: NormalizedOpencodeConfig = {}
		const source: NormalizedOpencodeConfig = { plugin: ["npm:b"] }
		const result = mergeOpencodeConfig(target, source)
		expect(result.plugin).toEqual(["npm:b"])
	})
})
