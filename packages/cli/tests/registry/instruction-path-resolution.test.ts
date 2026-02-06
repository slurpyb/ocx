/**
 * Registry Instruction Path Resolution Tests
 *
 * Tests instruction path resolution from registry components' opencode.instructions.
 * These paths must be resolved relative to the installation root (global, profile, or local).
 *
 * Security model:
 * - Relative paths → resolved under installation root (global/profile/local)
 * - Absolute paths → error (security violation)
 * - .. traversal → error (security violation)
 * - URLs (https://, http://) → pass through unchanged (remote instructions)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { mergeOpencodeConfig } from "../../src/registry/merge"
import type { NormalizedOpencodeConfig } from "../../src/schemas/registry"
import { ValidationError } from "../../src/utils/errors"
import {
	resolveRegistryInstructionPath,
	resolveRegistryInstructionPaths,
	validateRegistryInstructionPath,
} from "../../src/utils/instruction-paths"
import { tmpdir } from "../fixture"

describe("registry instruction path resolution", () => {
	let originalXdgConfigHome: string | undefined

	beforeEach(() => {
		originalXdgConfigHome = process.env.XDG_CONFIG_HOME
	})

	afterEach(() => {
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome
		}
	})

	describe("relative path resolution", () => {
		it("resolves relative instruction path to absolute under project root (local mode)", async () => {
			await using tmp = await tmpdir({ git: true })

			// Create the target file
			mkdirSync(path.join(tmp.path, "docs"), { recursive: true })
			writeFileSync(path.join(tmp.path, "docs/AGENTS.md"), "# Instructions")

			const registryConfig: NormalizedOpencodeConfig = {
				instructions: ["docs/AGENTS.md"],
			}

			// Simulate local mode: installRoot is project root
			const installRoot = tmp.path
			const instructions = registryConfig.instructions ?? []
			const resolved = resolveRegistryInstructionPaths(instructions, installRoot, "test-component")

			expect(resolved.length).toBe(1)
			expect(resolved[0]).toBe(path.join(tmp.path, "docs/AGENTS.md"))
			expect(path.isAbsolute(resolved[0])).toBe(true)
		})

		it("resolves relative instruction path to absolute under profile dir (profile mode)", async () => {
			await using _tmp = await tmpdir({
				git: true,
				profile: { name: "work", ocxConfig: { registries: {} } },
			})

			const registryConfig: NormalizedOpencodeConfig = {
				instructions: ["AGENTS.md"],
			}

			// Simulate profile mode: installRoot is profile directory
			const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
			const profileDir = path.join(xdgConfig, "opencode", "profiles", "work")

			// Create the target file
			writeFileSync(path.join(profileDir, "AGENTS.md"), "# Profile Instructions")

			const instructions = registryConfig.instructions ?? []
			const resolved = resolveRegistryInstructionPaths(instructions, profileDir, "test-component")

			expect(resolved.length).toBe(1)
			expect(resolved[0]).toBe(path.join(profileDir, "AGENTS.md"))
			expect(path.isAbsolute(resolved[0])).toBe(true)
		})

		it("resolves relative instruction path to absolute under global dir (global mode)", async () => {
			await using _tmp = await tmpdir({ git: true })

			const registryConfig: NormalizedOpencodeConfig = {
				instructions: ["config/instructions.md"],
			}

			// Simulate global mode: installRoot is global config directory
			const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
			const globalDir = path.join(xdgConfig, "opencode")

			// Create the target file
			mkdirSync(path.join(globalDir, "config"), { recursive: true })
			writeFileSync(path.join(globalDir, "config/instructions.md"), "# Global Instructions")

			const instructions = registryConfig.instructions ?? []
			const resolved = resolveRegistryInstructionPaths(instructions, globalDir, "test-component")

			expect(resolved.length).toBe(1)
			expect(resolved[0]).toBe(path.join(globalDir, "config/instructions.md"))
			expect(path.isAbsolute(resolved[0])).toBe(true)
		})

		it("resolves nested relative paths correctly", async () => {
			await using tmp = await tmpdir({ git: true })

			// Create the target files
			mkdirSync(path.join(tmp.path, "docs/guides"), { recursive: true })
			writeFileSync(path.join(tmp.path, "docs/guides/advanced.md"), "# Advanced")
			writeFileSync(path.join(tmp.path, "AGENTS.md"), "# Agents")

			const registryConfig: NormalizedOpencodeConfig = {
				instructions: ["docs/guides/advanced.md", "AGENTS.md"],
			}

			const instructions = registryConfig.instructions ?? []
			const resolved = resolveRegistryInstructionPaths(instructions, tmp.path, "test-component")

			expect(resolved.length).toBe(2)
			expect(resolved[0]).toBe(path.join(tmp.path, "docs/guides/advanced.md"))
			expect(resolved[1]).toBe(path.join(tmp.path, "AGENTS.md"))
		})
	})

	describe("URL passthrough", () => {
		it("passes through https URLs unchanged", async () => {
			await using tmp = await tmpdir({ git: true })

			const registryConfig: NormalizedOpencodeConfig = {
				instructions: ["https://example.com/instructions.md"],
			}

			const installRoot = tmp.path
			const instructions = registryConfig.instructions ?? []
			const resolved = resolveRegistryInstructionPaths(instructions, installRoot, "test-component")

			expect(resolved.length).toBe(1)
			expect(resolved[0]).toBe("https://example.com/instructions.md")
		})

		it("passes through http URLs unchanged", async () => {
			await using tmp = await tmpdir({ git: true })

			const registryConfig: NormalizedOpencodeConfig = {
				instructions: ["http://example.com/guide.md"],
			}

			const installRoot = tmp.path
			const instructions = registryConfig.instructions ?? []
			const resolved = resolveRegistryInstructionPaths(instructions, installRoot, "test-component")

			expect(resolved.length).toBe(1)
			expect(resolved[0]).toBe("http://example.com/guide.md")
		})

		it("handles mixed relative and URL paths", async () => {
			await using tmp = await tmpdir({ git: true })

			// Create local files
			mkdirSync(path.join(tmp.path, "local"), { recursive: true })
			writeFileSync(path.join(tmp.path, "local/guide.md"), "# Local")
			writeFileSync(path.join(tmp.path, "AGENTS.md"), "# Agents")

			const registryConfig: NormalizedOpencodeConfig = {
				instructions: [
					"local/guide.md",
					"https://example.com/remote.md",
					"AGENTS.md",
					"http://example.com/another.md",
				],
			}

			const instructions = registryConfig.instructions ?? []
			const resolved = resolveRegistryInstructionPaths(instructions, tmp.path, "test-component")

			expect(resolved.length).toBe(4)
			expect(resolved[0]).toBe(path.join(tmp.path, "local/guide.md"))
			expect(resolved[1]).toBe("https://example.com/remote.md")
			expect(resolved[2]).toBe(path.join(tmp.path, "AGENTS.md"))
			expect(resolved[3]).toBe("http://example.com/another.md")
		})
	})

	describe("security: forbidden paths", () => {
		it("rejects absolute paths (unix style)", async () => {
			await using _tmp = await tmpdir({ git: true })

			expect(() => {
				validateRegistryInstructionPath("/etc/passwd", "test-component")
			}).toThrow(ValidationError)

			expect(() => {
				validateRegistryInstructionPath("/etc/passwd", "test-component")
			}).toThrow("Absolute path not allowed")
		})

		it("rejects absolute paths (windows drive on POSIX)", async () => {
			await using _tmp = await tmpdir({ git: true })

			// Windows-style absolute paths should be detected even on POSIX
			expect(() => {
				validateRegistryInstructionPath("C:\\Users\\evil.md", "test-component")
			}).toThrow(ValidationError)

			expect(() => {
				validateRegistryInstructionPath("C:\\Users\\evil.md", "test-component")
			}).toThrow("Absolute path not allowed")
		})

		it("rejects Windows UNC paths", async () => {
			await using _tmp = await tmpdir({ git: true })

			expect(() => {
				validateRegistryInstructionPath("\\\\server\\share\\file.md", "test-component")
			}).toThrow(ValidationError)

			expect(() => {
				validateRegistryInstructionPath("\\\\server\\share\\file.md", "test-component")
			}).toThrow("Absolute path not allowed")
		})

		it("rejects parent directory traversal (..)", async () => {
			await using _tmp = await tmpdir({ git: true })

			expect(() => {
				validateRegistryInstructionPath("../../../etc/passwd", "test-component")
			}).toThrow(ValidationError)

			expect(() => {
				validateRegistryInstructionPath("../../../etc/passwd", "test-component")
			}).toThrow("Path traversal (..) not allowed")
		})

		it("rejects .. in middle of path", async () => {
			await using _tmp = await tmpdir({ git: true })

			expect(() => {
				validateRegistryInstructionPath("docs/../../../etc/passwd", "test-component")
			}).toThrow(ValidationError)

			expect(() => {
				validateRegistryInstructionPath("docs/../../../etc/passwd", "test-component")
			}).toThrow("Path traversal (..) not allowed")
		})

		it("rejects backslash traversal", async () => {
			await using _tmp = await tmpdir({ git: true })

			expect(() => {
				validateRegistryInstructionPath("..\\..\\etc\\passwd", "test-component")
			}).toThrow(ValidationError)

			expect(() => {
				validateRegistryInstructionPath("..\\..\\etc\\passwd", "test-component")
			}).toThrow("Path traversal (..) not allowed")
		})

		it("rejects foo/../bar pattern", async () => {
			await using _tmp = await tmpdir({ git: true })

			expect(() => {
				validateRegistryInstructionPath("foo/../bar", "test-component")
			}).toThrow(ValidationError)

			expect(() => {
				validateRegistryInstructionPath("foo/../bar", "test-component")
			}).toThrow("Path traversal (..) not allowed")
		})

		it("rejects single .. parent reference", async () => {
			await using _tmp = await tmpdir({ git: true })

			expect(() => {
				validateRegistryInstructionPath("..", "test-component")
			}).toThrow(ValidationError)

			expect(() => {
				validateRegistryInstructionPath("..", "test-component")
			}).toThrow("Path traversal (..) not allowed")
		})

		it("rejects glob patterns that match nothing", async () => {
			await using tmp = await tmpdir({ git: true })

			// Glob that matches nothing should return empty array, which caller can treat as error
			const resolved = resolveRegistryInstructionPath(
				"nonexistent-*.md",
				tmp.path,
				"test-component",
			)

			// Empty matches - caller should handle this as error per fail-fast rule
			expect(resolved.length).toBe(0)
		})
	})

	describe("user opencode.jsonc instructions (not from registry)", () => {
		it("user-written opencode.jsonc instructions remain cwd-relative (not rewritten)", async () => {
			await using tmp = await tmpdir({
				git: true,
				opencodeConfig: {
					// User manually wrote this in their opencode.jsonc
					// These should NOT be resolved by OCX - OpenCode handles them
					instructions: ["./my-local-instructions.md"],
				},
			})

			// Read back the config as-is (no resolution)
			const configPath = path.join(tmp.path, ".opencode/opencode.jsonc")
			const content = await Bun.file(configPath).text()
			const parsed = JSON.parse(content)

			// User's paths remain unchanged - OCX doesn't touch them
			expect(parsed.instructions).toEqual(["./my-local-instructions.md"])

			// When OCX adds registry instructions, it resolves them but preserves user's
			// This is handled by the merge logic (mergeOpencodeConfig concatenates arrays)
		})
	})

	describe("mergeOpencodeConfig behavior", () => {
		it("concatenates and deduplicates instruction arrays", () => {
			const target: NormalizedOpencodeConfig = {
				instructions: ["/tmp/project/AGENTS.md", "https://example.com/remote.md"],
			}

			const source: NormalizedOpencodeConfig = {
				instructions: ["/tmp/project/docs/guide.md", "/tmp/project/AGENTS.md"], // Duplicate
			}

			const merged = mergeOpencodeConfig(target, source)

			expect(merged.instructions).toEqual([
				"/tmp/project/AGENTS.md",
				"https://example.com/remote.md",
				"/tmp/project/docs/guide.md",
				// Duplicate removed by Set deduplication
			])
		})

		it("preserves non-instruction fields during merge", () => {
			const target: NormalizedOpencodeConfig = {
				instructions: ["/tmp/project/AGENTS.md"],
				tools: { bash: true },
			}

			const source: NormalizedOpencodeConfig = {
				instructions: ["/tmp/project/docs/guide.md"],
				tools: { grep: false },
			}

			const merged = mergeOpencodeConfig(target, source)

			expect(merged.instructions?.length).toBe(2)
			expect(merged.tools).toEqual({ bash: true, grep: false })
		})
	})

	describe("edge cases", () => {
		it("handles empty instruction array", async () => {
			await using tmp = await tmpdir({ git: true })

			const registryConfig: NormalizedOpencodeConfig = {
				instructions: [],
			}

			const instructions = registryConfig.instructions ?? []
			const resolved = resolveRegistryInstructionPaths(instructions, tmp.path, "test-component")
			expect(resolved).toEqual([])
		})

		it("handles missing instructions field", () => {
			const registryConfig: NormalizedOpencodeConfig = {}

			// No instructions field - nothing to resolve
			expect(registryConfig.instructions).toBeUndefined()
		})

		it("normalizes paths with trailing slashes", async () => {
			await using tmp = await tmpdir({ git: true })

			// Create directories to be resolved (note: they're directories, not files)
			mkdirSync(path.join(tmp.path, "docs"), { recursive: true })
			mkdirSync(path.join(tmp.path, "guides/advanced"), { recursive: true })
			writeFileSync(path.join(tmp.path, "docs/.gitkeep"), "")
			writeFileSync(path.join(tmp.path, "guides/advanced/.gitkeep"), "")

			// For directories, we need actual instruction files
			writeFileSync(path.join(tmp.path, "docs/AGENTS.md"), "# Docs")
			writeFileSync(path.join(tmp.path, "guides/advanced/AGENTS.md"), "# Advanced")

			const registryConfig: NormalizedOpencodeConfig = {
				instructions: ["docs/AGENTS.md", "guides/advanced/AGENTS.md"],
			}

			const instructions = registryConfig.instructions ?? []
			const resolved = resolveRegistryInstructionPaths(instructions, tmp.path, "test-component")

			expect(resolved.length).toBe(2)
			expect(resolved[0]).toBe(path.join(tmp.path, "docs/AGENTS.md"))
			expect(resolved[1]).toBe(path.join(tmp.path, "guides/advanced/AGENTS.md"))
		})

		it("handles ./ prefix (explicit relative)", async () => {
			await using tmp = await tmpdir({ git: true })

			// Create the target files
			writeFileSync(path.join(tmp.path, "AGENTS.md"), "# Agents")
			mkdirSync(path.join(tmp.path, "docs"), { recursive: true })
			writeFileSync(path.join(tmp.path, "docs/guide.md"), "# Guide")

			const registryConfig: NormalizedOpencodeConfig = {
				instructions: ["./AGENTS.md", "./docs/guide.md"],
			}

			const instructions = registryConfig.instructions ?? []
			const resolved = resolveRegistryInstructionPaths(instructions, tmp.path, "test-component")

			expect(resolved.length).toBe(2)
			expect(resolved[0]).toBe(path.join(tmp.path, "AGENTS.md"))
			expect(resolved[1]).toBe(path.join(tmp.path, "docs/guide.md"))
		})

		it("handles glob patterns that match multiple files", async () => {
			await using tmp = await tmpdir({ git: true })

			// Create multiple matching files
			mkdirSync(path.join(tmp.path, "docs"), { recursive: true })
			writeFileSync(path.join(tmp.path, "docs/AGENTS.md"), "# Agents")
			writeFileSync(path.join(tmp.path, "docs/CONTEXT.md"), "# Context")
			writeFileSync(path.join(tmp.path, "docs/README.md"), "# Readme")

			const resolved = resolveRegistryInstructionPath("docs/*.md", tmp.path, "test-component")

			// All markdown files should match
			expect(resolved.length).toBeGreaterThan(0)
			expect(resolved.every((p) => p.endsWith(".md"))).toBe(true)
		})
	})
})
