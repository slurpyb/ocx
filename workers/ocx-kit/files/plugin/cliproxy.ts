import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { type ParseError, parse as parseJsonc } from "jsonc-parser"

type JsonScalar = string | number | boolean | null

type DiscoveryEndpoint = "v1" | "v1beta"
type DiscoveryFailureKind = "timeout" | "auth" | "malformed_json" | "generic"

type SourcePointer = {
	key: string
	providerNamespace: string
	modelId: string
}

type ChatOverride = {
	headers?: Record<string, string>
	params?: Record<string, JsonScalar>
}

type ProviderOverride = {
	displayName?: string
	limits?: Partial<Limits>
	reasoning?: boolean
	cost?: Partial<Cost>
	chat?: ChatOverride
}

type ModelOverride = ProviderOverride & {
	source?: SourcePointer
	safetyCaps?: Partial<SafetyCaps>
}

type ParsedCliproxyConfig = {
	url: string
	apiKey: string
	provider: Record<string, ProviderOverride>
	models: Record<string, ModelOverride>
}

type Limits = {
	context: number
	output: number
	input?: number
}

type Cost = {
	input: number
	output: number
	reasoning?: number
	cacheRead?: number
	cacheWrite?: number
}

type SafetyCaps = {
	context?: number
	output?: number
}

type ParsedCacheModel = {
	source: SourcePointer
	api: {
		npm: string
		id?: string
	}
	displayName: string
	limits: Limits
	reasoning: boolean
	cost: Cost
}

type ParsedCache = {
	models: ParsedCacheModel[]
	bySource: Map<string, ParsedCacheModel>
	providerNamespaces: Set<string>
}

type EndpointItem = {
	endpoint: DiscoveryEndpoint
	rawId: string
	canonicalId: string
	displayName?: string
	ordinal: number
}

type MergedDiscoveryModel = {
	canonicalId: string
	displayName: string
	canonicalConflict: boolean
}

type ResolvedArtifactModel = {
	source: {
		key: string
		providerNamespace: string
		modelId: string
		effectiveHost: string
	}
	output: {
		providerBucketId: string
		modelId: string
	}
	api: {
		npm: string
		id?: string
	}
	displayName: string
	limits: Limits
	reasoning: boolean
	cost: Cost
	safetyCaps?: SafetyCaps
	chat: {
		headers: Record<string, string>
		params: Record<string, JsonScalar>
	}
}

type ResolutionResult = {
	records: ResolvedArtifactModel[]
	skipWarnings: string[]
}

type DiscoveryOutcome =
	| { ok: true; models: EndpointItem[] }
	| { ok: false; kind: DiscoveryFailureKind; message: string }

type HostPreset = {
	basePath: "/v1" | "/v1beta"
	requiredHeaders: Record<string, string>
	requiredParams: Record<string, JsonScalar>
}

type CustomProviderModelPreset = {
	displayName: string
	reasoning: boolean
	limits: Limits
	cost?: Partial<Cost>
	apiId?: string
}

type CustomProviderPreset = {
	effectiveHost?: string
	basePath: "/v1" | "/v1beta"
	api: {
		npm: string
		id?: string
	}
	requiredHeaders: Record<string, string>
	requiredParams: Record<string, JsonScalar>
	limitsPatch?: Partial<Limits>
	safetyCapsPatch?: SafetyCaps
	models: Record<string, CustomProviderModelPreset>
}

const HOST_PRESET_PATCHES: Record<string, HostPreset> = {
	anthropic: {
		basePath: "/v1",
		requiredHeaders: {
			"anthropic-beta":
				"claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
		},
		requiredParams: {},
	},
	openai: {
		basePath: "/v1",
		requiredHeaders: {},
		requiredParams: {},
	},
	google: {
		basePath: "/v1beta",
		requiredHeaders: {},
		requiredParams: {},
	},
	"google-vertex-anthropic": {
		basePath: "/v1",
		requiredHeaders: {},
		requiredParams: {},
	},
	"github-copilot": {
		basePath: "/v1",
		requiredHeaders: {},
		requiredParams: {},
	},
	moonshotai: {
		basePath: "/v1",
		requiredHeaders: {},
		requiredParams: {},
	},
}

const DEFAULT_HOST_PRESET: HostPreset = {
	basePath: "/v1",
	requiredHeaders: {},
	requiredParams: {},
}

// Explicit checked-in alias table: exact discovered IDs -> exact canonical source keys.
const DISCOVERY_ALIAS_TABLE: Record<string, string> = {
	"vertex-claude": "google-vertex-anthropic/vertex-claude",
	"gpt-5-latest": "openai/gpt-5",
}

// Explicit checked-in custom provider table for providers absent from models.dev cache.
// google-antigravity has a documented larger context patch + safety caps.
const CUSTOM_PROVIDER_TABLE: Record<string, CustomProviderPreset> = {
	"google-antigravity": {
		basePath: "/v1beta",
		api: {
			npm: "@ai-sdk/google",
		},
		requiredHeaders: {},
		requiredParams: {},
		limitsPatch: {
			context: 400000,
		},
		safetyCapsPatch: {
			context: 400000,
			output: 64000,
		},
		models: {
			"gemini-2.5-pro": {
				displayName: "Gemini 2.5 Pro (Antigravity)",
				reasoning: true,
				limits: { context: 200000, output: 64000 },
			},
		},
	},
}

const JSON_SCALAR_TYPES = new Set(["string", "number", "boolean"])

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJsoncText(text: string, sourceLabel: string): Record<string, unknown> {
	const parseErrors: ParseError[] = []
	const parsed = parseJsonc(text, parseErrors, {
		disallowComments: false,
		allowTrailingComma: true,
	})
	if (parseErrors.length > 0) {
		throw new Error(`[cliproxy] Invalid JSONC syntax in: ${sourceLabel}`)
	}
	if (!isRecord(parsed)) {
		throw new Error(`[cliproxy] Config must be a JSON object: ${sourceLabel}`)
	}
	return parsed
}

