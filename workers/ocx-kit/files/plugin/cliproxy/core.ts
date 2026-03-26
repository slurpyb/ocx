import { existsSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import { dirname } from "node:path"
import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { type ParseError, parse as parseJsonc } from "jsonc-parser"

type JsonScalar = string | number | boolean | null

type CanonicalCapabilities = {
	modalities?: string[]
	modalitiesInput?: string[]
	modalitiesOutput?: string[]
	variants?: string[]
}

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
	contextOver200k?: {
		input: number
		output: number
		cacheRead?: number
		cacheWrite?: number
	}
}

type InterleavedCapability =
	| boolean
	| {
			field: "reasoning_content" | "reasoning_details"
	  }

type SafetyCaps = {
	context?: number
	output?: number
}

export type BaseCatalogSource = "models.dev" | "opencode" | "supplemental"

type ParsedCacheModel = {
	source: SourcePointer
	baseSource: BaseCatalogSource
	api: {
		npm: string
		id?: string
	}
	displayName: string
	releaseDate?: string
	attachment?: boolean
	limits: Limits
	reasoning: boolean
	cost: Cost
	capabilities?: CanonicalCapabilities
}

type ParsedCache = {
	models: ParsedCacheModel[]
	bySource: Map<string, ParsedCacheModel>
	providerNamespaces: Set<string>
}

export type BaseCatalogContractVersion = 1

export type BaseCatalogModelV1 = {
	source: string
	api: {
		npm: string
		id?: string
	}
	displayName: string
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
	interleaved?: InterleavedCapability
	options?: Record<string, unknown>
	headers?: Record<string, string>
	limits: Limits
	reasoning: boolean
	cost?: Partial<Cost>
	capabilities?: CanonicalCapabilities
}

export type BaseCatalogV1 = {
	$cliproxyBaseCatalogContractVersion: BaseCatalogContractVersion
	models: BaseCatalogModelV1[]
}

type EndpointItem = {
	endpoint: DiscoveryEndpoint
	rawId: string
	canonicalId: string
	displayName?: string
	ownerHint?: string
	ordinal: number
}

type MergedDiscoveryModel = {
	canonicalId: string
	displayName: string
	ownerHint?: string
	canonicalConflict: boolean
	resolvedFromAliasId?: string
}

type ResolvedArtifactModel = {
	source: {
		key: string
		providerNamespace: string
		modelId: string
		effectiveHost: string
	}
	baseSource: BaseCatalogSource
	output: {
		providerBucketId: string
		modelId: string
		resolvedFromAliasId?: string
	}
	api: {
		npm: string
		id?: string
	}
	displayName: string
	releaseDate?: string
	attachment?: boolean
	limits: Limits
	reasoning: boolean
	cost: Cost
	safetyCaps?: SafetyCaps
	chat: {
		headers: Record<string, string>
		params: Record<string, JsonScalar>
	}
	capabilities?: CanonicalCapabilities
}

type ResolutionResult = {
	records: ResolvedArtifactModel[]
	skipped: CliproxySkipRecord[]
}

export type CliproxySkipCode =
	| "availability-gap"
	| "exposure-gap"
	| "canonical conflict"
	| "unresolved source"
	| "auto-derived candidate miss"
	| "unsafe preset output"

export type CliproxySkipRecord = {
	code?: CliproxySkipCode
	modelId: string
	reason: string
	canonicalId?: string
	discoveredId?: string
}

export type CliproxyFailCode =
	| "invalid-canonical-metadata"
	| "ambiguous-mapping"
	| "duplicate-emitted-id"
	| "missing-required-provider-fields"
	| "invalid-availability-input"
	| "transform-parity-mismatch"
	| "availability-fallback-missing"

export type CliproxyFailRecord = {
	code: CliproxyFailCode
	message: string
	canonicalId?: string
	discoveredId?: string
}

type GenerationArtifact = {
	providerPatch: Record<string, Record<string, unknown>>
	skipped: CliproxySkipRecord[]
	failed: CliproxyFailRecord[]
	availabilitySource: "live" | "snapshot"
	snapshotPersistenceFailure?: string
}

class CliproxyGenerationFailure extends Error {
	constructor(
		readonly code: CliproxyFailCode,
		message: string,
		readonly details?: { canonicalId?: string; discoveredId?: string },
	) {
		super(message)
		this.name = "CliproxyGenerationFailure"
	}
}

type PersistedAvailabilityModel = {
	canonicalId: string
	ownerHint?: string
	canonicalConflict?: boolean
}

type PersistedAvailabilitySnapshot = {
	$cliproxyAvailabilityContractVersion: 1
	sourceUrl: string
	capturedAt: string
	models: PersistedAvailabilityModel[]
}

type ResolvedCachePaths = {
	modelsPath: string
	availabilitySnapshotPath: string
	opencodeBaseCatalogPath?: string
	opencodeBaseCatalogPathIsExplicit: boolean
}

type CanonicalCatalogModel = {
	canonicalId: string
	source: SourcePointer
	baseSource: BaseCatalogSource
	api: {
		npm: string
		id?: string
	}
	displayName: string
	releaseDate?: string
	attachment?: boolean
	limits: Limits
	reasoning: boolean
	cost: Cost
	capabilities?: CanonicalCapabilities
	customProvider?: CustomProviderPreset
}

type CanonicalCatalog = {
	models: CanonicalCatalogModel[]
	byCanonicalId: Map<string, CanonicalCatalogModel>
	bySourceKey: Map<string, CanonicalCatalogModel>
}

type AvailabilitySelection = {
	availableCanonicalIds: Set<string>
	aliasByCanonicalId: Map<string, string>
	skipped: CliproxySkipRecord[]
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
	"gpt-5-latest": "openai/gpt-5",
	"codex-mini-latest": "openai/codex-mini",
}

