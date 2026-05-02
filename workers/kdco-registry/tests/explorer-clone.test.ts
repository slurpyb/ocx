import { randomUUID } from "node:crypto"
import { lstat, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "bun:test"
import {
	assertSafeCleanupTarget,
	parseExplorerCloneRequest,
	parseExplorerRef,
	parseExplorerRepository,
	prepareFreshCloneDirectory,
	resolveExplorerCloneTarget,
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

	it("rejects a symlinked owner directory before clone time", async () => {
		const { owner, repo } = randomRepository()
		const externalTarget = await mkdtempRoot()
		const ownerPath = path.join(await scopedExplorerTempRoot(), owner)

		try {
			await resolveExplorerCloneTarget(owner, repo)
			await rm(ownerPath, { recursive: true, force: true })
			await symlink(externalTarget, ownerPath)

			await expect(resolveExplorerCloneTarget(owner, repo)).rejects.toThrow("owner directory cannot be a symbolic link")
		} finally {
			await rm(ownerPath, { recursive: true, force: true })
			await rm(externalTarget, { recursive: true, force: true })
		}
	})

	it("rejects a symlinked existing clone path before clone time", async () => {
		const { owner, repo } = randomRepository()
		const externalTarget = await mkdtempRoot()
		const ownerPath = path.join(await scopedExplorerTempRoot(), owner)
		const clonePath = path.join(ownerPath, repo)

		try {
			await resolveExplorerCloneTarget(owner, repo)
			await mkdir(ownerPath, { recursive: true })
			await symlink(externalTarget, clonePath)

			await expect(resolveExplorerCloneTarget(owner, repo)).rejects.toThrow("clone directory cannot be a symbolic link")
		} finally {
			await rm(ownerPath, { recursive: true, force: true })
			await rm(externalTarget, { recursive: true, force: true })
		}
	})

	it("rejects non-directory owner and clone paths before clone time", async () => {
		const ownerAsFile = randomRepository()
		const repoAsFile = randomRepository()
		const ownerFilePath = path.join(await scopedExplorerTempRoot(), ownerAsFile.owner)
		const repoOwnerPath = path.join(await scopedExplorerTempRoot(), repoAsFile.owner)
		const repoFilePath = path.join(repoOwnerPath, repoAsFile.repo)

		try {
			await resolveExplorerCloneTarget(ownerAsFile.owner, ownerAsFile.repo)
			await rm(ownerFilePath, { recursive: true, force: true })
			await writeFile(ownerFilePath, "not a directory")

			await expect(resolveExplorerCloneTarget(ownerAsFile.owner, ownerAsFile.repo)).rejects.toThrow(
				"owner directory must be a directory",
			)

			await resolveExplorerCloneTarget(repoAsFile.owner, repoAsFile.repo)
			await mkdir(repoOwnerPath, { recursive: true })
			await writeFile(repoFilePath, "not a directory")

			await expect(resolveExplorerCloneTarget(repoAsFile.owner, repoAsFile.repo)).rejects.toThrow(
				"clone directory must be a directory",
			)
		} finally {
			await rm(ownerFilePath, { recursive: true, force: true })
			await rm(repoOwnerPath, { recursive: true, force: true })
		}
	})

	it("removes an existing clone directory with a .git symlink before git can reuse it", async () => {
		const { owner, repo } = randomRepository()
		const externalGitMetadata = await mkdtempRoot()
		const ownerPath = path.join(await scopedExplorerTempRoot(), owner)

		try {
			const target = await resolveExplorerCloneTarget(owner, repo)
			await mkdir(target.clonePath, { recursive: true })
			await symlink(externalGitMetadata, path.join(target.clonePath, ".git"))

			await prepareFreshCloneDirectory(target)

			expect(await pathExists(target.clonePath)).toBe(false)
			expect(await pathExists(externalGitMetadata)).toBe(true)
		} finally {
			await rm(ownerPath, { recursive: true, force: true })
			await rm(externalGitMetadata, { recursive: true, force: true })
		}
	})

	it("removes an existing clone directory with a .git gitfile before git can reuse it", async () => {
		const { owner, repo } = randomRepository()
		const externalGitMetadata = await mkdtempRoot()
		const ownerPath = path.join(await scopedExplorerTempRoot(), owner)

		try {
			const target = await resolveExplorerCloneTarget(owner, repo)
			await mkdir(target.clonePath, { recursive: true })
			await writeFile(path.join(target.clonePath, ".git"), `gitdir: ${externalGitMetadata}`)

			await prepareFreshCloneDirectory(target)

			expect(await pathExists(target.clonePath)).toBe(false)
			expect(await pathExists(externalGitMetadata)).toBe(true)
		} finally {
			await rm(ownerPath, { recursive: true, force: true })
			await rm(externalGitMetadata, { recursive: true, force: true })
		}
	})

	it("removes an existing safe clone directory so explorer clone always starts fresh", async () => {
		const { owner, repo } = randomRepository()
		const ownerPath = path.join(await scopedExplorerTempRoot(), owner)

		try {
			const target = await resolveExplorerCloneTarget(owner, repo)
			await mkdir(path.join(target.clonePath, "nested"), { recursive: true })
			await writeFile(path.join(target.clonePath, "nested", "marker.txt"), "old clone contents")

			await prepareFreshCloneDirectory(target)

			expect(await pathExists(target.clonePath)).toBe(false)
			expect(await pathExists(ownerPath)).toBe(true)
		} finally {
			await rm(ownerPath, { recursive: true, force: true })
		}
	})

	it("keeps the temp root at the exact expected real directory", async () => {
		const { owner, repo } = randomRepository()
		const expectedTempRoot = await scopedExplorerTempRoot()
		const ownerPath = path.join(expectedTempRoot, owner)

		try {
			const target = await resolveExplorerCloneTarget(owner, repo)

			expect(target.tempRoot).toBe(expectedTempRoot)
			expect(await realpath(target.tempRoot)).toBe(expectedTempRoot)
		} finally {
			await rm(ownerPath, { recursive: true, force: true })
		}
	})
})

function randomRepository(): { owner: string; repo: string } {
	return {
		owner: `owner-${randomUUID()}`,
		repo: `repo-${randomUUID()}`,
	}
}

async function scopedExplorerTempRoot(): Promise<string> {
	return path.join(await realpath(os.tmpdir()), "kdco-flow")
}

async function mkdtempRoot(): Promise<string> {
	const tempRoot = path.join(os.tmpdir(), `kdco-flow-test-${randomUUID()}`)
	await mkdir(tempRoot, { recursive: true })
	return realpath(tempRoot)
}

async function pathExists(absolutePath: string): Promise<boolean> {
	try {
		await lstat(absolutePath)
		return true
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return false
		}

		throw error
	}
}