function expectAllowedKeys(input: Record<string, unknown>, allowed: string[], scope: string) {
	const allowedKeys = new Set(allowed)
	for (const key of Object.keys(input)) {
		if (allowedKeys.has(key)) continue
		throw new Error(`[cliproxy] Unsupported key in ${scope}: ${key}`)
	}
}

function expectString(value: unknown, scope: string): string {
	if (typeof value !== "string") {
		throw new Error(`[cliproxy] ${scope} must be a string`)
	}
	return value
}

function expectBoolean(value: unknown, scope: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`[cliproxy] ${scope} must be a boolean`)
	}
	return value
}

function expectPositiveInteger(value: unknown, scope: string): number {
	if (!Number.isInteger(value) || Number(value) < 1) {
		throw new Error(`[cliproxy] ${scope} must be an integer >= 1`)
	}
	return Number(value)
}

function expectFiniteNonNegative(value: unknown, scope: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`[cliproxy] ${scope} must be a finite number >= 0`)
	}
	return value
}

export function normalizeDiscoveredModelId(id: string): string {
	if (id.startsWith("models/")) return id.slice("models/".length)
	return id
}

function buildSourcePointer(providerNamespace: string, modelId: string): SourcePointer {
	return {
		key: `${providerNamespace}/${modelId}`,
		providerNamespace,
		modelId,
	}
}

function parseCanonicalSourceString(value: string, scope: string): SourcePointer {
	if (value.length === 0) {
		throw new Error(`[cliproxy] ${scope} must be a non-empty canonical source string`)
	}
	const slashIndex = value.indexOf("/")
	if (slashIndex <= 0 || slashIndex >= value.length - 1) {
		throw new Error(`[cliproxy] ${scope} must use canonical provider/model form`)
	}
	const providerNamespace = value.slice(0, slashIndex)
	const modelId = value.slice(slashIndex + 1)
	if (modelId.startsWith("/")) {
		throw new Error(`[cliproxy] ${scope} must use canonical provider/model form`)
	}
	return buildSourcePointer(providerNamespace, modelId)
}

function parseCanonicalSourceCandidate(value: string): SourcePointer | undefined {
	if (value.length === 0) return undefined
	const slashIndex = value.indexOf("/")
	if (slashIndex <= 0 || slashIndex >= value.length - 1) return undefined
	const providerNamespace = value.slice(0, slashIndex)
	const modelId = value.slice(slashIndex + 1)
	if (modelId.startsWith("/")) return undefined
	return buildSourcePointer(providerNamespace, modelId)
}

function parseLimitsOverride(value: unknown, scope: string): Partial<Limits> {
	if (!isRecord(value)) {
		throw new Error(`[cliproxy] ${scope} must be an object`)
	}
	expectAllowedKeys(value, ["context", "output", "input"], scope)
	const parsed: Partial<Limits> = {}
	if (value.context !== undefined)
		parsed.context = expectPositiveInteger(value.context, `${scope}.context`)
	if (value.output !== undefined)
		parsed.output = expectPositiveInteger(value.output, `${scope}.output`)
	if (value.input !== undefined) parsed.input = expectPositiveInteger(value.input, `${scope}.input`)
	if (parsed.input !== undefined && parsed.context !== undefined && parsed.input > parsed.context) {
		throw new Error(`[cliproxy] ${scope}.input must be <= ${scope}.context`)
	}
	return parsed
}

function parseCostOverride(value: unknown, scope: string): Partial<Cost> {
	if (!isRecord(value)) {
		throw new Error(`[cliproxy] ${scope} must be an object`)
	}
	expectAllowedKeys(value, ["input", "output", "reasoning", "cacheRead", "cacheWrite"], scope)
	const parsed: Partial<Cost> = {}
	if (value.input !== undefined)
		parsed.input = expectFiniteNonNegative(value.input, `${scope}.input`)
	if (value.output !== undefined)
		parsed.output = expectFiniteNonNegative(value.output, `${scope}.output`)
	if (value.reasoning !== undefined)
		parsed.reasoning = expectFiniteNonNegative(value.reasoning, `${scope}.reasoning`)
	if (value.cacheRead !== undefined)
		parsed.cacheRead = expectFiniteNonNegative(value.cacheRead, `${scope}.cacheRead`)
	if (value.cacheWrite !== undefined)
		parsed.cacheWrite = expectFiniteNonNegative(value.cacheWrite, `${scope}.cacheWrite`)
	return parsed
}

function parseSafetyCapsOverride(value: unknown, scope: string): Partial<SafetyCaps> {
	if (!isRecord(value)) {
		throw new Error(`[cliproxy] ${scope} must be an object`)
	}
	expectAllowedKeys(value, ["context", "output"], scope)
	const parsed: Partial<SafetyCaps> = {}
	if (value.context !== undefined)
		parsed.context = expectPositiveInteger(value.context, `${scope}.context`)
	if (value.output !== undefined)
		parsed.output = expectPositiveInteger(value.output, `${scope}.output`)
	return parsed
}

function parseChatOverride(value: unknown, scope: string): ChatOverride {
	if (!isRecord(value)) {
		throw new Error(`[cliproxy] ${scope} must be an object`)
	}
	expectAllowedKeys(value, ["headers", "params"], scope)
	const parsed: ChatOverride = {}

	if (value.headers !== undefined) {
		if (!isRecord(value.headers)) {
			throw new Error(`[cliproxy] ${scope}.headers must be an object`)
		}
		const headers: Record<string, string> = {}
		for (const [headerKey, headerValue] of Object.entries(value.headers)) {
			headers[headerKey] = expectString(headerValue, `${scope}.headers.${headerKey}`)
		}
		parsed.headers = headers
	}

	if (value.params !== undefined) {
		if (!isRecord(value.params)) {
			throw new Error(`[cliproxy] ${scope}.params must be an object`)
		}
		const params: Record<string, JsonScalar> = {}
		for (const [paramKey, paramValue] of Object.entries(value.params)) {
			if (paramValue === null) {
				params[paramKey] = null
				continue
			}
			if (!JSON_SCALAR_TYPES.has(typeof paramValue)) {
				throw new Error(
					`[cliproxy] ${scope}.params.${paramKey} must be a JSON scalar (string | number | boolean | null)`,
				)
			}
			params[paramKey] = paramValue as string | number | boolean
		}
		parsed.params = params
	}

	return parsed
}

