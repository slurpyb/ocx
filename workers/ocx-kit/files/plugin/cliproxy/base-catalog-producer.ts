import { dirname } from "node:path"

import type { BaseCatalogModelV1, BaseCatalogV1 } from "./core"

export const CLIPROXY_BASE_CATALOG_CONTRACT_VERSION = 1 as const
export const OPENCODE_BASE_CATALOG_FILENAME = "opencode-base-catalog.json"

type CanonicalModality = "text" | "audio" | "image" | "video" | "pdf"

const CANONICAL_MODALITIES: readonly CanonicalModality[] = [
	"text",
	"audio",
	"image",
	"video",
	"pdf",
]
const CANONICAL_MODALITY_SET = new Set<string>(CANONICAL_MODALITIES)

type OpencodeModelCapabilities = {
	reasoning?: boolean
	temperature?: boolean
	attachment?: boolean
	toolcall?: boolean
	interleaved?:
		| boolean
		| {
				field: "reasoning_content" | "reasoning_details"
		  }
	input?: Partial<Record<CanonicalModality, boolean>>
	output?: Partial<Record<CanonicalModality, boolean>>
}

type OpencodeModelCost = {
	input: number
	output: number
	reasoning?: number
	cache?: {
		read?: number
		write?: number
	}
	experimentalOver200K?: {
		input: number
		output: number
		cache?: {
			read?: number
			write?: number
		}
	}
}

export type OpencodeBaseCatalogModelInput = {
	providerID: string
	modelID: string
	name: string
	family?: string
	releaseDate?: string
	lastUpdated?: string
	knowledgeCutoff?: string
	status?: "alpha" | "beta" | "deprecated" | "active"
	attachment?: boolean
	temperature?: boolean
	toolCall?: boolean
	structuredOutput?: boolean
	openWeights?: boolean
	interleaved?:
		| boolean
		| {
				field: "reasoning_content" | "reasoning_details"
		  }
	options?: Record<string, unknown>
	headers?: Record<string, string>
	api: {
		npm: string
		id?: string
	}
	reasoning?: boolean
	capabilities?: OpencodeModelCapabilities
	limit: {
		context: number
		output: number
		input?: number
	}
	cost?: OpencodeModelCost
	variants?: Record<string, unknown>
}

export type OpencodeProviderModelInput = {
	id?: string
	providerID?: string
	name: string
	family?: string
	release_date?: string
	last_updated?: string
	knowledge?: string
	status?: "alpha" | "beta" | "deprecated" | "active"
	attachment?: boolean
	temperature?: boolean
	tool_call?: boolean
	structured_output?: boolean
	open_weights?: boolean
	interleaved?:
		| boolean
		| {
				field: "reasoning_content" | "reasoning_details"
		  }
	options?: Record<string, unknown>
	headers?: Record<string, string>
	api: {
		npm: string
		id?: string
	}
	reasoning?: boolean
	capabilities?: OpencodeModelCapabilities
	limit: {
		context: number
		output: number
		input?: number
	}
	cost?: OpencodeModelCost
	variants?: Record<string, unknown>
}

export type OpencodeProviderInput = {
	models: Record<string, OpencodeProviderModelInput>
}

export type OpencodeBaseCatalogArtifact = {
	generatedAt?: string
	baseCatalog: BaseCatalogV1
}

function fail(scope: string, message: string): never {
	throw new Error(`[cliproxy] opencode base catalog producer ${scope}: ${message}`)
}

function compareDeterministicStrings(left: string, right: string): number {
	if (left === right) {
		return 0
	}
	return left < right ? -1 : 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function expectRecord(value: unknown, scope: string): Record<string, unknown> {
	if (!isRecord(value)) {
		fail(scope, "must be an object")
	}
	return value
}

function expectOptionalBoolean(value: unknown, scope: string): boolean | undefined {
	if (value === undefined) {
		return undefined
	}
	if (typeof value !== "boolean") {
		fail(scope, "must be a boolean")
	}
	return value
}

function expectNonEmptyString(value: unknown, scope: string): string {
	if (typeof value !== "string") {
		fail(scope, "must be a string")
	}
	const trimmed = value.trim()
	if (trimmed.length === 0) {
		fail(scope, "must be a non-empty string")
	}
	return trimmed
}

function expectNonNegativeInteger(value: unknown, scope: string): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		!Number.isInteger(value) ||
		value < 0
	) {
		fail(scope, "must be a non-negative integer")
	}
	return value
}

