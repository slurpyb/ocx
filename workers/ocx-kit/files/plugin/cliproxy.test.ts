import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
	buildCliproxyGenerationArtifact,
	buildCliproxyGenerationArtifactWithAvailability,
	buildCliproxyProviderPatch,
	discoverMergedModels,
	emitCliproxySkipWarnings,
	formatCliproxySkipWarning,
	mergeBaseCatalogSources,
	mergeDiscoveryModels,
	normalizeDiscoveredModelId,
	parseBaseCatalogText,
	parseCliproxyAvailabilitySnapshotText,
	parseCliproxyCacheText,
	parseCliproxyConfigObject,
	parseCliproxyConfigText,
	parseV1BetaDiscoveryPayload,
	parseV1DiscoveryPayload,
	resolveCliproxyArtifact,
	resolveCliproxyAvailabilityWithFallback,
	resolveCliproxyConfigSearchPaths,
	resolveOptionalOpencodeBaseCatalogPath,
} from "./cliproxy/core"

import {
	buildCliproxyParityOracle,
	CLIPROXY_PARITY_FIXTURE_MATRIX,
	CLIPROXY_PLUGIN_FAIL_EXPECTATION,
} from "./cliproxy-parity-oracle"

const PARITY_GOLDENS = JSON.parse(
	readFileSync(path.join(import.meta.dir, "cliproxy.parity.goldens.json"), "utf-8"),
) as Record<string, unknown>

function configBase() {
	return parseCliproxyConfigObject(
		{
			url: "http://localhost:8317",
		},
		{
			env: {},
			readCredentialFile: () => "",
		},
	)
}

function cacheFixture() {
	return parseCliproxyCacheText(
		JSON.stringify({
			$cliproxyCacheContractVersion: 1,
			anthropic: {
				id: "anthropic",
				name: "Anthropic",
				npm: "@ai-sdk/anthropic",
				models: {
					"claude-sonnet-4-5": {
						id: "claude-sonnet-4-5",
						name: "Claude Sonnet 4.5",
						reasoning: true,
						limit: { context: 200000, output: 64000 },
						cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 },
					},
				},
			},
			openai: {
				id: "openai",
				name: "OpenAI",
				npm: "@ai-sdk/openai",
				models: {
					"gpt-5": {
						id: "gpt-5",
						name: "GPT-5",
						reasoning: true,
						limit: { context: 400000, output: 128000 },
						cost: { input: 1, output: 2 },
					},
					"codex-mini": {
						id: "codex-mini",
						name: "Codex Mini",
						reasoning: true,
						limit: { context: 200000, output: 100000 },
						cost: { input: 0.5, output: 1 },
					},
				},
			},
			google: {
				id: "google",
				name: "Google",
				npm: "@ai-sdk/google",
				models: {
					"gemini-2.5-pro": {
						id: "gemini-2.5-pro",
						name: "Gemini 2.5 Pro",
						reasoning: true,
						limit: { context: 1000000, output: 64000 },
					},
				},
			},
			"google-vertex-anthropic": {
				id: "google-vertex-anthropic",
				name: "Google Vertex Anthropic",
				npm: "@ai-sdk/google-vertex/anthropic",
				models: {
					"vertex-claude": {
						id: "vertex-claude",
						name: "Vertex Claude",
						reasoning: true,
						limit: { context: 200000, output: 64000 },
					},
				},
			},
			"github-copilot": {
				id: "github-copilot",
				name: "GitHub Copilot",
				npm: "@ai-sdk/github-copilot",
				api: "https://api.githubcopilot.com",
				models: {
					"gpt-4.1-mini": {
						id: "gpt-4.1-mini",
						name: "GPT 4.1 Mini",
						reasoning: true,
						limit: { context: 128000, output: 16000 },
					},
				},
			},
			moonshotai: {
				id: "moonshotai",
				name: "MoonshotAI",
				npm: "@ai-sdk/openai-compatible",
				models: {
					"kimi-k2": {
						id: "kimi-k2",
						name: "Kimi K2",
						reasoning: true,
						limit: { context: 200000, output: 32000 },
					},
				},
			},
		}),
		"fixture-cache.json",
	)
}

async function expectAsyncThrowContains(
	run: () => Promise<unknown>,
	fragment: string,
): Promise<void> {
	try {
		await run()
	} catch (error) {
		expect(error).toBeInstanceOf(Error)
		expect((error as Error).message).toContain(fragment)
		return
	}
	throw new Error(`Expected throw including: ${fragment}`)
}

describe("cliproxy config contract", () => {
	it("rejects legacy top-level prefix key", () => {
		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
					prefix: "cliproxy",
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow("[cliproxy] Unsupported key in cliproxy config: prefix")
	})

	it("rejects unknown top-level keys", () => {
		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
					unknown: true,
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow("Unsupported key")
	})

	it("rejects empty or whitespace-only url", () => {
		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "   ",
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow("[cliproxy] cliproxy.url must be a non-empty string")
	})

	it("resolves env and file apiKey references and fails for missing ones", () => {
		const fromEnv = parseCliproxyConfigObject(
			{
				url: "http://localhost:8317",
				apiKey: "{env:CLIPROXY_API_KEY}",
			},
			{ env: { CLIPROXY_API_KEY: "abc123" }, readCredentialFile: () => "" },
		)
		expect(fromEnv.apiKey).toBe("abc123")

		const fromFile = parseCliproxyConfigObject(
			{
				url: "http://localhost:8317",
				apiKey: "{file:/tmp/token}",
			},
			{ env: {}, readCredentialFile: () => " token-from-file\n" },
		)
		expect(fromFile.apiKey).toBe("token-from-file")

		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
					apiKey: "{env:CLIPROXY_API_KEY}",
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow("Environment variable not set or empty")

		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
					apiKey: "{file:/missing/token}",
				},
				{
					env: {},
					readCredentialFile: () => {
						throw new Error("read failed")
					},
				},
			),
		).toThrow("Failed to read credential file")
	})

	it("parses canonical string source and rejects invalid source forms", () => {
		const parsed = parseCliproxyConfigObject(
			{
				url: "http://localhost:8317",
				models: {
					"gpt-5": {
						source: "openai/gpt-5",
					},
				},
			},
			{ env: {}, readCredentialFile: () => "" },
		)
		expect(parsed.models["gpt-5"].source?.key).toBe("openai/gpt-5")

		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
					models: { "gpt-5": { source: "openai" } },
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow("canonical provider/model form")

		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
					models: { "gpt-5": { source: "openai//gpt-5" } },
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow("canonical provider/model form")

		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
					models: {
						"gpt-5": {
							source: {
								providerNamespace: "openai",
								modelId: "gpt-5",
							},
						},
					},
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow("cliproxy.models.gpt-5.source must be a string")
	})

	it("rejects invalid safety caps and locked-key style unknown fields", () => {
		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
					models: {
						"gpt-5": {
							safetyCaps: {
								context: 0,
							},
						},
					},
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow("must be an integer >= 1")

		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
					models: {
						"gpt-5": {
							output: {
								providerBucketId: "cliproxy-openai",
							},
						},
					},
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow("Unsupported key")
	})

	it("parses JSONC comments and trailing commas", () => {
		const parsed = parseCliproxyConfigText(
			`{
				// comment
				"url": "http://localhost:8317",
				"provider": {
					"openai": {
						"displayName": "OpenAI via cliproxy",
					},
				},
				"models": {
					"gpt-5": {
						"chat": {
							"params": {
								"reasoning_effort": "high",
							},
						},
					},
				},
			}`,
			"cliproxy.jsonc",
			{ env: {}, readCredentialFile: () => "" },
		)

		expect(parsed.provider.openai.displayName).toBe("OpenAI via cliproxy")
		expect(parsed.models["gpt-5"].chat?.params?.reasoning_effort).toBe("high")
	})
})

