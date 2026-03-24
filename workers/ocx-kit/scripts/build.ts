import { buildRegistry } from "ocx"

const result = await buildRegistry({
	source: ".",
	out: "dist",
	skipDuplicateTargets: true,
})

console.log(`✓ Built ${result.componentsCount} components`)
