import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { parse as parseJsonc } from "jsonc-parser"

type RegistryComponent = {
	name: string
	type: string
	opencode?: { plugin?: string[] }
	npmDevDependencies?: string[]
}

type RegistryManifest = {
	components?: RegistryComponent[]
}

function loadRegistryManifest(): RegistryManifest {
	const registryPath = path.join(import.meta.dir, "..", "..", "registry.jsonc")
	const source = readFileSync(registryPath, "utf-8")
	return parseJsonc(source) as RegistryManifest
}

describe("cliproxy registry wiring", () => {
	it("registers cliproxy plugin in opencode config", () => {
		const manifest = loadRegistryManifest()
		const component = manifest.components?.find(
			(entry) => entry.name === "cliproxy" && entry.type === "plugin",
		)

		expect(component).toBeDefined()
		expect(component?.opencode?.plugin).toContain("plugins/cliproxy.ts")
		expect(component?.npmDevDependencies).toContain("jsonc-parser@3.3.1")
	})
})
