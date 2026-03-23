import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

interface HostRuntimePackageDefinition {
	version: string
	entrypoint: string
	moduleSource: string
}

/**
 * Minimal CLI-owned runtime package map used for plugin loadability validation.
 *
 * These packages are treated as host-provided in OpenCode runtime environments,
 * so validation seeds deterministic local stubs instead of requiring network installs.
 */
export const HOST_RUNTIME_PACKAGES: Record<string, HostRuntimePackageDefinition> = {
	"@opencode-ai/plugin": {
		version: "0.0.0-ocx-host-runtime",
		entrypoint: "index.js",
		moduleSource: [
			"const chain = {",
			"  describe() { return chain },",
			"  optional() { return chain },",
			"  min() { return chain },",
			"  max() { return chain },",
			"}",
			"export const tool = Object.assign((definition) => definition, {",
			"  schema: {",
			"    string: () => chain,",
			"  },",
			"})",
			"export default { tool }",
		].join("\n"),
	},
}

export function isHostRuntimePackage(packageName: string): boolean {
	return Object.hasOwn(HOST_RUNTIME_PACKAGES, packageName)
}

export async function seedHostRuntimePackages(
	validationWorkspaceRoot: string,
	packageNames: Iterable<string>,
): Promise<void> {
	const nodeModulesDirectory = join(validationWorkspaceRoot, "node_modules")

	for (const packageName of packageNames) {
		const runtimeDefinition = HOST_RUNTIME_PACKAGES[packageName]
		if (!runtimeDefinition) {
			continue
		}

		const packageDirectory = join(nodeModulesDirectory, packageName)
		await mkdir(packageDirectory, { recursive: true })

		const packageJsonPath = join(packageDirectory, "package.json")
		await Bun.write(
			packageJsonPath,
			JSON.stringify(
				{
					name: packageName,
					version: runtimeDefinition.version,
					type: "module",
					exports: {
						".": `./${runtimeDefinition.entrypoint}`,
					},
				},
				null,
				2,
			),
		)

		const entrypointPath = join(packageDirectory, runtimeDefinition.entrypoint)
		await mkdir(dirname(entrypointPath), { recursive: true })
		await Bun.write(entrypointPath, runtimeDefinition.moduleSource)
	}
}