function parseSourceOverride(value: unknown, scope: string): SourcePointer {
	if (typeof value !== "string") {
		throw new Error(`[cliproxy] ${scope} must be a string`)
	}
	return parseCanonicalSourceString(value, scope)
}

function parseProviderOverride(value: unknown, scope: string): ProviderOverride {
	if (!isRecord(value)) {
		throw new Error(`[cliproxy] ${scope} must be an object`)
	}
	expectAllowedKeys(value, ["displayName", "limits", "reasoning", "cost", "chat"], scope)

	const parsed: ProviderOverride = {}
	if (value.displayName !== undefined)
		parsed.displayName = expectString(value.displayName, `${scope}.displayName`)
	if (value.limits !== undefined)
		parsed.limits = parseLimitsOverride(value.limits, `${scope}.limits`)
	if (value.reasoning !== undefined)
		parsed.reasoning = expectBoolean(value.reasoning, `${scope}.reasoning`)
	if (value.cost !== undefined) parsed.cost = parseCostOverride(value.cost, `${scope}.cost`)
	if (value.chat !== undefined) parsed.chat = parseChatOverride(value.chat, `${scope}.chat`)

	return parsed
}

function parseModelOverride(value: unknown, scope: string): ModelOverride {
	if (!isRecord(value)) {
		throw new Error(`[cliproxy] ${scope} must be an object`)
	}
	expectAllowedKeys(
		value,
		["source", "displayName", "limits", "reasoning", "cost", "safetyCaps", "chat"],
		scope,
	)

	const parsed: ModelOverride = {}
	if (value.source !== undefined)
		parsed.source = parseSourceOverride(value.source, `${scope}.source`)
	if (value.displayName !== undefined)
		parsed.displayName = expectString(value.displayName, `${scope}.displayName`)
	if (value.limits !== undefined)
		parsed.limits = parseLimitsOverride(value.limits, `${scope}.limits`)
	if (value.reasoning !== undefined)
		parsed.reasoning = expectBoolean(value.reasoning, `${scope}.reasoning`)
	if (value.cost !== undefined) parsed.cost = parseCostOverride(value.cost, `${scope}.cost`)
	if (value.safetyCaps !== undefined)
		parsed.safetyCaps = parseSafetyCapsOverride(value.safetyCaps, `${scope}.safetyCaps`)
	if (value.chat !== undefined) parsed.chat = parseChatOverride(value.chat, `${scope}.chat`)

	return parsed
}

function resolveCredential(
	apiKey: string,
	resolvers: {
		env: Record<string, string | undefined>
		readCredentialFile: (filePath: string) => string
	},
): string {
	if (apiKey.startsWith("{env:") && apiKey.endsWith("}")) {
		const varName = apiKey.slice(5, -1)
		const resolved = resolvers.env[varName]
		if (!resolved) {
			throw new Error(`[cliproxy] Environment variable not set or empty: ${varName}`)
		}
		return resolved
	}

	if (apiKey.startsWith("{file:") && apiKey.endsWith("}")) {
		const fileRef = apiKey.slice(6, -1)
		const expanded = fileRef.replace(/^~/, os.homedir())
		try {
			return resolvers.readCredentialFile(expanded).trim()
		} catch {
			throw new Error(`[cliproxy] Failed to read credential file: ${expanded}`)
		}
	}

	return apiKey
}

export function parseCliproxyConfigObject(
	raw: Record<string, unknown>,
	resolvers: {
		env: Record<string, string | undefined>
		readCredentialFile: (filePath: string) => string
	},
): ParsedCliproxyConfig {
	expectAllowedKeys(raw, ["url", "apiKey", "provider", "models"], "cliproxy config")

	const url = expectString(raw.url, "cliproxy.url").trim()
	if (url.length === 0) {
		throw new Error("[cliproxy] cliproxy.url must be a non-empty string")
	}

	const apiKeyRaw = raw.apiKey === undefined ? "" : expectString(raw.apiKey, "cliproxy.apiKey")
	const apiKey = resolveCredential(apiKeyRaw, resolvers)

	const provider: Record<string, ProviderOverride> = {}
	if (raw.provider !== undefined) {
		if (!isRecord(raw.provider)) {
			throw new Error("[cliproxy] cliproxy.provider must be an object")
		}
		for (const [namespace, overrideValue] of Object.entries(raw.provider)) {
			provider[namespace] = parseProviderOverride(overrideValue, `cliproxy.provider.${namespace}`)
		}
	}

	const models: Record<string, ModelOverride> = {}
	if (raw.models !== undefined) {
		if (!isRecord(raw.models)) {
			throw new Error("[cliproxy] cliproxy.models must be an object")
		}
		for (const [modelId, overrideValue] of Object.entries(raw.models)) {
			models[modelId] = parseModelOverride(overrideValue, `cliproxy.models.${modelId}`)
		}
	}

	return {
		url,
		apiKey,
		provider,
		models,
	}
}

export function parseCliproxyConfigText(
	text: string,
	sourceLabel: string,
	resolvers: {
		env: Record<string, string | undefined>
		readCredentialFile: (filePath: string) => string
	},
): ParsedCliproxyConfig {
	const raw = parseJsoncText(text, sourceLabel)
	return parseCliproxyConfigObject(raw, resolvers)
}

