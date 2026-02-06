/**
 * Tests for ocx remove command
 * Tests receipt path validation, symlink escaping, atomicity, and normal removal
 */

import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import { existsSync, symlinkSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

describe("ocx remove security", () => {
	let testDir: string
	let externalDir: string
	let registry: MockRegistry

	beforeAll(() => {
		registry = startMockRegistry()
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
		const validFile = join(testDir, "agents", "test-agent.md")
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
		expect(existsSync(join(testDir, "plugins", "test-plugin.ts"))).toBe(true)
		expect(existsSync(join(testDir, "skills", "test-skill", "SKILL.md"))).toBe(true)

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
		expect(existsSync(join(testDir, "plugins", "test-plugin.ts"))).toBe(false)

		// Verify skill file still exists
		expect(existsSync(join(testDir, "skills", "test-skill", "SKILL.md"))).toBe(true)

		// Verify receipt updated: plugin removed, skill remains
		const receiptAfter = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const keysAfter = Object.keys(receiptAfter.installed as Record<string, unknown>)
		expect(keysAfter).not.toContain(pluginKey)
		expect(keysAfter).toContain(skillKey)
	})
})
