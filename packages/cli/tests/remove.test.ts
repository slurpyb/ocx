/**
 * Tests for ocx remove command
 * Tests receipt path validation, symlink escaping, atomicity, and normal removal
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test"
import * as fsSync from "node:fs"
import { existsSync, symlinkSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

describe("ocx remove preflight race hardening", () => {
	afterEach(() => {
		mock.restore()
	})

	it("treats ENOENT from preflight realpath as already missing", async () => {
		const projectDir = await createTempDir("remove-preflight-enoent-race")
		try {
			const relativePath = ".opencode/plugins/test-plugin.ts"
			const absolutePath = join(projectDir, relativePath)

			await mkdir(join(projectDir, ".opencode", "plugins"), { recursive: true })
			await writeFile(absolutePath, "plugin")

			const enoentError = Object.assign(new Error("simulated TOCTOU ENOENT"), {
				code: "ENOENT",
			})

			const realpathSyncMock = spyOn(fsSync, "realpathSync").mockImplementation((() => {
				throw enoentError
			}) as unknown as typeof fsSync.realpathSync)

			const { resolvePreflightRemovalTarget } = await import("../src/commands/remove")

			const result = resolvePreflightRemovalTarget(projectDir, projectDir, relativePath)

			expect(result).toEqual({
				path: relativePath,
				targetReal: null,
			})
			expect(realpathSyncMock).toHaveBeenCalledTimes(1)
		} finally {
			await cleanupTempDir(projectDir)
		}
	})

	it("treats ENOTDIR from preflight realpath as already missing", async () => {
		const projectDir = await createTempDir("remove-preflight-enotdir-race")
		try {
			const relativePath = ".opencode/plugins/test-plugin.ts"

			const enotdirError = Object.assign(new Error("simulated ENOTDIR"), {
				code: "ENOTDIR",
			})

			const realpathSyncMock = spyOn(fsSync, "realpathSync").mockImplementation((() => {
				throw enotdirError
			}) as unknown as typeof fsSync.realpathSync)

			const { resolvePreflightRemovalTarget } = await import("../src/commands/remove")

			const result = resolvePreflightRemovalTarget(projectDir, projectDir, relativePath)

			expect(result).toEqual({
				path: relativePath,
				targetReal: null,
			})
			expect(realpathSyncMock).toHaveBeenCalledTimes(1)
		} finally {
			await cleanupTempDir(projectDir)
		}
	})

	it("fails loudly when a preflight-missing target reappears at delete-time", async () => {
		const projectDir = await createTempDir("remove-preflight-reappearance")
		try {
			const relativePath = ".opencode/reappearance/target.ts"
			const blockerPath = join(projectDir, ".opencode", "reappearance")
			const targetPath = join(projectDir, relativePath)

			await mkdir(join(projectDir, ".opencode"), { recursive: true })
			await writeFile(blockerPath, "not-a-directory")

			const { resolveDeleteTimeRemovalTarget, resolvePreflightRemovalTarget } = await import(
				"../src/commands/remove"
			)

			const baseReal = fsSync.realpathSync(projectDir)
			const preflight = resolvePreflightRemovalTarget(projectDir, baseReal, relativePath)
			expect(preflight).toEqual({
				path: relativePath,
				targetReal: null,
			})

			await rm(blockerPath, { force: true })
			await mkdir(blockerPath, { recursive: true })
			await writeFile(targetPath, "reappeared")

			expect(() => resolveDeleteTimeRemovalTarget(projectDir, baseReal, preflight)).toThrow(
				`Security violation: missing target reappeared during removal (${relativePath})`,
			)
		} finally {
			await cleanupTempDir(projectDir)
		}
	})

	it("includes the affected path when delete-time target changes", async () => {
		const projectDir = await createTempDir("remove-preflight-target-changed")
		try {
			const relativePath = ".opencode/repoint/current.ts"
			const targetDir = join(projectDir, ".opencode", "repoint")
			const firstTarget = join(targetDir, "first.ts")
			const secondTarget = join(targetDir, "second.ts")
			const linkPath = join(projectDir, relativePath)

			await mkdir(targetDir, { recursive: true })
			await writeFile(firstTarget, "first")
			await writeFile(secondTarget, "second")
			symlinkSync(firstTarget, linkPath)

			const { resolveDeleteTimeRemovalTarget, resolvePreflightRemovalTarget } = await import(
				"../src/commands/remove"
			)

			const baseReal = fsSync.realpathSync(projectDir)
			const preflight = resolvePreflightRemovalTarget(projectDir, baseReal, relativePath)

			await rm(linkPath, { force: true })
			symlinkSync(secondTarget, linkPath)

			expect(() => resolveDeleteTimeRemovalTarget(projectDir, baseReal, preflight)).toThrow(
				`Security violation: target changed during removal (${relativePath})`,
			)
		} finally {
			await cleanupTempDir(projectDir)
		}
	})
})

describe("ocx remove security", () => {
	let testDir: string
	let externalDir: string
	let registry: MockRegistry

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	afterEach(async () => {
		if (testDir) {
			await cleanupTempDir(testDir)
		}
		if (externalDir) {
			await cleanupTempDir(externalDir)
		}
	})

	it("should reject receipt path '.' with --force", async () => {
		testDir = await createTempDir("remove-dot-path")

		// Initialize and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install a component
		await runCLI(["add", "kdco/test-plugin"], testDir)

		// Read receipt and tamper with file path to "."
		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKey = Object.keys(receipt.installed as Record<string, unknown>)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		// Tamper: set file path to "."
		const entry = (receipt.installed as Record<string, unknown>)[installedKey] as {
			files: Array<{ path: string; hash: string }>
		}
		entry.files[0].path = "."

		await writeFile(receiptPath, JSON.stringify(receipt, null, 2))

		// Try to remove with --force (should reject empty/dot paths)
		const { exitCode, output } = await runCLI(["remove", installedKey, "--force"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output.toLowerCase()).toMatch(/security|validation|invalid/)
	})

	it("should reject empty path in receipt", async () => {
		testDir = await createTempDir("remove-empty-path")

		// Initialize and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install a component
		await runCLI(["add", "kdco/test-plugin"], testDir)

		// Read receipt and tamper with file path to ""
		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKey = Object.keys(receipt.installed as Record<string, unknown>)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		// Tamper: set file path to ""
		const entry = (receipt.installed as Record<string, unknown>)[installedKey] as {
			files: Array<{ path: string; hash: string }>
		}
		entry.files[0].path = ""

		await writeFile(receiptPath, JSON.stringify(receipt, null, 2))

		// Try to remove with --force (should reject empty paths)
		const { exitCode, output } = await runCLI(["remove", installedKey, "--force"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output.toLowerCase()).toMatch(/security|validation|invalid|empty/)
	})

	it("should reject absolute path tamper", async () => {
		testDir = await createTempDir("remove-absolute-tamper")

		// Initialize and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install a component
		await runCLI(["add", "kdco/test-plugin"], testDir)

		// Read receipt and tamper with file path to absolute
		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKey = Object.keys(receipt.installed as Record<string, unknown>)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		// Tamper: set file path to absolute
		const entry = (receipt.installed as Record<string, unknown>)[installedKey] as {
			files: Array<{ path: string; hash: string }>
		}
		entry.files[0].path = "/etc/passwd"

		await writeFile(receiptPath, JSON.stringify(receipt, null, 2))

		// Try to remove with --force (should reject absolute paths)
		const { exitCode, output } = await runCLI(["remove", installedKey, "--force"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output.toLowerCase()).toMatch(/security|validation|absolute/)
	})

	it("should reject symlink escaping project root", async () => {
		testDir = await createTempDir("remove-symlink-escape")
		externalDir = await createTempDir("remove-external-target")

		// Initialize and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install a component
		await runCLI(["add", "kdco/test-plugin"], testDir)

		// Create a symlink that escapes to externalDir (and create the target so it exists)
		const symlinkPath = join(testDir, "plugins", "escape-link.ts")
		const targetPath = join(externalDir, "evil-target.txt")
		await mkdir(join(testDir, "plugins"), { recursive: true })
		// Create target file first
		await writeFile(targetPath, "malicious content")
		symlinkSync(targetPath, symlinkPath)

		// Read receipt and tamper with file path to symlink
		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKey = Object.keys(receipt.installed as Record<string, unknown>)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		// Tamper: set file path to symlink
		const entry = (receipt.installed as Record<string, unknown>)[installedKey] as {
			files: Array<{ path: string; hash: string }>
		}
		entry.files[0].path = "plugins/escape-link.ts"

		await writeFile(receiptPath, JSON.stringify(receipt, null, 2))

		// Try to remove with --force (should reject symlinks escaping root)
		const { exitCode, output } = await runCLI(["remove", installedKey, "--force"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output.toLowerCase()).toMatch(/security|escapes|directory/)

		// Assert external target file remains after failed remove
		expect(existsSync(targetPath)).toBe(true)
	})

	it("should reject mixed valid + malicious paths atomically", async () => {
		testDir = await createTempDir("remove-atomic-mixed")

		// Initialize and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install a component
		await runCLI(["add", "kdco/test-agent"], testDir)

		// Verify files exist before tampering
		const validFile = join(testDir, ".opencode", "agents", "test-agent.md")
		expect(existsSync(validFile)).toBe(true)

		// Read receipt and tamper: add malicious path alongside valid
		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKey = Object.keys(receipt.installed as Record<string, unknown>)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		// Tamper: add absolute path to files array
		const entry = (receipt.installed as Record<string, unknown>)[installedKey] as {
			files: Array<{ path: string; hash: string }>
		}
		entry.files.push({ path: "/etc/passwd", hash: "fake-hash" })

		await writeFile(receiptPath, JSON.stringify(receipt, null, 2))

		// Try to remove with --force (should fail and not delete anything)
		const { exitCode, output } = await runCLI(["remove", installedKey, "--force"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output.toLowerCase()).toMatch(/security|validation|absolute/)

		// Verify valid file still exists (atomicity)
		expect(existsSync(validFile)).toBe(true)

		// Verify receipt unchanged
		const receiptAfter = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		expect(Object.keys(receiptAfter.installed as Record<string, unknown>)).toContain(installedKey)
	})

	it("should fail atomically when later symlink path escapes project root", async () => {
		testDir = await createTempDir("remove-atomic-symlink-escape")
		externalDir = await createTempDir("remove-atomic-symlink-external")

		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		await runCLI(["add", "kdco/test-agent"], testDir)

		const escapeTarget = join(externalDir, "outside.md")
		await writeFile(escapeTarget, "outside project")

		const escapeSymlink = join(testDir, ".opencode", "agents", "escape-link.md")
		symlinkSync(escapeTarget, escapeSymlink)

		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKey = Object.keys(receipt.installed as Record<string, unknown>)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		const entry = (receipt.installed as Record<string, unknown>)[installedKey] as {
			files: Array<{ path: string; hash: string }>
		}

		const validReceiptPath = entry.files[0]?.path
		if (!validReceiptPath) {
			throw new Error("Expected at least one valid receipt file path")
		}
		const validFile = join(testDir, validReceiptPath)
		expect(existsSync(validFile)).toBe(true)

		entry.files.push({ path: ".opencode/agents/escape-link.md", hash: "fake-hash" })

		await writeFile(receiptPath, JSON.stringify(receipt, null, 2))
		const receiptBefore = await readFile(receiptPath, "utf-8")

		const { exitCode, output } = await runCLI(["remove", installedKey, "--force"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output.toLowerCase()).toMatch(/security|escapes|directory/)

		// Atomic no-op: earlier valid path must not be deleted.
		expect(existsSync(validFile)).toBe(true)

		// Receipt must remain unchanged on preflight failure.
		const receiptAfter = await readFile(receiptPath, "utf-8")
		expect(receiptAfter).toBe(receiptBefore)
	})

	it("should remove only target component and update receipt", async () => {
		testDir = await createTempDir("remove-normal")

		// Initialize and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install two components
		await runCLI(["add", "kdco/test-plugin"], testDir)
		await runCLI(["add", "kdco/test-skill"], testDir)

		// Verify both installed
		expect(existsSync(join(testDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(true)
		expect(existsSync(join(testDir, ".opencode", "skills", "test-skill", "SKILL.md"))).toBe(true)

		// Read receipt to get canonical IDs
		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKeys = Object.keys(receipt.installed as Record<string, unknown>)
		const pluginKey = installedKeys.find((k) => k.includes("test-plugin"))
		const skillKey = installedKeys.find((k) => k.includes("test-skill"))

		if (!pluginKey || !skillKey) {
			throw new Error("Components not found in receipt")
		}

		// Remove only test-plugin
		const { exitCode } = await runCLI(["remove", pluginKey], testDir)

		expect(exitCode).toBe(0)

		// Verify plugin file deleted
		expect(existsSync(join(testDir, ".opencode", "plugins", "test-plugin.ts"))).toBe(false)

		// Verify skill file still exists
		expect(existsSync(join(testDir, ".opencode", "skills", "test-skill", "SKILL.md"))).toBe(true)

		// Verify receipt updated: plugin removed, skill remains
		const receiptAfter = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const keysAfter = Object.keys(receiptAfter.installed as Record<string, unknown>)
		expect(keysAfter).not.toContain(pluginKey)
		expect(keysAfter).toContain(skillKey)
	})

	it("should skip missing targets during remove and still update receipt", async () => {
		testDir = await createTempDir("remove-missing-target-skip")

		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		await runCLI(["add", "kdco/test-plugin"], testDir)

		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receiptBefore = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			installed: Record<
				string,
				{
					files: Array<{ path: string; hash: string }>
				}
			>
		}

		const installedKey = Object.keys(receiptBefore.installed)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		const missingPath = receiptBefore.installed[installedKey]?.files[0]?.path
		if (!missingPath) {
			throw new Error("Expected receipt file path for installed component")
		}

		await rm(join(testDir, missingPath), { force: true })

		const { exitCode, output } = await runCLI(
			["remove", installedKey, "--force", "--verbose"],
			testDir,
		)

		expect(exitCode).toBe(0)
		expect(output.toLowerCase()).toContain("skipped")
		expect(output.toLowerCase()).toContain("(not found)")

		const receiptAfter = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			installed: Record<string, unknown>
		}
		expect(Object.keys(receiptAfter.installed)).not.toContain(installedKey)
	})

	it("should handle ENOTDIR-style missing paths without crashing and still update receipt", async () => {
		testDir = await createTempDir("remove-enotdir-missing-target")

		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		await runCLI(["add", "kdco/test-plugin"], testDir)

		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			installed: Record<
				string,
				{
					files: Array<{ path: string; hash: string }>
				}
			>
		}

		const installedKey = Object.keys(receipt.installed)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		const blockerPath = join(testDir, ".opencode", "blocked-segment")
		await writeFile(blockerPath, "file blocks directory traversal")

		receipt.installed[installedKey].files[0].path = ".opencode/blocked-segment/target.ts"
		await writeFile(receiptPath, JSON.stringify(receipt, null, 2))

		const { exitCode, output } = await runCLI(
			["remove", installedKey, "--force", "--verbose"],
			testDir,
		)

		expect(exitCode).toBe(0)
		expect(output.toLowerCase()).toContain("skipped")
		expect(output.toLowerCase()).toContain("(not found)")
		expect(existsSync(blockerPath)).toBe(true)

		const receiptAfter = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			installed: Record<string, unknown>
		}
		expect(Object.keys(receiptAfter.installed)).not.toContain(installedKey)
	})
})

describe("ocx remove UX behavior", () => {
	let testDir: string
	let registry: MockRegistry

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	afterEach(async () => {
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("should fail removal when file is modified without --force", async () => {
		testDir = await createTempDir("remove-modified-no-force")

		// Initialize and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install a component
		await runCLI(["add", "kdco/test-plugin"], testDir)

		// Verify file exists
		const pluginPath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		expect(existsSync(pluginPath)).toBe(true)

		// Modify the file to break integrity
		const originalContent = await readFile(pluginPath, "utf-8")
		await writeFile(pluginPath, `${originalContent}\n// User modification`)

		// Read receipt to get canonical ID
		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKey = Object.keys(receipt.installed as Record<string, unknown>)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		// Try to remove without --force (should fail)
		const { exitCode, output } = await runCLI(["remove", installedKey], testDir)

		// Verify failure
		expect(exitCode).not.toBe(0)
		expect(output.toLowerCase()).toMatch(/modified|integrity|force/)

		// Verify file still exists (no removal occurred)
		expect(existsSync(pluginPath)).toBe(true)

		// Verify receipt unchanged
		const receiptAfter = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		expect(Object.keys(receiptAfter.installed as Record<string, unknown>)).toContain(installedKey)
	})

	it("should succeed removal when file is modified with --force", async () => {
		testDir = await createTempDir("remove-modified-with-force")

		// Initialize and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install a component
		await runCLI(["add", "kdco/test-plugin"], testDir)

		// Verify file exists
		const pluginPath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		expect(existsSync(pluginPath)).toBe(true)

		// Modify the file to break integrity
		const originalContent = await readFile(pluginPath, "utf-8")
		await writeFile(pluginPath, `${originalContent}\n// User modification`)

		// Read receipt to get canonical ID
		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKey = Object.keys(receipt.installed as Record<string, unknown>)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		// Remove with --force (should succeed)
		const { exitCode } = await runCLI(["remove", installedKey, "--force"], testDir)

		// Verify success
		expect(exitCode).toBe(0)

		// Verify file was deleted
		expect(existsSync(pluginPath)).toBe(false)

		// Verify receipt updated
		const receiptAfter = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		expect(Object.keys(receiptAfter.installed as Record<string, unknown>)).not.toContain(
			installedKey,
		)
	})

	it("should not remove files or mutate receipt with --dry-run", async () => {
		testDir = await createTempDir("remove-dry-run")

		// Initialize and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install a component
		await runCLI(["add", "kdco/test-plugin"], testDir)

		// Verify file exists
		const pluginPath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		expect(existsSync(pluginPath)).toBe(true)

		// Capture receipt state before dry-run
		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receiptBefore = await readFile(receiptPath, "utf-8")
		const parsedBefore = parseJsonc(receiptBefore) as Record<string, unknown>
		const installedKey = Object.keys(parsedBefore.installed as Record<string, unknown>)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		// Run remove with --dry-run
		const { exitCode } = await runCLI(["remove", installedKey, "--dry-run"], testDir)

		// Verify exit code is 0 (dry-run succeeded)
		expect(exitCode).toBe(0)

		// Verify file still exists (no removal)
		expect(existsSync(pluginPath)).toBe(true)

		// Verify receipt unchanged (byte-for-byte comparison)
		const receiptAfter = await readFile(receiptPath, "utf-8")
		expect(receiptAfter).toBe(receiptBefore)
	})

	it("should output correct JSON structure on successful removal with --json", async () => {
		testDir = await createTempDir("remove-json-success")

		// Initialize and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install a component
		await runCLI(["add", "kdco/test-plugin"], testDir)

		// Read receipt to get canonical ID
		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKey = Object.keys(receipt.installed as Record<string, unknown>)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		// Remove with --json
		const { exitCode, stdout } = await runCLI(["remove", installedKey, "--json"], testDir)

		// Verify success
		expect(exitCode).toBe(0)

		// Parse and validate JSON output structure
		const jsonOutput = JSON.parse(stdout) as {
			success: boolean
			removed: string[]
			notFound: string[]
		}
		expect(jsonOutput.success).toBe(true)
		expect(Array.isArray(jsonOutput.removed)).toBe(true)
		expect(jsonOutput.removed).toContain(installedKey)
		expect(Array.isArray(jsonOutput.notFound)).toBe(true)
		expect(jsonOutput.notFound).toHaveLength(0)
	})

	it("should output correct JSON error structure on failure with --json", async () => {
		testDir = await createTempDir("remove-json-failure")

		// Initialize and add registry
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install a component
		await runCLI(["add", "kdco/test-plugin"], testDir)

		// Verify file exists
		const pluginPath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		expect(existsSync(pluginPath)).toBe(true)

		// Modify the file to break integrity
		const originalContent = await readFile(pluginPath, "utf-8")
		await writeFile(pluginPath, `${originalContent}\n// User modification`)

		// Read receipt to get canonical ID
		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKey = Object.keys(receipt.installed as Record<string, unknown>)[0]
		if (!installedKey) {
			throw new Error("No installed components found")
		}

		// Try to remove without --force but with --json (should fail)
		const { exitCode, stdout } = await runCLI(["remove", installedKey, "--json"], testDir)

		// Verify failure
		expect(exitCode).not.toBe(0)

		// Parse and validate JSON error output structure
		const jsonOutput = JSON.parse(stdout) as {
			success: boolean
			error: {
				code: string
				message: string
			}
			exitCode: number
			meta: {
				timestamp: string
			}
		}
		expect(jsonOutput.success).toBe(false)
		expect(typeof jsonOutput.error).toBe("object")
		expect(typeof jsonOutput.error.code).toBe("string")
		expect(typeof jsonOutput.error.message).toBe("string")
		expect(typeof jsonOutput.exitCode).toBe("number")
		expect(jsonOutput.exitCode).not.toBe(0)
		expect(typeof jsonOutput.meta).toBe("object")
		expect(typeof jsonOutput.meta.timestamp).toBe("string")
		// Validate timestamp is ISO 8601 format
		expect(jsonOutput.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
	})
})

describe("ocx remove resolver consistency", () => {
	let testDir: string
	let registry: MockRegistry

	beforeAll(() => {
		registry = startMockRegistry()
	})

	afterAll(() => {
		registry.stop()
	})

	afterEach(async () => {
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	async function setupProject(name: string): Promise<string> {
		const dir = await createTempDir(name)
		await runCLI(["init"], dir)

		const configPath = join(dir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = {
			kdco: { url: registry.url },
		}
		await writeFile(configPath, JSON.stringify(config, null, 2))

		return dir
	}

	it("resolves shorthand alias/component refs to installed canonical IDs", async () => {
		testDir = await setupProject("remove-resolver-shorthand")

		await runCLI(["add", "kdco/test-plugin"], testDir)

		const pluginPath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		expect(existsSync(pluginPath)).toBe(true)

		const { exitCode } = await runCLI(["remove", "kdco/test-plugin"], testDir)

		expect(exitCode).toBe(0)
		expect(existsSync(pluginPath)).toBe(false)
	})

	it("deduplicates repeated refs while preserving first-seen order", async () => {
		testDir = await setupProject("remove-resolver-dedupe")

		await runCLI(["add", "kdco/test-plugin"], testDir)
		await runCLI(["add", "kdco/test-skill"], testDir)

		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			installed: Record<string, unknown>
		}

		const installedKeys = Object.keys(receipt.installed)
		const pluginKey = installedKeys.find((key) => key.includes("kdco/test-plugin@"))
		const skillKey = installedKeys.find((key) => key.includes("kdco/test-skill@"))

		if (!pluginKey || !skillKey) {
			throw new Error("Expected plugin and skill canonical IDs in receipt")
		}

		const result = await runCLI(
			["remove", "kdco/test-plugin", pluginKey, "kdco/test-skill", skillKey, "--json"],
			testDir,
		)

		expect(result.exitCode).toBe(0)

		const payload = JSON.parse(result.stdout) as {
			removed: string[]
		}

		expect(payload.removed).toEqual([pluginKey, skillKey])
	})

	it("fails loudly on ambiguous shorthand with deterministic canonical guidance", async () => {
		testDir = await setupProject("remove-resolver-ambiguous")

		await runCLI(["add", "kdco/test-plugin"], testDir)

		const receiptPath = join(testDir, ".ocx", "receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			installed: Record<string, unknown>
		}

		const originalCanonicalId = Object.keys(receipt.installed).find((key) =>
			key.includes("kdco/test-plugin@"),
		)
		if (!originalCanonicalId) {
			throw new Error("Expected test-plugin canonical ID in receipt")
		}

		const canonicalSuffix = originalCanonicalId.split("::")[1]
		if (!canonicalSuffix) {
			throw new Error("Expected canonical suffix after '::'")
		}

		const secondCanonicalId = `aaa://mirror.registry::${canonicalSuffix}`
		receipt.installed[secondCanonicalId] = receipt.installed[originalCanonicalId]
		await writeFile(receiptPath, JSON.stringify(receipt, null, 2))

		const result = await runCLI(["remove", "kdco/test-plugin", "--json"], testDir)

		expect(result.exitCode).not.toBe(0)
		const payload = JSON.parse(result.stdout) as {
			error: {
				code: string
				message: string
			}
		}

		const sortedMatches = [originalCanonicalId, secondCanonicalId].sort()
		expect(payload.error.code).toBe("VALIDATION_ERROR")
		expect(payload.error.message).toBe(
			`Ambiguous component reference 'kdco/test-plugin'. Found 2 installed matches:\n` +
				sortedMatches.map((id) => `  - ${id}`).join("\n") +
				"\n\nUse one of the canonical IDs above.",
		)
	})

	it("fails with actionable message for unknown refs", async () => {
		testDir = await setupProject("remove-resolver-unknown")

		await runCLI(["add", "kdco/test-plugin"], testDir)

		const result = await runCLI(["remove", "kdco/not-installed", "--json"], testDir)

		expect(result.exitCode).not.toBe(0)
		const payload = JSON.parse(result.stdout) as {
			error: {
				code: string
				message: string
			}
		}

		expect(payload.error.code).toBe("NOT_FOUND")
		expect(payload.error.message).toBe(
			"Component 'kdco/not-installed' is not installed.\nRun 'ocx search --installed' to see installed components.",
		)
	})
})
