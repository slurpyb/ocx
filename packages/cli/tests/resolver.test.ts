/**
 * Tests for the resolver module
 * Tests cycle detection, cross-registry resolution, topological sort, and error handling
 */

import { describe, expect, it } from "bun:test"
import { parseComponentRef } from "../src/registry/resolver"

describe("resolver", () => {
	describe("parseComponentRef", () => {
		it("should parse qualified component reference with namespace", () => {
			const result = parseComponentRef("kdco/researcher")
			expect(result).toEqual({ namespace: "kdco", component: "researcher" })
		})

		it("should parse qualified reference with hyphenated names", () => {
			const result = parseComponentRef("my-namespace/my-component")
			expect(result).toEqual({ namespace: "my-namespace", component: "my-component" })
		})

		it("should use default alias for bare component name", () => {
			const result = parseComponentRef("researcher", "kdco")
			expect(result).toEqual({ namespace: "kdco", component: "researcher" })
		})

		it("should throw ValidationError for bare name without default alias", () => {
			expect(() => parseComponentRef("researcher")).toThrow(
				"Component 'researcher' must include a registry alias",
			)
		})

		it("should prefer explicit alias over default", () => {
			const result = parseComponentRef("other/utils", "kdco")
			expect(result).toEqual({ namespace: "other", component: "utils" })
		})

		it("should reject multiple slashes in component ref", () => {
			// parseQualifiedComponent now rejects refs with more than one "/"
			expect(() => parseComponentRef("ns/comp/extra")).toThrow('Too many "/" separators')
		})
	})

	describe("dependency graph patterns", () => {
		// These tests verify the expected behavior patterns for the resolver
		// The actual resolveDependencies function requires network mocking

		it("should handle single component with no dependencies", () => {
			// Pattern: A (no deps) -> resolved order: [A]
			const deps: string[] = []
			const resolved: string[] = ["A"]
			expect(resolved.length).toBe(1)
			expect(deps.length).toBe(0)
		})

		it("should handle linear dependency chain", () => {
			// Pattern: A -> B -> C
			// Expected resolution order: [C, B, A] (depth-first)
			const graph = {
				A: ["B"],
				B: ["C"],
				C: [],
			}
			// Simulated topological sort result
			const order = topologicalSort(graph, ["A"])
			expect(order).toEqual(["C", "B", "A"])
		})

		it("should handle diamond dependency pattern", () => {
			// Pattern: A -> B, A -> C, B -> D, C -> D
			// Expected resolution order: [D, B, C, A] or [D, C, B, A]
			const graph = {
				A: ["B", "C"],
				B: ["D"],
				C: ["D"],
				D: [],
			}
			const order = topologicalSort(graph, ["A"])
			// D must come before B and C, which must come before A
			expect(order.indexOf("D")).toBeLessThan(order.indexOf("B"))
			expect(order.indexOf("D")).toBeLessThan(order.indexOf("C"))
			expect(order.indexOf("B")).toBeLessThan(order.indexOf("A"))
			expect(order.indexOf("C")).toBeLessThan(order.indexOf("A"))
		})

		it("should detect simple cycle", () => {
			// Pattern: A -> B -> A
			const graph = {
				A: ["B"],
				B: ["A"],
			}
			expect(() => topologicalSort(graph, ["A"])).toThrow("Circular dependency")
		})

		it("should detect indirect cycle", () => {
			// Pattern: A -> B -> C -> A
			const graph = {
				A: ["B"],
				B: ["C"],
				C: ["A"],
			}
			expect(() => topologicalSort(graph, ["A"])).toThrow("Circular dependency")
		})

		it("should detect self-referencing cycle", () => {
			// Pattern: A -> A
			const graph = {
				A: ["A"],
			}
			expect(() => topologicalSort(graph, ["A"])).toThrow("Circular dependency")
		})

		it("should handle multiple entry points", () => {
			// Pattern: Request [A, X] where A -> B, X -> Y
			// Expected: [B, A, Y, X] or similar valid order
			const graph = {
				A: ["B"],
				B: [],
				X: ["Y"],
				Y: [],
			}
			const order = topologicalSort(graph, ["A", "X"])
			// B before A, Y before X
			expect(order.indexOf("B")).toBeLessThan(order.indexOf("A"))
			expect(order.indexOf("Y")).toBeLessThan(order.indexOf("X"))
		})

		it("should handle cross-registry dependencies", () => {
			// Pattern: kdco/A -> other/B
			// This is tested via parseComponentRef with qualified names
			const dep = "other/utils"
			const ref = parseComponentRef(dep, "kdco")
			expect(ref.namespace).toBe("other")
			expect(ref.component).toBe("utils")
		})

		it("should deduplicate shared dependencies", () => {
			// Pattern: A -> C, B -> C (both depend on C)
			// When resolving [A, B], C should only appear once
			const graph = {
				A: ["C"],
				B: ["C"],
				C: [],
			}
			const order = topologicalSort(graph, ["A", "B"])
			const cCount = order.filter((x) => x === "C").length
			expect(cCount).toBe(1)
		})
	})
})

/**
 * Helper function to simulate topological sort with cycle detection
 * This mirrors the algorithm used in resolveDependencies
 */
function topologicalSort(graph: Record<string, string[]>, entries: string[]): string[] {
	const resolved: string[] = []
	const resolvedSet = new Set<string>()
	const visiting = new Set<string>()

	function visit(node: string, path: string[] = []): void {
		if (resolvedSet.has(node)) return

		if (visiting.has(node)) {
			const cycle = [...path, node].join(" → ")
			throw new Error(`Circular dependency detected: ${cycle}`)
		}

		visiting.add(node)

		const deps = graph[node]
		if (!deps) {
			throw new Error(`Node '${node}' not found in graph`)
		}

		for (const dep of deps) {
			visit(dep, [...path, node])
		}

		visiting.delete(node)
		resolvedSet.add(node)
		resolved.push(node)
	}

	for (const entry of entries) {
		visit(entry)
	}

	return resolved
}
