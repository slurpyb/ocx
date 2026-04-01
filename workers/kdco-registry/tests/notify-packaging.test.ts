import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const registryRoot = join(import.meta.dir, "..")

function extractComponentManifestFiles(
	registryContent: string,
	componentName: string,
): Set<string> {
	const componentMatch = registryContent.match(
		new RegExp(`"name"\\s*:\\s*"${componentName}"[\\s\\S]*?"files"\\s*:\\s*\\[([\\s\\S]*?)\\]`),
	)

	expect(componentMatch).toBeTruthy()
	if (!componentMatch || !componentMatch[1]) {
		throw new Error(`Expected ${componentName} component files array in registry manifest`)
	}

	return new Set(Array.from(componentMatch[1].matchAll(/"([^"]+)"/g), ([, filePath]) => filePath))
}

function collectNotifyPluginLocalImports(source: string): string[] {
	return Array.from(source.matchAll(/from "\.\/notify\/([^"]+)"/g), ([, localImport]) => {
		if (!localImport) {
			throw new Error("Expected notify local import path")
		}

		return `plugins/notify/${localImport}.ts`
	})
}

function collectNotifyHelperLocalImports(source: string): string[] {
	return Array.from(source.matchAll(/from "\.\/([^"]+)"/g), ([, localImport]) => {
		if (!localImport) {
			throw new Error("Expected notify helper local import path")
		}

		return `plugins/notify/${localImport}.ts`
	})
}

describe("kdco/notify packaging contract", () => {
	it("keeps notify manifest files in parity with local ./notify/* imports", async () => {
		const registryContent = await readFile(join(registryRoot, "registry.jsonc"), "utf-8")
		const manifestFiles = extractComponentManifestFiles(registryContent, "notify")

		const notifyPluginSource = await readFile(
			join(registryRoot, "files", "plugins", "notify.ts"),
			"utf-8",
		)
		const notifyNormalizeSource = await readFile(
			join(registryRoot, "files", "plugins", "notify", "normalize.ts"),
			"utf-8",
		)

		const expectedFiles = [
			...collectNotifyPluginLocalImports(notifyPluginSource),
			...collectNotifyHelperLocalImports(notifyNormalizeSource),
		]

		const missingManifestFiles = expectedFiles.filter((filePath) => !manifestFiles.has(filePath))
		expect(missingManifestFiles).toEqual([])
	})

	it("prevents notify runtime source from importing monorepo-only CLI modules", async () => {
		const notifyPluginSource = await readFile(
			join(registryRoot, "files", "plugins", "notify.ts"),
			"utf-8",
		)
		const notifyNormalizeSource = await readFile(
			join(registryRoot, "files", "plugins", "notify", "normalize.ts"),
			"utf-8",
		)

		expect(notifyPluginSource).not.toContain("packages/cli/src/")
		expect(notifyNormalizeSource).not.toContain("packages/cli/src/")
	})

	it("keeps background-agents self-contained from notify helper imports", async () => {
		const backgroundAgentsSource = await readFile(
			join(registryRoot, "files", "plugins", "background-agents.ts"),
			"utf-8",
		)

		expect(backgroundAgentsSource).not.toMatch(/from\s+["']\.\/notify(?:["']|\/)/)
	})
})