describe("cliproxy config search path precedence", () => {
	it("prefers project-local config before OPENCODE_CONFIG_DIR when enabled", () => {
		const paths = resolveCliproxyConfigSearchPaths({
			env: {
				OPENCODE_CONFIG_DIR: "/tmp/opencode/profiles/work",
			},
			homedir: "/home/tester",
		})

		expect(paths).toEqual([
			".opencode/cliproxy.jsonc",
			".opencode/cliproxy.json",
			"/tmp/opencode/profiles/work/cliproxy.jsonc",
			"/tmp/opencode/profiles/work/cliproxy.json",
		])
	})

	it("ignores project-local config when OPENCODE_DISABLE_PROJECT_CONFIG is set", () => {
		const paths = resolveCliproxyConfigSearchPaths({
			env: {
				OPENCODE_CONFIG_DIR: "/tmp/opencode/profiles/work",
				OPENCODE_DISABLE_PROJECT_CONFIG: "true",
			},
			homedir: "/home/tester",
		})

		expect(paths).toEqual([
			"/tmp/opencode/profiles/work/cliproxy.jsonc",
			"/tmp/opencode/profiles/work/cliproxy.json",
		])
	})
})

describe("cliproxy opencode base catalog path resolution", () => {
	it("prefers explicit OPENCODE_BASE_CATALOG_PATH over sidecar detection", () => {
		const resolved = resolveOptionalOpencodeBaseCatalogPath({
			modelsPath: "/tmp/opencode/models.json",
			env: {
				OPENCODE_BASE_CATALOG_PATH: " /tmp/custom/base-catalog.json ",
			},
			pathExists: () => true,
		})

		expect(resolved).toEqual({
			path: "/tmp/custom/base-catalog.json",
			isExplicit: true,
		})
	})

	it("falls back to models sibling sidecar when explicit env var is unset", () => {
		const resolved = resolveOptionalOpencodeBaseCatalogPath({
			modelsPath: "/tmp/opencode/models.json",
			env: {},
			pathExists: (filePath: string) => filePath === "/tmp/opencode/opencode-base-catalog.json",
		})

		expect(resolved).toEqual({
			path: "/tmp/opencode/opencode-base-catalog.json",
			isExplicit: false,
		})
	})
})

describe("cliproxy cache contract", () => {
	it("supports marker=1 and validates models", () => {
		const parsed = cacheFixture()
		expect(parsed.models.length).toBeGreaterThan(0)
		expect(parsed.bySource.get("openai/gpt-5")?.source.key).toBe("openai/gpt-5")
	})

	it("rejects unsupported marker", () => {
		expect(() =>
			parseCliproxyCacheText(
				JSON.stringify({ $cliproxyCacheContractVersion: 2, any: {} }),
				"fixture-cache.json",
			),
		).toThrow("Unsupported $cliproxyCacheContractVersion")
	})

	it("accepts no-marker fallback when v1 shape validates", () => {
		const parsed = parseCliproxyCacheText(
			JSON.stringify({
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						"gpt-5": {
							id: "gpt-5",
							name: "GPT-5",
							reasoning: true,
							limit: { context: 400000, output: 128000 },
						},
					},
				},
			}),
			"fixture-cache.json",
		)

		expect(parsed.models).toHaveLength(1)
	})

	it("rejects invalid numeric invariants and malformed optional numeric objects", () => {
		expect(() =>
			parseCliproxyCacheText(
				JSON.stringify({
					openai: {
						id: "openai",
						name: "OpenAI",
						npm: "@ai-sdk/openai",
						models: {
							bad: {
								id: "bad",
								name: "Bad",
								reasoning: false,
								limit: { context: 100, input: 101, output: 10 },
							},
						},
					},
				}),
				"fixture-cache.json",
			),
		).toThrow("input must be <=")

		expect(() =>
			parseCliproxyCacheText(
				JSON.stringify({
					openai: {
						id: "openai",
						name: "OpenAI",
						npm: "@ai-sdk/openai",
						models: {
							bad: {
								id: "bad",
								name: "Bad",
								reasoning: false,
								limit: { context: 100, output: 10 },
								cost: "invalid-cost",
							},
						},
					},
				}),
				"fixture-cache.json",
			),
		).toThrow("must be an object")

		expect(() =>
			parseCliproxyCacheText(
				JSON.stringify({
					openai: {
						id: "openai",
						name: "OpenAI",
						npm: "@ai-sdk/openai",
						models: {
							bad: {
								id: "bad",
								name: "Bad",
								reasoning: false,
								limit: { context: 100, output: 10 },
								cost: {
									cacheRead: 0.1,
								},
							},
						},
					},
				}),
				"fixture-cache.json",
			),
		).toThrow("Unsupported key")
	})

	it("tolerates unrelated top-level metadata keys", () => {
		const parsed = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				generatedAt: "2026-03-10T00:00:00.000Z",
				meta: {
					note: "non-provider metadata",
				},
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						"gpt-5": {
							id: "gpt-5",
							name: "GPT-5",
							reasoning: true,
							limit: { context: 400000, output: 128000 },
						},
					},
				},
			}),
			"fixture-cache.json",
		)
		expect(parsed.models).toHaveLength(1)
	})

	it("parses object-shaped modalities by merging input/output lists", () => {
		const parsed = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						"gpt-5": {
							id: "gpt-5",
							name: "GPT-5",
							reasoning: true,
							limit: { context: 400000, output: 128000 },
							modalities: {
								input: ["text", "audio", "text"],
								output: ["image", "audio"],
							},
						},
					},
				},
			}),
			"object-modalities-cache.json",
		)

		expect(parsed.bySource.get("openai/gpt-5")?.capabilities).toEqual({
			modalities: ["audio", "image", "text"],
			modalitiesInput: ["audio", "text"],
			modalitiesOutput: ["audio", "image"],
		})
	})
})

