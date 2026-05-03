import { describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { parse as parseJsonc } from "jsonc-parser"

type RegistryComponent = {
	name: string
	files?: string[]
}

type RegistryManifest = {
	components?: RegistryComponent[]
}

const registryRoot = path.resolve(import.meta.dir, "..")

async function readRegistryManifest(): Promise<RegistryManifest> {
	const registryJsonc = await fs.readFile(path.join(registryRoot, "registry.jsonc"), "utf8")
	return parseJsonc(registryJsonc) as RegistryManifest
}

function getComponentFiles(manifest: RegistryManifest, componentName: string): string[] {
	const component = manifest.components?.find((candidate) => candidate.name === componentName)
	if (!component) throw new Error(`Missing registry component: ${componentName}`)

	return component.files ?? []
}

function getNotifyLocalImportFiles(source: string): string[] {
	const importPathPattern = /from\s+["']\.\/notify\/([^"']+)["']/g
	return Array.from(source.matchAll(importPathPattern), ([, importPath]) => {
		if (!importPath) throw new Error("Missing notify import path")
		return `plugins/notify/${importPath}.ts`
	})
}

describe("registry component manifests", () => {
	it("ships local notify helper files imported by the notify plugin", async () => {
		const manifest = await readRegistryManifest()
		const notifyFiles = getComponentFiles(manifest, "notify")
		const notifySource = await fs.readFile(path.join(registryRoot, "files/plugins/notify.ts"), "utf8")

		for (const importedFile of getNotifyLocalImportFiles(notifySource)) {
			expect(notifyFiles).toContain(importedFile)
		}
	})
})