function parseCacheCost(value: unknown, scope: string): Cost {
	if (value === undefined) {
		return {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		}
	}
	if (!isRecord(value)) {
		throw new Error(`[cliproxy] ${scope} must be an object`)
	}
	expectAllowedKeys(value, ["input", "output", "reasoning", "cache_read", "cache_write"], scope)

	const input =
		value.input === undefined ? 0 : expectFiniteNonNegative(value.input, `${scope}.input`)
	const output =
		value.output === undefined ? 0 : expectFiniteNonNegative(value.output, `${scope}.output`)
	const reasoning =
		value.reasoning === undefined
			? undefined
			: expectFiniteNonNegative(value.reasoning, `${scope}.reasoning`)

	const cacheRead =
		value.cache_read === undefined
			? 0
			: expectFiniteNonNegative(value.cache_read, `${scope}.cache_read`)
	const cacheWrite =
		value.cache_write === undefined
			? 0
			: expectFiniteNonNegative(value.cache_write, `${scope}.cache_write`)

	return {
		input,
		output,
		reasoning,
		cacheRead,
		cacheWrite,
	}
}

function parseCacheLimits(value: unknown, scope: string): Limits {
	if (!isRecord(value)) {
		throw new Error(`[cliproxy] ${scope} must be an object`)
	}
	const context = expectPositiveInteger(value.context, `${scope}.context`)
	const output = expectPositiveInteger(value.output, `${scope}.output`)
	const input =
		value.input === undefined ? undefined : expectPositiveInteger(value.input, `${scope}.input`)
	if (input !== undefined && input > context) {
		throw new Error(`[cliproxy] ${scope}.input must be <= ${scope}.context`)
	}
	return {
		context,
		output,
		input,
	}
}

function parseCacheModel(
	providerNamespace: string,
	providerDefaults: { npm?: string; api?: string },
	modelKey: string,
	value: unknown,
): ParsedCacheModel {
	const scope = `cache provider ${providerNamespace} model ${modelKey}`
	if (!isRecord(value)) {
		throw new Error(`[cliproxy] ${scope} must be an object`)
	}

	const modelId = expectString(value.id, `${scope}.id`)
	const displayName = expectString(value.name, `${scope}.name`)
	const reasoning = expectBoolean(value.reasoning, `${scope}.reasoning`)
	const limits = parseCacheLimits(value.limit, `${scope}.limit`)
	const cost = parseCacheCost(value.cost, `${scope}.cost`)

	const modelProvider = value.provider
	if (modelProvider !== undefined && !isRecord(modelProvider)) {
		throw new Error(`[cliproxy] ${scope}.provider must be an object`)
	}

	const modelNpm =
		isRecord(modelProvider) && modelProvider.npm !== undefined ? modelProvider.npm : undefined
	const modelApi =
		isRecord(modelProvider) && modelProvider.api !== undefined ? modelProvider.api : undefined

	const inheritedNpmRaw = modelNpm ?? providerDefaults.npm
	if (typeof inheritedNpmRaw !== "string" || inheritedNpmRaw.length === 0) {
		throw new Error(`[cliproxy] ${scope} is missing required api.npm inheritance`)
	}

	let inheritedApi: string | undefined
	if (modelApi !== undefined) {
		inheritedApi = expectString(modelApi, `${scope}.provider.api`)
	} else if (providerDefaults.api !== undefined) {
		inheritedApi = expectString(providerDefaults.api, `${scope}.provider.api`)
	}

	return {
		source: buildSourcePointer(providerNamespace, modelId),
		api: {
			npm: inheritedNpmRaw,
			id: inheritedApi,
		},
		displayName,
		limits,
		reasoning,
		cost,
	}
}

function looksLikeCacheProviderNode(value: Record<string, unknown>): boolean {
	return "id" in value || "name" in value || "models" in value || "npm" in value || "api" in value
}

export function parseCliproxyCacheText(text: string, cachePath: string): ParsedCache {
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch {
		throw new Error(`[cliproxy] Malformed cache JSON: ${cachePath}`)
	}
	if (!isRecord(raw)) {
		throw new Error(`[cliproxy] Cache root must be a JSON object: ${cachePath}`)
	}

	const marker = raw.$cliproxyCacheContractVersion
	if (marker !== undefined) {
		if (!Number.isInteger(marker) || marker !== 1) {
			throw new Error("[cliproxy] Unsupported $cliproxyCacheContractVersion marker")
		}
	}

	const parsedModels: ParsedCacheModel[] = []

	for (const [providerNamespace, providerValue] of Object.entries(raw)) {
		if (providerNamespace === "$cliproxyCacheContractVersion") continue
		if (!isRecord(providerValue)) continue
		if (!looksLikeCacheProviderNode(providerValue)) continue

		const providerScope = `cache provider ${providerNamespace}`
		const providerId = expectString(providerValue.id, `${providerScope}.id`)
		expectString(providerValue.name, `${providerScope}.name`)
		if (!isRecord(providerValue.models)) {
			throw new Error(`[cliproxy] ${providerScope}.models must be an object`)
		}

		const providerNpm =
			providerValue.npm === undefined
				? undefined
				: expectString(providerValue.npm, `${providerScope}.npm`)
		const providerApi =
			providerValue.api === undefined
				? undefined
				: expectString(providerValue.api, `${providerScope}.api`)

		for (const [modelKey, modelValue] of Object.entries(providerValue.models)) {
			parsedModels.push(
				parseCacheModel(providerId, { npm: providerNpm, api: providerApi }, modelKey, modelValue),
			)
		}
	}

	if (parsedModels.length === 0) {
		throw new Error("[cliproxy] Cache contains zero providers/models")
	}

	const bySource = new Map<string, ParsedCacheModel>()
	const providerNamespaces = new Set<string>()

	for (const model of parsedModels) {
		if (bySource.has(model.source.key)) {
			throw new Error(`[cliproxy] duplicate cache source key: ${model.source.key}`)
		}
		bySource.set(model.source.key, model)
		providerNamespaces.add(model.source.providerNamespace)
	}

	return {
		models: parsedModels,
		bySource,
		providerNamespaces,
	}
}

