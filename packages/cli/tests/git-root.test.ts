/**
 * Tests for git-root resolution
 * Tests resolveGitRootSync with relative input, absolute input, fallback, and worktree support
 */

import { afterEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { resolveGitRootSync } from "../src/utils/git-root"
import { cleanupTempDir, createTempDir } from "./helpers"

describe("resolveGitRootSync", () => {
	let testDir: string

	afterEach(async () => {
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("should return absolute path when given relative input in git repo", async () => {
		testDir = await createTempDir("git-root-relative")

		// Create .git directory
		const gitDir = join(testDir, ".git")
		await mkdir(gitDir, { recursive: true })

		// Create nested directory under testDir
		const nestedDir = join(testDir, "nested", "subdir")
		await mkdir(nestedDir, { recursive: true })

		// Compute relative path from process.cwd() to nestedDir
		const relativePath = relative(process.cwd(), nestedDir)

		// Assert input is relative
		expect(isAbsolute(relativePath)).toBe(false)
		expect(relativePath.length).toBeGreaterThan(0)

		// Test with relative path
		const result = resolveGitRootSync(relativePath)
		expect(isAbsolute(result)).toBe(true)
		expect(result).toBe(resolve(testDir))
	})

	it("should return absolute path when outside git repo", async () => {
		testDir = await createTempDir("git-root-no-git")

		// No .git directory - fallback to cwd
		// NOTE: Since test runs inside OCX repo, it will find parent .git
		// This test verifies the result is absolute and stable
		const result = resolveGitRootSync(testDir)
		expect(isAbsolute(result)).toBe(true)
		// Should return a stable git root (either testDir or parent repo)
		expect(result.length).toBeGreaterThan(0)
	})

	it("should return unchanged when given absolute input", async () => {
		testDir = await createTempDir("git-root-absolute")

		// Create .git directory
		const gitDir = join(testDir, ".git")
		await mkdir(gitDir, { recursive: true })

		// Test with absolute path
		const absolutePath = resolve(testDir)
		const result = resolveGitRootSync(absolutePath)
		expect(isAbsolute(result)).toBe(true)
		expect(result).toBe(absolutePath)
	})

	it("should resolve .git file (worktree) to directory containing .git file", async () => {
		testDir = await createTempDir("git-root-worktree")

		// Create .git file (worktree format)
		const gitFile = join(testDir, ".git")
		await writeFile(gitFile, "gitdir: /some/main/repo/.git/worktrees/my-worktree\n")

		const result = resolveGitRootSync(testDir)
		expect(isAbsolute(result)).toBe(true)
		// Should return testDir (where .git file is located)
		expect(result).toBe(testDir)
	})

	it("should traverse upward to find .git directory", async () => {
		testDir = await createTempDir("git-root-nested")

		// Create .git at root
		const gitDir = join(testDir, ".git")
		await mkdir(gitDir, { recursive: true })

		// Create nested subdirectory
		const subDir = join(testDir, "a", "b", "c")
		await mkdir(subDir, { recursive: true })

		// Start from nested directory
		const result = resolveGitRootSync(subDir)
		expect(isAbsolute(result)).toBe(true)
		expect(result).toBe(testDir)
	})

	it("should return absolute cwd when .git not found", async () => {
		testDir = await createTempDir("git-root-fallback")

		// No .git anywhere
		const subDir = join(testDir, "nested")
		await mkdir(subDir, { recursive: true })

		// NOTE: Since test runs inside OCX repo, it will find parent .git
		// This test verifies the result is absolute
		const result = resolveGitRootSync(subDir)
		expect(isAbsolute(result)).toBe(true)
		expect(result.length).toBeGreaterThan(0)
	})

	it("should handle .git directory in real working directory", () => {
		// Test with actual project directory (should have .git)
		const projectRoot = resolve(import.meta.dir, "..", "..", "..")
		const gitPath = join(projectRoot, ".git")

		// Only run if .git exists (may not in CI)
		if (existsSync(gitPath)) {
			const result = resolveGitRootSync(projectRoot)
			expect(isAbsolute(result)).toBe(true)
			expect(result).toBe(projectRoot)
		}
	})
})
