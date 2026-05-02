import * as fs from "node:fs/promises"
import * as path from "node:path"
import { buildRegistry } from "ocx"

const registryRootDir = path.resolve(import.meta.dir, "..")
const registryDistDir = path.resolve(registryRootDir, "dist")
const relativeDistPath = path.relative(registryRootDir, registryDistDir)

if (relativeDistPath !== "dist") {
	throw new Error(`Refusing to clean unexpected dist path: ${registryDistDir}`)
}

await fs.rm(registryDistDir, { recursive: true, force: true })

const result = await buildRegistry({
	source: ".",
	out: "dist",
})

console.log(`✓ Built ${result.componentsCount} components to ${result.outputPath}`)

// Copy schemas to dist
const schemasDir = path.join(import.meta.dir, "..", "schemas")
const distSchemasDir = path.join(import.meta.dir, "..", "dist", "schemas")
try {
	await fs.cp(schemasDir, distSchemasDir, { recursive: true })
	console.log("✓ Copied schemas to dist")
} catch (_error) {
	console.log("⚠ No schemas directory found, skipping")
}