function expectFiniteNonNegative(value: unknown, scope: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		fail(scope, "must be a finite non-negative number")
	}
	return value
}

function normalizeApi(input: unknown, scope: string): { npm: string; id?: string } {
	const api = expectRecord(input, scope)
	const npm = expectNonEmptyString(api.npm, `${scope}.npm`)
	const apiID = api.id === undefined ? undefined : expectNonEmptyString(api.id, `${scope}.id`)
	return {
		npm,
		...(apiID ? { id: apiID } : {}),
	}
}

function normalizeCapabilityMap(
	input: unknown,
	scope: string,
): Partial<Record<CanonicalModality, boolean>> | undefined {
	if (input === undefined) {
		return undefined
	}

	const capabilityMap = expectRecord(input, scope)
	const normalized: Partial<Record<CanonicalModality, boolean>> = {}

	for (const [key, value] of Object.entries(capabilityMap)) {
		if (!CANONICAL_MODALITY_SET.has(key)) {
			fail(scope, `contains unsupported modality key: ${key}`)
		}
		if (typeof value !== "boolean") {
			fail(`${scope}.${key}`, "must be a boolean")
		}
		normalized[key as CanonicalModality] = value
	}

	return normalized
}

function normalizeCapabilities(
	input: unknown,
	scope: string,
): OpencodeModelCapabilities | undefined {
	if (input === undefined) {
		return undefined
	}

	const capabilities = expectRecord(input, scope)
	const reasoning = expectOptionalBoolean(capabilities.reasoning, `${scope}.reasoning`)
	const temperature = expectOptionalBoolean(capabilities.temperature, `${scope}.temperature`)
	const attachment = expectOptionalBoolean(capabilities.attachment, `${scope}.attachment`)
	const toolcall = expectOptionalBoolean(capabilities.toolcall, `${scope}.toolcall`)
	const interleaved = normalizeInterleavedValue(capabilities.interleaved, `${scope}.interleaved`)
	const inputModalities = normalizeCapabilityMap(capabilities.input, `${scope}.input`)
	const outputModalities = normalizeCapabilityMap(capabilities.output, `${scope}.output`)

	return {
		...(reasoning === undefined ? {} : { reasoning }),
		...(temperature === undefined ? {} : { temperature }),
		...(attachment === undefined ? {} : { attachment }),
		...(toolcall === undefined ? {} : { toolcall }),
		...(interleaved === undefined ? {} : { interleaved }),
		...(inputModalities ? { input: inputModalities } : {}),
		...(outputModalities ? { output: outputModalities } : {}),
	}
}

function normalizeVariants(input: unknown, scope: string): Record<string, unknown> | undefined {
	if (input === undefined) {
		return undefined
	}
	return expectRecord(input, scope)
}

function normalizeInterleavedValue(
	input: unknown,
	scope: string,
):
	| boolean
	| {
			field: "reasoning_content" | "reasoning_details"
	  }
	| undefined {
	if (input === undefined) {
		return undefined
	}
	if (typeof input === "boolean") {
		return input
	}
	const interleaved = expectRecord(input, scope)
	if (interleaved.field !== "reasoning_content" && interleaved.field !== "reasoning_details") {
		fail(`${scope}.field`, 'must be "reasoning_content" or "reasoning_details"')
	}
	const field: "reasoning_content" | "reasoning_details" = interleaved.field
	return { field }
}

function collectEnabledModalities(
	input?: Partial<Record<CanonicalModality, boolean>>,
	output?: Partial<Record<CanonicalModality, boolean>>,
): string[] | undefined {
	const enabled = new Set<string>()

	for (const modality of CANONICAL_MODALITIES) {
		if (input?.[modality] || output?.[modality]) {
			enabled.add(modality)
		}
	}

	if (enabled.size === 0) {
		return undefined
	}

	return [...enabled].sort(compareDeterministicStrings)
}

function collectVariants(variants?: Record<string, unknown>): string[] | undefined {
	if (!variants) {
		return undefined
	}

	const names = Object.keys(variants)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.sort(compareDeterministicStrings)

	if (names.length === 0) {
		return undefined
	}

	return [...new Set(names)]
}

