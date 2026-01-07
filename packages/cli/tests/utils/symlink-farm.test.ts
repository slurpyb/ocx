/**
 * Symlink Farm Tests
 *
 * Tests for the symlink farm utility used in ghost mode.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { lstat, mkdir, readlink, rm } from "node:fs/promises"
import { join } from "node:path"
import {
	cleanupSymlinkFarm,
	createSymlinkFarm,
	GHOST_MARKER_FILE,
} from "../../src/utils/symlink-farm.js"

// =============================================================================
// HELPERS
// =============================================================================

async function createTempDir(name: string): Promise<string> {
	const dir = join(import.meta.dir, "fixtures", `tmp-${name}-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	return dir
}

async function cleanupTempDir(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true })
}

// =============================================================================
// TESTS
// =============================================================================

describe("createSymlinkFarm", () => {
	let sourceDir: string

	beforeEach(async () => {
		sourceDir = await createTempDir("symlink-farm-source")
	})

	afterEach(async () => {
		await cleanupTempDir(sourceDir)
	})

	it("should create symlinks to all files in source directory", async () => {
		// Create some files
		await Bun.write(join(sourceDir, "file1.txt"), "content1")
		await Bun.write(join(sourceDir, "file2.txt"), "content2")

		const tempDir = await createSymlinkFarm(sourceDir, new Set())

		try {
			// Check symlinks exist
			const stat1 = await lstat(join(tempDir, "file1.txt"))
			const stat2 = await lstat(join(tempDir, "file2.txt"))

			expect(stat1.isSymbolicLink()).toBe(true)
			expect(stat2.isSymbolicLink()).toBe(true)

			// Check they point to the right place
			const target1 = await readlink(join(tempDir, "file1.txt"))
			const target2 = await readlink(join(tempDir, "file2.txt"))

			expect(target1).toBe(join(sourceDir, "file1.txt"))
			expect(target2).toBe(join(sourceDir, "file2.txt"))
		} finally {
			await cleanupSymlinkFarm(tempDir)
		}
	})

	it("should create symlinks to directories", async () => {
		// Create a subdirectory with content
		const subDir = join(sourceDir, "subdir")
		await mkdir(subDir, { recursive: true })
		await Bun.write(join(subDir, "nested.txt"), "nested content")

		const tempDir = await createSymlinkFarm(sourceDir, new Set())

		try {
			// Check symlink exists
			const stat = await lstat(join(tempDir, "subdir"))
			expect(stat.isSymbolicLink()).toBe(true)

			// Check symlink target
			const target = await readlink(join(tempDir, "subdir"))
			expect(target).toBe(subDir)

			// Check we can read through the symlink
			const content = await Bun.file(join(tempDir, "subdir", "nested.txt")).text()
			expect(content).toBe("nested content")
		} finally {
			await cleanupSymlinkFarm(tempDir)
		}
	})

	it("should exclude paths in the exclusion set", async () => {
		// Create some files
		await Bun.write(join(sourceDir, "keep.txt"), "keep")
		await Bun.write(join(sourceDir, "exclude.txt"), "exclude")
		await Bun.write(join(sourceDir, "opencode.jsonc"), "{}")

		const excludePaths = new Set([
			join(sourceDir, "exclude.txt"),
			join(sourceDir, "opencode.jsonc"),
		])

		const tempDir = await createSymlinkFarm(sourceDir, excludePaths)

		try {
			// keep.txt should be linked
			const keepStat = await lstat(join(tempDir, "keep.txt"))
			expect(keepStat.isSymbolicLink()).toBe(true)

			// excluded files should not exist
			const excludeExists = await Bun.file(join(tempDir, "exclude.txt")).exists()
			const configExists = await Bun.file(join(tempDir, "opencode.jsonc")).exists()

			expect(excludeExists).toBe(false)
			expect(configExists).toBe(false)
		} finally {
			await cleanupSymlinkFarm(tempDir)
		}
	})

	it("should exclude directories in the exclusion set", async () => {
		// Create files and directories
		await Bun.write(join(sourceDir, "file.txt"), "content")
		const opencodDir = join(sourceDir, ".opencode")
		await mkdir(opencodDir, { recursive: true })
		await Bun.write(join(opencodDir, "config.json"), "{}")

		const excludePaths = new Set([opencodDir])

		const tempDir = await createSymlinkFarm(sourceDir, excludePaths)

		try {
			// file.txt should be linked
			const fileStat = await lstat(join(tempDir, "file.txt"))
			expect(fileStat.isSymbolicLink()).toBe(true)

			// .opencode should not exist
			const opencodeExists = await Bun.file(join(tempDir, ".opencode")).exists()
			expect(opencodeExists).toBe(false)
		} finally {
			await cleanupSymlinkFarm(tempDir)
		}
	})

	it("should create temp directory in system temp location", async () => {
		await Bun.write(join(sourceDir, "test.txt"), "test")

		const tempDir = await createSymlinkFarm(sourceDir, new Set())

		try {
			// Should start with ocx-ghost prefix
			expect(tempDir).toContain("ocx-ghost")
		} finally {
			await cleanupSymlinkFarm(tempDir)
		}
	})

	it("should handle empty source directory", async () => {
		// sourceDir is already empty

		const tempDir = await createSymlinkFarm(sourceDir, new Set())

		try {
			// Should have created the marker file
			const markerExists = await Bun.file(join(tempDir, GHOST_MARKER_FILE)).exists()
			expect(markerExists).toBe(true)
		} finally {
			await cleanupSymlinkFarm(tempDir)
		}
	})
})

describe("cleanupSymlinkFarm", () => {
	it("should remove the temp directory", async () => {
		const sourceDir = await createTempDir("symlink-farm-cleanup")
		await Bun.write(join(sourceDir, "file.txt"), "content")

		const tempDir = await createSymlinkFarm(sourceDir, new Set())

		// Verify it exists
		const existsBefore = await Bun.file(join(tempDir, "file.txt")).exists()
		expect(existsBefore).toBe(true)

		// Cleanup
		await cleanupSymlinkFarm(tempDir)

		// Verify it's gone
		const existsAfter = await Bun.file(join(tempDir, "file.txt")).exists()
		expect(existsAfter).toBe(false)

		// Cleanup source
		await cleanupTempDir(sourceDir)
	})

	it("should not throw if directory doesn't exist", async () => {
		// Should not throw
		await cleanupSymlinkFarm("/nonexistent/path/that/does/not/exist")
	})
})