describe("cliproxy base catalog layering", () => {
	it("merges opencode + models.dev + supplemental sources per entry", () => {
		const modelsDevBase = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						"gpt-5": {
							id: "gpt-5",
							name: "GPT-5 (models.dev)",
							reasoning: true,
							limit: { context: 200000, output: 64000 },
						},
					},
				},
				anthropic: {
					id: "anthropic",
					name: "Anthropic",
					npm: "@ai-sdk/anthropic",
					models: {
						"claude-sonnet-4-5": {
							id: "claude-sonnet-4-5",
							name: "Claude Sonnet 4.5",
							reasoning: true,
							limit: { context: 200000, output: 64000 },
						},
					},
				},
			}),
			"models.dev-cache.json",
		)

		const opencodeBase = parseBaseCatalogText(
			JSON.stringify({
				$cliproxyBaseCatalogContractVersion: 1,
				models: [
					{
						source: "openai/gpt-5",
						api: { npm: "@ai-sdk/openai" },
						displayName: "GPT-5 (opencode)",
						reasoning: true,
						limits: { context: 400000, output: 128000 },
						cost: { input: 1, output: 2 },
					},
				],
			}),
			"opencode-base-catalog.json",
		)

		const supplementalBase = parseBaseCatalogText(
			JSON.stringify({
				$cliproxyBaseCatalogContractVersion: 1,
				models: [
					{
						source: "google-antigravity/gemini-2.5-pro",
						api: { npm: "@ai-sdk/google" },
						displayName: "Gemini 2.5 Pro (supplemental)",
						reasoning: true,
						limits: { context: 200000, output: 64000 },
					},
				],
			}),
			"supplemental-base-catalog.json",
			{ baseSource: "supplemental" },
		)

		const merged = mergeBaseCatalogSources({
			opencodeBase,
			modelsDevBase,
			supplementalBase,
		})

		expect(merged.models.map((model) => model.source.key)).toEqual([
			"anthropic/claude-sonnet-4-5",
			"google-antigravity/gemini-2.5-pro",
			"openai/gpt-5",
		])
		expect(merged.bySource.get("openai/gpt-5")?.displayName).toBe("GPT-5 (opencode)")
		expect(merged.bySource.get("openai/gpt-5")?.baseSource).toBe("opencode")
		expect(merged.bySource.get("anthropic/claude-sonnet-4-5")?.displayName).toBe(
			"Claude Sonnet 4.5",
		)
		expect(merged.bySource.get("anthropic/claude-sonnet-4-5")?.baseSource).toBe("models.dev")
		expect(merged.bySource.get("google-antigravity/gemini-2.5-pro")?.displayName).toBe(
			"Gemini 2.5 Pro (supplemental)",
		)
		expect(merged.bySource.get("google-antigravity/gemini-2.5-pro")?.baseSource).toBe(
			"supplemental",
		)
	})

	it("requires marker=1 for opencode-derived base catalogs", () => {
		expect(() =>
			parseBaseCatalogText(
				JSON.stringify({
					$cliproxyBaseCatalogContractVersion: 2,
					models: [],
				}),
				"opencode-base-catalog.json",
			),
		).toThrow("Unsupported $cliproxyBaseCatalogContractVersion")
	})

	it("accepts opencode-style envelope shape with baseCatalog payload", () => {
		const parsed = parseBaseCatalogText(
			JSON.stringify({
				generatedAt: "2026-03-25T00:00:00.000Z",
				baseCatalog: {
					$cliproxyBaseCatalogContractVersion: 1,
					models: [
						{
							source: "openai/gpt-5",
							api: { npm: "@ai-sdk/openai" },
							displayName: "GPT-5 (opencode envelope)",
							reasoning: true,
							limits: { context: 400000, output: 128000 },
						},
					],
				},
			}),
			"opencode-base-catalog-envelope.json",
		)

		expect(parsed.models).toHaveLength(1)
		expect(parsed.bySource.get("openai/gpt-5")?.displayName).toBe("GPT-5 (opencode envelope)")
	})

	it("treats an empty opencode base catalog as a valid no-op layer", () => {
		const parsed = parseBaseCatalogText(
			JSON.stringify({
				$cliproxyBaseCatalogContractVersion: 1,
				models: [],
			}),
			"opencode-empty-base-catalog.json",
		)

		expect(parsed.models).toEqual([])

		const merged = mergeBaseCatalogSources({
			opencodeBase: parsed,
			modelsDevBase: cacheFixture(),
		})

		expect(merged.bySource.get("openai/gpt-5")?.source.key).toBe("openai/gpt-5")
		expect(merged.models.length).toBe(cacheFixture().models.length)
	})

	it("keeps models.dev sibling models when opencode overrides one model in the same provider", () => {
		const modelsDevBase = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						"gpt-5": {
							id: "gpt-5",
							name: "GPT-5 (models.dev)",
							reasoning: true,
							limit: { context: 200000, output: 64000 },
						},
						"codex-mini": {
							id: "codex-mini",
							name: "Codex Mini (models.dev)",
							reasoning: true,
							limit: { context: 120000, output: 32000 },
						},
					},
				},
			}),
			"models.dev-cache-fill-sibling.json",
		)

		const opencodeBase = parseBaseCatalogText(
			JSON.stringify({
				$cliproxyBaseCatalogContractVersion: 1,
				models: [
					{
						source: "openai/gpt-5",
						api: { npm: "@ai-sdk/openai" },
						displayName: "GPT-5 (opencode override)",
						reasoning: true,
						limits: { context: 400000, output: 128000 },
					},
				],
			}),
			"opencode-base-catalog-fill-sibling.json",
		)

		const merged = mergeBaseCatalogSources({
			opencodeBase,
			modelsDevBase,
		})

		expect(merged.models.map((model) => model.source.key)).toEqual([
			"openai/codex-mini",
			"openai/gpt-5",
		])
		expect(merged.bySource.get("openai/gpt-5")?.displayName).toBe("GPT-5 (opencode override)")
		expect(merged.bySource.get("openai/codex-mini")?.displayName).toBe("Codex Mini (models.dev)")
	})

	it("applies duplicate source-key precedence as supplemental < models.dev < opencode", () => {
		const supplementalBase = parseBaseCatalogText(
			JSON.stringify({
				$cliproxyBaseCatalogContractVersion: 1,
				models: [
					{
						source: "openai/gpt-5",
						api: { npm: "@ai-sdk/openai-compatible" },
						displayName: "GPT-5 (supplemental)",
						reasoning: false,
						limits: { context: 100000, output: 16000 },
					},
				],
			}),
			"supplemental-base-catalog-precedence.json",
			{ baseSource: "supplemental" },
		)

		const modelsDevBase = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						"gpt-5": {
							id: "gpt-5",
							name: "GPT-5 (models.dev)",
							reasoning: true,
							limit: { context: 200000, output: 64000 },
						},
					},
				},
			}),
			"models.dev-cache-precedence.json",
		)

		const opencodeBase = parseBaseCatalogText(
			JSON.stringify({
				$cliproxyBaseCatalogContractVersion: 1,
				models: [
					{
						source: "openai/gpt-5",
						api: { npm: "@ai-sdk/openai" },
						displayName: "GPT-5 (opencode)",
						reasoning: true,
						limits: { context: 400000, output: 128000 },
					},
				],
			}),
			"opencode-base-catalog-precedence.json",
		)

		const merged = mergeBaseCatalogSources({
			opencodeBase,
			modelsDevBase,
			supplementalBase,
		})

		expect(merged.models.map((model) => model.source.key)).toEqual(["openai/gpt-5"])
		expect(merged.bySource.get("openai/gpt-5")).toMatchObject({
			displayName: "GPT-5 (opencode)",
			reasoning: true,
			api: { npm: "@ai-sdk/openai" },
			limits: { context: 400000, output: 128000 },
		})
	})
})