export function parseV1DiscoveryPayload(payload: unknown): EndpointItem[] {
	if (!isRecord(payload) || !Array.isArray(payload.data)) {
		throw new Error("[cliproxy] Malformed /v1/models payload")
	}

	const items: EndpointItem[] = []
	for (let ordinal = 0; ordinal < payload.data.length; ordinal += 1) {
		const entry = payload.data[ordinal]
		if (!isRecord(entry) || typeof entry.id !== "string") continue
		const canonicalId = normalizeDiscoveredModelId(entry.id)
		if (canonicalId.length === 0) continue
		items.push({
			endpoint: "v1",
			rawId: entry.id,
			canonicalId,
			displayName:
				typeof entry.display_name === "string" && entry.display_name.length > 0
					? entry.display_name
					: undefined,
			ordinal,
		})
	}
	return items
}

export function parseV1BetaDiscoveryPayload(payload: unknown): EndpointItem[] {
	if (!isRecord(payload) || !Array.isArray(payload.models)) {
		throw new Error("[cliproxy] Malformed /v1beta/models payload")
	}

	const items: EndpointItem[] = []
	for (let ordinal = 0; ordinal < payload.models.length; ordinal += 1) {
		const entry = payload.models[ordinal]
		if (!isRecord(entry) || typeof entry.name !== "string") continue
		const canonicalId = normalizeDiscoveredModelId(entry.name)
		if (canonicalId.length === 0) continue
		items.push({
			endpoint: "v1beta",
			rawId: entry.name,
			canonicalId,
			displayName:
				typeof entry.displayName === "string" && entry.displayName.length > 0
					? entry.displayName
					: undefined,
			ordinal,
		})
	}

	return items
}

export function mergeDiscoveryModels(
	v1: EndpointItem[],
	v1beta: EndpointItem[],
): MergedDiscoveryModel[] {
	type Bucket = {
		v1: EndpointItem[]
		v1beta: EndpointItem[]
		canonicalConflict: boolean
	}

	const merged = new Map<string, Bucket>()

	const upsert = (item: EndpointItem) => {
		const bucket = merged.get(item.canonicalId) ?? {
			v1: [],
			v1beta: [],
			canonicalConflict: false,
		}
		const target = item.endpoint === "v1" ? bucket.v1 : bucket.v1beta
		if (target.length > 0 && target.some((existing) => existing.rawId !== item.rawId)) {
			bucket.canonicalConflict = true
		}
		target.push(item)
		merged.set(item.canonicalId, bucket)
	}

	for (const item of v1) upsert(item)
	for (const item of v1beta) upsert(item)

	const records: MergedDiscoveryModel[] = []
	for (const [canonicalId, bucket] of merged.entries()) {
		const v1Sorted = [...bucket.v1].sort((a, b) => a.ordinal - b.ordinal)
		const v1betaSorted = [...bucket.v1beta].sort((a, b) => a.ordinal - b.ordinal)

		const displayName =
			v1Sorted.find((item) => item.displayName)?.displayName ??
			v1betaSorted.find((item) => item.displayName)?.displayName ??
			canonicalId

		records.push({
			canonicalId,
			displayName,
			canonicalConflict: bucket.canonicalConflict,
		})
	}

	records.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId))
	return records
}

function isTimeoutError(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	if (error.name === "AbortError") return true
	const msg = error.message.toLowerCase()
	return msg.includes("timeout") || msg.includes("timed out") || msg.includes("abort")
}

async function fetchDiscoveryEndpoint(
	endpoint: DiscoveryEndpoint,
	url: string,
	apiKey: string,
): Promise<DiscoveryOutcome> {
	const endpointPath = endpoint === "v1" ? "/v1/models" : "/v1beta/models"
	const requestHeaders: Record<string, string> = {}
	if (apiKey) {
		requestHeaders["x-api-key"] = apiKey
	}
	if (endpoint === "v1") {
		requestHeaders["User-Agent"] = "claude-cli"
	}

	let response: Response
	try {
		response = await fetch(`${url}${endpointPath}`, {
			headers: requestHeaders,
			signal: AbortSignal.timeout(5000),
		})
	} catch (error) {
		if (isTimeoutError(error)) {
			return {
				ok: false,
				kind: "timeout",
				message: `${endpointPath} timed out`,
			}
		}
		return {
			ok: false,
			kind: "generic",
			message: `${endpointPath} request failed`,
		}
	}

	if (!response.ok) {
		return {
			ok: false,
			kind: response.status === 401 || response.status === 403 ? "auth" : "generic",
			message: `${endpointPath} returned HTTP ${response.status}`,
		}
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(await response.text())
	} catch {
		return {
			ok: false,
			kind: "malformed_json",
			message: `${endpointPath} returned malformed JSON`,
		}
	}

	try {
		const models =
			endpoint === "v1" ? parseV1DiscoveryPayload(parsed) : parseV1BetaDiscoveryPayload(parsed)
		return { ok: true, models }
	} catch (error) {
		return {
			ok: false,
			kind: "malformed_json",
			message: error instanceof Error ? error.message : `${endpointPath} payload invalid`,
		}
	}
}

function selectDominantDiscoveryFailure(
	outcomes: [DiscoveryOutcome, DiscoveryOutcome],
): DiscoveryOutcome {
	const order: Record<DiscoveryFailureKind, number> = {
		timeout: 4,
		auth: 3,
		malformed_json: 2,
		generic: 1,
	}

	const failures = outcomes.filter(
		(item): item is Extract<DiscoveryOutcome, { ok: false }> => !item.ok,
	)
	failures.sort((a, b) => order[b.kind] - order[a.kind])
	return failures[0]
}