function normalizeReasoning(
	input: {
		reasoning?: boolean
		capabilities?: Pick<OpencodeModelCapabilities, "reasoning">
	},
	scope: string,
): boolean {
	const fromField = input.reasoning
	const fromCapabilities = input.capabilities?.reasoning

	if (
		typeof fromField === "boolean" &&
		typeof fromCapabilities === "boolean" &&
		fromField !== fromCapabilities
	) {
		fail(
			`${scope}.reasoning`,
			"conflicts with model.capabilities.reasoning; both fields must agree when provided",
		)
	}

	if (typeof fromField === "boolean") {
		return fromField
	}

	if (typeof fromCapabilities === "boolean") {
		return fromCapabilities
	}

	fail(scope, "reasoning flag is required (model.reasoning or model.capabilities.reasoning)")
}

function normalizeCapabilityBoolean(input: {
	fieldName: string
	fieldValue: boolean | undefined
	capabilityValue: boolean | undefined
	scope: string
}): boolean | undefined {
	if (
		typeof input.fieldValue === "boolean" &&
		typeof input.capabilityValue === "boolean" &&
		input.fieldValue !== input.capabilityValue
	) {
		fail(
			`${input.scope}.${input.fieldName}`,
			`conflicts with model.capabilities.${input.fieldName}; both fields must agree when provided`,
		)
	}

	if (typeof input.fieldValue === "boolean") {
		return input.fieldValue
	}

	if (typeof input.capabilityValue === "boolean") {
		return input.capabilityValue
	}

	return undefined
}

function normalizeInterleaved(input: {
	interleaved?:
		| boolean
		| {
				field: "reasoning_content" | "reasoning_details"
		  }
	capabilities?: Pick<OpencodeModelCapabilities, "interleaved">
	scope: string
}) {
	if (input.interleaved === undefined) {
		return input.capabilities?.interleaved
	}

	const fromField = input.interleaved
	const fromCapabilities = input.capabilities?.interleaved

	if (fromCapabilities === undefined) {
		return fromField
	}

	if (JSON.stringify(fromField) !== JSON.stringify(fromCapabilities)) {
		fail(
			`${input.scope}.interleaved`,
			"conflicts with model.capabilities.interleaved; both fields must agree when provided",
		)
	}

	return fromField
}

function normalizeLimits(
	limitsInput: unknown,
	scope: string,
): OpencodeBaseCatalogModelInput["limit"] {
	const limits = expectRecord(limitsInput, scope)
	const context = expectNonNegativeInteger(limits.context, `${scope}.context`)
	const output = expectNonNegativeInteger(limits.output, `${scope}.output`)
	const input =
		limits.input === undefined
			? undefined
			: expectNonNegativeInteger(limits.input, `${scope}.input`)

	if (input !== undefined && input > context) {
		fail(scope, "input must be <= context")
	}

	return {
		context,
		output,
		...(input === undefined ? {} : { input }),
	}
}

function normalizeOpencodeModelCost(
	costInput: unknown,
	scope: string,
): OpencodeModelCost | undefined {
	if (costInput === undefined) {
		return undefined
	}
	const cost = expectRecord(costInput, scope)

	const input = expectFiniteNonNegative(cost.input, `${scope}.input`)
	const output = expectFiniteNonNegative(cost.output, `${scope}.output`)
	const reasoning =
		cost.reasoning === undefined
			? undefined
			: expectFiniteNonNegative(cost.reasoning, `${scope}.reasoning`)

	const cache = cost.cache === undefined ? undefined : expectRecord(cost.cache, `${scope}.cache`)
	const cacheRead =
		cache?.read === undefined
			? undefined
			: expectFiniteNonNegative(cache.read, `${scope}.cache.read`)
	const cacheWrite =
		cache?.write === undefined
			? undefined
			: expectFiniteNonNegative(cache.write, `${scope}.cache.write`)

	const experimentalOver200K = (() => {
		if (cost.experimentalOver200K === undefined) {
			return undefined
		}
		const over = expectRecord(cost.experimentalOver200K, `${scope}.experimentalOver200K`)
		const overCache =
			over.cache === undefined
				? undefined
				: expectRecord(over.cache, `${scope}.experimentalOver200K.cache`)
		return {
			input: expectFiniteNonNegative(over.input, `${scope}.experimentalOver200K.input`),
			output: expectFiniteNonNegative(over.output, `${scope}.experimentalOver200K.output`),
			...(overCache?.read === undefined
				? {}
				: {
						cache: {
							read: expectFiniteNonNegative(
								overCache.read,
								`${scope}.experimentalOver200K.cache.read`,
							),
						},
					}),
			...(overCache?.write === undefined
				? {}
				: {
						cache: {
							...(overCache?.read === undefined
								? {}
								: {
										read: expectFiniteNonNegative(
											overCache.read,
											`${scope}.experimentalOver200K.cache.read`,
										),
									}),
							write: expectFiniteNonNegative(
								overCache.write,
								`${scope}.experimentalOver200K.cache.write`,
							),
						},
					}),
		}
	})()

	const parsed: OpencodeModelCost = {
		input,
		output,
		...(reasoning === undefined ? {} : { reasoning }),
		...(cacheRead === undefined && cacheWrite === undefined
			? {}
			: {
					cache: {
						...(cacheRead === undefined ? {} : { read: cacheRead }),
						...(cacheWrite === undefined ? {} : { write: cacheWrite }),
					},
				}),
		...(experimentalOver200K === undefined ? {} : { experimentalOver200K }),
	}

	return parsed
}

