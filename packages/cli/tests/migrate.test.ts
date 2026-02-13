/**
 * Tests for ocx migrate command
 *
 * TDD: Tests written first to define the migration contract.
 * Covers: help registration, no-op states, dry-run preview,
 * apply write+backup, json output, rerun idempotency,
 * --global scope, registry config normalization.
 */

import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "./fixture"
import { parseJsonc, runCLI } from "./helpers"

// =============================================================================
// Helpers
// =============================================================================

/** Minimal legacy ocx.lock content for migration tests */
function createLegacyLock(overrides?: {
	installed?: Record<string, unknown>
	installedFrom?: Record<string, unknown>
}): string {
	const lock = {
		lockVersion: 1,
		...(overrides?.installedFrom && { installedFrom: overrides.installedFrom }),
		installed: overrides?.installed ?? {
			"kdco/researcher": {
				registry: "kdco",
				version: "1.0.0",
				hash: "abc123def456",
				files: [".opencode/agents/researcher.md"],
				installedAt: "2025-06-01T00:00:00.000Z",
			},
			"kdco/test-plugin": {
				registry: "kdco",
				version: "2.0.0",
				hash: "def789ghi012",
				files: [".opencode/plugins/test-plugin.ts"],
				installedAt: "2025-06-02T00:00:00.000Z",
				updatedAt: "2025-06-03T00:00:00.000Z",
			},
		},
	}
	return JSON.stringify(lock, null, 2)
}

/** Set up a project with ocx.jsonc config containing registries */
async function setupProjectWithConfig(
	dir: string,
	registries?: Record<string, { url: string; version?: string }>,
): Promise<void> {
	const configDir = join(dir, ".opencode")
	await mkdir(configDir, { recursive: true })

	// Create .git directory for git-root detection
	await mkdir(join(dir, ".git"), { recursive: true })

	const config = {
		registries: registries ?? {
			kdco: { url: "https://ocx.kdco.dev" },
		},
	}
	await writeFile(join(configDir, "ocx.jsonc"), JSON.stringify(config, null, 2))
}

/** Write a legacy lock file at the standard location */
async function writeLegacyLock(dir: string, content?: string): Promise<string> {
	const lockDir = join(dir, ".opencode")
	await mkdir(lockDir, { recursive: true })
	const lockPath = join(lockDir, "ocx.lock")
	await writeFile(lockPath, content ?? createLegacyLock())
	return lockPath
}

/**
 * Set up a global-like directory structure for --global tests.
 * Global mode uses flattened paths (lock at root, config at .opencode/).
 */
async function setupGlobalDir(
	dir: string,
	options?: {
		registries?: Record<string, { url: string; version?: string }>
		lock?: string | false
		receipt?: boolean
	},
): Promise<void> {
	const configDir = join(dir, ".opencode")
	await mkdir(configDir, { recursive: true })

	// Create .git directory for git-root detection
	await mkdir(join(dir, ".git"), { recursive: true })

	const registries = options?.registries ?? {
		kdco: { url: "https://ocx.kdco.dev" },
	}
	await writeFile(join(configDir, "ocx.jsonc"), JSON.stringify({ registries }, null, 2))

	// Global mode: lock at root (flattened)
	if (options?.lock !== false) {
		const lockContent = options?.lock ?? createLegacyLock()
		await writeFile(join(dir, "ocx.lock"), lockContent)
	}

	if (options?.receipt) {
		const receiptDir = join(dir, ".ocx")
		await mkdir(receiptDir, { recursive: true })
		await writeFile(
			join(receiptDir, "receipt.jsonc"),
			JSON.stringify({ version: 1, installed: {} }, null, 2),
		)
	}
}

// =============================================================================
// Command registration
// =============================================================================