describe("cliproxy deterministic discovery + resolution", () => {
	it("keeps a single actionable warning by default when exactly one model is skipped", () => {
		const logged: string[] = []
		emitCliproxySkipWarnings(
			[
				{
					modelId: "mistral-large",
					reason: "unresolved source",
				},
			],
			{
				env: {},
				warn: (message) => {
					logged.push(message)
				},
			},
		)

		expect(logged).toEqual(["[cliproxy] skipped <mistral-large>: unresolved source"])
	})

	it("logs a summary warning by default when multiple models are skipped", () => {
		const logged: string[] = []
		emitCliproxySkipWarnings(
			[
				{ modelId: "mistral-large", reason: "unresolved source" },
				{ modelId: "gpt-999", reason: "auto-derived candidate miss" },
				{ modelId: "gpt-998", reason: "auto-derived candidate miss" },
			],
			{
				env: {},
				warn: (message) => {
					logged.push(message)
				},
			},
		)

		expect(logged).toHaveLength(1)
		expect(logged[0]).toContain("[cliproxy] skipped 3 discovered models")
		expect(logged[0]).toContain("auto-derived candidate miss: 2")
		expect(logged[0]).toContain("unresolved source: 1")
		expect(logged[0]).toContain("CLIPROXY_VERBOSE=1")
		expect(logged[0]).not.toContain("<mistral-large>")
	})

	it("logs per-model warnings in verbose mode", () => {
		const skipped = [
			{ modelId: "mistral-large", reason: "unresolved source" },
			{ modelId: "gpt-999", reason: "auto-derived candidate miss" },
		]
		const logged: string[] = []

		emitCliproxySkipWarnings(skipped, {
			env: { CLIPROXY_VERBOSE: "1" },
			warn: (message) => {
				logged.push(message)
			},
		})

		expect(logged).toEqual(skipped.map((entry) => formatCliproxySkipWarning(entry)))
	})

	it("keeps hard failure when all discovered models are skipped", () => {
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "mistral-large", display_name: "Unresolved" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		expect(() =>
			resolveCliproxyArtifact({
				cache: cacheFixture(),
				config: configBase(),
				discovered: merged,
			}),
		).toThrow("[cliproxy] zero providers/all models skipped")
	})

	it("canonicalizes one leading models/ prefix exactly", () => {
		expect(normalizeDiscoveredModelId("models/foo")).toBe("foo")
		expect(normalizeDiscoveredModelId("models/models/foo")).toBe("models/foo")
	})

	it("prefers v1 display name over v1beta", () => {
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "models/gpt-5", display_name: "GPT Five" }] }),
			parseV1BetaDiscoveryPayload({ models: [{ name: "gpt-5", displayName: "GPT 5 Beta" }] }),
		)
		expect(merged).toHaveLength(1)
		expect(merged[0].displayName).toBe("GPT Five")
	})

	it("fails discovery on one-endpoint success and uses failure precedence timeout > auth", async () => {
		const originalFetch = globalThis.fetch

		try {
			globalThis.fetch = (async (input: URL | RequestInfo) => {
				const url = typeof input === "string" ? input : input.toString()
				if (url.endsWith("/v1/models")) {
					return new Response(JSON.stringify({ data: [{ id: "gpt-5" }] }), { status: 200 })
				}
				return new Response("{", { status: 200 })
			}) as typeof fetch

			await expectAsyncThrowContains(
				() => discoverMergedModels("http://localhost:8317", ""),
				"discovery partial failure",
			)

			globalThis.fetch = (async (input: URL | RequestInfo) => {
				const url = typeof input === "string" ? input : input.toString()
				if (url.endsWith("/v1/models")) {
					throw new DOMException("aborted", "AbortError")
				}
				return new Response("", { status: 401 })
			}) as typeof fetch

			await expectAsyncThrowContains(
				() => discoverMergedModels("http://localhost:8317", ""),
				"discovery failed (timeout)",
			)
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it("resolves provider-qualified discovered IDs against models.dev cache", () => {
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [{ id: "github-copilot/gpt-4.1-mini", display_name: "Copilot GPT" }],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)
		const resolved = resolveCliproxyArtifact({
			cache: cacheFixture(),
			config: configBase(),
			discovered: merged,
		})

		expect(resolved.records).toHaveLength(1)
		expect(resolved.records[0].source.key).toBe("github-copilot/gpt-4.1-mini")
		expect(resolved.records[0].output.modelId).toBe("github-copilot/gpt-4.1-mini")
		expect(resolved.records[0].api.npm).toBe("@ai-sdk/github-copilot")
	})

	it("uses v1 owned_by hint to resolve unqualified IDs to copilot", () => {
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{
						id: "gpt-4.1-mini",
						display_name: "Copilot GPT",
						owned_by: "github-copilot",
					},
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({
			cache: cacheFixture(),
			config: configBase(),
			discovered: merged,
		})

		expect(resolved.records).toHaveLength(1)
		expect(resolved.records[0].source.key).toBe("github-copilot/gpt-4.1-mini")
		expect(resolved.records[0].output.providerBucketId).toBe("cliproxy-github-copilot")
		expect(resolved.records[0].output.modelId).toBe("gpt-4.1-mini")
	})

	it("falls back to family inference when owner-hinted provider misses", () => {
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{
						id: "gpt-5",
						display_name: "GPT 5",
						owned_by: "github-copilot",
					},
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({
			cache: cacheFixture(),
			config: configBase(),
			discovered: merged,
		})

		expect(resolved.records).toHaveLength(1)
		expect(resolved.records[0].source.key).toBe("openai/gpt-5")
		expect(resolved.records[0].output.providerBucketId).toBe("cliproxy-openai")
	})

	it("resolves custom provider IDs absent from models.dev via explicit table", () => {
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [{ id: "google-antigravity/gemini-2.5-pro", display_name: "Antigravity" }],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)
		const resolved = resolveCliproxyArtifact({
			cache: cacheFixture(),
			config: configBase(),
			discovered: merged,
		})

		expect(resolved.records).toHaveLength(1)
		expect(resolved.records[0].source.providerNamespace).toBe("google-antigravity")
		expect(resolved.records[0].source.effectiveHost).toBe("google-antigravity")
		expect(resolved.records[0].output.providerBucketId).toBe("cliproxy-google-antigravity")
		expect(resolved.records[0].limits.context).toBe(400000)
		expect(resolved.records[0].safetyCaps).toEqual({ context: 400000, output: 64000 })
	})

	it("applies alias lookup and bare family default mapping", () => {
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "gpt-5-latest", display_name: "Alias GPT" },
					{ id: "codex-mini-latest", display_name: "Alias Codex" },
					{ id: "claude-sonnet-4-5", display_name: "Claude" },
					{ id: "gemini-2.5-pro", display_name: "Gemini" },
					{ id: "kimi-k2", display_name: "Kimi" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({
			cache: cacheFixture(),
			config: configBase(),
			discovered: merged,
		})

		expect(resolved.records.map((record) => record.source.key)).toEqual([
			"anthropic/claude-sonnet-4-5",
			"google/gemini-2.5-pro",
			"moonshotai/kimi-k2",
			"openai/codex-mini",
			"openai/gpt-5",
		])
	})

	it("skips unresolved and auto-derived misses with canonicalId in warning", () => {
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "mistral-large", display_name: "Unresolved" },
					{ id: "gpt-999", display_name: "Missing OpenAI" },
					{ id: "gpt-5", display_name: "OpenAI" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({
			cache: cacheFixture(),
			config: configBase(),
			discovered: merged,
		})

		expect(resolved.records).toHaveLength(1)
		expect(resolved.records[0].output.modelId).toBe("gpt-5")
		expect(resolved.skipped).toContainEqual({
			modelId: "mistral-large",
			reason: "unresolved source",
		})
		expect(resolved.skipped).toContainEqual({
			modelId: "gpt-999",
			reason: "auto-derived candidate miss",
		})
	})

	it("skips exact canonical conflicts", () => {
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "gpt-5", display_name: "One" },
					{ id: "models/gpt-5", display_name: "Two" },
					{ id: "claude-sonnet-4-5", display_name: "Claude" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({
			cache: cacheFixture(),
			config: configBase(),
			discovered: merged,
		})

		expect(resolved.records).toHaveLength(1)
		expect(resolved.records[0].output.modelId).toBe("claude-sonnet-4-5")
		expect(resolved.skipped).toContainEqual({
			modelId: "gpt-5",
			reason: "canonical conflict",
		})
	})

	it("fails for user-specified source misses and unknown custom providers", () => {
		const missingTargetConfig = parseCliproxyConfigObject(
			{
				url: "http://localhost:8317",
				models: {
					"gpt-5": {
						source: "openai/does-not-exist",
					},
				},
			},
			{ env: {}, readCredentialFile: () => "" },
		)

		const unknownProviderConfig = parseCliproxyConfigObject(
			{
				url: "http://localhost:8317",
				models: {
					"gpt-5": {
						source: "unknown-provider/gpt-5",
					},
				},
			},
			{ env: {}, readCredentialFile: () => "" },
		)

		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "gpt-5" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		expect(() =>
			resolveCliproxyArtifact({
				cache: cacheFixture(),
				config: missingTargetConfig,
				discovered: merged,
			}),
		).toThrow("source target for <gpt-5> does not exist")

		expect(() =>
			resolveCliproxyArtifact({
				cache: cacheFixture(),
				config: unknownProviderConfig,
				discovered: merged,
			}),
		).toThrow("references unsupported provider namespace")
	})

	it("fails when override conflicts with preset-required anthropic header", () => {
		const config = parseCliproxyConfigObject(
			{
				url: "http://localhost:8317",
				models: {
					"claude-sonnet-4-5": {
						chat: {
							headers: {
								"anthropic-beta": "wrong-value",
							},
						},
					},
				},
			},
			{ env: {}, readCredentialFile: () => "" },
		)

		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "claude-sonnet-4-5" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		expect(() =>
			resolveCliproxyArtifact({
				cache: cacheFixture(),
				config,
				discovered: merged,
			}),
		).toThrow("cannot override preset-required")
	})

	it("preserves sibling overrides and emits isolated cliproxy-* providers", () => {
		const config = parseCliproxyConfigObject(
			{
				url: "http://localhost:8317",
				provider: {
					openai: {
						cost: {
							input: 5,
						},
						chat: {
							headers: {
								"x-team": "core",
							},
						},
					},
				},
				models: {
					"gpt-5": {
						displayName: "GPT 5 Override",
						cost: {
							output: 9,
						},
						chat: {
							params: {
								temperature: 0.2,
							},
						},
					},
				},
			},
			{ env: {}, readCredentialFile: () => "" },
		)

		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "claude-sonnet-4-5", display_name: "Claude" },
					{ id: "gpt-5", display_name: "GPT" },
					{ id: "gemini-2.5-pro", display_name: "Gemini" },
					{ id: "github-copilot/gpt-4.1-mini", display_name: "Copilot" },
					{ id: "kimi-k2", display_name: "Kimi" },
					{ id: "google-antigravity/gemini-2.5-pro", display_name: "Anti" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({
			cache: cacheFixture(),
			config,
			discovered: merged,
		})
		const patch = buildCliproxyProviderPatch({ config, records: resolved.records })

		expect(Object.keys(patch)).toEqual([
			"cliproxy-anthropic",
			"cliproxy-github-copilot",
			"cliproxy-google",
			"cliproxy-google-antigravity",
			"cliproxy-moonshotai",
			"cliproxy-openai",
		])

		const openaiModels = patch["cliproxy-openai"].models as Record<string, Record<string, unknown>>
		expect(openaiModels["gpt-5"].name).toBe("GPT 5 Override")
		expect((openaiModels["gpt-5"].cost as Record<string, number>).input).toBe(5)
		expect((openaiModels["gpt-5"].cost as Record<string, number>).output).toBe(9)
		expect(openaiModels["gpt-5"].headers).toEqual({ "x-team": "core" })
		expect(openaiModels["gpt-5"].options).toEqual({ temperature: 0.2 })

		const googleModel = (
			patch["cliproxy-google"].models as Record<string, Record<string, unknown>>
		)["gemini-2.5-pro"]
		expect(googleModel.headers).toBeUndefined()
		expect(googleModel.options).toBeUndefined()
	})

	it("disambiguates duplicate display names within a provider bucket", () => {
		const cache = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						"gpt-5": {
							id: "gpt-5",
							name: "GPT 5",
							reasoning: true,
							limit: { context: 400000, output: 128000 },
						},
						"gpt-5.1": {
							id: "gpt-5.1",
							name: "GPT 5.1",
							reasoning: true,
							limit: { context: 400000, output: 128000 },
						},
						"gpt-4.1": {
							id: "gpt-4.1",
							name: "GPT 4.1",
							reasoning: true,
							limit: { context: 400000, output: 128000 },
						},
					},
				},
			}),
			"fixture-duplicate-display-names-cache.json",
		)

		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "gpt-5", display_name: "GPT 5" },
					{ id: "gpt-5.1", display_name: "GPT 5" },
					{ id: "gpt-4.1", display_name: "GPT 4.1" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({
			cache,
			config: configBase(),
			discovered: merged,
		})
		const patch = buildCliproxyProviderPatch({ config: configBase(), records: resolved.records })
		const openaiModels = patch["cliproxy-openai"].models as Record<string, Record<string, unknown>>

		expect(openaiModels["gpt-5"].name).toBe("GPT 5 [gpt-5]")
		expect(openaiModels["gpt-5.1"].name).toBe("GPT 5 [gpt-5.1]")
		expect(openaiModels["gpt-4.1"].name).toBe("GPT 4.1")
	})
})