function normalizeCost(costInput: unknown, scope: string): BaseCatalogModelV1["cost"] {
	const cost = normalizeOpencodeModelCost(costInput, scope)
	if (!cost) {
		return undefined
	}

	return {
		input: cost.input,
		output: cost.output,
		...(cost.reasoning === undefined ? {} : { reasoning: cost.reasoning }),
		...(cost.cache?.read === undefined ? {} : { cacheRead: cost.cache.read }),
		...(cost.cache?.write === undefined ? {} : { cacheWrite: cost.cache.write }),
		...(cost.experimentalOver200K
			? {
					contextOver200k: {
						input: cost.experimentalOver200K.input,
						output: cost.experimentalOver200K.output,
						...(cost.experimentalOver200K.cache?.read === undefined
							? {}
							: { cacheRead: cost.experimentalOver200K.cache.read }),
						...(cost.experimentalOver200K.cache?.write === undefined
							? {}
							: { cacheWrite: cost.experimentalOver200K.cache.write }),
					},
				}
			: {}),
	}
}

function normalizeModel(input: unknown, index: number): BaseCatalogModelV1 {
	const scope = `models[${index}]`
	const model = expectRecord(input, scope)

	const providerID = expectNonEmptyString(model.providerID, `${scope}.providerID`)
	const modelID = expectNonEmptyString(model.modelID, `${scope}.modelID`)
	const source = `${providerID}/${modelID}`

	const displayName = expectNonEmptyString(model.name, `${scope}.name`)
	const family =
		model.family === undefined ? undefined : expectNonEmptyString(model.family, `${scope}.family`)
	const releaseDate =
		model.releaseDate === undefined
			? undefined
			: expectNonEmptyString(model.releaseDate, `${scope}.releaseDate`)
	const lastUpdated =
		model.lastUpdated === undefined
			? undefined
			: expectNonEmptyString(model.lastUpdated, `${scope}.lastUpdated`)
	const knowledgeCutoff =
		model.knowledgeCutoff === undefined
			? undefined
			: expectNonEmptyString(model.knowledgeCutoff, `${scope}.knowledgeCutoff`)
	const status =
		model.status === undefined
			? undefined
			: (() => {
					if (
						model.status !== "alpha" &&
						model.status !== "beta" &&
						model.status !== "deprecated" &&
						model.status !== "active"
					) {
						fail(`${scope}.status`, 'must be one of "alpha", "beta", "deprecated", "active"')
					}
					return model.status
				})()
	const options =
		model.options === undefined ? undefined : expectRecord(model.options, `${scope}.options`)
	const headers = (() => {
		if (model.headers === undefined) {
			return undefined
		}
		const value = expectRecord(model.headers, `${scope}.headers`)
		const parsed: Record<string, string> = {}
		for (const [headerKey, headerValue] of Object.entries(value)) {
			parsed[headerKey] = expectNonEmptyString(headerValue, `${scope}.headers.${headerKey}`)
		}
		return parsed
	})()
	const api = normalizeApi(model.api, `${scope}.api`)
	const capabilitiesInput = normalizeCapabilities(model.capabilities, `${scope}.capabilities`)
	const reasoning = normalizeReasoning(
		{
			reasoning: expectOptionalBoolean(model.reasoning, `${scope}.reasoning`),
			capabilities: capabilitiesInput,
		},
		scope,
	)
	const attachment = normalizeCapabilityBoolean({
		fieldName: "attachment",
		fieldValue: expectOptionalBoolean(model.attachment, `${scope}.attachment`),
		capabilityValue: capabilitiesInput?.attachment,
		scope,
	})
	const temperature = normalizeCapabilityBoolean({
		fieldName: "temperature",
		fieldValue: expectOptionalBoolean(model.temperature, `${scope}.temperature`),
		capabilityValue: capabilitiesInput?.temperature,
		scope,
	})
	const toolCall = normalizeCapabilityBoolean({
		fieldName: "toolCall",
		fieldValue: expectOptionalBoolean(model.toolCall, `${scope}.toolCall`),
		capabilityValue: capabilitiesInput?.toolcall,
		scope,
	})
	const structuredOutput = expectOptionalBoolean(
		model.structuredOutput,
		`${scope}.structuredOutput`,
	)
	const openWeights = expectOptionalBoolean(model.openWeights, `${scope}.openWeights`)
	const interleaved = normalizeInterleaved({
		interleaved: normalizeInterleavedValue(model.interleaved, `${scope}.interleaved`),
		capabilities: capabilitiesInput,
		scope,
	})
	const limits = normalizeLimits(model.limit, `${scope}.limit`)
	const cost = normalizeCost(model.cost, `${scope}.cost`)

	const modalities = collectEnabledModalities(capabilitiesInput?.input, capabilitiesInput?.output)
	const variants = collectVariants(normalizeVariants(model.variants, `${scope}.variants`))
	const capabilities = !modalities && !variants ? undefined : { modalities, variants }

	return {
		source,
		api,
		displayName,
		...(family ? { family } : {}),
		...(releaseDate ? { releaseDate } : {}),
		...(lastUpdated ? { lastUpdated } : {}),
		...(knowledgeCutoff ? { knowledgeCutoff } : {}),
		...(status ? { status } : { status: "active" }),
		...(attachment === undefined ? {} : { attachment }),
		...(temperature === undefined ? {} : { temperature }),
		...(toolCall === undefined ? {} : { toolCall }),
		...(structuredOutput === undefined ? {} : { structuredOutput }),
		...(openWeights === undefined ? {} : { openWeights }),
		...(interleaved === undefined ? {} : { interleaved }),
		...(options ? { options } : {}),
		...(headers ? { headers } : {}),
		reasoning,
		limits,
		...(cost ? { cost } : {}),
		...(capabilities
			? {
					capabilities: {
						...(capabilities.modalities ? { modalities: capabilities.modalities } : {}),
						...(capabilities.variants ? { variants: capabilities.variants } : {}),
					},
				}
			: {}),
	}
}

