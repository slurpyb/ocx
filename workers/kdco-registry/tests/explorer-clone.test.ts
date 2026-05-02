import { randomUUID } from "node:crypto"
import { mkdir, realpath, rm, symlink } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "bun:test"
import {
	assertSafeCleanupTarget,
	parseExplorerCloneRequest,
	parseExplorerRef,
	parseExplorerRepository,
	type ResolvedCloneTarget,
} from "../files/plugins/explorer-clone"

describe("explorer clone helpers", () => {
	it("accepts GitHub owner/repo names and an optional safe ref", () => {
		expect(parseExplorerCloneRequest("kdco", "ocx", "feat/kdco-flow-harness")).toEqual({
			owner: "kdco",
			repo: "ocx",
			ref: "feat/kdco-flow-harness",
		})
	})

	it("rejects owner and repo path traversal or separators", () => {
		expect(() => parseExplorerRepository(".", "ocx")).toThrow("owner")
		expect(() => parseExplorerRepository("kdco", "..")).toThrow("repo")
		expect(() => parseExplorerRepository("kdco/evil", "ocx")).toThrow("owner")
		expect(() => parseExplorerRepository("kdco", "evil\\repo")).toThrow("repo")
	})

	it("rejects unsafe refs before git receives arguments", () => {
		const invalidRefs = ["-main", "/main", "feature/../main", "feature//main", "main.lock", "feature/-bad", "main;rm"]

		for (const invalidRef of invalidRefs) {
			expect(() => parseExplorerRef(invalidRef)).toThrow()
		}
	})

	it("rejects cleanup targets that are not the exact owner/repo clone directory", async () => {
		const tempRoot = await mkdtempRoot()
		const ownerDir = path.join(tempRoot, "kdco")
		const clonePath = path.join(ownerDir, "ocx")
		await mkdir(clonePath, { recursive: true })

		const ownerTarget: ResolvedCloneTarget = { owner: "kdco", repo: "ocx", tempRoot, clonePath: ownerDir }
		const cloneTarget: ResolvedCloneTarget = { owner: "kdco", repo: "ocx", tempRoot, clonePath }

		try {
			await expect(assertSafeCleanupTarget(ownerTarget)).rejects.toThrow()
			expect(await assertSafeCleanupTarget(cloneTarget)).toBe(clonePath)
		} finally {
			await rm(tempRoot, { recursive: true, force: true })
		}
	})

	it("rejects symbolic link cleanup targets", async () => {
		const tempRoot = await mkdtempRoot()
		const ownerDir = path.join(tempRoot, "kdco")
		const realClonePath = path.join(ownerDir, "real")
		const symlinkClonePath = path.join(ownerDir, "ocx")
		await mkdir(realClonePath, { recursive: true })
		await symlink(realClonePath, symlinkClonePath)

		try {
			await expect(
				assertSafeCleanupTarget({ owner: "kdco", repo: "ocx", tempRoot, clonePath: symlinkClonePath }),
			).rejects.toThrow("symbolic link")
		} finally {
			await rm(tempRoot, { recursive: true, force: true })
		}
	})
})

async function mkdtempRoot(): Promise<string> {
	const tempRoot = path.join(os.tmpdir(), `kdco-flow-test-${randomUUID()}`)
	await mkdir(tempRoot, { recursive: true })
	return realpath(tempRoot)
}