describe("cliproxy canonical artifact pipeline", () => {
	it("falls back to persisted snapshot when live discovery is incomplete", async () => {
		const snapshotModels = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [{ id: "gpt-5-latest", display_name: "GPT 5 Latest" }],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const availability = await resolveCliproxyAvailabilityWithFallback({
			config: configBase(),
			snapshotPath: "/tmp/cliproxy-availability.json",
			discover: async () => {
				throw new Error("discovery partial failure")
			},
			readSnapshot: () => snapshotModels,
		})

		expect(availability.source).toBe("snapshot")
		expect(availability.models).toEqual(snapshotModels)
	})

	it("persists live snapshot only after canonical reconciliation/build validation succeeds", async () => {
		const duplicateCache = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						shared: {
							id: "shared",
							name: "Shared OpenAI",
							reasoning: true,
							limit: { context: 128000, output: 32000 },
						},
					},
				},
				anthropic: {
					id: "anthropic",
					name: "Anthropic",
					npm: "@ai-sdk/anthropic",
					models: {
						shared: {
							id: "shared",
							name: "Shared Anthropic",
							reasoning: true,
							limit: { context: 128000, output: 32000 },
						},
					},
				},
			}),
			"duplicate-cache.json",
		)

		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "shared", display_name: "Shared" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		let persistedCount = 0
		const artifact = await buildCliproxyGenerationArtifactWithAvailability({
			cache: duplicateCache,
			config: configBase(),
			snapshotPath: "/tmp/cliproxy-availability.json",
			discover: async () => availability,
			persistSnapshot: () => {
				persistedCount += 1
			},
		})

		expect(artifact.availabilitySource).toBe("live")
		expect(artifact.failed).toEqual([
			{
				code: "duplicate-emitted-id",
				message: "[cliproxy] duplicate canonical model id emitted: shared",
				canonicalId: "shared",
			},
		])
		expect(persistedCount).toBe(0)
	})

	it("keeps live artifact usable when snapshot persistence fails", async () => {
		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "gpt-5", display_name: "GPT 5" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = await buildCliproxyGenerationArtifactWithAvailability({
			cache: cacheFixture(),
			config: configBase(),
			snapshotPath: "/tmp/cliproxy-availability.json",
			discover: async () => availability,
			persistSnapshot: () => {
				throw new Error("disk full")
			},
		})

		expect(artifact.availabilitySource).toBe("live")
		expect(artifact.failed).toEqual([])
		expect(artifact.providerPatch["cliproxy-openai"]).toBeDefined()
		expect(artifact.snapshotPersistenceFailure).toContain("disk full")
	})

	it("fails loudly for structurally invalid persisted availability snapshot", () => {
		expect(() =>
			parseCliproxyAvailabilitySnapshotText(
				JSON.stringify({
					$cliproxyAvailabilityContractVersion: 1,
					sourceUrl: "http://localhost:8317",
					capturedAt: "2026-03-24T00:00:00.000Z",
					models: {},
				}),
				"cliproxy-availability.json",
			),
		).toThrow("availability snapshot models must be an array")
	})

	it("uses merged opencode base values directly in generation and emits base-source provenance", () => {
		const modelsDevBase = cacheFixture()

		const opencodeBase = parseBaseCatalogText(
			JSON.stringify({
				$cliproxyBaseCatalogContractVersion: 1,
				models: [
					{
						source: "openai/gpt-5",
						api: { npm: "@ai-sdk/openai" },
						displayName: "GPT-5 (opencode)",
						reasoning: true,
						limits: { context: 400000, output: 128000 },
					},
				],
			}),
			"opencode-provenance-base-catalog.json",
		)

		const mergedBase = mergeBaseCatalogSources({
			modelsDevBase,
			opencodeBase,
		})

		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "gpt-5", display_name: "GPT 5" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: mergedBase,
			config: configBase(),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(artifact.failed).toEqual([])
		const openaiModels = artifact.providerPatch["cliproxy-openai"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(openaiModels["gpt-5"].limit).toEqual({ context: 400000, output: 128000 })
		expect(openaiModels["gpt-5"].metadata).toEqual({
			canonicalId: "gpt-5",
			baseCatalogSource: "opencode",
			sourceProvider: "openai",
			sourceModelId: "gpt-5",
		})
	})

	it("preserves custom-provider overlay on canonical reconciliation paths", () => {
		const supplementalBase = parseBaseCatalogText(
			JSON.stringify({
				$cliproxyBaseCatalogContractVersion: 1,
				models: [
					{
						source: "google-antigravity/gemini-2.5-pro",
						api: { npm: "@ai-sdk/google" },
						displayName: "Gemini 2.5 Pro (supplemental canonical)",
						reasoning: true,
						limits: { context: 200000, output: 64000 },
					},
				],
			}),
			"supplemental-canonical-overlay.json",
			{ baseSource: "supplemental" },
		)

		const mergedBase = mergeBaseCatalogSources({
			modelsDevBase: cacheFixture(),
			supplementalBase,
		})

		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [{ id: "google-antigravity/gemini-2.5-pro", display_name: "Antigravity Canonical" }],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: mergedBase,
			config: configBase(),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(artifact.failed).toEqual([])
		const provider = artifact.providerPatch["cliproxy-google-antigravity"]
		expect((provider.options as Record<string, unknown>).baseURL).toBe(
			"http://localhost:8317/v1beta",
		)

		const model = (provider.models as Record<string, Record<string, unknown>>)[
			"google-antigravity/gemini-2.5-pro"
		]
		expect(model.limit).toEqual({ context: 400000, output: 64000 })
		expect(model.safetyCaps).toEqual({ context: 400000, output: 64000 })
	})

	it("builds deterministic machine-readable provider patch with canonical metadata", () => {
		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "gpt-5-latest", display_name: "GPT 5 Latest" },
					{ id: "codex-mini-latest", display_name: "Codex Mini Latest" },
					{ id: "claude-sonnet-4-5", display_name: "Claude Sonnet" },
					{ id: "ghost-model", display_name: "Ghost" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: cacheFixture(),
			config: configBase(),
			availabilityModels: availability,
			availabilitySource: "snapshot",
		})

		expect(artifact.failed).toEqual([])
		expect(artifact.availabilitySource).toBe("snapshot")

		const openaiModels = artifact.providerPatch["cliproxy-openai"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(openaiModels["gpt-5"].metadata).toEqual({
			canonicalId: "gpt-5",
			baseCatalogSource: "models.dev",
			sourceProvider: "openai",
			sourceModelId: "gpt-5",
			resolvedFromAliasId: "gpt-5-latest",
		})
		expect(openaiModels["codex-mini"].metadata).toEqual({
			canonicalId: "codex-mini",
			baseCatalogSource: "models.dev",
			sourceProvider: "openai",
			sourceModelId: "codex-mini",
			resolvedFromAliasId: "codex-mini-latest",
		})

		const anthropicModels = artifact.providerPatch["cliproxy-anthropic"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(anthropicModels["claude-sonnet-4-5"].metadata).toEqual({
			canonicalId: "claude-sonnet-4-5",
			baseCatalogSource: "models.dev",
			sourceProvider: "anthropic",
			sourceModelId: "claude-sonnet-4-5",
		})

		expect(artifact.skipped).toContainEqual({
			code: "exposure-gap",
			modelId: "ghost-model",
			discoveredId: "ghost-model",
			reason: "exposure gap",
		})
		expect(artifact.skipped).toContainEqual({
			code: "availability-gap",
			modelId: "github-copilot/gpt-4.1-mini",
			canonicalId: "github-copilot/gpt-4.1-mini",
			reason: "availability gap",
		})
	})

	it("emits capabilities metadata parity for modalities and variants", () => {
		const cacheWithCapabilities = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						"gpt-5": {
							id: "gpt-5",
							name: "GPT-5",
							reasoning: true,
							limit: { context: 400000, output: 128000 },
							capabilities: {
								modalities: ["audio", "text", "text"],
								variants: ["preview", "stable"],
							},
						},
						"codex-mini": {
							id: "codex-mini",
							name: "Codex Mini",
							reasoning: true,
							limit: { context: 200000, output: 100000 },
						},
					},
				},
				"google-vertex-anthropic": {
					id: "google-vertex-anthropic",
					name: "Google Vertex Anthropic",
					npm: "@ai-sdk/google-vertex/anthropic",
					models: {
						"vertex-claude": {
							id: "vertex-claude",
							name: "Vertex Claude",
							reasoning: true,
							limit: { context: 200000, output: 64000 },
						},
					},
				},
			}),
			"capabilities-cache.json",
		)

		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "gpt-5", display_name: "GPT 5" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: cacheWithCapabilities,
			config: configBase(),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(artifact.failed).toEqual([])
		const openaiModels = artifact.providerPatch["cliproxy-openai"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(openaiModels["gpt-5"].metadata).toEqual({
			canonicalId: "gpt-5",
			baseCatalogSource: "models.dev",
			sourceProvider: "openai",
			sourceModelId: "gpt-5",
			modalities: ["audio", "text"],
			variants: ["preview", "stable"],
		})
	})

	it("emits top-level runtime attachment/modalities fields for image-capable models", () => {
		const cacheWithRuntimeCapabilities = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						"gpt-5.4": {
							id: "gpt-5.4",
							name: "GPT-5.4",
							attachment: true,
							reasoning: true,
							limit: { context: 1050000, input: 922000, output: 128000 },
							modalities: {
								input: ["text", "image", "pdf"],
								output: ["text"],
							},
						},
					},
				},
			}),
			"runtime-modalities-cache.json",
		)

		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "gpt-5.4", display_name: "GPT 5.4" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: cacheWithRuntimeCapabilities,
			config: configBase(),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(artifact.failed).toEqual([])
		const openaiModels = artifact.providerPatch["cliproxy-openai"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(openaiModels["gpt-5.4"].attachment).toBe(true)
		expect(openaiModels["gpt-5.4"].modalities).toEqual({
			input: ["image", "pdf", "text"],
			output: ["text"],
		})
		expect(openaiModels["gpt-5.4"].metadata).toEqual({
			canonicalId: "gpt-5.4",
			baseCatalogSource: "models.dev",
			sourceProvider: "openai",
			sourceModelId: "gpt-5.4",
			modalities: ["image", "pdf", "text"],
		})
	})

	it("emits modalities for active openai/codex alias path when canonical cache provides them", () => {
		const cacheWithActiveModalities = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						"gpt-5": {
							id: "gpt-5",
							name: "GPT-5",
							reasoning: true,
							limit: { context: 400000, output: 128000 },
							modalities: ["text", "audio"],
						},
						"codex-mini": {
							id: "codex-mini",
							name: "Codex Mini",
							reasoning: true,
							limit: { context: 200000, output: 100000 },
							capabilities: {
								modalities: ["text", "text"],
							},
						},
					},
				},
				"google-vertex-anthropic": {
					id: "google-vertex-anthropic",
					name: "Google Vertex Anthropic",
					npm: "@ai-sdk/google-vertex/anthropic",
					models: {
						"vertex-claude": {
							id: "vertex-claude",
							name: "Vertex Claude",
							reasoning: true,
							limit: { context: 200000, output: 64000 },
						},
					},
				},
			}),
			"active-openai-codex-modalities-cache.json",
		)

		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "gpt-5-latest", display_name: "GPT 5 Latest" },
					{ id: "codex-mini-latest", display_name: "Codex Mini Latest" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: cacheWithActiveModalities,
			config: configBase(),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(artifact.failed).toEqual([])
		const openaiModels = artifact.providerPatch["cliproxy-openai"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(openaiModels["gpt-5"].metadata).toEqual({
			canonicalId: "gpt-5",
			baseCatalogSource: "models.dev",
			sourceProvider: "openai",
			sourceModelId: "gpt-5",
			modalities: ["audio", "text"],
			resolvedFromAliasId: "gpt-5-latest",
		})
		expect(openaiModels["codex-mini"].metadata).toEqual({
			canonicalId: "codex-mini",
			baseCatalogSource: "models.dev",
			sourceProvider: "openai",
			sourceModelId: "codex-mini",
			modalities: ["text"],
			resolvedFromAliasId: "codex-mini-latest",
		})
	})

	it("emits modalities for active openai/codex alias path when cache uses object-shaped modalities", () => {
		const cacheWithObjectModalities = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						"gpt-5": {
							id: "gpt-5",
							name: "GPT-5",
							reasoning: true,
							limit: { context: 400000, output: 128000 },
							modalities: {
								input: ["text", "audio", "text"],
								output: ["audio", "image"],
							},
						},
						"codex-mini": {
							id: "codex-mini",
							name: "Codex Mini",
							reasoning: true,
							limit: { context: 200000, output: 100000 },
							capabilities: {
								modalities: {
									input: ["text", "code"],
									output: ["code", "text"],
								},
							},
						},
					},
				},
				"google-vertex-anthropic": {
					id: "google-vertex-anthropic",
					name: "Google Vertex Anthropic",
					npm: "@ai-sdk/google-vertex/anthropic",
					models: {
						"vertex-claude": {
							id: "vertex-claude",
							name: "Vertex Claude",
							reasoning: true,
							limit: { context: 200000, output: 64000 },
						},
					},
				},
			}),
			"active-openai-codex-object-modalities-cache.json",
		)

		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "gpt-5-latest", display_name: "GPT 5 Latest" },
					{ id: "codex-mini-latest", display_name: "Codex Mini Latest" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: cacheWithObjectModalities,
			config: configBase(),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(artifact.failed).toEqual([])
		const openaiModels = artifact.providerPatch["cliproxy-openai"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(openaiModels["gpt-5"].metadata).toEqual({
			canonicalId: "gpt-5",
			baseCatalogSource: "models.dev",
			sourceProvider: "openai",
			sourceModelId: "gpt-5",
			modalities: ["audio", "image", "text"],
			resolvedFromAliasId: "gpt-5-latest",
		})
		expect(openaiModels["codex-mini"].metadata).toEqual({
			canonicalId: "codex-mini",
			baseCatalogSource: "models.dev",
			sourceProvider: "openai",
			sourceModelId: "codex-mini",
			modalities: ["code", "text"],
			resolvedFromAliasId: "codex-mini-latest",
		})
	})

	it("emits resolvedFromAliasId for explicit alias-table reconciliation", () => {
		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [{ id: "gpt-5-latest", display_name: "GPT 5 Latest" }],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: cacheFixture(),
			config: configBase(),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(artifact.failed).toEqual([])
		const openaiModels = artifact.providerPatch["cliproxy-openai"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(openaiModels["gpt-5"].metadata).toEqual({
			canonicalId: "gpt-5",
			baseCatalogSource: "models.dev",
			sourceProvider: "openai",
			sourceModelId: "gpt-5",
			resolvedFromAliasId: "gpt-5-latest",
		})
	})

	it("does not emit alias metadata for provider-qualified reconciliation", () => {
		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [{ id: "openai/gpt-5", display_name: "OpenAI GPT 5" }],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: cacheFixture(),
			config: configBase(),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(artifact.failed).toEqual([])
		const openaiModels = artifact.providerPatch["cliproxy-openai"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(openaiModels["gpt-5"].metadata).toEqual({
			canonicalId: "gpt-5",
			baseCatalogSource: "models.dev",
			sourceProvider: "openai",
			sourceModelId: "gpt-5",
		})
	})

	it("does not emit alias metadata for owner-hint reconciliation", () => {
		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{
						id: "gpt-4.1-mini",
						display_name: "Copilot GPT",
						owned_by: "github-copilot",
					},
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: cacheFixture(),
			config: configBase(),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(artifact.failed).toEqual([])
		const copilotModels = artifact.providerPatch["cliproxy-github-copilot"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(copilotModels["github-copilot/gpt-4.1-mini"].metadata).toEqual({
			canonicalId: "github-copilot/gpt-4.1-mini",
			baseCatalogSource: "models.dev",
			sourceProvider: "github-copilot",
			sourceModelId: "gpt-4.1-mini",
		})
	})

	it("does not emit alias metadata when direct canonical discovery exists", () => {
		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "gpt-5", display_name: "GPT 5" },
					{ id: "gpt-5-latest", display_name: "GPT 5 Latest" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: cacheFixture(),
			config: configBase(),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(artifact.failed).toEqual([])
		const openaiModels = artifact.providerPatch["cliproxy-openai"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(openaiModels["gpt-5"].metadata).toEqual({
			canonicalId: "gpt-5",
			baseCatalogSource: "models.dev",
			sourceProvider: "openai",
			sourceModelId: "gpt-5",
		})
	})

	it("emits machine-readable fail records for duplicate canonical emitted IDs", () => {
		const duplicateCache = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				openai: {
					id: "openai",
					name: "OpenAI",
					npm: "@ai-sdk/openai",
					models: {
						shared: {
							id: "shared",
							name: "Shared OpenAI",
							reasoning: true,
							limit: { context: 128000, output: 32000 },
						},
					},
				},
				anthropic: {
					id: "anthropic",
					name: "Anthropic",
					npm: "@ai-sdk/anthropic",
					models: {
						shared: {
							id: "shared",
							name: "Shared Anthropic",
							reasoning: true,
							limit: { context: 128000, output: 32000 },
						},
					},
				},
			}),
			"duplicate-cache.json",
		)

		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "shared", display_name: "Shared" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: duplicateCache,
			config: configBase(),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(artifact.providerPatch).toEqual({})
		expect(artifact.failed).toEqual([
			{
				code: "duplicate-emitted-id",
				message: "[cliproxy] duplicate canonical model id emitted: shared",
				canonicalId: "shared",
			},
		])
	})
})