export async function discoverMergedModels(
	url: string,
	apiKey: string,
): Promise<MergedDiscoveryModel[]> {
	const [v1, v1beta] = await Promise.all([
		fetchDiscoveryEndpoint("v1", url, apiKey),
		fetchDiscoveryEndpoint("v1beta", url, apiKey),
	])

	if (v1.ok && v1beta.ok) {
		const merged = mergeDiscoveryModels(v1.models, v1beta.models)
		if (merged.length === 0) {
			throw new Error("[cliproxy] discovery returned zero merged models")
		}
		return merged
	}

	if (v1.ok !== v1beta.ok) {
		throw new Error(
			"[cliproxy] discovery partial failure: both /v1/models and /v1beta/models must succeed",
		)
	}

	const dominantFailure = selectDominantDiscoveryFailure([v1, v1beta])
	if (dominantFailure.ok) {
		throw new Error("[cliproxy] discovery failed")
	}
	throw new Error(
		`[cliproxy] discovery failed (${dominantFailure.kind}): ${dominantFailure.message}`,
	)
}

function resolveHostPreset(sourceProviderNamespace: string, effectiveHost: string): HostPreset {
	const customProvider = CUSTOM_PROVIDER_TABLE[sourceProviderNamespace]
	if (customProvider) {
		const customEffectiveHost = customProvider.effectiveHost ?? sourceProviderNamespace
		if (customEffectiveHost === effectiveHost) {
			return {
				basePath: customProvider.basePath,
				requiredHeaders: customProvider.requiredHeaders,
				requiredParams: customProvider.requiredParams,
			}
		}
	}

	return HOST_PRESET_PATCHES[effectiveHost] ?? DEFAULT_HOST_PRESET
}

function ensurePresetConflictFree(
	overrideChat: ChatOverride | undefined,
	preset: HostPreset,
	scope: string,
) {
	if (!overrideChat) return

	if (overrideChat.headers) {
		for (const [requiredKey, requiredValue] of Object.entries(preset.requiredHeaders)) {
			const nextValue = overrideChat.headers[requiredKey]
			if (nextValue === undefined) continue
			if (nextValue !== requiredValue) {
				throw new Error(
					`[cliproxy] ${scope} cannot override preset-required chat.headers.${requiredKey}`,
				)
			}
		}
	}

	if (overrideChat.params) {
		for (const [requiredKey, requiredValue] of Object.entries(preset.requiredParams)) {
			const nextValue = overrideChat.params[requiredKey]
			if (nextValue === undefined) continue
			if (nextValue !== requiredValue) {
				throw new Error(
					`[cliproxy] ${scope} cannot override preset-required chat.params.${requiredKey}`,
				)
			}
		}
	}
}

function mergeChat(
	base: ResolvedArtifactModel["chat"],
	override: ChatOverride | undefined,
): ResolvedArtifactModel["chat"] {
	if (!override) return base
	return {
		headers: {
			...base.headers,
			...(override.headers ?? {}),
		},
		params: {
			...base.params,
			...(override.params ?? {}),
		},
	}
}

function applyOverride(
	base: ResolvedArtifactModel,
	override: ProviderOverride | undefined,
): ResolvedArtifactModel {
	if (!override) return base
	return {
		...base,
		displayName: override.displayName ?? base.displayName,
		limits: {
			...base.limits,
			...(override.limits ?? {}),
		},
		reasoning: override.reasoning ?? base.reasoning,
		cost: {
			...base.cost,
			...(override.cost ?? {}),
		},
		chat: mergeChat(base.chat, override.chat),
	}
}

function applyModelOverride(
	base: ResolvedArtifactModel,
	override: ModelOverride | undefined,
): ResolvedArtifactModel {
	if (!override) return base
	const merged = applyOverride(base, override)
	if (!override.safetyCaps) return merged
	return {
		...merged,
		safetyCaps: {
			...(merged.safetyCaps ?? {}),
			...override.safetyCaps,
		},
	}
}

function applyCustomProviderPatch(
	base: ResolvedArtifactModel,
	customProvider: CustomProviderPreset | undefined,
): ResolvedArtifactModel {
	if (!customProvider) return base

	const withLimitPatch =
		customProvider.limitsPatch === undefined
			? base
			: {
					...base,
					limits: {
						...base.limits,
						...customProvider.limitsPatch,
					},
				}

	if (!customProvider.safetyCapsPatch) {
		return withLimitPatch
	}

	return {
		...withLimitPatch,
		safetyCaps: {
			...(withLimitPatch.safetyCaps ?? {}),
			...customProvider.safetyCapsPatch,
		},
	}
}

function isValidSafetyCaps(model: ResolvedArtifactModel): boolean {
	if (!model.safetyCaps) return true
	if (model.safetyCaps.context !== undefined && model.safetyCaps.context > model.limits.context)
		return false
	if (model.safetyCaps.output !== undefined && model.safetyCaps.output > model.limits.output)
		return false
	return true
}

function inferDefaultFamilySource(canonicalId: string): SourcePointer | undefined {
	if (canonicalId.includes("/")) {
		return undefined
	}

	if (canonicalId.startsWith("claude")) {
		return buildSourcePointer("anthropic", canonicalId)
	}

	if (
		canonicalId.startsWith("gpt") ||
		canonicalId.startsWith("o") ||
		canonicalId.startsWith("text-embedding") ||
		canonicalId.startsWith("whisper")
	) {
		return buildSourcePointer("openai", canonicalId)
	}

	if (canonicalId.startsWith("gemini")) {
		return buildSourcePointer("google", canonicalId)
	}

	if (canonicalId.startsWith("kimi")) {
		return buildSourcePointer("moonshotai", canonicalId)
	}

	return undefined
}

type SourceCandidate = {
	candidate: SourcePointer
	fromUserSource: boolean
}

