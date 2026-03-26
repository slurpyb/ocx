import { runBaseCatalogExportCli } from "./cliproxy/base-catalog-export"

try {
	const result = runBaseCatalogExportCli({
		argv: Bun.argv.slice(2),
		env: process.env,
	})

	console.log(
		`[cliproxy] opencode base catalog generated at ${result.outputPath} (${result.modelCount} models)`,
	)
} catch (error) {
	const message = error instanceof Error ? error.message : "unknown failure"
	console.error(message)
	process.exitCode = 1
}