const OWNER_PROVIDER_NAMESPACE_ALIASES: Record<string, string> = {
	openai: "openai",
	"github-copilot": "github-copilot",
	anthropic: "anthropic",
	google: "google",
	moonshot: "moonshotai",
	moonshotai: "moonshotai",
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

const CLIPROXY_BASE_CATALOG_CONTRACT_VERSION: BaseCatalogContractVersion = 1
const OPENCODE_BASE_CATALOG_ENV_VAR = "OPENCODE_BASE_CATALOG_PATH"
const OPENCODE_BASE_CATALOG_DEFAULT_FILENAME = "opencode-base-catalog.json"

const SUPPLEMENTAL_BASE_CATALOG_MODELS: BaseCatalogModelV1[] = [
	{
		source: "google-antigravity/gemini-2.5-pro",
		api: {
			npm: "@ai-sdk/google",
		},
		displayName: "Gemini 2.5 Pro (Antigravity)",
		limits: { context: 200000, output: 64000 },
		reasoning: true,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
	},
]

const JSON_SCALAR_TYPES = new Set(["string", "number", "boolean"])
const CLIPROXY_VERBOSE_ENV_VAR = "CLIPROXY_VERBOSE"
const CLIPROXY_AVAILABILITY_CONTRACT_VERSION = 1

const UNQUALIFIED_CANONICAL_MODEL_ID_PROVIDERS = new Set([
	"anthropic",
	"openai",
	"google",
	"google-vertex-anthropic",
	"moonshotai",
])

function failCliproxyGeneration(
	code: CliproxyFailCode,
	message: string,
	details?: { canonicalId?: string; discoveredId?: string },
): never {
	throw new CliproxyGenerationFailure(code, message, details)
}

function toCliproxyFailRecord(error: unknown): CliproxyFailRecord {
	if (error instanceof CliproxyGenerationFailure) {
		return {
			code: error.code,
			message: error.message,
			...(error.details?.canonicalId ? { canonicalId: error.details.canonicalId } : {}),
			...(error.details?.discoveredId ? { discoveredId: error.details.discoveredId } : {}),
		}
	}

	if (error instanceof Error) {
		return {
			code: "invalid-canonical-metadata",
			message: error.message,
		}
	}

	return {
		code: "invalid-canonical-metadata",
		message: "[cliproxy] unknown generation failure",
	}
}

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

function expectNonNegativeInteger(value: unknown, scope: string): number {
	if (!Number.isInteger(value) || Number(value) < 0) {
		throw new Error(`[cliproxy] ${scope} must be an integer >= 0`)
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
	expectAllowedKeys(
		value,
		["input", "output", "reasoning", "cacheRead", "cacheWrite", "contextOver200k"],
		scope,
	)
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
	if (value.contextOver200k !== undefined) {
		if (!isRecord(value.contextOver200k)) {
			throw new Error(`[cliproxy] ${scope}.contextOver200k must be an object`)
		}
		expectAllowedKeys(
			value.contextOver200k,
			["input", "output", "cacheRead", "cacheWrite"],
			`${scope}.contextOver200k`,
		)
		parsed.contextOver200k = {
			input: expectFiniteNonNegative(value.contextOver200k.input, `${scope}.contextOver200k.input`),
			output: expectFiniteNonNegative(
				value.contextOver200k.output,
				`${scope}.contextOver200k.output`,
			),
			...(value.contextOver200k.cacheRead === undefined
				? {}
				: {
						cacheRead: expectFiniteNonNegative(
							value.contextOver200k.cacheRead,
							`${scope}.contextOver200k.cacheRead`,
						),
					}),
			...(value.contextOver200k.cacheWrite === undefined
				? {}
				: {
						cacheWrite: expectFiniteNonNegative(
							value.contextOver200k.cacheWrite,
							`${scope}.contextOver200k.cacheWrite`,
						),
					}),
		}
	}
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
	const knownCostKeys = new Set(["input", "output", "reasoning", "cache_read", "cache_write"])
	for (const key of Object.keys(value)) {
		if (knownCostKeys.has(key)) continue
		if (/^[a-z]+(?:_[a-z0-9]+)*$/.test(key)) continue
		throw new Error(`[cliproxy] Unsupported key in ${scope}: ${key}`)
	}

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
	const context = expectNonNegativeInteger(value.context, `${scope}.context`)
	const output = expectNonNegativeInteger(value.output, `${scope}.output`)
	const input =
		value.input === undefined ? undefined : expectNonNegativeInteger(value.input, `${scope}.input`)
	if (input !== undefined && input > context) {
		throw new Error(`[cliproxy] ${scope}.input must be <= ${scope}.context`)
	}
	return {
		context,
		output,
		input,
	}
}

function parseOptionalCanonicalStringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined

	const normalized = value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)

	if (normalized.length === 0) return undefined

	return [...new Set(normalized)].sort((left, right) => left.localeCompare(right))
}

function mergeCanonicalStringLists(...lists: Array<string[] | undefined>): string[] | undefined {
	const merged = lists.flatMap((list) => list ?? [])
	if (merged.length === 0) return undefined
	return [...new Set(merged)].sort((left, right) => left.localeCompare(right))
}

function parseOptionalCanonicalModalities(value: unknown):
	| {
			merged?: string[]
			input?: string[]
			output?: string[]
	  }
	| undefined {
	if (Array.isArray(value)) {
		const merged = parseOptionalCanonicalStringList(value)
		if (!merged) {
			return undefined
		}
		return { merged }
	}

	if (!isRecord(value)) {
		return undefined
	}

	const inputModalities = parseOptionalCanonicalStringList(value.input)
	const outputModalities = parseOptionalCanonicalStringList(value.output)
	const merged = mergeCanonicalStringLists(inputModalities, outputModalities)

	if (!inputModalities && !outputModalities && !merged) {
		return undefined
	}

	return {
		...(merged ? { merged } : {}),
		...(inputModalities ? { input: inputModalities } : {}),
		...(outputModalities ? { output: outputModalities } : {}),
	}
}

function parseCanonicalCapabilities(
	value: Record<string, unknown>,
): CanonicalCapabilities | undefined {
	const nestedCapabilities = isRecord(value.capabilities) ? value.capabilities : undefined

	const topLevelModalities = parseOptionalCanonicalModalities(value.modalities)
	const topLevelVariants = parseOptionalCanonicalStringList(value.variants)
	const nestedModalities = nestedCapabilities
		? parseOptionalCanonicalModalities(nestedCapabilities.modalities)
		: undefined
	const nestedVariants = nestedCapabilities
		? parseOptionalCanonicalStringList(nestedCapabilities.variants)
		: undefined

	const modalities = mergeCanonicalStringLists(topLevelModalities?.merged, nestedModalities?.merged)
	const modalitiesInput = mergeCanonicalStringLists(
		topLevelModalities?.input,
		nestedModalities?.input,
	)
	const modalitiesOutput = mergeCanonicalStringLists(
		topLevelModalities?.output,
		nestedModalities?.output,
	)
	const variants = topLevelVariants ?? nestedVariants
	if (!modalities && !modalitiesInput && !modalitiesOutput && !variants) {
		return undefined
	}

	return {
		...(modalities ? { modalities } : {}),
		...(modalitiesInput ? { modalitiesInput } : {}),
		...(modalitiesOutput ? { modalitiesOutput } : {}),
		...(variants ? { variants } : {}),
	}
}

function parseCacheModel(
	providerNamespace: string,
	providerDefaults: { npm?: string; api?: string },
	baseSource: BaseCatalogSource,
	modelKey: string,
	value: unknown,
): ParsedCacheModel {
	const scope = `cache provider ${providerNamespace} model ${modelKey}`
	if (!isRecord(value)) {
		throw new Error(`[cliproxy] ${scope} must be an object`)
	}

	const modelId = expectString(value.id, `${scope}.id`)
	const displayName = expectString(value.name, `${scope}.name`)
	const releaseDate =
		value.release_date === undefined
			? undefined
			: expectString(value.release_date, `${scope}.release_date`)
	const attachment =
		value.attachment === undefined
			? undefined
			: expectBoolean(value.attachment, `${scope}.attachment`)
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

	const capabilities = parseCanonicalCapabilities(value)

	return {
		source: buildSourcePointer(providerNamespace, modelId),
		baseSource,
		api: {
			npm: inheritedNpmRaw,
			id: inheritedApi,
		},
		displayName,
		...(releaseDate ? { releaseDate } : {}),
		...(attachment === undefined ? {} : { attachment }),
		limits,
		reasoning,
		cost,
		...(capabilities ? { capabilities } : {}),
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
				parseCacheModel(
					providerId,
					{ npm: providerNpm, api: providerApi },
					"models.dev",
					modelKey,
					modelValue,
				),
			)
		}
	}

	if (parsedModels.length === 0) {
		throw new Error("[cliproxy] Cache contains zero providers/models")
	}

	return buildParsedCache(parsedModels)
}