function resolveSourceCandidate(
	discoveryModel: MergedDiscoveryModel,
	modelOverride: ModelOverride | undefined,
): SourceCandidate | undefined {
	if (modelOverride?.source) {
		return {
			candidate: modelOverride.source,
			fromUserSource: true,
		}
	}

	if (discoveryModel.canonicalId.includes("/")) {
		const providerQualifiedCandidate = parseCanonicalSourceCandidate(discoveryModel.canonicalId)
		if (providerQualifiedCandidate) {
			return {
				candidate: providerQualifiedCandidate,
				fromUserSource: false,
			}
		}
	}

	const aliasTarget = DISCOVERY_ALIAS_TABLE[discoveryModel.canonicalId]
	if (aliasTarget !== undefined) {
		return {
			candidate: parseCanonicalSourceString(aliasTarget, `alias.${discoveryModel.canonicalId}`),
			fromUserSource: false,
		}
	}

	const inferred = inferDefaultFamilySource(discoveryModel.canonicalId)
	if (inferred) {
		return {
			candidate: inferred,
			fromUserSource: false,
		}
	}

	return undefined
}

type ResolvedSourceTarget = {
	selected: ParsedCacheModel
	customProvider?: CustomProviderPreset
}

type MissingSourceTarget = {
	missingReason: "unknown-provider" | "missing-target"
}

