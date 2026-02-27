/**
 * Tests for ocx verify command
 * Tests file integrity verification for installed components
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { aliasSchema } from "../src/schemas/registry"
import { cleanupTempDir, createTempDir, parseJsonc, runCLI } from "./helpers"
import { type MockRegistry, startMockRegistry } from "./mock-registry"

const COMPONENT_REFERENCE_PATTERN = /^(?:[a-z0-9-]+\/[a-z0-9-]+|<[^\s/>]+\/[^\s/>]+>)$/
const REGISTRY_ALIAS_PLACEHOLDER_PATTERN = /^<[^\s<>]+>$/

function normalizeCommandText(command: string): string {
	return command.trim().replace(/\s+/g, " ")
}

function extractLongFlagsFromHelp(updateHelpOutput: string): Set<string> {
	const longFlags = new Set<string>()
	const lines = updateHelpOutput.split(/\r?\n/)
	let inOptionsSection = false

	for (const line of lines) {
		if (!inOptionsSection) {
			if (/^\s*Options:\s*$/i.test(line)) {
				inOptionsSection = true
			}
			continue
		}

		if (/^\s*$/.test(line)) {
			continue
		}

		if (/^\S/.test(line)) {
			break
		}

		const optionDefinition = line.match(/^\s*(?:-[a-z0-9],\s*)?(--[a-z0-9][a-z0-9-]*)\b/)
		if (optionDefinition) {
			longFlags.add(optionDefinition[1])
		}
	}

	return longFlags
}

function isRegistryNameArgument(token: string | undefined): boolean {
	if (!token) {
		return false
	}

	if (REGISTRY_ALIAS_PLACEHOLDER_PATTERN.test(token)) {
		return true
	}

	return aliasSchema.safeParse(token).success
}

function isSupportedUpdateRemediationCommand(command: string): boolean {
	const tokens = normalizeCommandText(command).split(/\s+/)
	if (tokens[0] !== "ocx" || tokens[1] !== "update") {
		return false
	}

	const args = tokens.slice(2)
	if (args.length === 0) {
		return false
	}

	if (args.length === 1 && args[0] === "--all") {
		return true
	}

	if (args[0] === "--registry") {
		return args.length === 2 && isRegistryNameArgument(args[1])
	}

	if (args.some((arg) => arg.startsWith("--"))) {
		return false
	}

	return args.every((arg) => COMPONENT_REFERENCE_PATTERN.test(arg))
}

function extractSuggestedUpdateCommands(output: string): string[] {
	const singleQuotedCommands = [...output.matchAll(/'((?:ocx\s+update)[^']*)'/g)].map((match) =>
		normalizeCommandText(match[1]),
	)
	const doubleQuotedCommands = [...output.matchAll(/"((?:ocx\s+update)[^"]*)"/g)].map((match) =>
		normalizeCommandText(match[1]),
	)
	const backtickQuotedCommands = [...output.matchAll(/`((?:ocx\s+update)[^`]*)`/g)].map((match) =>
		normalizeCommandText(match[1]),
	)
	const unquotedCommands = [
		...output.matchAll(/\bocx\s+update(?:\s+[^\s\n'"`.,;:()[\]{}!?]+)+/g),
	].map((match) => normalizeCommandText(match[0]))

	return [
		...new Set([
			...singleQuotedCommands,
			...doubleQuotedCommands,
			...backtickQuotedCommands,
			...unquotedCommands,
		]),
	]
}

function expectValidUpdateRemediation(output: string, updateHelpOutput: string): void {
	const suggestedCommands = extractSuggestedUpdateCommands(output)
	const supportedFlags = extractLongFlagsFromHelp(updateHelpOutput)

	expect(suggestedCommands.length).toBeGreaterThan(0)
	expect(supportedFlags.size).toBeGreaterThan(0)

	for (const command of suggestedCommands) {
		const tokens = normalizeCommandText(command).split(/\s+/)
		expect(tokens[0]).toBe("ocx")
		expect(tokens[1]).toBe("update")

		const args = tokens.slice(2)
		expect(args.length).toBeGreaterThan(0)

		for (const flag of args.filter((arg) => arg.startsWith("--"))) {
			expect(supportedFlags.has(flag)).toBe(true)
		}

		expect(isSupportedUpdateRemediationCommand(command)).toBe(true)
	}
}

describe("verify remediation command helpers", () => {
	it("collects quoted/backtick/unquoted remediation commands and deduplicates", () => {
		const output =
			"Use 'ocx update kdco/test-plugin' first. If needed run `ocx update --all`, then " +
			'rerun "ocx update --all". Avoid a bare ocx update. ' +
			"Finally rerun ocx update kdco/test-plugin."

		expect(extractSuggestedUpdateCommands(output)).toEqual([
			"ocx update kdco/test-plugin",
			"ocx update --all",
		])
	})

	it("accepts supported registry and multi-component remediation forms", () => {
		const updateHelpOutput = `
Usage: ocx update [components...]

Options:
  --all
  --registry <name>
`

		expect(() =>
			expectValidUpdateRemediation("Run `ocx update --registry <name>`.", updateHelpOutput),
		).not.toThrow()
		expect(() =>
			expectValidUpdateRemediation(
				"Run ocx update kdco/test-plugin kdco/test-skill.",
				updateHelpOutput,
			),
		).not.toThrow()
	})

	it("rejects invalid remediation command combinations", () => {
		const updateHelpOutput = `
Usage: ocx update [components...]

Options:
  --all
  --registry <name>
`

		for (const invalidCommand of [
			"ocx update --all kdco/test-plugin",
			"ocx update --registry",
			"ocx update --registry KDCO",
			"ocx update --registry kdco/test-plugin",
			"ocx update --registry kdco kdco/test-plugin",
		]) {
			expect(() => expectValidUpdateRemediation(invalidCommand, updateHelpOutput)).toThrow()
		}
	})

	it("requires exact long-flag membership from help output", () => {
		const updateHelpOutput = `
Usage: ocx update [components...]

The deprecated --reg alias is shown in prose and must not be parsed as supported.

Options:
  --registry <name>  (legacy mentions: --reg)
`

		expect(() => expectValidUpdateRemediation("ocx update --reg kdco", updateHelpOutput)).toThrow()
		expect(() =>
			expectValidUpdateRemediation("ocx update --registry kdco", updateHelpOutput),
		).not.toThrow()
	})
})

describe("ocx verify", () => {
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

	/**
	 * Helper to initialize project and add registry
	 */
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

	/**
	 * Helper to install a component
	 */
	async function installComponent(dir: string, componentName: string): Promise<void> {
		const { exitCode, output } = await runCLI(["add", componentName], dir)
		if (exitCode !== 0) {
			throw new Error(`Failed to install ${componentName}: ${output}`)
		}
	}

	// =========================================================================
	// No components installed
	// =========================================================================

	it("should succeed with no components installed (normal output)", async () => {
		testDir = await setupProject("verify-no-components")

		const { exitCode, output } = await runCLI(["verify"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("No components installed")
	})

	it("should succeed with no components installed (JSON output)", async () => {
		testDir = await setupProject("verify-no-components-json")

		const { exitCode, output } = await runCLI(["verify", "--json"], testDir)

		expect(exitCode).toBe(0)

		const json = JSON.parse(output)
		expect(json.success).toBe(true)
		expect(json.verified).toEqual([])
		expect(json.errors).toEqual([])
	})

	// =========================================================================
	// All components intact
	// =========================================================================

	it("should verify all intact components successfully", async () => {
		testDir = await setupProject("verify-intact")

		// Install components
		await installComponent(testDir, "kdco/test-plugin")
		await installComponent(testDir, "kdco/test-skill")

		const { exitCode, output } = await runCLI(["verify"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("All components verified successfully")
	})

	it("should verify all intact components with JSON output", async () => {
		testDir = await setupProject("verify-intact-json")

		await installComponent(testDir, "kdco/test-plugin")

		const { exitCode, output } = await runCLI(["verify", "--json"], testDir)

		expect(exitCode).toBe(0)

		const json = JSON.parse(output)
		expect(json.success).toBe(true)
		expect(json.verified.length).toBeGreaterThan(0)
		expect(json.errors).toEqual([])

		// Verify structure of verified entry
		const verifiedEntry = json.verified[0]
		expect(verifiedEntry.canonicalId).toBeDefined()
		expect(verifiedEntry.intact).toBe(true)
		expect(verifiedEntry.modified).toEqual([])
		expect(verifiedEntry.missing).toEqual([])
	})

	it("should return exit 0 in quiet mode when all components are intact", async () => {
		testDir = await setupProject("verify-quiet-intact")

		await installComponent(testDir, "kdco/test-plugin")

		const { exitCode, output } = await runCLI(["verify", "--quiet"], testDir)

		expect(exitCode).toBe(0)
		expect(output).not.toContain("All components verified successfully")
		expect(output).not.toContain("Verifying components")
	})

	// =========================================================================
	// Verify specific canonical ID
	// =========================================================================

	it("should verify a specific component by canonical ID", async () => {
		testDir = await setupProject("verify-specific")

		await installComponent(testDir, "kdco/test-plugin")
		await installComponent(testDir, "kdco/test-skill")

		// Read receipt to get canonical ID
		const receiptPath = join(testDir, ".ocx/receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as Record<string, unknown>
		const installedKeys = Object.keys(receipt.installed as Record<string, unknown>)
		const pluginKey = installedKeys.find((k) => k.includes("test-plugin"))

		expect(pluginKey).toBeDefined()
		if (!pluginKey) throw new Error("pluginKey should be defined")

		const { exitCode, output } = await runCLI(["verify", pluginKey], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("All components verified successfully")
	})

	// =========================================================================
	// Modified file detection
	// =========================================================================

	it("should detect modified file and fail with conflict", async () => {
		testDir = await setupProject("verify-modified")

		await installComponent(testDir, "kdco/test-plugin")

		// Modify the installed file
		const filePath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		expect(existsSync(filePath)).toBe(true)
		await writeFile(filePath, "// Modified by user - this is different content")

		const { exitCode, output } = await runCLI(["verify"], testDir)

		// Should fail due to integrity check failure
		expect(exitCode).not.toBe(0)
		expect(output).toContain("integrity check failed")
		expect(output).toContain("Modified")
	})

	it("should fail in quiet mode when file integrity is modified", async () => {
		testDir = await setupProject("verify-quiet-modified")

		await installComponent(testDir, "kdco/test-plugin")

		const filePath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		expect(existsSync(filePath)).toBe(true)
		await writeFile(filePath, "// Modified by quiet-mode test")

		const { exitCode, output } = await runCLI(["verify", "--quiet"], testDir)

		expect(exitCode).toBe(6)
		expect(output).toContain("integrity check failed")
		expect(output).not.toContain("Modified:")
	})

	it("should provide actionable remediation with supported update command options", async () => {
		testDir = await setupProject("verify-remediation")

		await installComponent(testDir, "kdco/test-plugin")

		const filePath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		await writeFile(filePath, "// Modified content to trigger remediation")

		const verifyResult = await runCLI(["verify"], testDir)
		expect(verifyResult.exitCode).not.toBe(0)
		expect(verifyResult.output).toContain("integrity check failed")
		expect(verifyResult.output).toContain("ocx update")
		expect(verifyResult.output).not.toContain("ocx update --force")

		const updateHelp = await runCLI(["update", "--help"], testDir)
		expect(updateHelp.exitCode).toBe(0)

		// Guard assertion: remediation commands must only reference help-supported flags.
		expectValidUpdateRemediation(verifyResult.output, updateHelp.output)
	})

	it("should report modified files in JSON output", async () => {
		testDir = await setupProject("verify-modified-json")

		await installComponent(testDir, "kdco/test-plugin")

		// Modify the installed file
		const filePath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		await writeFile(filePath, "// Modified content")

		const { exitCode, output } = await runCLI(["verify", "--json"], testDir)

		expect(exitCode).not.toBe(0)

		const json = JSON.parse(output)
		expect(json.success).toBe(false)
		expect(json.errors.length).toBeGreaterThan(0)

		const errorEntry = json.errors[0]
		expect(errorEntry.intact).toBe(false)
		expect(errorEntry.modified.length).toBeGreaterThan(0)
	})

	// =========================================================================
	// Missing file detection
	// =========================================================================

	it("should detect missing file and fail", async () => {
		testDir = await setupProject("verify-missing")

		await installComponent(testDir, "kdco/test-plugin")

		// Delete the installed file
		const filePath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		expect(existsSync(filePath)).toBe(true)
		await rm(filePath, { force: true })

		const { exitCode, output } = await runCLI(["verify"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("integrity check failed")
		expect(output).toContain("Missing")
	})

	it("should fail in quiet mode when installed file is missing", async () => {
		testDir = await setupProject("verify-quiet-missing")

		await installComponent(testDir, "kdco/test-plugin")

		const filePath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		expect(existsSync(filePath)).toBe(true)
		await rm(filePath, { force: true })

		const { exitCode, output } = await runCLI(["verify", "--quiet"], testDir)

		expect(exitCode).toBe(6)
		expect(output).toContain("integrity check failed")
		expect(output).not.toContain("Missing:")
	})

	it("should report missing files in JSON output", async () => {
		testDir = await setupProject("verify-missing-json")

		await installComponent(testDir, "kdco/test-plugin")

		// Delete the installed file
		const filePath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		await rm(filePath, { force: true })

		const { exitCode, output } = await runCLI(["verify", "--json"], testDir)

		expect(exitCode).not.toBe(0)

		const json = JSON.parse(output)
		expect(json.success).toBe(false)
		expect(json.errors.length).toBeGreaterThan(0)

		const errorEntry = json.errors[0]
		expect(errorEntry.intact).toBe(false)
		expect(errorEntry.missing.length).toBeGreaterThan(0)
	})

	// =========================================================================
	// Mixed intact and broken components
	// =========================================================================

	it("should report both verified and errors in JSON when mixed", async () => {
		testDir = await setupProject("verify-mixed")

		// Install two components
		await installComponent(testDir, "kdco/test-plugin")
		await installComponent(testDir, "kdco/test-skill")

		// Modify only the plugin file (skill should remain intact)
		const pluginPath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		await writeFile(pluginPath, "// Modified plugin content")

		const { exitCode, output } = await runCLI(["verify", "--json"], testDir)

		expect(exitCode).not.toBe(0)

		const json = JSON.parse(output)
		expect(json.success).toBe(false)

		// Should have both verified and error entries
		expect(json.verified.length).toBeGreaterThan(0)
		expect(json.errors.length).toBeGreaterThan(0)

		// Verify bucket structure
		const intactEntry = json.verified.find((e: { intact: boolean }) => e.intact === true)
		const brokenEntry = json.errors.find((e: { intact: boolean }) => e.intact === false)

		expect(intactEntry).toBeDefined()
		expect(brokenEntry).toBeDefined()
	})

	// =========================================================================
	// Shorthand component ref resolution
	// =========================================================================

	it("should resolve shorthand and canonical refs equivalently", async () => {
		testDir = await setupProject("verify-shorthand-canonical-parity")

		await installComponent(testDir, "kdco/test-plugin")

		const receiptPath = join(testDir, ".ocx/receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			installed: Record<string, unknown>
		}
		const pluginCanonicalId = Object.keys(receipt.installed).find((key) =>
			key.includes("kdco/test-plugin@"),
		)
		expect(pluginCanonicalId).toBeDefined()
		if (!pluginCanonicalId) {
			throw new Error("Expected test-plugin canonical ID in receipt")
		}

		const canonicalRun = await runCLI(["verify", pluginCanonicalId, "--json"], testDir)
		const shorthandRun = await runCLI(["verify", "kdco/test-plugin", "--json"], testDir)

		expect(canonicalRun.exitCode).toBe(0)
		expect(shorthandRun.exitCode).toBe(0)

		const canonicalPayload = JSON.parse(canonicalRun.output) as {
			verified: Array<{ canonicalId: string }>
			errors: Array<{ canonicalId: string }>
		}
		const shorthandPayload = JSON.parse(shorthandRun.output) as {
			verified: Array<{ canonicalId: string }>
			errors: Array<{ canonicalId: string }>
		}

		expect(canonicalPayload.errors).toHaveLength(0)
		expect(shorthandPayload.errors).toHaveLength(0)
		expect(canonicalPayload.verified.map((entry) => entry.canonicalId)).toEqual([pluginCanonicalId])
		expect(shorthandPayload.verified.map((entry) => entry.canonicalId)).toEqual([pluginCanonicalId])
	})

	it("should verify a specific component by shorthand ref", async () => {
		testDir = await setupProject("verify-shorthand")

		await installComponent(testDir, "kdco/test-plugin")
		await installComponent(testDir, "kdco/test-skill")

		// Verify using shorthand "namespace/name" instead of full canonical ID
		const { exitCode, output } = await runCLI(["verify", "kdco/test-plugin"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("All components verified successfully")
	})

	it("should fail for shorthand ref not installed", async () => {
		testDir = await setupProject("verify-shorthand-notfound")

		await installComponent(testDir, "kdco/test-plugin")

		// Verify a component that is not installed via shorthand
		const { exitCode, output } = await runCLI(["verify", "kdco/nonexistent"], testDir)

		// Should fail with NOT_FOUND
		expect(exitCode).not.toBe(0)
		expect(output).toContain("not installed")
	})

	it("should detect integrity failure via shorthand ref", async () => {
		testDir = await setupProject("verify-shorthand-integrity")

		await installComponent(testDir, "kdco/test-plugin")

		// Corrupt the installed file
		const filePath = join(testDir, ".opencode", "plugins", "test-plugin.ts")
		expect(existsSync(filePath)).toBe(true)
		await writeFile(filePath, "// Corrupted content via shorthand test")

		// Verify using shorthand ref - should detect integrity failure
		const { exitCode, output } = await runCLI(["verify", "kdco/test-plugin"], testDir)

		expect(exitCode).toBe(6) // EXIT_CODES.CONFLICT
		expect(output).toContain("integrity check failed")
		expect(output).toContain("Modified")
	})

	// =========================================================================
	// Unknown requested component
	// =========================================================================

	it("should fail for unknown component ref", async () => {
		testDir = await setupProject("verify-unknown")

		await installComponent(testDir, "kdco/test-plugin")

		// Verify a non-existent component - should fail with NOT_FOUND
		const { exitCode, output } = await runCLI(["verify", "unknown-component"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("not installed")
	})

	it("should return actionable unknown-ref guidance", async () => {
		testDir = await setupProject("verify-unknown-actionable")

		await installComponent(testDir, "kdco/test-plugin")

		const result = await runCLI(["verify", "kdco/not-installed", "--json"], testDir)

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

	// =========================================================================
	// Not initialized / no receipt
	// =========================================================================

	it("should fail when project not initialized", async () => {
		testDir = await createTempDir("verify-not-init")

		const { exitCode, output } = await runCLI(["verify"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("ocx init")
	})

	it("should succeed with no receipt (no components installed)", async () => {
		testDir = await setupProject("verify-no-receipt")

		// Project is initialized but no components installed (no receipt)
		const { exitCode, output } = await runCLI(["verify"], testDir)

		expect(exitCode).toBe(0)
		expect(output).toContain("No components installed")
	})
})

describe("ocx verify ambiguity", () => {
	let testDir: string
	let registry: MockRegistry

	afterEach(async () => {
		registry?.stop()
		if (testDir) {
			await cleanupTempDir(testDir)
		}
	})

	it("should fail with ambiguity error when shorthand matches multiple canonical IDs", async () => {
		registry = startMockRegistry()
		testDir = await createTempDir("verify-ambiguity")
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = { kdco: { url: registry.url } }
		await writeFile(configPath, JSON.stringify(config, null, 2))

		// Install a component to get a valid receipt, then manually craft ambiguity
		const { exitCode: addExit } = await runCLI(["add", "kdco/test-plugin"], testDir)
		expect(addExit).toBe(0)

		// Read receipt and duplicate the entry under a different URL to simulate ambiguity
		const receiptPath = join(testDir, ".ocx/receipt.jsonc")
		const receiptContent = await readFile(receiptPath, "utf-8")
		const receipt = parseJsonc(receiptContent) as Record<string, unknown>
		const installed = receipt.installed as Record<string, unknown>
		const originalKey = Object.keys(installed).find((k) => k.includes("test-plugin"))
		expect(originalKey).toBeDefined()
		if (!originalKey) throw new Error("originalKey should be defined")

		// Create a second entry with a different URL but same registryName/name
		const secondKey = originalKey.replace(/^https?:\/\/[^:]+/, "https://other-registry.example.com")
		installed[secondKey] = installed[originalKey]
		await writeFile(receiptPath, JSON.stringify(receipt, null, 2))

		// Now verify using shorthand — should fail with ambiguity error
		const { exitCode, output } = await runCLI(["verify", "kdco/test-plugin"], testDir)

		expect(exitCode).not.toBe(0)
		expect(output).toContain("Ambiguous")
		expect(output).toContain("canonical ID")
	})

	it("should provide deterministic canonical suggestions for ambiguous shorthand", async () => {
		registry = startMockRegistry()
		testDir = await createTempDir("verify-ambiguity-deterministic")
		await runCLI(["init"], testDir)

		const configPath = join(testDir, ".opencode", "ocx.jsonc")
		const config = parseJsonc(await readFile(configPath, "utf-8")) as Record<string, unknown>
		config.registries = { kdco: { url: registry.url } }
		await writeFile(configPath, JSON.stringify(config, null, 2))

		const addResult = await runCLI(["add", "kdco/test-plugin"], testDir)
		expect(addResult.exitCode).toBe(0)

		const receiptPath = join(testDir, ".ocx/receipt.jsonc")
		const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
			installed: Record<string, unknown>
		}

		const originalCanonicalId = Object.keys(receipt.installed).find((key) =>
			key.includes("kdco/test-plugin@"),
		)
		expect(originalCanonicalId).toBeDefined()
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

		const result = await runCLI(["verify", "kdco/test-plugin", "--json"], testDir)

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
})