function cloneParsedCacheModel(model: ParsedCacheModel): ParsedCacheModel {
	return {
		source: { ...model.source },
		baseSource: model.baseSource,
		api: { ...model.api },
		displayName: model.displayName,
		...(model.releaseDate ? { releaseDate: model.releaseDate } : {}),
		...(model.attachment === undefined ? {} : { attachment: model.attachment }),
		limits: { ...model.limits },
		reasoning: model.reasoning,
		cost: { ...model.cost },
		...(model.capabilities
			? {
					capabilities: {
						...(model.capabilities.modalities
							? { modalities: [...model.capabilities.modalities] }
							: {}),
						...(model.capabilities.modalitiesInput
							? { modalitiesInput: [...model.capabilities.modalitiesInput] }
							: {}),
						...(model.capabilities.modalitiesOutput
							? { modalitiesOutput: [...model.capabilities.modalitiesOutput] }
							: {}),
						...(model.capabilities.variants ? { variants: [...model.capabilities.variants] } : {}),
					},
				}
			: {}),
	}
}

function buildParsedCache(models: ParsedCacheModel[]): ParsedCache {
	const bySource = new Map<string, ParsedCacheModel>()
	const providerNamespaces = new Set<string>()
	const normalizedModels: ParsedCacheModel[] = []

	for (const model of models) {
		if (bySource.has(model.source.key)) {
			throw new Error(`[cliproxy] duplicate cache source key: ${model.source.key}`)
		}

		const normalized = cloneParsedCacheModel(model)
		normalizedModels.push(normalized)
		bySource.set(normalized.source.key, normalized)
		providerNamespaces.add(normalized.source.providerNamespace)
	}

	normalizedModels.sort((left, right) => left.source.key.localeCompare(right.source.key))

	return {
		models: normalizedModels,
		bySource,
		providerNamespaces,
	}
}

function parseBaseCatalogModelV1(
	value: unknown,
	scope: string,
	baseSource: BaseCatalogSource,
): ParsedCacheModel {
	if (!isRecord(value)) {
		throw new Error(`[cliproxy] ${scope} must be an object`)
	}

	expectAllowedKeys(
		value,
		[
			"source",
			"api",
			"displayName",
			"family",
			"releaseDate",
			"lastUpdated",
			"knowledgeCutoff",
			"status",
			"attachment",
			"temperature",
			"toolCall",
			"structuredOutput",
			"openWeights",
			"interleaved",
			"options",
			"headers",
			"limits",
			"reasoning",
			"cost",
			"capabilities",
		],
		scope,
	)

	const source = parseCanonicalSourceString(expectString(value.source, `${scope}.source`), scope)

	if (!isRecord(value.api)) {
		throw new Error(`[cliproxy] ${scope}.api must be an object`)
	}
	expectAllowedKeys(value.api, ["npm", "id"], `${scope}.api`)
	const npm = expectString(value.api.npm, `${scope}.api.npm`).trim()
	if (npm.length === 0) {
		throw new Error(`[cliproxy] ${scope}.api.npm must be a non-empty string`)
	}
	const apiId =
		value.api.id === undefined ? undefined : expectString(value.api.id, `${scope}.api.id`).trim()

	const displayName = expectString(value.displayName, `${scope}.displayName`)
	const releaseDate =
		value.releaseDate === undefined
			? undefined
			: expectString(value.releaseDate, `${scope}.releaseDate`)
	const attachment =
		value.attachment === undefined
			? undefined
			: expectBoolean(value.attachment, `${scope}.attachment`)
	const reasoning = expectBoolean(value.reasoning, `${scope}.reasoning`)
	const limits = parseCacheLimits(value.limits, `${scope}.limits`)
	const cost = normalizeCost(
		value.cost === undefined ? undefined : parseCostOverride(value.cost, `${scope}.cost`),
	)
	const capabilities = parseCanonicalCapabilities(value)

	return {
		source,
		baseSource,
		api: {
			npm,
			...(apiId ? { id: apiId } : {}),
		},
		displayName,
		...(releaseDate ? { releaseDate } : {}),
		...(attachment === undefined ? {} : { attachment }),
		limits,
		reasoning,
		cost,
		...(capabilities ? { capabilities } : {}),
	}
}

export function parseBaseCatalogText(
	text: string,
	catalogPath: string,
	options: {
		baseSource?: BaseCatalogSource
	} = {},
): ParsedCache {
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch {
		throw new Error(`[cliproxy] Malformed base catalog JSON: ${catalogPath}`)
	}

	if (!isRecord(raw)) {
		throw new Error(`[cliproxy] Base catalog root must be a JSON object: ${catalogPath}`)
	}

	const rootCandidate = isRecord(raw.baseCatalog) ? raw.baseCatalog : raw
	const marker = rootCandidate.$cliproxyBaseCatalogContractVersion
	if (marker !== CLIPROXY_BASE_CATALOG_CONTRACT_VERSION) {
		throw new Error("[cliproxy] Unsupported $cliproxyBaseCatalogContractVersion marker")
	}

	if (!Array.isArray(rootCandidate.models)) {
		throw new Error(`[cliproxy] Base catalog models must be an array: ${catalogPath}`)
	}

	const baseSource = options.baseSource ?? "opencode"

	const parsedModels = rootCandidate.models.map((entry, index) =>
		parseBaseCatalogModelV1(entry, `base catalog models[${index}]`, baseSource),
	)

	return buildParsedCache(parsedModels)
}

function buildSupplementalBaseCatalog(): ParsedCache {
	const parsedModels = SUPPLEMENTAL_BASE_CATALOG_MODELS.map((entry, index) =>
		parseBaseCatalogModelV1(entry, `supplemental base models[${index}]`, "supplemental"),
	)
	return buildParsedCache(parsedModels)
}

export function mergeBaseCatalogSources(input: {
	opencodeBase?: ParsedCache
	modelsDevBase: ParsedCache
	supplementalBase?: ParsedCache
}): ParsedCache {
	const mergedBySource = new Map<string, ParsedCacheModel>()

	const applyLayer = (models: ParsedCacheModel[]) => {
		for (const model of models) {
			mergedBySource.set(model.source.key, cloneParsedCacheModel(model))
		}
	}

	applyLayer(input.supplementalBase?.models ?? [])
	applyLayer(input.modelsDevBase.models)
	applyLayer(input.opencodeBase?.models ?? [])

	return buildParsedCache([...mergedBySource.values()])
}

function deriveCanonicalModelId(source: SourcePointer): string {
	if (UNQUALIFIED_CANONICAL_MODEL_ID_PROVIDERS.has(source.providerNamespace)) {
		return source.modelId
	}
	return source.key
}