function normalizeCost(input: Partial<Cost> | undefined): Cost {
	return {
		input: input?.input ?? 0,
		output: input?.output ?? 0,
		...(input?.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
		cacheRead: input?.cacheRead ?? 0,
		cacheWrite: input?.cacheWrite ?? 0,
	}
}

function resolveSourceTarget(
	cache: ParsedCache,
	candidate: SourcePointer,
): ResolvedSourceTarget | MissingSourceTarget {
	const selectedFromCache = cache.bySource.get(candidate.key)
	if (selectedFromCache) {
		return { selected: selectedFromCache }
	}

	if (!cache.providerNamespaces.has(candidate.providerNamespace)) {
		const customProvider = CUSTOM_PROVIDER_TABLE[candidate.providerNamespace]
		if (!customProvider) {
			return { missingReason: "unknown-provider" }
		}

		const customModel = customProvider.models[candidate.modelId]
		if (!customModel) {
			return { missingReason: "missing-target" }
		}

		return {
			selected: {
				source: candidate,
				api: {
					npm: customProvider.api.npm,
					id: customModel.apiId ?? customProvider.api.id,
				},
				displayName: customModel.displayName,
				limits: customModel.limits,
				reasoning: customModel.reasoning,
				cost: normalizeCost(customModel.cost),
			},
			customProvider,
		}
	}

	return { missingReason: "missing-target" }
}

export function resolveCliproxyArtifact(input: {
	cache: ParsedCache
	config: ParsedCliproxyConfig
	discovered: MergedDiscoveryModel[]
}): ResolutionResult {
	const records: ResolvedArtifactModel[] = []
	const skipWarnings: string[] = []

	for (const discoveredModel of input.discovered) {
		if (discoveredModel.canonicalConflict) {
			skipWarnings.push(`[cliproxy] skipped <${discoveredModel.canonicalId}>: canonical conflict`)
			continue
		}

		const modelOverride = input.config.models[discoveredModel.canonicalId]
		const sourceCandidate = resolveSourceCandidate(discoveredModel, modelOverride)
		if (!sourceCandidate) {
			skipWarnings.push(`[cliproxy] skipped <${discoveredModel.canonicalId}>: unresolved source`)
			continue
		}

		const sourceTarget = resolveSourceTarget(input.cache, sourceCandidate.candidate)
		if ("missingReason" in sourceTarget) {
			if (sourceCandidate.fromUserSource) {
				if (sourceTarget.missingReason === "unknown-provider") {
					throw new Error(
						`[cliproxy] source target for <${discoveredModel.canonicalId}> references unsupported provider namespace: ${sourceCandidate.candidate.providerNamespace}`,
					)
				}
				throw new Error(
					`[cliproxy] source target for <${discoveredModel.canonicalId}> does not exist: ${sourceCandidate.candidate.key}`,
				)
			}
			skipWarnings.push(
				`[cliproxy] skipped <${discoveredModel.canonicalId}>: auto-derived candidate miss`,
			)
			continue
		}

		const selected = sourceTarget.selected
		const customProvider = sourceTarget.customProvider
		const effectiveHost = customProvider?.effectiveHost ?? selected.source.providerNamespace
		const preset = resolveHostPreset(selected.source.providerNamespace, effectiveHost)

		const providerOverride = input.config.provider[selected.source.providerNamespace]
		ensurePresetConflictFree(
			providerOverride?.chat,
			preset,
			`cliproxy.provider.${selected.source.providerNamespace}`,
		)
		ensurePresetConflictFree(
			modelOverride?.chat,
			preset,
			`cliproxy.models.${discoveredModel.canonicalId}`,
		)

		const baseRecord: ResolvedArtifactModel = {
			source: {
				key: selected.source.key,
				providerNamespace: selected.source.providerNamespace,
				modelId: selected.source.modelId,
				effectiveHost,
			},
			output: {
				providerBucketId: `cliproxy-${effectiveHost}`,
				modelId: discoveredModel.canonicalId,
			},
			api: {
				npm: selected.api.npm,
				id: selected.api.id,
			},
			displayName: discoveredModel.displayName,
			limits: { ...selected.limits },
			reasoning: selected.reasoning,
			cost: { ...selected.cost },
			chat: {
				headers: { ...preset.requiredHeaders },
				params: { ...preset.requiredParams },
			},
		}

		const withCustomPatch = applyCustomProviderPatch(baseRecord, customProvider)
		const withProviderOverride = applyOverride(withCustomPatch, providerOverride)
		const withModelOverride = applyModelOverride(withProviderOverride, modelOverride)

		if (
			withModelOverride.limits.input !== undefined &&
			withModelOverride.limits.input > withModelOverride.limits.context
		) {
			throw new Error(
				`[cliproxy] limits.input must be <= limits.context for <${discoveredModel.canonicalId}>`,
			)
		}

		if (!isValidSafetyCaps(withModelOverride)) {
			skipWarnings.push(`[cliproxy] skipped <${discoveredModel.canonicalId}>: unsafe preset output`)
			continue
		}

		records.push(withModelOverride)
	}

	records.sort((left, right) => {
		const providerSort = left.output.providerBucketId.localeCompare(right.output.providerBucketId)
		if (providerSort !== 0) return providerSort
		return left.output.modelId.localeCompare(right.output.modelId)
	})

	if (records.length === 0) {
		throw new Error("[cliproxy] zero providers/all models skipped")
	}

	return {
		records,
		skipWarnings,
	}
}

export function buildCliproxyProviderPatch(input: {
	config: ParsedCliproxyConfig
	records: ResolvedArtifactModel[]
}): Record<string, Record<string, unknown>> {
	const patch: Record<string, Record<string, unknown>> = {}

	for (const record of input.records) {
		const hostPreset = resolveHostPreset(
			record.source.providerNamespace,
			record.source.effectiveHost,
		)
		const providerId = record.output.providerBucketId

		if (!patch[providerId]) {
			const options: Record<string, unknown> = {
				baseURL: `${input.config.url}${hostPreset.basePath}`,
			}
			if (input.config.apiKey.length > 0) {
				options.apiKey = input.config.apiKey
				options.headers = {
					"x-api-key": input.config.apiKey,
				}
			}

			patch[providerId] = {
				id: providerId,
				name: `cliproxy (${record.source.effectiveHost})`,
				npm: record.api.npm,
				options,
				models: {},
			}
		}

		const provider = patch[providerId]
		const models = provider.models as Record<string, Record<string, unknown>>

		const modelPayload: Record<string, unknown> = {
			id: record.source.modelId,
			name: record.displayName,
			reasoning: record.reasoning,
			limit: {
				context: record.limits.context,
				output: record.limits.output,
				...(record.limits.input !== undefined ? { input: record.limits.input } : {}),
			},
			cost: {
				input: record.cost.input,
				output: record.cost.output,
				...(record.cost.reasoning !== undefined ? { reasoning: record.cost.reasoning } : {}),
				...(record.cost.cacheRead !== undefined ? { cache_read: record.cost.cacheRead } : {}),
				...(record.cost.cacheWrite !== undefined ? { cache_write: record.cost.cacheWrite } : {}),
			},
			provider: {
				npm: record.api.npm,
				...(record.api.id !== undefined ? { api: record.api.id } : {}),
			},
		}

		if (record.safetyCaps) {
			modelPayload.safetyCaps = record.safetyCaps
		}

		if (Object.keys(record.chat.headers).length > 0) {
			modelPayload.headers = record.chat.headers
		}
		if (Object.keys(record.chat.params).length > 0) {
			modelPayload.options = record.chat.params
		}

		models[record.output.modelId] = modelPayload
	}

	return patch
}

async function loadConfigFromDisk(): Promise<ParsedCliproxyConfig | undefined> {
	const paths = resolveCliproxyConfigSearchPaths({
		env: process.env,
		homedir: os.homedir(),
	})

	for (const configPath of paths) {
		const file = Bun.file(configPath)
		if (!(await file.exists())) continue
		const text = await file.text()
		return parseCliproxyConfigText(text, configPath, {
			env: process.env,
			readCredentialFile: (credentialPath) => readFileSync(credentialPath, "utf-8"),
		})
	}

	return undefined
}

export function resolveCliproxyConfigSearchPaths(input: {
	env: Record<string, string | undefined>
	homedir: string
}): string[] {
	const configBase = input.env.XDG_CONFIG_HOME || `${input.homedir}/.config`
	const globalOrProfileConfigDir = input.env.OPENCODE_CONFIG_DIR || `${configBase}/opencode`
	const shouldReadProjectConfig = input.env.OPENCODE_DISABLE_PROJECT_CONFIG === undefined

	const candidateDirs = [
		...(shouldReadProjectConfig ? [".opencode"] : []),
		globalOrProfileConfigDir,
	]

	const paths: string[] = []
	const seen = new Set<string>()
	for (const dir of candidateDirs) {
		for (const extension of ["jsonc", "json"]) {
			const path = `${dir}/cliproxy.${extension}`
			if (seen.has(path)) continue
			seen.add(path)
			paths.push(path)
		}
	}

	return paths
}

function resolveCachePath(): string {
	if (process.env.OPENCODE_MODELS_PATH) {
		return process.env.OPENCODE_MODELS_PATH
	}

	const home = os.homedir()
	const candidates = [
		`${process.env.XDG_CACHE_HOME || `${home}/.cache`}/opencode/models.json`,
		`${home}/Library/Caches/opencode/models.json`,
	]

	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue
		return candidate
	}

	throw new Error("[cliproxy] models.dev cache file not found")
}

function loadCacheFromDisk(): ParsedCache {
	const cachePath = resolveCachePath()
	let text: string
	try {
		text = readFileSync(cachePath, "utf-8")
	} catch {
		throw new Error(`[cliproxy] Failed to read cache file: ${cachePath}`)
	}
	return parseCliproxyCacheText(text, cachePath)
}

export const CliproxyPlugin: Plugin = async () => {
	const parsedConfig = await loadConfigFromDisk()
	if (!parsedConfig) {
		return {}
	}

	const parsedCache = loadCacheFromDisk()
	const discovered = await discoverMergedModels(parsedConfig.url, parsedConfig.apiKey)
	const resolved = resolveCliproxyArtifact({
		cache: parsedCache,
		config: parsedConfig,
		discovered,
	})

	for (const warning of resolved.skipWarnings) {
		console.warn(warning)
	}

	const providerPatch = buildCliproxyProviderPatch({
		config: parsedConfig,
		records: resolved.records,
	})

	const hooks: Hooks = {
		config: async (cfg) => {
			cfg.provider = cfg.provider || {}
			for (const [providerId, providerValue] of Object.entries(providerPatch)) {
				cfg.provider[providerId] = providerValue
			}
		},
	}

	return hooks
}

export default CliproxyPlugin
