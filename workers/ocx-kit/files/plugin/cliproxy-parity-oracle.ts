type JsonScalar = string | number | boolean | null

type NativeProviderNamespace =
	| "anthropic"
	| "openai"
	| "google"
	| "google-vertex-anthropic"
	| "github-copilot"
	| "moonshotai"
	| "google-antigravity"

type SourcePointer = {
	providerNamespace: NativeProviderNamespace
	modelId: string
}

type Limits = {
	context: number
	output: number
}

type SafetyCaps = {
	context?: number
	output?: number
}

type Cost = {
	input: number
	output: number
	cacheRead: number
	cacheWrite: number
	reasoning?: number
}

type ProviderExpectation = {
	apiNpm: string
	apiId?: string
	requiredHeaders: Record<string, string>
	requiredParams: Record<string, JsonScalar>
	effectiveHost: string
	defaultSafetyCaps?: SafetyCaps
}

type ModelExpectation = {
	limits: Limits
	reasoning: boolean
	cost?: Partial<Cost>
}

type DiscoveryFixtureModel = {
	id: string
	displayName: string
}

type ParityFixtureCase = {
	name: string
	discovery: DiscoveryFixtureModel[]
	selectedSource: SourcePointer
	outputModelId: string
	outputDisplayName: string
	assertSkipWarningFragment?: string
}