function buildCanonicalCatalog(cache: ParsedCache): CanonicalCatalog {
	const models: CanonicalCatalogModel[] = []

	for (const cacheModel of cache.models) {
		if (cacheModel.api.npm.trim().length === 0) {
			failCliproxyGeneration(
				"missing-required-provider-fields",
				`[cliproxy] missing required provider field api.npm for ${cacheModel.source.key}`,
				{ canonicalId: cacheModel.source.key },
			)
		}

		models.push({
			canonicalId: deriveCanonicalModelId(cacheModel.source),
			source: cacheModel.source,
			baseSource: cacheModel.baseSource,
			api: { ...cacheModel.api },
			displayName: cacheModel.displayName,
			...(cacheModel.releaseDate ? { releaseDate: cacheModel.releaseDate } : {}),
			...(cacheModel.attachment === undefined ? {} : { attachment: cacheModel.attachment }),
			limits: { ...cacheModel.limits },
			reasoning: cacheModel.reasoning,
			cost: { ...cacheModel.cost },
			...(cacheModel.capabilities
				? {
						capabilities: {
							...(cacheModel.capabilities.modalities
								? { modalities: [...cacheModel.capabilities.modalities] }
								: {}),
							...(cacheModel.capabilities.modalitiesInput
								? { modalitiesInput: [...cacheModel.capabilities.modalitiesInput] }
								: {}),
							...(cacheModel.capabilities.modalitiesOutput
								? { modalitiesOutput: [...cacheModel.capabilities.modalitiesOutput] }
								: {}),
							...(cacheModel.capabilities.variants
								? { variants: [...cacheModel.capabilities.variants] }
								: {}),
						},
					}
				: {}),
		})
	}

	for (const [providerNamespace, providerPreset] of Object.entries(CUSTOM_PROVIDER_TABLE)) {
		for (const [modelId, customModel] of Object.entries(providerPreset.models)) {
			const source = buildSourcePointer(providerNamespace, modelId)
			if (cache.bySource.has(source.key)) {
				continue
			}
			models.push({
				canonicalId: deriveCanonicalModelId(source),
				source,
				baseSource: "supplemental",
				api: {
					npm: providerPreset.api.npm,
					id: customModel.apiId ?? providerPreset.api.id,
				},
				displayName: customModel.displayName,
				limits: { ...customModel.limits },
				reasoning: customModel.reasoning,
				cost: normalizeCost(customModel.cost),
				customProvider: providerPreset,
			})
		}
	}

	const byCanonicalId = new Map<string, CanonicalCatalogModel>()
	const bySourceKey = new Map<string, CanonicalCatalogModel>()

	for (const model of models) {
		if (model.canonicalId.length === 0) {
			failCliproxyGeneration(
				"invalid-canonical-metadata",
				`[cliproxy] canonical model id cannot be empty for ${model.source.key}`,
				{ canonicalId: model.source.key },
			)
		}

		const existingCanonical = byCanonicalId.get(model.canonicalId)
		if (existingCanonical && existingCanonical.source.key !== model.source.key) {
			failCliproxyGeneration(
				"duplicate-emitted-id",
				`[cliproxy] duplicate canonical model id emitted: ${model.canonicalId}`,
				{ canonicalId: model.canonicalId },
			)
		}

		if (bySourceKey.has(model.source.key)) {
			failCliproxyGeneration(
				"invalid-canonical-metadata",
				`[cliproxy] duplicate canonical source key in catalog: ${model.source.key}`,
				{ canonicalId: model.source.key },
			)
		}

		byCanonicalId.set(model.canonicalId, model)
		bySourceKey.set(model.source.key, model)
	}

	for (const [aliasId, sourceKey] of Object.entries(DISCOVERY_ALIAS_TABLE)) {
		if (aliasId.trim().length === 0 || sourceKey.trim().length === 0) {
			failCliproxyGeneration(
				"transform-parity-mismatch",
				`[cliproxy] alias table contains empty value: ${aliasId} -> ${sourceKey}`,
			)
		}
		if (!bySourceKey.has(sourceKey)) continue
	}

	models.sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))
	return {
		models,
		byCanonicalId,
		bySourceKey,
	}
}

export function parseCliproxyAvailabilitySnapshotText(
	text: string,
	snapshotPath: string,
): MergedDiscoveryModel[] {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		failCliproxyGeneration(
			"invalid-availability-input",
			`[cliproxy] malformed availability snapshot JSON: ${snapshotPath}`,
		)
	}

	if (!isRecord(parsed)) {
		failCliproxyGeneration(
			"invalid-availability-input",
			`[cliproxy] availability snapshot root must be an object: ${snapshotPath}`,
		)
	}

	const version = parsed.$cliproxyAvailabilityContractVersion
	if (version !== CLIPROXY_AVAILABILITY_CONTRACT_VERSION) {
		failCliproxyGeneration(
			"invalid-availability-input",
			`[cliproxy] unsupported availability snapshot contract version at ${snapshotPath}`,
		)
	}

	if (typeof parsed.sourceUrl !== "string" || parsed.sourceUrl.trim().length === 0) {
		failCliproxyGeneration(
			"invalid-availability-input",
			`[cliproxy] availability snapshot sourceUrl must be a non-empty string: ${snapshotPath}`,
		)
	}

	if (typeof parsed.capturedAt !== "string" || parsed.capturedAt.trim().length === 0) {
		failCliproxyGeneration(
			"invalid-availability-input",
			`[cliproxy] availability snapshot capturedAt must be a non-empty string: ${snapshotPath}`,
		)
	}

	if (!Array.isArray(parsed.models)) {
		failCliproxyGeneration(
			"invalid-availability-input",
			`[cliproxy] availability snapshot models must be an array: ${snapshotPath}`,
		)
	}

	const merged: MergedDiscoveryModel[] = []
	for (const entry of parsed.models) {
		if (!isRecord(entry)) {
			failCliproxyGeneration(
				"invalid-availability-input",
				`[cliproxy] availability snapshot model entry must be an object: ${snapshotPath}`,
			)
		}

		const canonicalId =
			typeof entry.canonicalId === "string" ? normalizeDiscoveredModelId(entry.canonicalId) : ""
		if (canonicalId.length === 0) {
			failCliproxyGeneration(
				"invalid-availability-input",
				`[cliproxy] availability snapshot model canonicalId must be non-empty: ${snapshotPath}`,
			)
		}

		const ownerHint =
			typeof entry.ownerHint === "string" && entry.ownerHint.trim().length > 0
				? entry.ownerHint.trim()
				: undefined

		if (entry.canonicalConflict !== undefined && typeof entry.canonicalConflict !== "boolean") {
			failCliproxyGeneration(
				"invalid-availability-input",
				`[cliproxy] availability snapshot canonicalConflict must be a boolean: ${snapshotPath}`,
			)
		}

		merged.push({
			canonicalId,
			displayName: canonicalId,
			ownerHint,
			canonicalConflict: entry.canonicalConflict === true,
		})
	}

	merged.sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))
	return merged
}

function serializeCliproxyAvailabilitySnapshot(input: {
	url: string
	models: MergedDiscoveryModel[]
}): PersistedAvailabilitySnapshot {
	const models: PersistedAvailabilityModel[] = input.models
		.map((entry) => ({
			canonicalId: entry.canonicalId,
			...(entry.ownerHint ? { ownerHint: entry.ownerHint } : {}),
			...(entry.canonicalConflict ? { canonicalConflict: true } : {}),
		}))
		.sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))

	return {
		$cliproxyAvailabilityContractVersion: CLIPROXY_AVAILABILITY_CONTRACT_VERSION,
		sourceUrl: input.url,
		capturedAt: new Date().toISOString(),
		models,
	}
}

function loadAvailabilitySnapshotFromDisk(
	snapshotPath: string,
): MergedDiscoveryModel[] | undefined {
	if (!existsSync(snapshotPath)) {
		return undefined
	}

	let text: string
	try {
		text = readFileSync(snapshotPath, "utf-8")
	} catch {
		failCliproxyGeneration(
			"invalid-availability-input",
			`[cliproxy] failed to read availability snapshot: ${snapshotPath}`,
		)
	}

	return parseCliproxyAvailabilitySnapshotText(text, snapshotPath)
}