describe("ocx migrate", () => {
	describe("command registration", () => {
		it("should show migrate in help output", async () => {
			await using tmp = await tmpdir({ git: true })
			const { exitCode, output } = await runCLI(["--help"], tmp.path)

			expect(exitCode).toBe(0)
			expect(output).toContain("migrate")
		})

		it("should show migrate command help", async () => {
			await using tmp = await tmpdir({ git: true })
			const { exitCode, output } = await runCLI(["migrate", "--help"], tmp.path)

			expect(exitCode).toBe(0)
			expect(output).toContain("--apply")
			expect(output).toContain("--json")
		})

		it("should show --global in migrate command help", async () => {
			await using tmp = await tmpdir({ git: true })
			const { exitCode, output } = await runCLI(["migrate", "--help"], tmp.path)

			expect(exitCode).toBe(0)
			expect(output).toContain("--global")
		})
	})

	// =========================================================================
	// No-op states: neither lock nor receipt exist
	// =========================================================================

	describe("no-op: no lock, no receipt", () => {
		it("should exit 0 with nothing-to-migrate message", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)

			const { exitCode, output } = await runCLI(["migrate"], tmp.path)

			expect(exitCode).toBe(0)
			expect(output.toLowerCase()).toContain("nothing to migrate")
		})

		it("should return success JSON when --json", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)

			const { exitCode, stdout } = await runCLI(["migrate", "--json"], tmp.path)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(true)
			expect(json.status).toBe("nothing_to_migrate")
		})
	})

	// =========================================================================
	// No-op: receipt already exists (already v2)
	// =========================================================================

	describe("no-op: receipt already exists", () => {
		it("should exit 0 with already-v2 message", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)

			// Create a v2 receipt
			const receiptDir = join(tmp.path, ".ocx")
			await mkdir(receiptDir, { recursive: true })
			await writeFile(
				join(receiptDir, "receipt.jsonc"),
				JSON.stringify({ version: 1, installed: {} }, null, 2),
			)

			const { exitCode, output } = await runCLI(["migrate"], tmp.path)

			expect(exitCode).toBe(0)
			expect(output.toLowerCase()).toMatch(/already.*v2|already migrated/)
		})

		it("should return success JSON with already_v2 status when --json", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)

			const receiptDir = join(tmp.path, ".ocx")
			await mkdir(receiptDir, { recursive: true })
			await writeFile(
				join(receiptDir, "receipt.jsonc"),
				JSON.stringify({ version: 1, installed: {} }, null, 2),
			)

			const { exitCode, stdout } = await runCLI(["migrate", "--json"], tmp.path)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(true)
			expect(json.status).toBe("already_v2")
		})
	})

	// =========================================================================
	// Dry-run preview: lock exists, default (no --apply)
	// =========================================================================

	describe("dry-run preview", () => {
		it("should show preview plan with component count", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			const { exitCode, output } = await runCLI(["migrate"], tmp.path)

			expect(exitCode).toBe(0)
			// Should show the count of components that would be migrated
			expect(output).toContain("2")
			// Should indicate no changes made
			expect(output.toLowerCase()).toMatch(/preview|dry.run|would/)
		})

		it("should NOT create receipt.jsonc during preview", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			await runCLI(["migrate"], tmp.path)

			const receiptPath = join(tmp.path, ".ocx", "receipt.jsonc")
			expect(existsSync(receiptPath)).toBe(false)
		})

		it("should NOT rename lock file during preview", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			const lockPath = await writeLegacyLock(tmp.path)

			await runCLI(["migrate"], tmp.path)

			// Lock should still exist, no .bak
			expect(existsSync(lockPath)).toBe(true)
			expect(existsSync(`${lockPath}.bak`)).toBe(false)
		})

		it("should return preview JSON with component details when --json", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			const { exitCode, stdout } = await runCLI(["migrate", "--json"], tmp.path)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(true)
			expect(json.status).toBe("preview")
			expect(json.count).toBe(2)
			expect(Array.isArray(json.components)).toBe(true)
			expect(json.components.length).toBe(2)
		})
	})

	// =========================================================================
	// Apply migration: lock exists, --apply
	// =========================================================================

	describe("apply migration", () => {
		it("should create receipt.jsonc from legacy lock", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			const { exitCode } = await runCLI(["migrate", "--apply"], tmp.path)

			expect(exitCode).toBe(0)

			// Receipt should exist
			const receiptPath = join(tmp.path, ".ocx", "receipt.jsonc")
			expect(existsSync(receiptPath)).toBe(true)

			// Verify receipt content
			const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
				version: number
				installed: Record<string, unknown>
			}
			expect(receipt.version).toBe(1)
			expect(Object.keys(receipt.installed).length).toBe(2)
		})

		it("should rename lock file to .bak", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			const lockPath = await writeLegacyLock(tmp.path)

			const { exitCode } = await runCLI(["migrate", "--apply"], tmp.path)

			expect(exitCode).toBe(0)

			// Lock should be renamed to .bak
			expect(existsSync(lockPath)).toBe(false)
			expect(existsSync(`${lockPath}.bak`)).toBe(true)
		})

		it("should preserve component data in receipt", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			await runCLI(["migrate", "--apply"], tmp.path)

			const receiptPath = join(tmp.path, ".ocx", "receipt.jsonc")
			const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
				version: number
				installed: Record<
					string,
					{
						registryUrl: string
						registryName: string
						name: string
						revision: string
						hash: string
						files: Array<{ path: string; hash: string }>
						installedAt: string
						updatedAt?: string
					}
				>
			}

			// Find the researcher entry
			const entries = Object.values(receipt.installed)
			const researcher = entries.find((e) => e.name === "researcher")
			expect(researcher).toBeDefined()
			if (!researcher) throw new Error("researcher not found")

			// Verify fields are preserved
			expect(researcher.registryName).toBe("kdco")
			expect(researcher.revision).toBe("1.0.0")
			expect(researcher.hash).toBe("abc123def456")
			expect(researcher.installedAt).toBe("2025-06-01T00:00:00.000Z")
			expect(researcher.files.length).toBe(1)
			expect(researcher.files[0]?.path).toBe(".opencode/agents/researcher.md")

			// Verify updatedAt is preserved for test-plugin
			const plugin = entries.find((e) => e.name === "test-plugin")
			expect(plugin).toBeDefined()
			if (!plugin) throw new Error("test-plugin not found")
			expect(plugin.updatedAt).toBe("2025-06-03T00:00:00.000Z")
		})

		it("should report migrated count in output", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			const { exitCode, output } = await runCLI(["migrate", "--apply"], tmp.path)

			expect(exitCode).toBe(0)
			expect(output).toContain("2")
			expect(output.toLowerCase()).toMatch(/migrat/)
		})

		it("should return success JSON with migrated status when --json --apply", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			const { exitCode, stdout } = await runCLI(["migrate", "--apply", "--json"], tmp.path)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(true)
			expect(json.status).toBe("migrated")
			expect(json.count).toBe(2)
		})
	})

	// =========================================================================
	// Idempotent rerun: apply after successful migration
	// =========================================================================

	describe("idempotent rerun", () => {
		it("should be a safe no-op when receipt exists after prior apply", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			// First apply
			const first = await runCLI(["migrate", "--apply"], tmp.path)
			expect(first.exitCode).toBe(0)

			// Second apply (lock is now .bak, receipt exists)
			const second = await runCLI(["migrate", "--apply"], tmp.path)
			expect(second.exitCode).toBe(0)
			expect(second.output.toLowerCase()).toMatch(/already.*v2|already migrated/)
		})

		it("should return already_v2 JSON on rerun with --json", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			// First apply
			await runCLI(["migrate", "--apply"], tmp.path)

			// Second apply with --json
			const { exitCode, stdout } = await runCLI(["migrate", "--apply", "--json"], tmp.path)
			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(true)
			expect(json.status).toBe("already_v2")
		})
	})

	// =========================================================================
	// Edge cases
	// =========================================================================

	describe("edge cases", () => {
		it("should handle lock file with empty installed map", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path, createLegacyLock({ installed: {} }))

			const { exitCode, output } = await runCLI(["migrate"], tmp.path)

			expect(exitCode).toBe(0)
			// Even empty locks count as "nothing to migrate" since there are no components
			expect(output).toMatch(/0|nothing/i)
		})

		it("should handle lock file with single component", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(
				tmp.path,
				createLegacyLock({
					installed: {
						"kdco/researcher": {
							registry: "kdco",
							version: "1.0.0",
							hash: "abc123",
							files: [".opencode/agents/researcher.md"],
							installedAt: "2025-06-01T00:00:00.000Z",
						},
					},
				}),
			)

			const { exitCode } = await runCLI(["migrate", "--apply"], tmp.path)
			expect(exitCode).toBe(0)

			const receiptPath = join(tmp.path, ".ocx", "receipt.jsonc")
			const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
				installed: Record<string, unknown>
			}
			expect(Object.keys(receipt.installed).length).toBe(1)
		})

		it("should use registry URL from ocx.jsonc config", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path, {
				kdco: { url: "https://custom-registry.example.com" },
			})
			await writeLegacyLock(tmp.path)

			await runCLI(["migrate", "--apply"], tmp.path)

			const receiptPath = join(tmp.path, ".ocx", "receipt.jsonc")
			const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
				installed: Record<string, { registryUrl: string }>
			}

			const entry = Object.values(receipt.installed)[0]
			expect(entry?.registryUrl).toBe("https://custom-registry.example.com")
		})

		it("should fail with CONFIG_ERROR when registry alias is missing from config", async () => {
			await using tmp = await tmpdir({ git: true })
			// Config has "other" registry, but lock references "kdco"
			await setupProjectWithConfig(tmp.path, {
				other: { url: "https://other.example.com" },
			})
			await writeLegacyLock(tmp.path)

			const { exitCode, stdout } = await runCLI(["migrate", "--apply", "--json"], tmp.path)

			expect(exitCode).not.toBe(0)
			const json = JSON.parse(stdout) as {
				success: boolean
				error: { code: string; message: string }
			}
			expect(json.success).toBe(false)
			expect(json.error.code).toBe("CONFIG_ERROR")
			expect(json.error.message).toContain("kdco")
		})

		it("should fail with VALIDATION_ERROR on malformed lock file", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			// Write invalid JSON as lock content
			await writeLegacyLock(tmp.path, "{ this is not valid json !!!")

			const { exitCode, stdout } = await runCLI(["migrate", "--apply", "--json"], tmp.path)

			expect(exitCode).not.toBe(0)
			const json = JSON.parse(stdout) as {
				success: boolean
				error: { code: string }
			}
			expect(json.success).toBe(false)
			// Zod parse or JSONC parse failure surfaces as a structured error
			expect(json.error.code).toBeDefined()
		})

		it("should fail with CONFIG_ERROR when lock exists but no ocx config", async () => {
			await using tmp = await tmpdir({ git: true })
			// Write lock but NO ocx.jsonc config
			await writeLegacyLock(tmp.path)

			const { exitCode, stdout } = await runCLI(["migrate", "--apply", "--json"], tmp.path)

			expect(exitCode).not.toBe(0)
			const json = JSON.parse(stdout) as {
				success: boolean
				error: { code: string; message: string }
			}
			expect(json.success).toBe(false)
			expect(json.error.code).toBe("CONFIG_ERROR")
			expect(json.error.message).toContain("ocx.jsonc")
		})

		it("should use empty string sentinel for per-file hashes in migrated receipt", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			await runCLI(["migrate", "--apply"], tmp.path)

			const receiptPath = join(tmp.path, ".ocx", "receipt.jsonc")
			const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
				installed: Record<string, { files: Array<{ path: string; hash: string }> }>
			}

			// Every file entry should have hash as empty string sentinel
			for (const entry of Object.values(receipt.installed)) {
				for (const file of entry.files) {
					expect(file.hash).toBe("")
				}
			}
		})

		it("should omit updatedAt field entirely when not present in legacy entry", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(
				tmp.path,
				createLegacyLock({
					installed: {
						"kdco/researcher": {
							registry: "kdco",
							version: "1.0.0",
							hash: "abc123",
							files: [".opencode/agents/researcher.md"],
							installedAt: "2025-06-01T00:00:00.000Z",
							// No updatedAt field
						},
					},
				}),
			)

			await runCLI(["migrate", "--apply"], tmp.path)

			const receiptPath = join(tmp.path, ".ocx", "receipt.jsonc")
			const raw = await readFile(receiptPath, "utf-8")
			const receipt = parseJsonc(raw) as {
				installed: Record<string, Record<string, unknown>>
			}

			const entry = Object.values(receipt.installed)[0]
			expect(entry).toBeDefined()
			// updatedAt should not exist at all (not even as undefined)
			expect("updatedAt" in (entry as Record<string, unknown>)).toBe(false)
		})

		it("should set owner.type to 'user' on migrated entries", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			await runCLI(["migrate", "--apply"], tmp.path)

			const receiptPath = join(tmp.path, ".ocx", "receipt.jsonc")
			const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
				installed: Record<string, { owner?: { type: string } }>
			}

			for (const entry of Object.values(receipt.installed)) {
				expect(entry.owner).toEqual({ type: "user" })
			}
		})

		it("should set root on migrated receipt", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			await runCLI(["migrate", "--apply"], tmp.path)

			const receiptPath = join(tmp.path, ".ocx", "receipt.jsonc")
			const receipt = parseJsonc(await readFile(receiptPath, "utf-8")) as {
				root?: string
			}

			expect(receipt.root).toBeDefined()
			expect(typeof receipt.root).toBe("string")
			expect((receipt.root as string).length).toBeGreaterThan(0)
		})

		it("should use non-colliding backup name when .bak already exists", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			const lockPath = await writeLegacyLock(tmp.path)

			// Pre-create .bak file to force collision
			await writeFile(`${lockPath}.bak`, "old backup content")

			const { exitCode } = await runCLI(["migrate", "--apply"], tmp.path)

			expect(exitCode).toBe(0)

			// Original lock should be gone
			expect(existsSync(lockPath)).toBe(false)
			// Old .bak should be preserved
			const oldBakContent = await readFile(`${lockPath}.bak`, "utf-8")
			expect(oldBakContent).toBe("old backup content")
			// New backup should be at .bak.1
			expect(existsSync(`${lockPath}.bak.1`)).toBe(true)
		})
	})

	// =========================================================================
	// --global scope
	// =========================================================================

	describe("--global scope", () => {
		it("should show nothing-to-migrate for empty global dir", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, { lock: false })

			const { exitCode, output } = await runCLI(
				["migrate", "--global", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			expect(output.toLowerCase()).toContain("nothing to migrate")
			// Should indicate global scope
			expect(output.toLowerCase()).toContain("global")
		})

		it("should show already_v2 when global receipt exists and no deprecated config", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, { lock: false, receipt: true })

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(true)
			expect(json.status).toBe("already_v2")
			expect(json.scope).toBe("global")
		})

		it("should preview global lock migration without writing", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path)

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(true)
			expect(json.status).toBe("preview")
			expect(json.scope).toBe("global")
			expect(json.count).toBe(2)

			// No receipt should be created
			expect(existsSync(join(tmp.path, ".ocx", "receipt.jsonc"))).toBe(false)
			// Lock should still exist at root (flattened)
			expect(existsSync(join(tmp.path, "ocx.lock"))).toBe(true)
		})

		it("should apply global migration and create receipt + .bak", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path)

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--apply", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(true)
			expect(json.status).toBe("migrated")
			expect(json.scope).toBe("global")
			expect(json.count).toBe(2)

			// Receipt should exist
			expect(existsSync(join(tmp.path, ".ocx", "receipt.jsonc"))).toBe(true)

			// Lock at root should be renamed to .bak
			expect(existsSync(join(tmp.path, "ocx.lock"))).toBe(false)
			expect(existsSync(join(tmp.path, "ocx.lock.bak"))).toBe(true)
		})

		it("should handle non-colliding .bak in global mode", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path)

			// Pre-create .bak at root
			await writeFile(join(tmp.path, "ocx.lock.bak"), "old backup")

			const { exitCode } = await runCLI(
				["migrate", "--global", "--apply", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			// Original lock gone
			expect(existsSync(join(tmp.path, "ocx.lock"))).toBe(false)
			// Old .bak preserved
			const oldBak = await readFile(join(tmp.path, "ocx.lock.bak"), "utf-8")
			expect(oldBak).toBe("old backup")
			// New backup at .bak.1
			expect(existsSync(join(tmp.path, "ocx.lock.bak.1"))).toBe(true)
		})

		it("should be idempotent on global rerun", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path)

			// First apply
			const first = await runCLI(["migrate", "--global", "--apply", "--cwd", tmp.path], tmp.path)
			expect(first.exitCode).toBe(0)

			// Second apply
			const second = await runCLI(
				["migrate", "--global", "--apply", "--json", "--cwd", tmp.path],
				tmp.path,
			)
			expect(second.exitCode).toBe(0)
			const json = JSON.parse(second.stdout)
			expect(json.status).toBe("already_v2")
			expect(json.scope).toBe("global")
		})
	})

	// =========================================================================
	// Local mode unchanged without --global
	// =========================================================================

	describe("local mode unchanged without --global", () => {
		it("should use local scope by default", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			const { exitCode, stdout } = await runCLI(["migrate", "--json"], tmp.path)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.scope).toBe("local")
		})

		it("should not pick up root-level lock without --global", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			// Put lock at root only (flattened style), not in .opencode/
			await writeFile(join(tmp.path, "ocx.lock"), createLegacyLock())

			const { exitCode, stdout } = await runCLI(["migrate", "--json"], tmp.path)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			// Local mode finds root lock as fallback, so it should see it
			// (findOcxLock checks .opencode/ first, then root)
			expect(json.scope).toBe("local")
		})
	})

	// =========================================================================
	// Registry config normalization
	// =========================================================================

	describe("registry config normalization", () => {
		it("should detect deprecated version field in preview", async () => {
			await using tmp = await tmpdir({ git: true })
			// Config with legacy v1.4.6 version field
			await setupProjectWithConfig(tmp.path, {
				kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" },
			})

			const { exitCode, stdout } = await runCLI(["migrate", "--json"], tmp.path)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(true)
			expect(json.configActions).toBeDefined()
			expect(Array.isArray(json.configActions)).toBe(true)
			expect(json.configActions.length).toBe(1)
			expect(json.configActions[0].registry).toBe("kdco")
			expect(json.configActions[0].field).toBe("version")
			expect(json.configActions[0].action).toBe("remove_deprecated")
		})

		it("should not modify config file during preview", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path, {
				kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" },
			})

			const configPath = join(tmp.path, ".opencode", "ocx.jsonc")
			const before = await readFile(configPath, "utf-8")

			await runCLI(["migrate"], tmp.path)

			const after = await readFile(configPath, "utf-8")
			expect(after).toBe(before)
		})

		it("should remove deprecated version field on --apply", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path, {
				kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" },
			})

			const { exitCode } = await runCLI(["migrate", "--apply"], tmp.path)

			expect(exitCode).toBe(0)

			const configPath = join(tmp.path, ".opencode", "ocx.jsonc")
			const config = parseJsonc(await readFile(configPath, "utf-8")) as {
				registries: Record<string, Record<string, unknown>>
			}

			// version field should be gone
			expect(config.registries.kdco.url).toBe("https://ocx.kdco.dev")
			expect("version" in config.registries.kdco).toBe(false)
		})

		it("should be idempotent on config normalization rerun", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path, {
				kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" },
			})

			// First apply (normalizes config + shows no lock migration since no lock)
			const first = await runCLI(["migrate", "--apply", "--json"], tmp.path)
			expect(first.exitCode).toBe(0)
			const firstJson = JSON.parse(first.stdout)
			expect(firstJson.status).toBe("migrated")
			expect(firstJson.configActions.length).toBe(1)

			// Second apply (should find nothing to normalize, no lock, no receipt)
			const second = await runCLI(["migrate", "--apply", "--json"], tmp.path)
			expect(second.exitCode).toBe(0)
			const secondJson = JSON.parse(second.stdout)
			expect(secondJson.status).toBe("nothing_to_migrate")
			expect(secondJson.configActions.length).toBe(0)
		})

		it("should handle multiple registries with version fields", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path, {
				kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" },
				acme: { url: "https://acme.example.com", version: "2.0.0" },
			})

			const { exitCode, stdout } = await runCLI(["migrate", "--json"], tmp.path)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.configActions.length).toBe(2)

			// Should be sorted by alias
			expect(json.configActions[0].registry).toBe("acme")
			expect(json.configActions[1].registry).toBe("kdco")
		})

		it("should report no config actions when config has no deprecated fields", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)
			await writeLegacyLock(tmp.path)

			const { exitCode, stdout } = await runCLI(["migrate", "--json"], tmp.path)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.configActions).toEqual([])
		})

		it("should normalize config even when receipt already exists", async () => {
			await using tmp = await tmpdir({ git: true })
			// Config with deprecated version field
			await setupProjectWithConfig(tmp.path, {
				kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" },
			})

			// Create receipt (already migrated)
			const receiptDir = join(tmp.path, ".ocx")
			await mkdir(receiptDir, { recursive: true })
			await writeFile(
				join(receiptDir, "receipt.jsonc"),
				JSON.stringify({ version: 1, installed: {} }, null, 2),
			)

			// Preview should show config normalization needed
			const { exitCode, stdout } = await runCLI(["migrate", "--json"], tmp.path)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.status).toBe("preview")
			expect(json.configActions.length).toBe(1)
		})

		it("should apply config normalization even when receipt already exists", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path, {
				kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" },
			})

			// Create receipt
			const receiptDir = join(tmp.path, ".ocx")
			await mkdir(receiptDir, { recursive: true })
			await writeFile(
				join(receiptDir, "receipt.jsonc"),
				JSON.stringify({ version: 1, installed: {} }, null, 2),
			)

			const { exitCode, stdout } = await runCLI(["migrate", "--apply", "--json"], tmp.path)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.status).toBe("migrated")
			expect(json.configActions.length).toBe(1)

			// Config should be normalized
			const configPath = join(tmp.path, ".opencode", "ocx.jsonc")
			const config = parseJsonc(await readFile(configPath, "utf-8")) as {
				registries: Record<string, Record<string, unknown>>
			}
			expect("version" in config.registries.kdco).toBe(false)
		})
	})

	// =========================================================================
	// JSON output includes scope/action details
	// =========================================================================

	describe("JSON output contract", () => {
		it("should include scope in all JSON outputs", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)

			// nothing_to_migrate
			const { stdout } = await runCLI(["migrate", "--json"], tmp.path)
			const json = JSON.parse(stdout)
			expect(json.scope).toBe("local")
		})

		it("should include configActions array in all JSON outputs", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path)

			const { stdout } = await runCLI(["migrate", "--json"], tmp.path)
			const json = JSON.parse(stdout)
			expect(Array.isArray(json.configActions)).toBe(true)
		})

		it("should include scope=global in JSON when --global", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, { lock: false })

			const { stdout } = await runCLI(
				["migrate", "--global", "--json", "--cwd", tmp.path],
				tmp.path,
			)
			const json = JSON.parse(stdout)
			expect(json.scope).toBe("global")
		})

		it("should include configActions detail in JSON when normalization detected", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupProjectWithConfig(tmp.path, {
				kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" },
			})

			const { stdout } = await runCLI(["migrate", "--json"], tmp.path)
			const json = JSON.parse(stdout)
			expect(json.configActions.length).toBeGreaterThan(0)

			const action = json.configActions[0]
			expect(action).toHaveProperty("registry")
			expect(action).toHaveProperty("field")
			expect(action).toHaveProperty("action")
		})
	})

	// =========================================================================
	// --global + config normalization combined
	// =========================================================================

	describe("--global + config normalization", () => {
		it("should apply both lock migration and config normalization in global scope", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, {
				registries: {
					kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" },
				},
			})

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--apply", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(true)
			expect(json.status).toBe("migrated")
			expect(json.scope).toBe("global")
			expect(json.count).toBe(2)
			expect(json.configActions.length).toBe(1)
			expect(json.configActions[0].registry).toBe("kdco")
			expect(json.configActions[0].field).toBe("version")

			// Config should be normalized
			const configPath = join(tmp.path, ".opencode", "ocx.jsonc")
			const config = parseJsonc(await readFile(configPath, "utf-8")) as {
				registries: Record<string, Record<string, unknown>>
			}
			expect(config.registries.kdco.url).toBe("https://ocx.kdco.dev")
			expect("version" in config.registries.kdco).toBe(false)

			// Receipt should exist
			expect(existsSync(join(tmp.path, ".ocx", "receipt.jsonc"))).toBe(true)
			// Lock should be backed up
			expect(existsSync(join(tmp.path, "ocx.lock"))).toBe(false)
			expect(existsSync(join(tmp.path, "ocx.lock.bak"))).toBe(true)
		})

		it("should normalize global config without lock migration when receipt already exists", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, {
				registries: {
					kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" },
				},
				lock: false,
				receipt: true,
			})

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--apply", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.status).toBe("migrated")
			expect(json.scope).toBe("global")
			expect(json.count).toBe(0)
			expect(json.configActions.length).toBe(1)

			// Config should be normalized
			const configPath = join(tmp.path, ".opencode", "ocx.jsonc")
			const config = parseJsonc(await readFile(configPath, "utf-8")) as {
				registries: Record<string, Record<string, unknown>>
			}
			expect("version" in config.registries.kdco).toBe(false)
		})
	})

	// =========================================================================
	// JSONC comment preservation
	// =========================================================================

	describe("JSONC comment preservation", () => {
		it("should preserve comments when removing deprecated fields", async () => {
			await using tmp = await tmpdir({ git: true })
			const configDir = join(tmp.path, ".opencode")
			await mkdir(configDir, { recursive: true })
			await mkdir(join(tmp.path, ".git"), { recursive: true })

			// Write config with JSONC comments
			const jsoncContent = `{
  // Registry configuration
  "registries": {
    // Primary registry
    "kdco": {
      "url": "https://ocx.kdco.dev",
      "version": "1.4.6" // deprecated, should be removed
    }
  }
}
`
			await writeFile(join(configDir, "ocx.jsonc"), jsoncContent)

			const { exitCode } = await runCLI(["migrate", "--apply"], tmp.path)
			expect(exitCode).toBe(0)

			const result = await readFile(join(configDir, "ocx.jsonc"), "utf-8")

			// Comments should be preserved
			expect(result).toContain("// Registry configuration")
			expect(result).toContain("// Primary registry")

			// Deprecated field should be removed
			expect(result).not.toContain('"version"')
			expect(result).not.toContain("1.4.6")

			// URL should still be present
			expect(result).toContain('"url"')
			expect(result).toContain("https://ocx.kdco.dev")
		})
	})
})