type ParityRecord = {
	source: {
		key: string
		providerNamespace: NativeProviderNamespace
		modelId: string
		effectiveHost: string
	}
	baseSource: "models.dev" | "supplemental"
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

const PROVIDER_EXPECTATIONS: Record<NativeProviderNamespace, ProviderExpectation> = {
	anthropic: {
		apiNpm: "@ai-sdk/anthropic",
		requiredHeaders: {
			"anthropic-beta":
				"claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
		},
		requiredParams: {},
		effectiveHost: "anthropic",
	},
	openai: {
		apiNpm: "@ai-sdk/openai",
		requiredHeaders: {},
		requiredParams: {},
		effectiveHost: "openai",
	},
	google: {
		apiNpm: "@ai-sdk/google",
		requiredHeaders: {},
		requiredParams: {},
		effectiveHost: "google",
	},
	"google-vertex-anthropic": {
		apiNpm: "@ai-sdk/google-vertex/anthropic",
		requiredHeaders: {},
		requiredParams: {},
		effectiveHost: "google-vertex-anthropic",
	},
	"github-copilot": {
		apiNpm: "@ai-sdk/github-copilot",
		apiId: "https://api.githubcopilot.com",
		requiredHeaders: {},
		requiredParams: {},
		effectiveHost: "github-copilot",
	},
	moonshotai: {
		apiNpm: "@ai-sdk/openai-compatible",
		requiredHeaders: {},
		requiredParams: {},
		effectiveHost: "moonshotai",
	},
	"google-antigravity": {
		apiNpm: "@ai-sdk/google",
		requiredHeaders: {},
		requiredParams: {},
		effectiveHost: "google-antigravity",
		defaultSafetyCaps: {
			context: 400000,
			output: 64000,
		},
	},
}

const MODEL_EXPECTATIONS: Record<string, ModelExpectation> = {
	"anthropic::claude-sonnet-4-5": {
		limits: { context: 200000, output: 64000 },
		reasoning: true,
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
	},
	"openai::gpt-5": {
		limits: { context: 400000, output: 128000 },
		reasoning: true,
		cost: { input: 1, output: 2 },
	},
	"google::gemini-2.5-pro": {
		limits: { context: 1000000, output: 64000 },
		reasoning: true,
	},
	"google-vertex-anthropic::vertex-claude": {
		limits: { context: 200000, output: 64000 },
		reasoning: true,
	},
	"github-copilot::gpt-4.1-mini": {
		limits: { context: 128000, output: 16000 },
		reasoning: true,
	},
	"moonshotai::kimi-k2": {
		limits: { context: 200000, output: 32000 },
		reasoning: true,
	},
	"google-antigravity::gemini-2.5-pro": {
		limits: { context: 400000, output: 64000 },
		reasoning: true,
	},
}

export const CLIPROXY_PARITY_FIXTURE_MATRIX: readonly ParityFixtureCase[] = [
	{
		name: "anthropic",
		discovery: [{ id: "claude-sonnet-4-5", displayName: "Anthropic Fixture" }],
		selectedSource: { providerNamespace: "anthropic", modelId: "claude-sonnet-4-5" },
		outputModelId: "claude-sonnet-4-5",
		outputDisplayName: "Anthropic Fixture",
	},
	{
		name: "openai",
		discovery: [{ id: "gpt-5", displayName: "OpenAI Fixture" }],
		selectedSource: { providerNamespace: "openai", modelId: "gpt-5" },
		outputModelId: "gpt-5",
		outputDisplayName: "OpenAI Fixture",
	},
	{
		name: "google",
		discovery: [{ id: "gemini-2.5-pro", displayName: "Google Fixture" }],
		selectedSource: { providerNamespace: "google", modelId: "gemini-2.5-pro" },
		outputModelId: "gemini-2.5-pro",
		outputDisplayName: "Google Fixture",
	},
	{
		name: "google-vertex-anthropic",
		discovery: [{ id: "google-vertex-anthropic/vertex-claude", displayName: "Vertex Fixture" }],
		selectedSource: { providerNamespace: "google-vertex-anthropic", modelId: "vertex-claude" },
		outputModelId: "google-vertex-anthropic/vertex-claude",
		outputDisplayName: "Vertex Fixture",
	},
	{
		name: "github-copilot",
		discovery: [{ id: "github-copilot/gpt-4.1-mini", displayName: "Copilot Fixture" }],
		selectedSource: { providerNamespace: "github-copilot", modelId: "gpt-4.1-mini" },
		outputModelId: "github-copilot/gpt-4.1-mini",
		outputDisplayName: "Copilot Fixture",
	},
	{
		name: "moonshotai",
		discovery: [{ id: "kimi-k2", displayName: "Moonshot Fixture" }],
		selectedSource: { providerNamespace: "moonshotai", modelId: "kimi-k2" },
		outputModelId: "kimi-k2",
		outputDisplayName: "Moonshot Fixture",
	},
	{
		name: "google-antigravity",
		discovery: [{ id: "google-antigravity/gemini-2.5-pro", displayName: "Antigravity Fixture" }],
		selectedSource: { providerNamespace: "google-antigravity", modelId: "gemini-2.5-pro" },
		outputModelId: "google-antigravity/gemini-2.5-pro",
		outputDisplayName: "Antigravity Fixture",
	},
	{
		name: "unresolved-model-skip",
		discovery: [
			{ id: "mistral-large", displayName: "Unresolved" },
			{ id: "gpt-5", displayName: "OpenAI Fixture" },
		],
		selectedSource: { providerNamespace: "openai", modelId: "gpt-5" },
		outputModelId: "gpt-5",
		outputDisplayName: "OpenAI Fixture",
		assertSkipWarningFragment: "<mistral-large>",
	},
] as const

export const CLIPROXY_PLUGIN_FAIL_EXPECTATION = {
	message: "[cliproxy] cliproxy.url must be a non-empty string",
} as const

function sourceKey(pointer: SourcePointer): string {
	return `${pointer.providerNamespace}::${pointer.modelId}`
}

function normalizeCost(input: Partial<Cost> | undefined): Cost {
	return {
		input: input?.input ?? 0,
		output: input?.output ?? 0,
		cacheRead: input?.cacheRead ?? 0,
		cacheWrite: input?.cacheWrite ?? 0,
		...(input?.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
	}
}

function inferBaseSource(pointer: SourcePointer): "models.dev" | "supplemental" {
	if (pointer.providerNamespace === "google-antigravity") {
		return "supplemental"
	}

	return "models.dev"
}

function buildExpectedRecord(fixture: ParityFixtureCase): ParityRecord {
	const provider = PROVIDER_EXPECTATIONS[fixture.selectedSource.providerNamespace]
	const model = MODEL_EXPECTATIONS[sourceKey(fixture.selectedSource)]
	if (!model) {
		throw new Error(
			`[cliproxy] missing parity model expectation: ${sourceKey(fixture.selectedSource)}`,
		)
	}

	return {
		source: {
			key: `${fixture.selectedSource.providerNamespace}/${fixture.selectedSource.modelId}`,
			providerNamespace: fixture.selectedSource.providerNamespace,
			modelId: fixture.selectedSource.modelId,
			effectiveHost: provider.effectiveHost,
		},
		baseSource: inferBaseSource(fixture.selectedSource),
		output: {
			providerBucketId: `cliproxy-${provider.effectiveHost}`,
			modelId: fixture.outputModelId,
		},
		api: {
			npm: provider.apiNpm,
			...(provider.apiId ? { id: provider.apiId } : {}),
		},
		displayName: fixture.outputDisplayName,
		limits: model.limits,
		reasoning: model.reasoning,
		cost: normalizeCost(model.cost),
		...(provider.defaultSafetyCaps ? { safetyCaps: provider.defaultSafetyCaps } : {}),
		chat: {
			headers: provider.requiredHeaders,
			params: provider.requiredParams,
		},
	}
}

export function buildCliproxyParityOracle(): Record<string, unknown> {
	const oracle: Record<string, unknown> = {}

	for (const fixture of CLIPROXY_PARITY_FIXTURE_MATRIX) {
		oracle[fixture.name] = [buildExpectedRecord(fixture)]
	}

	oracle["plugin-fail"] = CLIPROXY_PLUGIN_FAIL_EXPECTATION
	return oracle
}
