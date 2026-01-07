/**
 * Tests for dependency version conflict detection
 * Tests component conflicts, package.json conflicts, and sorting behavior
 */

import { describe, expect, it } from "bun:test"
import { detectVersionConflicts } from "../src/commands/add"
import type { ResolvedNpmDependency } from "../src/registry/resolver"

describe("detectVersionConflicts", () => {
	it("should return empty array when no conflicts", () => {
		const resolved: ResolvedNpmDependency[] = [
			{ kind: "pinned", name: "zod", version: "^4.3.5", declaredBy: "kdco/component-a" },
			{ kind: "pinned", name: "zod", version: "^4.3.5", declaredBy: "kdco/component-b" },
		]
		const existing = {}

		const conflicts = detectVersionConflicts(resolved, existing)

		expect(conflicts).toEqual([])
	})

	it("should detect conflict between resolved components", () => {
		const resolved: ResolvedNpmDependency[] = [
			{ kind: "pinned", name: "zod", version: "^3.0.0", declaredBy: "kdco/component-a" },
			{ kind: "pinned", name: "zod", version: "^4.0.0", declaredBy: "kdco/component-b" },
		]
		const existing = {}

		const conflicts = detectVersionConflicts(resolved, existing)

		expect(conflicts).toHaveLength(1)
		expect(conflicts[0].packageName).toBe("zod")
		expect(conflicts[0].versions).toHaveLength(2)
		expect(conflicts[0].versions.map((v) => v.version)).toContain("^3.0.0")
		expect(conflicts[0].versions.map((v) => v.version)).toContain("^4.0.0")
	})

	it("should detect conflict with existing package.json", () => {
		const resolved: ResolvedNpmDependency[] = [
			{ kind: "pinned", name: "zod", version: "^4.0.0", declaredBy: "kdco/component-a" },
		]
		const existing = { zod: "^3.0.0" }

		const conflicts = detectVersionConflicts(resolved, existing)

		expect(conflicts).toHaveLength(1)
		expect(conflicts[0].packageName).toBe("zod")
		expect(conflicts[0].versions).toHaveLength(2)
		expect(conflicts[0].versions.some((v) => v.source.includes("package.json"))).toBe(true)
	})

	it("should not flag bare deps as conflicts", () => {
		const resolved: ResolvedNpmDependency[] = [
			{ kind: "bare", name: "zod", declaredBy: "kdco/component-a" },
			{ kind: "pinned", name: "zod", version: "^4.0.0", declaredBy: "kdco/component-b" },
		]
		const existing = {}

		const conflicts = detectVersionConflicts(resolved, existing)

		// bare deps don't have versions, so they shouldn't cause conflicts
		expect(conflicts).toEqual([])
	})

	it("should not flag bare deps against existing package.json", () => {
		const resolved: ResolvedNpmDependency[] = [
			{ kind: "bare", name: "zod", declaredBy: "kdco/component-a" },
		]
		const existing = { zod: "^4.0.0" }

		const conflicts = detectVersionConflicts(resolved, existing)

		expect(conflicts).toEqual([])
	})

	it("should sort component conflicts before package.json conflicts", () => {
		const resolved: ResolvedNpmDependency[] = [
			// Component-only conflict (lodash)
			{ kind: "pinned", name: "lodash", version: "^4.17.0", declaredBy: "kdco/component-a" },
			{ kind: "pinned", name: "lodash", version: "^4.18.0", declaredBy: "kdco/component-b" },
			// Package.json conflict (react)
			{ kind: "pinned", name: "react", version: "^19.0.0", declaredBy: "kdco/component-c" },
		]
		const existing = { react: "^18.0.0" }

		const conflicts = detectVersionConflicts(resolved, existing)

		expect(conflicts).toHaveLength(2)
		// Component-only conflict should come first
		expect(conflicts[0].packageName).toBe("lodash")
		// Package.json conflict should come second
		expect(conflicts[1].packageName).toBe("react")
	})

	it("should handle catalog deps the same as pinned deps", () => {
		const resolved: ResolvedNpmDependency[] = [
			{
				kind: "catalog",
				name: "zod",
				version: "^4.3.5",
				catalogKey: "zod",
				declaredBy: "kdco/component-a",
			},
			{ kind: "pinned", name: "zod", version: "^3.0.0", declaredBy: "kdco/component-b" },
		]
		const existing = {}

		const conflicts = detectVersionConflicts(resolved, existing)

		expect(conflicts).toHaveLength(1)
		expect(conflicts[0].packageName).toBe("zod")
		// Should include catalog source in the version info
		expect(conflicts[0].versions.some((v) => v.source.includes("catalog:"))).toBe(true)
	})

	it("should handle multiple packages with conflicts", () => {
		const resolved: ResolvedNpmDependency[] = [
			{ kind: "pinned", name: "zod", version: "^3.0.0", declaredBy: "kdco/component-a" },
			{ kind: "pinned", name: "zod", version: "^4.0.0", declaredBy: "kdco/component-b" },
			{ kind: "pinned", name: "react", version: "^18.0.0", declaredBy: "kdco/component-a" },
			{ kind: "pinned", name: "react", version: "^19.0.0", declaredBy: "kdco/component-c" },
		]
		const existing = {}

		const conflicts = detectVersionConflicts(resolved, existing)

		expect(conflicts).toHaveLength(2)
		const packageNames = conflicts.map((c) => c.packageName).sort()
		expect(packageNames).toEqual(["react", "zod"])
	})

	it("should not flag identical versions as conflicts", () => {
		const resolved: ResolvedNpmDependency[] = [
			{ kind: "pinned", name: "zod", version: "^4.3.5", declaredBy: "kdco/component-a" },
			{ kind: "pinned", name: "zod", version: "^4.3.5", declaredBy: "kdco/component-b" },
		]
		const existing = { zod: "^4.3.5" }

		const conflicts = detectVersionConflicts(resolved, existing)

		expect(conflicts).toEqual([])
	})

	it("should handle empty resolved array", () => {
		const resolved: ResolvedNpmDependency[] = []
		const existing = { zod: "^4.3.5" }

		const conflicts = detectVersionConflicts(resolved, existing)

		expect(conflicts).toEqual([])
	})

	it("should handle empty existing deps", () => {
		const resolved: ResolvedNpmDependency[] = [
			{ kind: "pinned", name: "zod", version: "^4.3.5", declaredBy: "kdco/component-a" },
		]
		const existing = {}

		const conflicts = detectVersionConflicts(resolved, existing)

		expect(conflicts).toEqual([])
	})

	it("should sort conflicts alphabetically within each group", () => {
		const resolved: ResolvedNpmDependency[] = [
			{ kind: "pinned", name: "zod", version: "^3.0.0", declaredBy: "kdco/component-a" },
			{ kind: "pinned", name: "zod", version: "^4.0.0", declaredBy: "kdco/component-b" },
			{ kind: "pinned", name: "axios", version: "^1.0.0", declaredBy: "kdco/component-a" },
			{ kind: "pinned", name: "axios", version: "^2.0.0", declaredBy: "kdco/component-b" },
		]
		const existing = {}

		const conflicts = detectVersionConflicts(resolved, existing)

		expect(conflicts).toHaveLength(2)
		// Component conflicts should be sorted alphabetically
		expect(conflicts[0].packageName).toBe("axios")
		expect(conflicts[1].packageName).toBe("zod")
	})
})
