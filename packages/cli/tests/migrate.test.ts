/**
 * Tests for ocx migrate command
 *
 * TDD: Tests written first to define the migration contract.
 * Covers: help registration, no-op states, dry-run preview,
 * apply write+backup, json output, rerun idempotency.
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
	registries?: Record<string, { url: string }>,
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
})