describe("cliproxy parity fixture matrix", () => {
	it("checked-in goldens match independent oracle", () => {
		expect(PARITY_GOLDENS).toEqual(buildCliproxyParityOracle())
	})

	for (const fixtureCase of CLIPROXY_PARITY_FIXTURE_MATRIX) {
		it(`matches golden: ${fixtureCase.name}`, () => {
			const merged = mergeDiscoveryModels(
				parseV1DiscoveryPayload({
					data: fixtureCase.discovery.map((entry) => ({
						id: entry.id,
						display_name: entry.displayName,
					})),
				}),
				parseV1BetaDiscoveryPayload({ models: [] }),
			)
			const resolved = resolveCliproxyArtifact({
				cache: cacheFixture(),
				config: configBase(),
				discovered: merged,
			})
			expect(resolved.records as unknown).toEqual(PARITY_GOLDENS[fixtureCase.name])
			if (fixtureCase.assertSkipWarningFragment) {
				const warningFragment = fixtureCase.assertSkipWarningFragment
				expect(
					resolved.skipped
						.map((entry) => formatCliproxySkipWarning(entry))
						.some((warning) => warning.includes(warningFragment)),
				).toBe(true)
			}
		})
	}

	it("matches golden: plugin-fail fixture", () => {
		const golden = PARITY_GOLDENS["plugin-fail"] as { message: string }
		expect(golden).toEqual(CLIPROXY_PLUGIN_FAIL_EXPECTATION)
		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "   ",
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow(golden.message)
	})
})
