/**
 * Tests for ocx remove command
 * Tests receipt path validation, symlink escaping, atomicity, and normal removal
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
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
		const pluginPath = join(testDir, "plugins", "test-plugin.ts")
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
		const pluginPath = join(testDir, "plugins", "test-plugin.ts")
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
		const pluginPath = join(testDir, "plugins", "test-plugin.ts")
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
		const pluginPath = join(testDir, "plugins", "test-plugin.ts")
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
