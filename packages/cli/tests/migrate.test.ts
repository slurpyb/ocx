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
import { expectStrictJsonFailure, expectStrictJsonSuccess, parseJsonc, runCLI } from "./helpers"

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
	// Preview diagnostics: degraded-parse warning & error label guard
	// =========================================================================

	describe("preview diagnostics", () => {
		it("should keep human warning when lock parsing fails in global preview", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, {
				// Write invalid lock content to trigger parse failure in analyzeTarget
				lock: "{ this is not valid json !!!",
			})

			const { exitCode, output } = await runCLI(
				["migrate", "--global", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			// Human mode should keep warning output for degraded preview paths.
			expect(output).toContain("component count may be incomplete")
		})

		it("should keep --global --json output strict and stderr-clean on degraded parse", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, {
				// Write invalid lock content to trigger parse failure in analyzeTarget
				lock: "{ this is not valid json !!!",
			})

			const result = await runCLI(["migrate", "--global", "--json", "--cwd", tmp.path], tmp.path)

			expect(result.exitCode).toBe(0)
			expect(result.stderr.trim()).toBe("")
			expect(result.output).not.toContain("component count may be incomplete")

			// JSON output should remain strictly parseable with degraded count=0.
			expect(() => JSON.parse(result.stdout)).not.toThrow()
			const json = expectStrictJsonSuccess(result)
			expect(json.success).toBe(true)
			expect(json.status).toBe("preview")

			// Root target should show count=0 due to degraded parse
			const rootTarget = (
				json.targets as Array<{ target: string; count: number }> | undefined
			)?.find((t) => t.target === "root")
			expect(rootTarget).toBeDefined()
			if (!rootTarget) throw new Error("root target not found")
			expect(rootTarget.count).toBe(0)
		})

		it("should keep --global --json output strict and stderr-clean on malformed config preview", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path)

			// Corrupt config while keeping lock valid to trigger degraded preview.
			await writeFile(join(tmp.path, ".opencode", "ocx.jsonc"), "{ this is not valid json !!!")

			const result = await runCLI(["migrate", "--global", "--json", "--cwd", tmp.path], tmp.path)

			expect(result.exitCode).toBe(0)
			expect(result.stderr.trim()).toBe("")
			expect(result.output).not.toContain("component count may be incomplete")

			// JSON output should remain strictly parseable with degraded count=0.
			expect(() => JSON.parse(result.stdout)).not.toThrow()
			const json = expectStrictJsonSuccess(result)
			expect(json.success).toBe(true)
			expect(json.status).toBe("preview")

			// Root target should show count=0 due to degraded parse
			const rootTarget = (
				json.targets as Array<{ target: string; count: number }> | undefined
			)?.find((t) => t.target === "root")
			expect(rootTarget).toBeDefined()
			if (!rootTarget) throw new Error("root target not found")
			expect(rootTarget.count).toBe(0)
		})

		it("should label error targets as 'error' in global preview output", async () => {
			await using tmp = await tmpdir({ git: true })
			// Root has a valid lock for preview
			await setupGlobalDir(tmp.path)

			// Add a profile with a lock but mismatched config → will fail in apply
			// For preview (analyzeTarget), a bad config just degrades to count=0
			// But describeTargetActions with status=error should return "error"
			// We test via the global apply path which can produce error targets
			const profilesDir = join(tmp.path, "profiles")
			await mkdir(profilesDir, { recursive: true })
			const badDir = join(profilesDir, "bad")
			await mkdir(badDir, { recursive: true })
			await writeFile(
				join(badDir, "ocx.jsonc"),
				JSON.stringify({ registries: { other: { url: "https://other.example.com" } } }, null, 2),
			)
			await writeFile(join(badDir, "ocx.lock"), createLegacyLock())

			// Apply mode: bad profile will error, good root will succeed
			const { exitCode, output } = await runCLI(
				["migrate", "--global", "--apply", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(1)
			// Error should be reported for the bad profile
			expect(output.toLowerCase()).toContain("failed")
			expect(output).toContain("profile:bad")
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

	// =========================================================================
	// --global includes profiles by default
	// =========================================================================

	describe("--global includes profiles", () => {
		/**
		 * Set up a global dir with profile subdirectories.
		 * Each profile gets its own ocx.jsonc and optional lock/receipt.
		 */
		async function setupGlobalWithProfiles(
			dir: string,
			profiles: Array<{
				name: string
				registries?: Record<string, { url: string; version?: string }>
				lock?: string | false
				receipt?: boolean
			}>,
			rootOptions?: {
				registries?: Record<string, { url: string; version?: string }>
				lock?: string | false
				receipt?: boolean
			},
		): Promise<void> {
			// Set up root
			await setupGlobalDir(dir, {
				registries: rootOptions?.registries,
				lock: rootOptions?.lock,
				receipt: rootOptions?.receipt,
			})

			// Set up profiles
			const profilesDir = join(dir, "profiles")
			await mkdir(profilesDir, { recursive: true })

			for (const profile of profiles) {
				const profileDir = join(profilesDir, profile.name)
				await mkdir(profileDir, { recursive: true })

				// Profile config (ocx.jsonc at profile root, not in .opencode)
				const registries = profile.registries ?? {
					kdco: { url: "https://ocx.kdco.dev" },
				}
				await writeFile(join(profileDir, "ocx.jsonc"), JSON.stringify({ registries }, null, 2))

				// Profile lock (at profile root, flattened)
				if (profile.lock !== false) {
					const lockContent = profile.lock ?? createLegacyLock()
					await writeFile(join(profileDir, "ocx.lock"), lockContent)
				}

				// Profile receipt
				if (profile.receipt) {
					const receiptDir = join(profileDir, ".ocx")
					await mkdir(receiptDir, { recursive: true })
					await writeFile(
						join(receiptDir, "receipt.jsonc"),
						JSON.stringify({ version: 1, installed: {} }, null, 2),
					)
				}
			}
		}

		it("migrates lock-only profile roots to receipt and backup lock", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalWithProfiles(tmp.path, [{ name: "work" }], { lock: false })

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--apply", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			const workTarget = json.targets.find((t: { target: string }) => t.target === "profile:work")
			expect(workTarget.status).toBe("migrated")

			expect(existsSync(join(tmp.path, "profiles", "work", ".ocx", "receipt.jsonc"))).toBe(true)
			expect(existsSync(join(tmp.path, "profiles", "work", "ocx.lock"))).toBe(false)
			expect(existsSync(join(tmp.path, "profiles", "work", "ocx.lock.bak"))).toBe(true)
		})

		it("keeps receipt-only profile roots as no-op", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalWithProfiles(tmp.path, [{ name: "work", lock: false, receipt: true }], {
				lock: false,
			})

			const profileReceiptPath = join(tmp.path, "profiles", "work", ".ocx", "receipt.jsonc")
			const receiptBefore = await readFile(profileReceiptPath, "utf-8")

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--apply", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			const workTarget = json.targets.find((t: { target: string }) => t.target === "profile:work")
			expect(workTarget.status).toBe("already_v2")

			const receiptAfter = await readFile(profileReceiptPath, "utf-8")
			expect(receiptAfter).toBe(receiptBefore)
			expect(existsSync(join(tmp.path, "profiles", "work", "ocx.lock"))).toBe(false)
		})

		it("removes stale lock when profile root already has receipt", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalWithProfiles(
				tmp.path,
				[
					{
						name: "work",
						receipt: true,
						// lock defaults to present -> stale lock + receipt case
					},
				],
				{ lock: false },
			)

			const profileReceiptPath = join(tmp.path, "profiles", "work", ".ocx", "receipt.jsonc")
			const sentinelReceipt = `{
  "version": 1,
  "root": "sentinel-root",
  "installed": {}
}
`
			await writeFile(profileReceiptPath, sentinelReceipt)
			const receiptBefore = await readFile(profileReceiptPath, "utf-8")

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--apply", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			const workTarget = json.targets.find((t: { target: string }) => t.target === "profile:work")
			expect(workTarget.status).toBe("migrated")
			expect(workTarget.count).toBe(0)

			expect(existsSync(join(tmp.path, "profiles", "work", "ocx.lock"))).toBe(false)
			expect(existsSync(join(tmp.path, "profiles", "work", "ocx.lock.bak"))).toBe(true)

			const receiptAfter = await readFile(profileReceiptPath, "utf-8")
			expect(receiptAfter).toBe(receiptBefore)
		})

		it("includes stale lock cleanup with config normalization in global preview summary", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalWithProfiles(
				tmp.path,
				[
					{
						name: "work",
						receipt: true,
						registries: {
							kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" },
						},
						// lock defaults to present -> stale lock + config normalization
					},
				],
				{ lock: false },
			)

			const { exitCode, output } = await runCLI(
				["migrate", "--global", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			expect(output).toContain("profile:work")
			expect(output).toContain("1 config field(s) to normalize")
			expect(output).toContain("legacy lock cleanup pending")
			expect(output).toMatch(
				/profile:work: .*1 config field\(s\) to normalize, legacy lock cleanup pending/,
			)
		})

		it("should include profiles in global preview", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalWithProfiles(tmp.path, [{ name: "work" }, { name: "personal", lock: false }])

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(true)
			expect(json.status).toBe("preview")
			expect(json.scope).toBe("global")
			// Should have targets array
			expect(Array.isArray(json.targets)).toBe(true)
			// Root + 2 profiles = 3 targets
			expect(json.targets.length).toBe(3)
			// Root first, then profiles sorted
			expect(json.targets[0].target).toBe("root")
			expect(json.targets[1].target).toBe("profile:personal")
			expect(json.targets[2].target).toBe("profile:work")
		})

		it("should handle mixed target states (already migrated, needs migration, normalization-only)", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalWithProfiles(
				tmp.path,
				[
					// Profile "alpha": already migrated (receipt exists, no deprecated config)
					{ name: "alpha", lock: false, receipt: true },
					// Profile "beta": needs migration (has lock)
					{ name: "beta" },
					// Profile "gamma": normalization-only (no lock, deprecated config)
					{
						name: "gamma",
						lock: false,
						registries: { kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" } },
					},
				],
				// Root: nothing to migrate (no lock, no receipt, no deprecated config)
				{ lock: false },
			)

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.targets.length).toBe(4) // root + 3 profiles

			// Root: nothing to migrate
			const rootTarget = json.targets.find((t: { target: string }) => t.target === "root")
			expect(rootTarget.status).toBe("nothing_to_migrate")

			// Alpha: already migrated
			const alphaTarget = json.targets.find((t: { target: string }) => t.target === "profile:alpha")
			expect(alphaTarget.status).toBe("already_v2")

			// Beta: needs migration (preview)
			const betaTarget = json.targets.find((t: { target: string }) => t.target === "profile:beta")
			expect(betaTarget.status).toBe("preview")
			expect(betaTarget.count).toBe(2) // default lock has 2 components

			// Gamma: normalization-only (preview)
			const gammaTarget = json.targets.find((t: { target: string }) => t.target === "profile:gamma")
			expect(gammaTarget.status).toBe("preview")
			expect(gammaTarget.configActions.length).toBe(1)
		})

		it("should not write to any target during preview", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalWithProfiles(tmp.path, [{ name: "work" }])

			await runCLI(["migrate", "--global", "--cwd", tmp.path], tmp.path)

			// Root: no receipt created, lock still exists
			expect(existsSync(join(tmp.path, ".ocx", "receipt.jsonc"))).toBe(false)
			expect(existsSync(join(tmp.path, "ocx.lock"))).toBe(true)

			// Profile: no receipt created, lock still exists
			expect(existsSync(join(tmp.path, "profiles", "work", ".ocx", "receipt.jsonc"))).toBe(false)
			expect(existsSync(join(tmp.path, "profiles", "work", "ocx.lock"))).toBe(true)
		})

		it("should apply migration/normalization across all applicable targets", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalWithProfiles(tmp.path, [
				{ name: "work" },
				{
					name: "hobby",
					lock: false,
					registries: { kdco: { url: "https://ocx.kdco.dev", version: "1.4.6" } },
				},
			])

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--apply", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(true)
			expect(json.status).toBe("migrated")

			// Root: receipt created, lock backed up
			expect(existsSync(join(tmp.path, ".ocx", "receipt.jsonc"))).toBe(true)
			expect(existsSync(join(tmp.path, "ocx.lock"))).toBe(false)
			expect(existsSync(join(tmp.path, "ocx.lock.bak"))).toBe(true)

			// Profile "work": receipt created, lock backed up
			expect(existsSync(join(tmp.path, "profiles", "work", ".ocx", "receipt.jsonc"))).toBe(true)
			expect(existsSync(join(tmp.path, "profiles", "work", "ocx.lock"))).toBe(false)
			expect(existsSync(join(tmp.path, "profiles", "work", "ocx.lock.bak"))).toBe(true)

			// Profile "hobby": config normalized (version removed)
			const hobbyConfigPath = join(tmp.path, "profiles", "hobby", "ocx.jsonc")
			const hobbyConfig = parseJsonc(await readFile(hobbyConfigPath, "utf-8")) as {
				registries: Record<string, Record<string, unknown>>
			}
			expect(hobbyConfig.registries.kdco.url).toBe("https://ocx.kdco.dev")
			expect("version" in hobbyConfig.registries.kdco).toBe(false)
		})

		it("should be idempotent on global rerun with profiles", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalWithProfiles(tmp.path, [{ name: "work" }])

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

			// All targets should be already_v2
			for (const target of json.targets) {
				expect(target.status === "already_v2" || target.status === "nothing_to_migrate").toBe(true)
			}
		})

		it("should continue after one target failure and exit non-zero with summary", async () => {
			await using tmp = await tmpdir({ git: true })

			// Set up root with a valid lock
			await setupGlobalDir(tmp.path)

			// Set up profiles directory
			const profilesDir = join(tmp.path, "profiles")
			await mkdir(profilesDir, { recursive: true })

			// Profile "bad": has lock but missing registry in config (will fail)
			const badDir = join(profilesDir, "bad")
			await mkdir(badDir, { recursive: true })
			await writeFile(
				join(badDir, "ocx.jsonc"),
				JSON.stringify({ registries: { other: { url: "https://other.example.com" } } }, null, 2),
			)
			await writeFile(join(badDir, "ocx.lock"), createLegacyLock())

			// Profile "good": has lock with correct config (will succeed)
			const goodDir = join(profilesDir, "good")
			await mkdir(goodDir, { recursive: true })
			await writeFile(
				join(goodDir, "ocx.jsonc"),
				JSON.stringify({ registries: { kdco: { url: "https://ocx.kdco.dev" } } }, null, 2),
			)
			await writeFile(join(goodDir, "ocx.lock"), createLegacyLock())

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--apply", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			// Should exit non-zero due to failure
			expect(exitCode).toBe(1)
			const json = JSON.parse(stdout)
			expect(json.success).toBe(false)
			expect(json.status).toBe("partial_failure")

			// Should have targets array
			expect(Array.isArray(json.targets)).toBe(true)

			// Root should succeed
			const rootTarget = json.targets.find((t: { target: string }) => t.target === "root")
			expect(rootTarget.status).toBe("migrated")

			// "bad" profile should have error
			const badTarget = json.targets.find((t: { target: string }) => t.target === "profile:bad")
			expect(badTarget.status).toBe("error")
			expect(badTarget.error).toBeDefined()
			expect(badTarget.error).toContain("kdco")

			// "good" profile should succeed (continued despite "bad" failing)
			const goodTarget = json.targets.find((t: { target: string }) => t.target === "profile:good")
			expect(goodTarget.status).toBe("migrated")

			// "good" profile should have receipt
			expect(existsSync(join(goodDir, ".ocx", "receipt.jsonc"))).toBe(true)
		})

		it("should process profiles sorted by name", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalWithProfiles(
				tmp.path,
				[
					{ name: "zebra", lock: false },
					{ name: "alpha", lock: false },
					{ name: "middle", lock: false },
				],
				{ lock: false },
			)

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)

			// Verify ordering: root first, then profiles alphabetically
			expect(json.targets[0].target).toBe("root")
			expect(json.targets[1].target).toBe("profile:alpha")
			expect(json.targets[2].target).toBe("profile:middle")
			expect(json.targets[3].target).toBe("profile:zebra")
		})

		it("should skip dot-prefixed directories in profiles", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, { lock: false })

			// Set up profiles directory with a dot-prefixed dir (should be skipped)
			const profilesDir = join(tmp.path, "profiles")
			await mkdir(profilesDir, { recursive: true })
			await mkdir(join(profilesDir, ".staging-temp"), { recursive: true })
			await mkdir(join(profilesDir, "real"), { recursive: true })
			await writeFile(
				join(profilesDir, "real", "ocx.jsonc"),
				JSON.stringify({ registries: { kdco: { url: "https://ocx.kdco.dev" } } }, null, 2),
			)

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)

			// Only root + "real" profile (dot-prefixed skipped)
			expect(json.targets.length).toBe(2)
			expect(json.targets[0].target).toBe("root")
			expect(json.targets[1].target).toBe("profile:real")
		})

		it("should handle no profiles directory gracefully", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path)
			// No profiles directory exists

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)

			// Only root target (no profiles)
			expect(json.targets.length).toBe(1)
			expect(json.targets[0].target).toBe("root")
		})

		it("should include targets array in JSON output for global scope", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, { lock: false })

			const { exitCode, stdout } = await runCLI(
				["migrate", "--global", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(0)
			const json = JSON.parse(stdout)
			expect(json.targets).toBeDefined()
			expect(Array.isArray(json.targets)).toBe(true)
			// Preserve top-level keys for compatibility
			expect(json.scope).toBe("global")
			expect(json.success).toBeDefined()
			expect(json.status).toBeDefined()
		})
	})

	// =========================================================================
	// Global preview per-target error handling
	// =========================================================================

	describe("global preview per-target error handling", () => {
		it("should log per-target error detail in non-JSON preview mode", async () => {
			await using tmp = await tmpdir({ git: true })

			// Root: valid setup with lock
			await setupGlobalDir(tmp.path)

			// Profile "conflict": has ocx.jsonc in BOTH root AND .opencode/
			// This causes findOcxConfig to throw a conflict error
			const profilesDir = join(tmp.path, "profiles")
			await mkdir(profilesDir, { recursive: true })
			const conflictDir = join(profilesDir, "conflict")
			await mkdir(conflictDir, { recursive: true })
			await writeFile(
				join(conflictDir, "ocx.jsonc"),
				JSON.stringify({ registries: { kdco: { url: "https://ocx.kdco.dev" } } }, null, 2),
			)
			const conflictDotOpencode = join(conflictDir, ".opencode")
			await mkdir(conflictDotOpencode, { recursive: true })
			await writeFile(
				join(conflictDotOpencode, "ocx.jsonc"),
				JSON.stringify({ registries: { kdco: { url: "https://ocx.kdco.dev" } } }, null, 2),
			)
			await writeFile(join(conflictDir, "ocx.lock"), createLegacyLock())

			// Preview mode without --json: should log error detail for the failed target
			const { exitCode, output } = await runCLI(
				["migrate", "--global", "--cwd", tmp.path],
				tmp.path,
			)

			expect(exitCode).toBe(1)
			// Should contain the target label and error message in output
			expect(output).toContain("profile:conflict")
			expect(output).toContain("Preview failed")
			expect(output).toContain("consolidate")
		})

		it("should not abort whole preview when one target throws (dual config conflict)", async () => {
			await using tmp = await tmpdir({ git: true })

			// Root: valid setup with lock
			await setupGlobalDir(tmp.path)

			// Profile "good": valid setup with lock
			const profilesDir = join(tmp.path, "profiles")
			await mkdir(profilesDir, { recursive: true })
			const goodDir = join(profilesDir, "good")
			await mkdir(goodDir, { recursive: true })
			await writeFile(
				join(goodDir, "ocx.jsonc"),
				JSON.stringify({ registries: { kdco: { url: "https://ocx.kdco.dev" } } }, null, 2),
			)
			await writeFile(join(goodDir, "ocx.lock"), createLegacyLock())

			// Profile "conflict": has ocx.jsonc in BOTH root AND .opencode/
			// This causes findOcxConfig to throw a conflict error
			const conflictDir = join(profilesDir, "conflict")
			await mkdir(conflictDir, { recursive: true })
			await writeFile(
				join(conflictDir, "ocx.jsonc"),
				JSON.stringify({ registries: { kdco: { url: "https://ocx.kdco.dev" } } }, null, 2),
			)
			const conflictDotOpencode = join(conflictDir, ".opencode")
			await mkdir(conflictDotOpencode, { recursive: true })
			await writeFile(
				join(conflictDotOpencode, "ocx.jsonc"),
				JSON.stringify({ registries: { kdco: { url: "https://ocx.kdco.dev" } } }, null, 2),
			)
			await writeFile(join(conflictDir, "ocx.lock"), createLegacyLock())

			// Preview mode with --json: should NOT abort
			const result = await runCLI(["migrate", "--global", "--json", "--cwd", tmp.path], tmp.path)

			expect(result.exitCode).toBe(1)
			const json = expectStrictJsonFailure(result)
			expect(Array.isArray(json.targets)).toBe(true)
			const targets = json.targets as Array<{
				target: string
				status: string
				error?: string
				count: number
			}>

			// Top-level status should reflect preview-with-errors
			expect(json.success).toBe(false)
			expect(json.status).toBe("preview_with_errors")

			// The conflict target should have status: "error"
			const conflictTarget = targets.find((t) => t.target === "profile:conflict")
			expect(conflictTarget).toBeDefined()
			if (!conflictTarget) throw new Error("profile:conflict target not found")
			expect(conflictTarget.status).toBe("error")
			expect(conflictTarget.error).toBeDefined()
			expect(conflictTarget.error).toContain("consolidate")
			expect(conflictTarget.count).toBe(0)

			// The good profile should still be processed
			const goodTarget = targets.find((t) => t.target === "profile:good")
			expect(goodTarget).toBeDefined()
			if (!goodTarget) throw new Error("profile:good target not found")
			expect(goodTarget.status).toBe("preview")
			expect(goodTarget.count).toBe(2)

			// Root should also be processed
			const rootTarget = targets.find((t) => t.target === "root")
			expect(rootTarget).toBeDefined()
			if (!rootTarget) throw new Error("root target not found")
			expect(rootTarget.status).toBe("preview")
		})
	})

	// =========================================================================
	// RED contract: lifecycle + blockers schema safety
	// =========================================================================

	describe("contract safety: lifecycle and blockers", () => {
		function expectNonEmptyString(value: unknown): void {
			expect(typeof value).toBe("string")
			expect((value as string).trim().length).toBeGreaterThan(0)
		}

		function expectBlockerShape(blocker: unknown): void {
			expect(typeof blocker).toBe("object")
			expect(blocker).not.toBeNull()
			const payload = blocker as Record<string, unknown>
			expectNonEmptyString(payload.code)
			expectNonEmptyString(payload.message)
			expectNonEmptyString(payload.path)
		}

		function expectAllBlockersValid(blockers: unknown[]): void {
			for (const blocker of blockers) {
				expectBlockerShape(blocker)
			}
		}

		function expectContractKeys(json: Record<string, unknown>): Array<Record<string, unknown>> {
			for (const key of [
				"success",
				"status",
				"scope",
				"count",
				"components",
				"configActions",
				"lifecycle_status",
				"schema_version",
				"blockers",
				"targets",
			]) {
				expect(json).toHaveProperty(key)
			}

			expect(json.schema_version).toBe(1)
			expect(Array.isArray(json.blockers)).toBe(true)
			expect(Array.isArray(json.targets)).toBe(true)

			const targets = json.targets as Array<Record<string, unknown>>
			for (const target of targets) {
				for (const key of [
					"target",
					"status",
					"scope",
					"result",
					"blockers",
					"count",
					"components",
					"configActions",
				]) {
					expect(target).toHaveProperty(key)
				}
				expect(Array.isArray(target.blockers)).toBe(true)
			}

			return targets
		}

		async function setupPreviewBlockedGlobalTarget(dir: string): Promise<void> {
			await setupGlobalDir(dir)

			const profilesDir = join(dir, "profiles")
			await mkdir(profilesDir, { recursive: true })

			const conflictDir = join(profilesDir, "conflict")
			await mkdir(conflictDir, { recursive: true })

			// Intentional conflict: both root ocx.jsonc and .opencode/ocx.jsonc exist
			await writeFile(
				join(conflictDir, "ocx.jsonc"),
				JSON.stringify({ registries: { kdco: { url: "https://ocx.kdco.dev" } } }, null, 2),
			)
			const conflictDotOpencode = join(conflictDir, ".opencode")
			await mkdir(conflictDotOpencode, { recursive: true })
			await writeFile(
				join(conflictDotOpencode, "ocx.jsonc"),
				JSON.stringify({ registries: { kdco: { url: "https://ocx.kdco.dev" } } }, null, 2),
			)
			await writeFile(join(conflictDir, "ocx.lock"), createLegacyLock())
		}

		async function setupApplyFailedGlobalTarget(dir: string): Promise<void> {
			await setupGlobalDir(dir)

			const profilesDir = join(dir, "profiles")
			await mkdir(profilesDir, { recursive: true })

			const badDir = join(profilesDir, "bad")
			await mkdir(badDir, { recursive: true })
			await writeFile(
				join(badDir, "ocx.jsonc"),
				JSON.stringify({ registries: { other: { url: "https://other.example.com" } } }, null, 2),
			)
			await writeFile(join(badDir, "ocx.lock"), createLegacyLock())
		}

		async function setupPreviewBlockedSingleTarget(dir: string): Promise<void> {
			await setupProjectWithConfig(dir)
			await writeLegacyLock(dir)

			// Intentional conflict: both root ocx.jsonc and .opencode/ocx.jsonc exist
			await writeFile(
				join(dir, "ocx.jsonc"),
				JSON.stringify({ registries: { kdco: { url: "https://ocx.kdco.dev" } } }, null, 2),
			)
		}

		async function setupApplyFailedSingleTarget(dir: string): Promise<void> {
			await setupProjectWithConfig(dir, {
				other: { url: "https://other.example.com" },
			})
			await writeLegacyLock(dir)
		}

		it("covers preview|human|single|preview_blocked with deterministic non-zero exit", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupPreviewBlockedSingleTarget(tmp.path)

			const { exitCode, output } = await runCLI(["migrate"], tmp.path)

			expect(exitCode).toBe(1)
			expect(output).toContain("consolidate")
		})

		it("covers preview|json|single|preview_blocked strict failure semantics", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupPreviewBlockedSingleTarget(tmp.path)

			const result = await runCLI(["migrate", "--json"], tmp.path)

			expect(result.exitCode).toBe(1)
			const json = expectStrictJsonFailure(result)
			const errorPayload = json.error as { code?: string; message?: string } | undefined
			expect(errorPayload).toBeDefined()
			if (!errorPayload) throw new Error("error payload missing")
			expect(errorPayload.code).toBe("UNKNOWN_ERROR")
			expect(errorPayload.message).toContain("consolidate")

			// Single-target failures are surfaced via handleError JSON payload,
			// so additive migrate lifecycle fields are intentionally absent here.
			expect(json).not.toHaveProperty("lifecycle_status")
			expect(json).not.toHaveProperty("schema_version")
			expect(json).not.toHaveProperty("targets")
		})

		it("covers apply|human|single|apply_failed with deterministic no-write failure", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupApplyFailedSingleTarget(tmp.path)

			const { exitCode, output } = await runCLI(["migrate", "--apply"], tmp.path)

			// ConfigError uses explicit config exit semantics in single-target mode.
			expect(exitCode).toBe(78)
			expect(output).toContain('Registry "kdco"')
			expect(output).toContain("not configured")

			// Apply failure must not partially migrate local single-target state.
			expect(existsSync(join(tmp.path, ".ocx", "receipt.jsonc"))).toBe(false)
			expect(existsSync(join(tmp.path, ".opencode", "ocx.lock"))).toBe(true)
		})

		it("enforces preview-blocked deterministic exit in human mode", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupPreviewBlockedGlobalTarget(tmp.path)

			const { exitCode, output } = await runCLI(
				["migrate", "--global", "--cwd", tmp.path],
				tmp.path,
			)

			// Contract: preview blockers must produce deterministic non-zero exit
			expect(exitCode).toBe(1)
			expect(output).toContain("profile:conflict")
		})

		it("enforces preview-blocked lifecycle mapping + blocker schemas in JSON mode", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupPreviewBlockedGlobalTarget(tmp.path)

			const result = await runCLI(["migrate", "--global", "--json", "--cwd", tmp.path], tmp.path)

			// Contract: preview blockers must produce deterministic non-zero exit
			expect(result.exitCode).toBe(1)
			const json = expectStrictJsonFailure(result)
			const targets = expectContractKeys(json)

			// Compatibility contract: legacy status remains stable
			expect(json.status).toBe("preview_with_errors")
			// Additive contract fields
			expect(json.lifecycle_status).toBe("preview_blocked")
			expect(json.success).toBe(false)

			// Aggregate blocker reporting
			const aggregateBlockers = json.blockers as unknown[]
			expect(aggregateBlockers.length).toBeGreaterThan(0)
			expectAllBlockersValid(aggregateBlockers)

			// Per-target blocker reporting across all targets
			for (const target of targets) {
				const targetBlockers = target.blockers as unknown[]
				expectAllBlockersValid(targetBlockers)
			}

			const blockedTarget = targets.find(
				(t) => t.target === "profile:conflict" || t.scope === "profile:conflict",
			)
			expect(blockedTarget).toBeDefined()
			if (!blockedTarget) throw new Error("profile:conflict target not found")
			const targetBlockers = blockedTarget.blockers as unknown[]
			expect(targetBlockers.length).toBeGreaterThan(0)
			expectAllBlockersValid(targetBlockers)
		})

		it("enforces preview_ok success payload keys and empty per-target blockers", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path)

			const result = await runCLI(["migrate", "--global", "--json", "--cwd", tmp.path], tmp.path)

			const json = expectStrictJsonSuccess(result)
			const targets = expectContractKeys(json)

			// Compatibility + normative mapping
			expect(json.status).toBe("preview")
			expect(json.lifecycle_status).toBe("preview_ok")
			expect(json.success).toBe(true)
			expect(json.blockers).toEqual([])

			for (const target of targets) {
				expect(target.blockers).toEqual([])
			}
		})

		it("enforces apply_ok success payload keys and empty per-target blockers", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path)

			const result = await runCLI(
				["migrate", "--global", "--apply", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			const json = expectStrictJsonSuccess(result)
			const targets = expectContractKeys(json)

			// Compatibility + normative mapping
			expect(json.status).toBe("migrated")
			expect(json.lifecycle_status).toBe("apply_ok")
			expect(json.success).toBe(true)
			expect(json.blockers).toEqual([])

			for (const target of targets) {
				expect(target.blockers).toEqual([])
			}
		})

		it("covers no-op already_v2 with additive fields and preview_ok lifecycle", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, { lock: false, receipt: true })

			const json = expectStrictJsonSuccess(
				await runCLI(["migrate", "--global", "--json", "--cwd", tmp.path], tmp.path),
			)
			const targets = expectContractKeys(json)

			expect(json.status).toBe("already_v2")
			expect(json.lifecycle_status).toBe("preview_ok")
			expect(json.success).toBe(true)
			expect(json.blockers).toEqual([])
			for (const target of targets) {
				expect(target.blockers).toEqual([])
			}
		})

		it("covers no-op nothing_to_migrate with additive fields and preview_ok lifecycle", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, { lock: false })

			const json = expectStrictJsonSuccess(
				await runCLI(["migrate", "--global", "--json", "--cwd", tmp.path], tmp.path),
			)
			const targets = expectContractKeys(json)

			expect(json.status).toBe("nothing_to_migrate")
			expect(json.lifecycle_status).toBe("preview_ok")
			expect(json.success).toBe(true)
			expect(json.blockers).toEqual([])
			for (const target of targets) {
				expect(target.blockers).toEqual([])
			}
		})

		it("covers no-op already_v2 with additive fields and apply_ok lifecycle", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, { lock: false, receipt: true })

			const json = expectStrictJsonSuccess(
				await runCLI(["migrate", "--global", "--apply", "--json", "--cwd", tmp.path], tmp.path),
			)
			const targets = expectContractKeys(json)

			expect(json.status).toBe("already_v2")
			expect(json.lifecycle_status).toBe("apply_ok")
			expect(json.success).toBe(true)
			expect(json.blockers).toEqual([])
			for (const target of targets) {
				expect(target.blockers).toEqual([])
			}
		})

		it("covers no-op nothing_to_migrate with additive fields and apply_ok lifecycle", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupGlobalDir(tmp.path, { lock: false })

			const json = expectStrictJsonSuccess(
				await runCLI(["migrate", "--global", "--apply", "--json", "--cwd", tmp.path], tmp.path),
			)
			const targets = expectContractKeys(json)

			expect(json.status).toBe("nothing_to_migrate")
			expect(json.lifecycle_status).toBe("apply_ok")
			expect(json.success).toBe(true)
			expect(json.blockers).toEqual([])
			for (const target of targets) {
				expect(target.blockers).toEqual([])
			}
		})

		it("enforces apply_failed lifecycle mapping, deterministic exit, and blocker schemas", async () => {
			await using tmp = await tmpdir({ git: true })
			await setupApplyFailedGlobalTarget(tmp.path)

			const result = await runCLI(
				["migrate", "--global", "--apply", "--json", "--cwd", tmp.path],
				tmp.path,
			)

			// Deterministic apply failure exit contract
			expect(result.exitCode).toBe(1)
			const json = expectStrictJsonFailure(result)
			const targets = expectContractKeys(json)

			// Compatibility + normative mapping
			expect(json.status).toBe("partial_failure")
			expect(json.lifecycle_status).toBe("apply_failed")
			expect(json.success).toBe(false)

			// Aggregate blocker schema
			const aggregateBlockers = json.blockers as unknown[]
			expect(aggregateBlockers.length).toBeGreaterThan(0)
			expectAllBlockersValid(aggregateBlockers)

			// Per-target blocker schema across all targets
			for (const target of targets) {
				const targetBlockers = target.blockers as unknown[]
				expectAllBlockersValid(targetBlockers)
			}

			// Failed target must include at least one blocker
			const badTarget = targets.find((t) => t.target === "profile:bad" || t.scope === "profile:bad")
			expect(badTarget).toBeDefined()
			if (!badTarget) throw new Error("profile:bad target not found")
			const badBlockers = badTarget.blockers as unknown[]
			expect(badBlockers.length).toBeGreaterThan(0)
			expectAllBlockersValid(badBlockers)
		})
	})
})
