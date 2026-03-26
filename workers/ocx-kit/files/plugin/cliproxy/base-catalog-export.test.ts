import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { runBaseCatalogExportCli } from "./base-catalog-export"
import { OPENCODE_BASE_CATALOG_FILENAME } from "./base-catalog-producer"
import { parseBaseCatalogText } from "./core"

function makeTempDir(): string {
	return mkdtempSync(path.join(tmpdir(), "cliproxy-base-catalog-export-"))
}

describe("cliproxy base catalog export workflow", () => {
	it("writes sidecar output derived from --models-path using provider input", () => {
		const workingDir = makeTempDir()
		try {
			const inputPath = path.join(workingDir, "producer-input.json")
			const modelsPath = path.join(workingDir, "models.json")
			writeFileSync(modelsPath, "{}\n", "utf-8")
			writeFileSync(
				inputPath,
				JSON.stringify(
					{
						generatedAt: "2026-03-25T00:00:00.000Z",
						providers: {
							openai: {
								models: {
									"gpt-5": {
										name: "GPT-5 (opencode)",
										api: { npm: "@ai-sdk/openai" },
										reasoning: true,
										limit: { context: 400000, output: 128000 },
									},
								},
							},
						},
					},
					null,
					"\t",
				),
				"utf-8",
			)

			const result = runBaseCatalogExportCli({
				argv: ["--input", inputPath, "--models-path", modelsPath],
				env: {},
			})

			expect(result.outputPath).toBe(path.join(workingDir, OPENCODE_BASE_CATALOG_FILENAME))
			expect(result.modelCount).toBe(1)

			const outputText = readFileSync(result.outputPath, "utf-8")
			const parsed = parseBaseCatalogText(outputText, result.outputPath)
			expect(parsed.bySource.get("openai/gpt-5")?.displayName).toBe("GPT-5 (opencode)")
			expect(parsed.bySource.get("openai/gpt-5")?.baseSource).toBe("opencode")

			const rawArtifact = JSON.parse(outputText) as { generatedAt?: string }
			expect(rawArtifact.generatedAt).toBe("2026-03-25T00:00:00.000Z")
		} finally {
			rmSync(workingDir, { recursive: true, force: true })
		}
	})

	it("supports explicit --output, takes priority over OPENCODE_BASE_CATALOG_PATH, and does not inject runtime-generated timestamps", () => {
		const workingDir = makeTempDir()
		try {
			const inputPath = path.join(workingDir, "producer-input.json")
			const outputPath = path.join(workingDir, "explicit", "base-catalog.json")
			const ignoredEnvOutputPath = path.join(workingDir, "env", "base-catalog.json")

			writeFileSync(
				inputPath,
				JSON.stringify(
					{
						models: [
							{
								providerID: "openai",
								modelID: "codex-mini",
								name: "Codex Mini",
								api: { npm: "@ai-sdk/openai" },
								reasoning: true,
								limit: { context: 200000, output: 100000 },
							},
						],
					},
					null,
					"\t",
				),
				"utf-8",
			)

			const result = runBaseCatalogExportCli({
				argv: ["--input", inputPath, "--output", outputPath],
				env: {
					OPENCODE_BASE_CATALOG_PATH: ignoredEnvOutputPath,
				},
			})

			expect(result.outputPath).toBe(outputPath)
			expect(result.modelCount).toBe(1)
			expect(existsSync(ignoredEnvOutputPath)).toBe(false)

			const outputText = readFileSync(outputPath, "utf-8")
			const rawArtifact = JSON.parse(outputText) as { generatedAt?: string }
			expect(rawArtifact.generatedAt).toBeUndefined()
		} finally {
			rmSync(workingDir, { recursive: true, force: true })
		}
	})

	it("uses OPENCODE_BASE_CATALOG_PATH when present, even when --models-path is provided", () => {
		const workingDir = makeTempDir()
		try {
			const inputPath = path.join(workingDir, "producer-input.json")
			const modelsPath = path.join(workingDir, "models.json")
			const explicitBaseCatalogPath = path.join(workingDir, "custom", "catalog.json")
			const derivedSidecarPath = path.join(workingDir, OPENCODE_BASE_CATALOG_FILENAME)

			writeFileSync(modelsPath, "{}\n", "utf-8")
			writeFileSync(
				inputPath,
				JSON.stringify(
					{
						models: [
							{
								providerID: "openai",
								modelID: "gpt-5",
								name: "GPT-5",
								api: { npm: "@ai-sdk/openai" },
								reasoning: true,
								limit: { context: 400000, output: 128000 },
							},
						],
					},
					null,
					"\t",
				),
				"utf-8",
			)

			const result = runBaseCatalogExportCli({
				argv: ["--input", inputPath, "--models-path", modelsPath],
				env: {
					OPENCODE_BASE_CATALOG_PATH: ` ${explicitBaseCatalogPath} `,
				},
			})

			expect(result.outputPath).toBe(explicitBaseCatalogPath)
			expect(existsSync(explicitBaseCatalogPath)).toBe(true)
			expect(existsSync(derivedSidecarPath)).toBe(false)
		} finally {
			rmSync(workingDir, { recursive: true, force: true })
		}
	})

	it("uses OPENCODE_MODELS_PATH to derive sidecar output when args omit output flags", () => {
		const workingDir = makeTempDir()
		try {
			const inputPath = path.join(workingDir, "producer-input.json")
			const modelsPath = path.join(workingDir, "models.json")
			writeFileSync(
				inputPath,
				JSON.stringify(
					{
						models: [
							{
								providerID: "openai",
								modelID: "gpt-5",
								name: "GPT-5",
								api: { npm: "@ai-sdk/openai" },
								reasoning: true,
								limit: { context: 400000, output: 128000 },
							},
						],
					},
					null,
					"\t",
				),
				"utf-8",
			)

			const result = runBaseCatalogExportCli({
				argv: ["--input", inputPath],
				env: {
					OPENCODE_MODELS_PATH: modelsPath,
				},
			})

			expect(result.outputPath).toBe(path.join(workingDir, OPENCODE_BASE_CATALOG_FILENAME))
		} finally {
			rmSync(workingDir, { recursive: true, force: true })
		}
	})

	it("fails loudly when output path cannot be resolved", () => {
		const workingDir = makeTempDir()
		try {
			const inputPath = path.join(workingDir, "producer-input.json")
			writeFileSync(inputPath, JSON.stringify({ models: [] }), "utf-8")

			expect(() =>
				runBaseCatalogExportCli({
					argv: ["--input", inputPath],
					env: {},
				}),
			).toThrow(
				"[cliproxy] base catalog export: output path is required: pass --output <path> or --models-path <path>, or set OPENCODE_BASE_CATALOG_PATH / OPENCODE_MODELS_PATH",
			)
		} finally {
			rmSync(workingDir, { recursive: true, force: true })
		}
	})

	it("keeps the previous artifact intact and cleans up temp file when atomic rename fails", () => {
		const workingDir = makeTempDir()
		try {
			const inputPath = path.join(workingDir, "producer-input.json")
			const outputPath = path.join(workingDir, "base-catalog.json")
			const previousArtifactText = '{\n\t"previous": true\n}\n'
			const deterministicTempSuffix = "rename-failure-test"
			const tempPath = `${outputPath}.${deterministicTempSuffix}.tmp`

			writeFileSync(outputPath, previousArtifactText, "utf-8")
			writeFileSync(
				inputPath,
				JSON.stringify(
					{
						models: [
							{
								providerID: "openai",
								modelID: "gpt-5",
								name: "GPT-5",
								api: { npm: "@ai-sdk/openai" },
								reasoning: true,
								limit: { context: 400000, output: 128000 },
							},
						],
					},
					null,
					"\t",
				),
				"utf-8",
			)

			expect(() =>
				runBaseCatalogExportCli({
					argv: ["--input", inputPath, "--output", outputPath],
					env: {},
					fs: {
						createTempSuffix: () => deterministicTempSuffix,
						renameSync: () => {
							throw new Error("simulated rename failure")
						},
					},
				}),
			).toThrow("simulated rename failure")

			expect(readFileSync(outputPath, "utf-8")).toBe(previousArtifactText)
			expect(existsSync(tempPath)).toBe(false)
		} finally {
			rmSync(workingDir, { recursive: true, force: true })
		}
	})
})