function persistAvailabilitySnapshotToDisk(
	snapshotPath: string,
	input: { url: string; models: MergedDiscoveryModel[] },
) {
	const snapshot = serializeCliproxyAvailabilitySnapshot(input)
	writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, "\t")}\n`, "utf-8")
}

type AvailabilityCandidate = {
	canonicalId: string
	fromAliasTable: boolean
}

function resolveAvailabilityCandidates(
	availabilityModel: MergedDiscoveryModel,
	catalog: CanonicalCatalog,
): AvailabilityCandidate[] {
	const candidatesByCanonicalId = new Map<string, AvailabilityCandidate>()

	const upsertCandidate = (canonicalId: string, options?: { fromAliasTable?: boolean }) => {
		const existing = candidatesByCanonicalId.get(canonicalId)
		if (existing) {
			if (options?.fromAliasTable) {
				existing.fromAliasTable = true
			}
			return
		}

		candidatesByCanonicalId.set(canonicalId, {
			canonicalId,
			fromAliasTable: options?.fromAliasTable === true,
		})
	}

	const direct = catalog.byCanonicalId.get(availabilityModel.canonicalId)
	if (direct) {
		upsertCandidate(direct.canonicalId)
		return [...candidatesByCanonicalId.values()]
	}

	const aliasTarget = DISCOVERY_ALIAS_TABLE[availabilityModel.canonicalId]
	if (aliasTarget) {
		const aliasModel = catalog.bySourceKey.get(aliasTarget)
		if (aliasModel) {
			upsertCandidate(aliasModel.canonicalId, { fromAliasTable: true })
		}
	}

	const providerQualifiedSource = parseCanonicalSourceCandidate(availabilityModel.canonicalId)
	if (providerQualifiedSource) {
		const sourceModel = catalog.bySourceKey.get(providerQualifiedSource.key)
		if (sourceModel) {
			upsertCandidate(sourceModel.canonicalId)
		}
	}

	const ownerHintSource = inferOwnerHintSource(
		availabilityModel.canonicalId,
		availabilityModel.ownerHint,
	)
	if (ownerHintSource) {
		const ownerHintModel = catalog.bySourceKey.get(ownerHintSource.key)
		if (ownerHintModel) {
			upsertCandidate(ownerHintModel.canonicalId)
		}
	}

	const familyInferenceSource = inferDefaultFamilySource(availabilityModel.canonicalId)
	if (familyInferenceSource) {
		const inferredModel = catalog.bySourceKey.get(familyInferenceSource.key)
		if (inferredModel) {
			upsertCandidate(inferredModel.canonicalId)
		}
	}

	return [...candidatesByCanonicalId.values()].sort((left, right) =>
		left.canonicalId.localeCompare(right.canonicalId),
	)
}

function reconcileAvailabilitySelection(input: {
	catalog: CanonicalCatalog
	availabilityModels: MergedDiscoveryModel[]
}): AvailabilitySelection {
	const availableCanonicalIds = new Set<string>()
	const aliasByCanonicalId = new Map<string, string>()
	const directCanonicalHits = new Set<string>()
	const skipped: CliproxySkipRecord[] = []

	for (const availabilityModel of input.availabilityModels) {
		if (availabilityModel.canonicalConflict) {
			failCliproxyGeneration(
				"ambiguous-mapping",
				`[cliproxy] availability mapping is ambiguous for ${availabilityModel.canonicalId}`,
				{ discoveredId: availabilityModel.canonicalId },
			)
		}

		const candidates = resolveAvailabilityCandidates(availabilityModel, input.catalog)
		if (candidates.length === 0) {
			skipped.push({
				code: "exposure-gap",
				modelId: availabilityModel.canonicalId,
				discoveredId: availabilityModel.canonicalId,
				reason: "exposure gap",
			})
			continue
		}

		if (candidates.length > 1) {
			failCliproxyGeneration(
				"ambiguous-mapping",
				`[cliproxy] ambiguous availability mapping for ${availabilityModel.canonicalId}: ${candidates
					.map((candidate) => candidate.canonicalId)
					.join(", ")}`,
				{ discoveredId: availabilityModel.canonicalId },
			)
		}

		const selectedCandidate = candidates[0]
		const selectedCanonicalId = selectedCandidate.canonicalId
		availableCanonicalIds.add(selectedCanonicalId)

		if (selectedCanonicalId === availabilityModel.canonicalId) {
			directCanonicalHits.add(selectedCanonicalId)
			aliasByCanonicalId.delete(selectedCanonicalId)
			continue
		}

		if (directCanonicalHits.has(selectedCanonicalId)) {
			continue
		}

		if (!selectedCandidate.fromAliasTable) {
			continue
		}

		if (!aliasByCanonicalId.has(selectedCanonicalId)) {
			aliasByCanonicalId.set(selectedCanonicalId, availabilityModel.canonicalId)
		}
	}

	return {
		availableCanonicalIds,
		aliasByCanonicalId,
		skipped,
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
			ownerHint:
				typeof entry.owned_by === "string" && entry.owned_by.trim().length > 0
					? entry.owned_by.trim()
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
			ownerHint: undefined,
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
		const ownerHint = v1Sorted.find((item) => item.ownerHint)?.ownerHint

		records.push({
			canonicalId,
			displayName,
			ownerHint,
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
		canonicalId.startsWith("codex") ||
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

function inferOwnerHintSource(
	canonicalId: string,
	ownerHint: string | undefined,
): SourcePointer | undefined {
	if (!ownerHint || canonicalId.includes("/")) {
		return undefined
	}

	const normalizedOwner = ownerHint.trim().toLowerCase()
	const providerNamespace = OWNER_PROVIDER_NAMESPACE_ALIASES[normalizedOwner]
	if (!providerNamespace) {
		return undefined
	}

	return buildSourcePointer(providerNamespace, canonicalId)
}

function dedupeSourceCandidates(candidates: SourcePointer[]): SourcePointer[] {
	const uniqueByKey = new Map<string, SourcePointer>()
	for (const candidate of candidates) {
		if (uniqueByKey.has(candidate.key)) continue
		uniqueByKey.set(candidate.key, candidate)
	}
	return [...uniqueByKey.values()]
}

type SourceCandidate = {
	candidates: SourcePointer[]
	fromUserSource: boolean
}

function resolveSourceCandidate(
	discoveryModel: MergedDiscoveryModel,
	modelOverride: ModelOverride | undefined,
): SourceCandidate | undefined {
	if (modelOverride?.source) {
		return {
			candidates: [modelOverride.source],
			fromUserSource: true,
		}
	}

	if (discoveryModel.canonicalId.includes("/")) {
		const providerQualifiedCandidate = parseCanonicalSourceCandidate(discoveryModel.canonicalId)
		if (providerQualifiedCandidate) {
			return {
				candidates: [providerQualifiedCandidate],
				fromUserSource: false,
			}
		}
	}

	const candidates: SourcePointer[] = []

	const aliasTarget = DISCOVERY_ALIAS_TABLE[discoveryModel.canonicalId]
	if (aliasTarget !== undefined) {
		candidates.push(parseCanonicalSourceString(aliasTarget, `alias.${discoveryModel.canonicalId}`))
	}

	const ownerHintSource = inferOwnerHintSource(discoveryModel.canonicalId, discoveryModel.ownerHint)
	if (ownerHintSource) {
		candidates.push(ownerHintSource)
	}

	const inferred = inferDefaultFamilySource(discoveryModel.canonicalId)
	if (inferred) {
		candidates.push(inferred)
	}

	if (candidates.length > 0) {
		return {
			candidates: dedupeSourceCandidates(candidates),
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
		...(input?.contextOver200k
			? {
					contextOver200k: {
						input: input.contextOver200k.input,
						output: input.contextOver200k.output,
						...(input.contextOver200k.cacheRead === undefined
							? {}
							: { cacheRead: input.contextOver200k.cacheRead }),
						...(input.contextOver200k.cacheWrite === undefined
							? {}
							: { cacheWrite: input.contextOver200k.cacheWrite }),
					},
				}
			: {}),
	}
}

function resolveCustomProviderOverlay(providerNamespace: string): CustomProviderPreset | undefined {
	return CUSTOM_PROVIDER_TABLE[providerNamespace]
}

function resolveSourceTarget(
	cache: ParsedCache,
	candidate: SourcePointer,
): ResolvedSourceTarget | MissingSourceTarget {
	const selectedFromCache = cache.bySource.get(candidate.key)
	if (selectedFromCache) {
		const customProvider = resolveCustomProviderOverlay(candidate.providerNamespace)
		if (customProvider) {
			return {
				selected: selectedFromCache,
				customProvider,
			}
		}
		return { selected: selectedFromCache }
	}

	if (!cache.providerNamespaces.has(candidate.providerNamespace)) {
		const customProvider = resolveCustomProviderOverlay(candidate.providerNamespace)
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
				baseSource: "supplemental",
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

function buildResolvedSourceTargetFromCanonical(
	canonicalModel: CanonicalCatalogModel,
): ResolvedSourceTarget {
	const selected: ParsedCacheModel = {
		source: { ...canonicalModel.source },
		baseSource: canonicalModel.baseSource,
		api: { ...canonicalModel.api },
		displayName: canonicalModel.displayName,
		...(canonicalModel.releaseDate ? { releaseDate: canonicalModel.releaseDate } : {}),
		...(canonicalModel.attachment === undefined ? {} : { attachment: canonicalModel.attachment }),
		limits: { ...canonicalModel.limits },
		reasoning: canonicalModel.reasoning,
		cost: { ...canonicalModel.cost },
		...(canonicalModel.capabilities
			? {
					capabilities: {
						...(canonicalModel.capabilities.modalities
							? { modalities: [...canonicalModel.capabilities.modalities] }
							: {}),
						...(canonicalModel.capabilities.modalitiesInput
							? { modalitiesInput: [...canonicalModel.capabilities.modalitiesInput] }
							: {}),
						...(canonicalModel.capabilities.modalitiesOutput
							? { modalitiesOutput: [...canonicalModel.capabilities.modalitiesOutput] }
							: {}),
						...(canonicalModel.capabilities.variants
							? { variants: [...canonicalModel.capabilities.variants] }
							: {}),
					},
				}
			: {}),
	}

	const customProvider =
		canonicalModel.customProvider ??
		resolveCustomProviderOverlay(canonicalModel.source.providerNamespace)

	return {
		selected,
		...(customProvider ? { customProvider } : {}),
	}
}

export function resolveCliproxyArtifact(input: {
	cache: ParsedCache
	config: ParsedCliproxyConfig
	discovered: MergedDiscoveryModel[]
	catalogModelByCanonicalId?: Map<string, CanonicalCatalogModel>
}): ResolutionResult {
	const records: ResolvedArtifactModel[] = []
	const skipped: CliproxySkipRecord[] = []
	const emittedModelIds = new Set<string>()

	for (const discoveredModel of input.discovered) {
		if (discoveredModel.canonicalConflict) {
			skipped.push({
				modelId: discoveredModel.canonicalId,
				reason: "canonical conflict",
			})
			continue
		}

		const modelOverride = input.config.models[discoveredModel.canonicalId]
		let sourceCandidate: SourceCandidate | undefined
		let sourceTarget: ResolvedSourceTarget | MissingSourceTarget | undefined

		if (!modelOverride?.source) {
			const canonicalModel = input.catalogModelByCanonicalId?.get(discoveredModel.canonicalId)
			if (canonicalModel) {
				sourceTarget = buildResolvedSourceTargetFromCanonical(canonicalModel)
			}
		}

		if (!sourceTarget) {
			sourceCandidate = modelOverride?.source
				? resolveSourceCandidate(discoveredModel, modelOverride)
				: resolveSourceCandidate(discoveredModel, modelOverride)

			if (!sourceCandidate) {
				skipped.push({
					modelId: discoveredModel.canonicalId,
					reason: "unresolved source",
				})
				continue
			}

			let missingReasonFromFirstCandidate: MissingSourceTarget["missingReason"] | undefined
			for (let index = 0; index < sourceCandidate.candidates.length; index += 1) {
				const nextCandidate = sourceCandidate.candidates[index]
				const nextResolution = resolveSourceTarget(input.cache, nextCandidate)
				if (!("missingReason" in nextResolution)) {
					sourceTarget = nextResolution
					break
				}
				if (index === 0) {
					missingReasonFromFirstCandidate = nextResolution.missingReason
				}
			}

			if (!sourceTarget) {
				sourceTarget = { missingReason: missingReasonFromFirstCandidate ?? "missing-target" }
			}
		}

		if ("missingReason" in sourceTarget) {
			if (sourceCandidate?.fromUserSource) {
				if (sourceTarget.missingReason === "unknown-provider") {
					throw new Error(
						`[cliproxy] source target for <${discoveredModel.canonicalId}> references unsupported provider namespace: ${sourceCandidate.candidates[0]?.providerNamespace ?? "unknown"}`,
					)
				}
				throw new Error(
					`[cliproxy] source target for <${discoveredModel.canonicalId}> does not exist: ${sourceCandidate.candidates[0]?.key ?? "unknown"}`,
				)
			}
			skipped.push({
				modelId: discoveredModel.canonicalId,
				reason: "auto-derived candidate miss",
			})
			continue
		}

		const selected = sourceTarget.selected
		if (selected.api.npm.trim().length === 0) {
			failCliproxyGeneration(
				"missing-required-provider-fields",
				`[cliproxy] missing required provider field api.npm for <${discoveredModel.canonicalId}>`,
				{ canonicalId: discoveredModel.canonicalId },
			)
		}

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
			baseSource: selected.baseSource,
			output: {
				providerBucketId: `cliproxy-${effectiveHost}`,
				modelId: discoveredModel.canonicalId,
				...(discoveredModel.resolvedFromAliasId
					? { resolvedFromAliasId: discoveredModel.resolvedFromAliasId }
					: {}),
			},
			api: {
				npm: selected.api.npm,
				id: selected.api.id,
			},
			displayName: discoveredModel.displayName,
			...(selected.releaseDate ? { releaseDate: selected.releaseDate } : {}),
			...(selected.attachment === undefined ? {} : { attachment: selected.attachment }),
			limits: { ...selected.limits },
			reasoning: selected.reasoning,
			cost: { ...selected.cost },
			chat: {
				headers: { ...preset.requiredHeaders },
				params: { ...preset.requiredParams },
			},
			...(selected.capabilities ? { capabilities: { ...selected.capabilities } } : {}),
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
			failCliproxyGeneration(
				"invalid-canonical-metadata",
				`[cliproxy] safetyCaps exceed limits for <${discoveredModel.canonicalId}>`,
				{ canonicalId: discoveredModel.canonicalId },
			)
		}

		const emittedKey = `${withModelOverride.output.providerBucketId}/${withModelOverride.output.modelId}`
		if (emittedModelIds.has(emittedKey)) {
			failCliproxyGeneration(
				"duplicate-emitted-id",
				`[cliproxy] duplicate emitted model id: ${emittedKey}`,
				{ canonicalId: discoveredModel.canonicalId },
			)
		}
		emittedModelIds.add(emittedKey)

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
		skipped,
	}
}

export function formatCliproxySkipWarning(skip: CliproxySkipRecord): string {
	return `[cliproxy] skipped <${skip.modelId}>: ${skip.reason}`
}

export function summarizeCliproxySkipWarnings(skipped: CliproxySkipRecord[]): string {
	const reasonCounts = new Map<string, number>()
	for (const skipRecord of skipped) {
		reasonCounts.set(skipRecord.reason, (reasonCounts.get(skipRecord.reason) ?? 0) + 1)
	}

	const reasonSummary = [...reasonCounts.entries()]
		.sort((left, right) => {
			const countSort = right[1] - left[1]
			if (countSort !== 0) return countSort
			return left[0].localeCompare(right[0])
		})
		.map(([reason, count]) => `${reason}: ${count}`)
		.join(", ")

	const modelWord = skipped.length === 1 ? "model" : "models"
	return `[cliproxy] skipped ${skipped.length} discovered ${modelWord} (${reasonSummary}). Set ${CLIPROXY_VERBOSE_ENV_VAR}=1 for per-model diagnostics.`
}

export function emitCliproxySkipWarnings(
	skipped: CliproxySkipRecord[],
	options: {
		env?: Record<string, string | undefined>
		warn?: (message: string) => void
	} = {},
) {
	if (skipped.length === 0) return

	const env = options.env ?? process.env
	const warn = options.warn ?? ((message: string) => console.warn(message))
	if (env[CLIPROXY_VERBOSE_ENV_VAR] === "1") {
		for (const skipRecord of skipped) {
			warn(formatCliproxySkipWarning(skipRecord))
		}
		return
	}

	if (skipped.length === 1) {
		warn(formatCliproxySkipWarning(skipped[0]))
		return
	}

	warn(summarizeCliproxySkipWarnings(skipped))
}

function deriveRuntimeModalities(
	capabilities: CanonicalCapabilities | undefined,
): { input: string[]; output: string[] } | undefined {
	if (!capabilities) {
		return undefined
	}

	const mergedModalities = capabilities.modalities
	const inputModalities =
		capabilities.modalitiesInput ?? mergedModalities ?? capabilities.modalitiesOutput
	const outputModalities =
		capabilities.modalitiesOutput ??
		(mergedModalities
			? mergedModalities.includes("text")
				? ["text"]
				: mergedModalities
			: capabilities.modalitiesInput)

	if (!inputModalities || !outputModalities) {
		return undefined
	}

	return {
		input: [...inputModalities],
		output: [...outputModalities],
	}
}

export function buildCliproxyProviderPatch(input: {
	config: ParsedCliproxyConfig
	records: ResolvedArtifactModel[]
}): Record<string, Record<string, unknown>> {
	const patch: Record<string, Record<string, unknown>> = {}
	const duplicateDisplayNamesByProvider = new Map<string, Set<string>>()
	const displayNameCountsByProvider = new Map<string, Map<string, number>>()

	for (const record of input.records) {
		const providerId = record.output.providerBucketId
		const providerCounts = displayNameCountsByProvider.get(providerId) ?? new Map<string, number>()
		providerCounts.set(record.displayName, (providerCounts.get(record.displayName) ?? 0) + 1)
		displayNameCountsByProvider.set(providerId, providerCounts)
	}

	for (const [providerId, nameCounts] of displayNameCountsByProvider.entries()) {
		const duplicateNames = new Set<string>()
		for (const [displayName, count] of nameCounts.entries()) {
			if (count <= 1) continue
			duplicateNames.add(displayName)
		}
		duplicateDisplayNamesByProvider.set(providerId, duplicateNames)
	}

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
		const duplicateNames = duplicateDisplayNamesByProvider.get(providerId)
		const modelName = duplicateNames?.has(record.displayName)
			? `${record.displayName} [${record.output.modelId}]`
			: record.displayName
		const runtimeModalities = deriveRuntimeModalities(record.capabilities)

		const modelPayload: Record<string, unknown> = {
			id: record.source.modelId,
			name: modelName,
			...(record.releaseDate ? { release_date: record.releaseDate } : {}),
			...(record.attachment === undefined ? {} : { attachment: record.attachment }),
			...(runtimeModalities ? { modalities: runtimeModalities } : {}),
			metadata: {
				canonicalId: record.output.modelId,
				baseCatalogSource: record.baseSource,
				sourceProvider: record.source.providerNamespace,
				sourceModelId: record.source.modelId,
				...(record.capabilities?.modalities
					? { modalities: [...record.capabilities.modalities] }
					: {}),
				...(record.capabilities?.variants ? { variants: [...record.capabilities.variants] } : {}),
				...(record.output.resolvedFromAliasId
					? { resolvedFromAliasId: record.output.resolvedFromAliasId }
					: {}),
			},
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

export function resolveOptionalOpencodeBaseCatalogPath(input: {
	modelsPath: string
	env: Record<string, string | undefined>
	pathExists?: (path: string) => boolean
}): { path?: string; isExplicit: boolean } {
	const explicitPath = input.env[OPENCODE_BASE_CATALOG_ENV_VAR]?.trim()
	if (explicitPath && explicitPath.length > 0) {
		return {
			path: explicitPath,
			isExplicit: true,
		}
	}

	const sidecarPath = `${dirname(input.modelsPath)}/${OPENCODE_BASE_CATALOG_DEFAULT_FILENAME}`
	if ((input.pathExists ?? existsSync)(sidecarPath)) {
		return {
			path: sidecarPath,
			isExplicit: false,
		}
	}

	return { isExplicit: false }
}

function loadOptionalOpencodeBaseCatalog(input: {
	path: string | undefined
	isExplicitPath: boolean
}): ParsedCache | undefined {
	const path = input.path
	if (!path) {
		return undefined
	}

	if (!existsSync(path)) {
		if (input.isExplicitPath) {
			throw new Error(`[cliproxy] opencode base catalog file not found: ${path}`)
		}
		return undefined
	}

	let text: string
	try {
		text = readFileSync(path, "utf-8")
	} catch {
		throw new Error(`[cliproxy] Failed to read opencode base catalog file: ${path}`)
	}

	return parseBaseCatalogText(text, path)
}

function resolveCachePaths(): ResolvedCachePaths {
	let modelsPath: string | undefined

	if (process.env.OPENCODE_MODELS_PATH) {
		modelsPath = process.env.OPENCODE_MODELS_PATH
	}

	if (!modelsPath) {
		const home = os.homedir()
		const candidates = [
			`${process.env.XDG_CACHE_HOME || `${home}/.cache`}/opencode/models.json`,
			`${home}/Library/Caches/opencode/models.json`,
		]

		for (const candidate of candidates) {
			if (!existsSync(candidate)) continue
			modelsPath = candidate
			break
		}
	}

	if (!modelsPath) {
		throw new Error("[cliproxy] models.dev cache file not found")
	}

	const resolvedOpencodeBaseCatalog = resolveOptionalOpencodeBaseCatalogPath({
		modelsPath,
		env: process.env,
	})

	return {
		modelsPath,
		availabilitySnapshotPath: `${dirname(modelsPath)}/cliproxy-availability.json`,
		opencodeBaseCatalogPathIsExplicit: resolvedOpencodeBaseCatalog.isExplicit,
		...(resolvedOpencodeBaseCatalog.path
			? { opencodeBaseCatalogPath: resolvedOpencodeBaseCatalog.path }
			: {}),
	}
}

function loadCacheFromDisk(): { cache: ParsedCache; paths: ResolvedCachePaths } {
	const paths = resolveCachePaths()
	let modelsDevText: string
	try {
		modelsDevText = readFileSync(paths.modelsPath, "utf-8")
	} catch {
		throw new Error(`[cliproxy] Failed to read cache file: ${paths.modelsPath}`)
	}

	const modelsDevBase = parseCliproxyCacheText(modelsDevText, paths.modelsPath)
	const opencodeBase = loadOptionalOpencodeBaseCatalog({
		path: paths.opencodeBaseCatalogPath,
		isExplicitPath: paths.opencodeBaseCatalogPathIsExplicit,
	})
	const supplementalBase = buildSupplementalBaseCatalog()

	return {
		cache: mergeBaseCatalogSources({
			opencodeBase,
			modelsDevBase,
			supplementalBase,
		}),
		paths,
	}
}

export async function resolveCliproxyAvailabilityWithFallback(input: {
	config: ParsedCliproxyConfig
	snapshotPath: string
	discover?: (url: string, apiKey: string) => Promise<MergedDiscoveryModel[]>
	readSnapshot?: (snapshotPath: string) => MergedDiscoveryModel[] | undefined
}): Promise<{ source: "live" | "snapshot"; models: MergedDiscoveryModel[] }> {
	const discover = input.discover ?? discoverMergedModels
	const readSnapshot = input.readSnapshot ?? loadAvailabilitySnapshotFromDisk

	let liveFailureMessage: string | undefined
	try {
		const liveModels = await discover(input.config.url, input.config.apiKey)
		return {
			source: "live",
			models: liveModels,
		}
	} catch (error) {
		liveFailureMessage = error instanceof Error ? error.message : "unknown discovery failure"
	}

	const snapshotModels = readSnapshot(input.snapshotPath)
	if (snapshotModels) {
		return {
			source: "snapshot",
			models: snapshotModels,
		}
	}

	failCliproxyGeneration(
		"availability-fallback-missing",
		`[cliproxy] live availability incomplete and fallback snapshot missing: ${input.snapshotPath} (${liveFailureMessage ?? "unknown"})`,
	)
}

export async function buildCliproxyGenerationArtifactWithAvailability(input: {
	cache: ParsedCache
	config: ParsedCliproxyConfig
	snapshotPath: string
	discover?: (url: string, apiKey: string) => Promise<MergedDiscoveryModel[]>
	readSnapshot?: (snapshotPath: string) => MergedDiscoveryModel[] | undefined
	persistSnapshot?: (
		snapshotPath: string,
		payload: { url: string; models: MergedDiscoveryModel[] },
	) => void
}): Promise<GenerationArtifact> {
	const availability = await resolveCliproxyAvailabilityWithFallback({
		config: input.config,
		snapshotPath: input.snapshotPath,
		discover: input.discover,
		readSnapshot: input.readSnapshot,
	})

	const artifact = buildCliproxyGenerationArtifact({
		cache: input.cache,
		config: input.config,
		availabilityModels: availability.models,
		availabilitySource: availability.source,
	})

	if (availability.source !== "live" || artifact.failed.length > 0) {
		return artifact
	}

	const persistSnapshot = input.persistSnapshot ?? persistAvailabilitySnapshotToDisk
	try {
		persistSnapshot(input.snapshotPath, {
			url: input.config.url,
			models: availability.models,
		})
		return artifact
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown snapshot persistence failure"
		return {
			...artifact,
			snapshotPersistenceFailure: `[cliproxy] live availability snapshot persistence failed: ${message}`,
		}
	}
}

export function buildCliproxyGenerationArtifact(input: {
	cache: ParsedCache
	config: ParsedCliproxyConfig
	availabilityModels: MergedDiscoveryModel[]
	availabilitySource: "live" | "snapshot"
}): GenerationArtifact {
	try {
		const canonicalCatalog = buildCanonicalCatalog(input.cache)
		const availabilitySelection = reconcileAvailabilitySelection({
			catalog: canonicalCatalog,
			availabilityModels: input.availabilityModels,
		})

		const catalogModelByCanonicalId = new Map<string, CanonicalCatalogModel>()
		const discoveredForResolution: MergedDiscoveryModel[] = []
		const skipped: CliproxySkipRecord[] = [...availabilitySelection.skipped]

		for (const canonicalModel of canonicalCatalog.models) {
			if (!availabilitySelection.availableCanonicalIds.has(canonicalModel.canonicalId)) {
				skipped.push({
					code: "availability-gap",
					modelId: canonicalModel.canonicalId,
					canonicalId: canonicalModel.canonicalId,
					reason: "availability gap",
				})
				continue
			}

			catalogModelByCanonicalId.set(canonicalModel.canonicalId, canonicalModel)
			discoveredForResolution.push({
				canonicalId: canonicalModel.canonicalId,
				displayName: canonicalModel.displayName,
				canonicalConflict: false,
				...(availabilitySelection.aliasByCanonicalId.has(canonicalModel.canonicalId)
					? {
							resolvedFromAliasId: availabilitySelection.aliasByCanonicalId.get(
								canonicalModel.canonicalId,
							),
						}
					: {}),
			})
		}

		const resolved = resolveCliproxyArtifact({
			cache: input.cache,
			config: input.config,
			discovered: discoveredForResolution,
			catalogModelByCanonicalId,
		})

		const providerPatch = buildCliproxyProviderPatch({
			config: input.config,
			records: resolved.records,
		})

		return {
			providerPatch,
			skipped: [...skipped, ...resolved.skipped],
			failed: [],
			availabilitySource: input.availabilitySource,
		}
	} catch (error) {
		return {
			providerPatch: {},
			skipped: [],
			failed: [toCliproxyFailRecord(error)],
			availabilitySource: input.availabilitySource,
		}
	}
}

export const CliproxyPlugin: Plugin = async () => {
	const parsedConfig = await loadConfigFromDisk()
	if (!parsedConfig) {
		return {}
	}

	const loadedCache = loadCacheFromDisk()
	const artifact = await buildCliproxyGenerationArtifactWithAvailability({
		cache: loadedCache.cache,
		config: parsedConfig,
		snapshotPath: loadedCache.paths.availabilitySnapshotPath,
	})

	if (artifact.failed.length > 0) {
		throw new Error(artifact.failed[0].message)
	}

	if (artifact.snapshotPersistenceFailure) {
		console.warn(artifact.snapshotPersistenceFailure)
	}

	emitCliproxySkipWarnings(artifact.skipped)

	const hooks: Hooks = {
		config: async (cfg) => {
			cfg.provider = cfg.provider || {}
			for (const [providerId, providerValue] of Object.entries(artifact.providerPatch)) {
				cfg.provider[providerId] = providerValue
			}
		},
	}

	return hooks
}

export default CliproxyPlugin