export function buildOpencodeBaseCatalogArtifact(input: {
	generatedAt?: string
	models: OpencodeBaseCatalogModelInput[]
}): OpencodeBaseCatalogArtifact {
	const parsedInput = expectRecord(input, "input")

	if (!Array.isArray(parsedInput.models)) {
		fail("input.models", "must be an array")
	}

	const seenSourceKeys = new Set<string>()
	const models = parsedInput.models.map((entry, index) => {
		const normalized = normalizeModel(entry, index)
		if (seenSourceKeys.has(normalized.source)) {
			fail(`models[${index}]`, `duplicate source key: ${normalized.source}`)
		}
		seenSourceKeys.add(normalized.source)
		return normalized
	})

	models.sort((left, right) => compareDeterministicStrings(left.source, right.source))

	const generatedAt =
		parsedInput.generatedAt === undefined
			? undefined
			: expectNonEmptyString(parsedInput.generatedAt, "input.generatedAt")

	return {
		...(generatedAt ? { generatedAt } : {}),
		baseCatalog: {
			$cliproxyBaseCatalogContractVersion: CLIPROXY_BASE_CATALOG_CONTRACT_VERSION,
			models,
		},
	}
}

export function buildOpencodeBaseCatalogArtifactFromProviders(input: {
	generatedAt?: string
	providers: Record<string, OpencodeProviderInput>
}): OpencodeBaseCatalogArtifact {
	const parsedInput = expectRecord(input, "input")
	const providers = expectRecord(parsedInput.providers, "input.providers")

	const flattened: OpencodeBaseCatalogModelInput[] = []
	for (const providerID of Object.keys(providers).sort(compareDeterministicStrings)) {
		const providerScope = `input.providers.${providerID}`
		const provider = expectRecord(providers[providerID], providerScope)
		const providerModels = expectRecord(provider.models, `${providerScope}.models`)

		for (const modelKey of Object.keys(providerModels).sort(compareDeterministicStrings)) {
			const modelScope = `${providerScope}.models.${modelKey}`
			const model = expectRecord(providerModels[modelKey], modelScope)
			flattened.push({
				providerID:
					model.providerID === undefined
						? expectNonEmptyString(providerID, `${modelScope} provider key`)
						: expectNonEmptyString(model.providerID, `${modelScope}.providerID`),
				modelID:
					model.id === undefined
						? expectNonEmptyString(modelKey, `${modelScope} model key`)
						: expectNonEmptyString(model.id, `${modelScope}.id`),
				name: expectNonEmptyString(model.name, `${modelScope}.name`),
				...(model.family === undefined
					? {}
					: { family: expectNonEmptyString(model.family, `${modelScope}.family`) }),
				...(model.release_date === undefined
					? {}
					: {
							releaseDate: expectNonEmptyString(model.release_date, `${modelScope}.release_date`),
						}),
				...(model.last_updated === undefined
					? {}
					: {
							lastUpdated: expectNonEmptyString(model.last_updated, `${modelScope}.last_updated`),
						}),
				...(model.knowledge === undefined
					? {}
					: { knowledgeCutoff: expectNonEmptyString(model.knowledge, `${modelScope}.knowledge`) }),
				...(model.status === undefined
					? {}
					: {
							status: (() => {
								if (
									model.status !== "alpha" &&
									model.status !== "beta" &&
									model.status !== "deprecated" &&
									model.status !== "active"
								) {
									fail(
										`${modelScope}.status`,
										'must be one of "alpha", "beta", "deprecated", "active"',
									)
								}
								return model.status
							})(),
						}),
				...(model.attachment === undefined
					? {}
					: {
							attachment: expectOptionalBoolean(model.attachment, `${modelScope}.attachment`),
						}),
				...(model.temperature === undefined
					? {}
					: {
							temperature: expectOptionalBoolean(model.temperature, `${modelScope}.temperature`),
						}),
				...(model.tool_call === undefined
					? {}
					: {
							toolCall: expectOptionalBoolean(model.tool_call, `${modelScope}.tool_call`),
						}),
				...(model.structured_output === undefined
					? {}
					: {
							structuredOutput: expectOptionalBoolean(
								model.structured_output,
								`${modelScope}.structured_output`,
							),
						}),
				...(model.open_weights === undefined
					? {}
					: {
							openWeights: expectOptionalBoolean(model.open_weights, `${modelScope}.open_weights`),
						}),
				...(model.interleaved === undefined
					? {}
					: {
							interleaved: normalizeInterleavedValue(
								model.interleaved,
								`${modelScope}.interleaved`,
							),
						}),
				...(model.options === undefined
					? {}
					: { options: expectRecord(model.options, `${modelScope}.options`) }),
				...(model.headers === undefined
					? {}
					: {
							headers: (() => {
								const parsedHeaders = expectRecord(model.headers, `${modelScope}.headers`)
								const normalizedHeaders: Record<string, string> = {}
								for (const [headerKey, headerValue] of Object.entries(parsedHeaders)) {
									normalizedHeaders[headerKey] = expectNonEmptyString(
										headerValue,
										`${modelScope}.headers.${headerKey}`,
									)
								}
								return normalizedHeaders
							})(),
						}),
				api: normalizeApi(model.api, `${modelScope}.api`),
				reasoning: expectOptionalBoolean(model.reasoning, `${modelScope}.reasoning`),
				capabilities: normalizeCapabilities(model.capabilities, `${modelScope}.capabilities`),
				limit: normalizeLimits(model.limit, `${modelScope}.limit`),
				cost: normalizeOpencodeModelCost(model.cost, `${modelScope}.cost`),
				variants: normalizeVariants(model.variants, `${modelScope}.variants`),
			})
		}
	}

	return buildOpencodeBaseCatalogArtifact({
		generatedAt:
			parsedInput.generatedAt === undefined
				? undefined
				: expectNonEmptyString(parsedInput.generatedAt, "input.generatedAt"),
		models: flattened,
	})
}

export function deriveOpencodeBaseCatalogSidecarPath(modelsPath: string): string {
	const normalizedModelsPath = expectNonEmptyString(modelsPath, "modelsPath")
	return `${dirname(normalizedModelsPath)}/${OPENCODE_BASE_CATALOG_FILENAME}`
}

export function serializeOpencodeBaseCatalogArtifact(
	artifact: OpencodeBaseCatalogArtifact,
): string {
	return `${JSON.stringify(artifact, null, "\t")}\n`
}
