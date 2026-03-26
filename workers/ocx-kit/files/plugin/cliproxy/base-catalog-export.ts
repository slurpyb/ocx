import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import {
	buildOpencodeBaseCatalogArtifact,
	buildOpencodeBaseCatalogArtifactFromProviders,
	deriveOpencodeBaseCatalogSidecarPath,
	type OpencodeBaseCatalogModelInput,
	type OpencodeProviderInput,
	serializeOpencodeBaseCatalogArtifact,
} from "./base-catalog-producer"

type BaseCatalogExportFileInput = {
	generatedAt?: string
	models?: OpencodeBaseCatalogModelInput[]
	providers?: Record<string, OpencodeProviderInput>
}

type BaseCatalogExportCliArgs = {
	inputPath: string
	outputPath?: string
	modelsPath?: string
}

type BaseCatalogExportFs = {
	readFileSync: (path: string, encoding: BufferEncoding) => string
	mkdirSync: (path: string, options: { recursive: true }) => void
	writeFileSync: (path: string, data: string, encoding: BufferEncoding) => void
	renameSync: (oldPath: string, newPath: string) => void
	unlinkSync: (path: string) => void
	createTempSuffix: () => string
}

const DEFAULT_BASE_CATALOG_EXPORT_FS: BaseCatalogExportFs = {
	readFileSync,
	mkdirSync,
	writeFileSync,
	renameSync,
	unlinkSync,
	createTempSuffix: () => randomUUID(),
}

function fail(message: string): never {
	throw new Error(`[cliproxy] base catalog export: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseCliArgs(argv: string[]): BaseCatalogExportCliArgs {
	let inputPath: string | undefined
	let outputPath: string | undefined
	let modelsPath: string | undefined

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (arg === "--input") {
			const value = argv[index + 1]
			if (!value || value.startsWith("--")) {
				fail("--input requires a file path")
			}
			inputPath = value
			index += 1
			continue
		}

		if (arg === "--output") {
			const value = argv[index + 1]
			if (!value || value.startsWith("--")) {
				fail("--output requires a file path")
			}
			outputPath = value
			index += 1
			continue
		}

		if (arg === "--models-path") {
			const value = argv[index + 1]
			if (!value || value.startsWith("--")) {
				fail("--models-path requires a file path")
			}
			modelsPath = value
			index += 1
			continue
		}

		if (arg === "--help" || arg === "-h") {
			fail(
				"usage: bun files/plugin/cliproxy-base-catalog-generate.ts --input <path> [--output <path> | --models-path <path>]",
			)
		}

		fail(`unsupported argument: ${arg}`)
	}

	if (!inputPath || inputPath.trim().length === 0) {
		fail("--input is required")
	}

	return {
		inputPath,
		...(outputPath?.trim() ? { outputPath } : {}),
		...(modelsPath?.trim() ? { modelsPath } : {}),
	}
}

function parseInputJson(text: string, inputPath: string): BaseCatalogExportFileInput {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		fail(`invalid JSON in input file: ${inputPath}`)
	}

	if (!isRecord(parsed)) {
		fail(`input file root must be a JSON object: ${inputPath}`)
	}

	return parsed as BaseCatalogExportFileInput
}

function buildArtifactFromInput(input: BaseCatalogExportFileInput) {
	const hasModels = input.models !== undefined
	const hasProviders = input.providers !== undefined

	if (hasModels === hasProviders) {
		fail('input file must include exactly one root field: "models" or "providers"')
	}

	if (hasProviders) {
		return buildOpencodeBaseCatalogArtifactFromProviders({
			generatedAt: input.generatedAt,
			providers: input.providers as Record<string, OpencodeProviderInput>,
		})
	}

	return buildOpencodeBaseCatalogArtifact({
		generatedAt: input.generatedAt,
		models: input.models as OpencodeBaseCatalogModelInput[],
	})
}

function resolveOutputPath(input: {
	outputPath?: string
	modelsPath?: string
	env: Record<string, string | undefined>
}): string {
	if (input.outputPath && input.outputPath.trim().length > 0) {
		return input.outputPath.trim()
	}

	const explicitBaseCatalogPath = input.env.OPENCODE_BASE_CATALOG_PATH?.trim()
	if (explicitBaseCatalogPath && explicitBaseCatalogPath.length > 0) {
		return explicitBaseCatalogPath
	}

	const modelsPath =
		(input.modelsPath && input.modelsPath.trim().length > 0
			? input.modelsPath.trim()
			: undefined) ?? input.env.OPENCODE_MODELS_PATH?.trim()
	if (!modelsPath) {
		fail(
			"output path is required: pass --output <path> or --models-path <path>, or set OPENCODE_BASE_CATALOG_PATH / OPENCODE_MODELS_PATH",
		)
	}

	return deriveOpencodeBaseCatalogSidecarPath(modelsPath)
}

function writeCatalogArtifactAtomically(input: {
	outputPath: string
	contents: string
	fs: BaseCatalogExportFs
}): void {
	const tempPath = `${input.outputPath}.${input.fs.createTempSuffix()}.tmp`
	input.fs.mkdirSync(dirname(input.outputPath), { recursive: true })

	try {
		input.fs.writeFileSync(tempPath, input.contents, "utf-8")
		input.fs.renameSync(tempPath, input.outputPath)
	} catch (error) {
		try {
			input.fs.unlinkSync(tempPath)
		} catch {
			// Best-effort cleanup only.
		}
		throw error
	}
}

export function runBaseCatalogExportCli(input: {
	argv: string[]
	env?: Record<string, string | undefined>
	fs?: Partial<BaseCatalogExportFs>
}): { outputPath: string; modelCount: number } {
	const args = parseCliArgs(input.argv)
	const env = input.env ?? process.env
	const fs: BaseCatalogExportFs = {
		...DEFAULT_BASE_CATALOG_EXPORT_FS,
		...(input.fs ?? {}),
	}

	const sourceText = fs.readFileSync(args.inputPath, "utf-8")
	const parsedInput = parseInputJson(sourceText, args.inputPath)
	const artifact = buildArtifactFromInput(parsedInput)
	const outputPath = resolveOutputPath({
		outputPath: args.outputPath,
		modelsPath: args.modelsPath,
		env,
	})

	writeCatalogArtifactAtomically({
		outputPath,
		contents: serializeOpencodeBaseCatalogArtifact(artifact),
		fs,
	})

	return {
		outputPath,
		modelCount: artifact.baseCatalog.models.length,
	}
}
