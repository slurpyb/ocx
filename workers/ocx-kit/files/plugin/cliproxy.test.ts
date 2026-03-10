import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
	buildCliproxyProviderPatch,
	mergeDiscoveryModels,
	normalizeDiscoveredModelId,
	parseCliproxyCacheText,
	parseCliproxyConfigObject,
	parseCliproxyConfigText,
	parseV1BetaDiscoveryPayload,
	parseV1DiscoveryPayload,
	resolveCliproxyArtifact,
} from "./cliproxy"
import {
	buildCliproxyParityOracle,
	CLIPROXY_PARITY_FIXTURE_MATRIX,
	CLIPROXY_PLUGIN_FAIL_EXPECTATION,
} from "./cliproxy-parity-oracle"

const PARITY_GOLDENS = JSON.parse(
	readFileSync(path.join(import.meta.dir, "cliproxy.parity.goldens.json"), "utf-8"),
) as Record<string, unknown>

function expectThrowMessageExactly(fn: () => unknown, expectedMessage: string) {
	try {
		fn()
	} catch (error) {
		expect(error).toBeInstanceOf(Error)
		expect((error as Error).message).toBe(expectedMessage)
		return
	}
	throw new Error(`Expected function to throw: ${expectedMessage}`)
}

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
					"shared-model": {
						id: "shared-model",
						name: "Shared Model",
						reasoning: false,
						limit: { context: 1000, output: 100 },
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
				npm: "@ai-sdk/openai-compatible",
				api: "https://api.githubcopilot.com",
				models: {
					"gpt-4.1-mini": {
						id: "gpt-4.1-mini",
						name: "GPT 4.1 Mini",
						reasoning: true,
						limit: { context: 128000, output: 16000 },
					},
					"gpt-5": {
						id: "gpt-5",
						name: "GPT-5 (Copilot)",
						reasoning: true,
						limit: { context: 400000, output: 128000 },
					},
					"gemini-2.5-pro": {
						id: "gemini-2.5-pro",
						name: "Gemini 2.5 Pro (Copilot)",
						reasoning: true,
						limit: { context: 1000000, output: 64000 },
					},
					"shared-model": {
						id: "shared-model",
						name: "Shared Model Copilot",
						reasoning: false,
						limit: { context: 1000, output: 100 },
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

describe("cliproxy config contract", () => {
	it("rejects unsupported prefix with exact message", () => {
		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
					prefix: "my-prefix",
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow(
			'[cliproxy] providers are always emitted as cliproxy-*; remove prefix or set it to "cliproxy"',
		)
	})

	it("rejects missing env credential reference", () => {
		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
					apiKey: "{env:CLIPROXY_API_KEY}",
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow("Environment variable not set or empty")
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

	it("rejects unknown provider override namespace up front", () => {
		expect(() =>
			parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
					provider: {
						"custom-provider": {
							displayName: "Custom",
						},
					},
				},
				{ env: {}, readCredentialFile: () => "" },
			),
		).toThrow("[cliproxy] cliproxy.provider.custom-provider references unsupported namespace")
	})

	it("parses JSONC without stripping comment-like text in strings", () => {
		const parsed = parseCliproxyConfigText(
			`{
				// top-level comment
				"url": "http://localhost:8317",
				"apiKey": "token://keep/*literal*/value",
				"models": {
					"gpt-5": {
						"displayName": "Model // keep",
						/* inline block comment */
						"chat": {
							"params": {
								"note": "slash // literal"
							}
						}
					}
				}
			}`,
			"fixture-config.jsonc",
			{ env: {}, readCredentialFile: () => "" },
		)

		expect(parsed.apiKey).toBe("token://keep/*literal*/value")
		expect(parsed.models["gpt-5"].displayName).toBe("Model // keep")
		expect(parsed.models["gpt-5"].chat?.params?.note).toBe("slash // literal")
	})

	it("parses cliproxy.jsonc with trailing commas", () => {
		const parsed = parseCliproxyConfigText(
			`{
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

describe("cliproxy cache contract", () => {
	it("supports marker=1 and validates models", () => {
		const parsed = cacheFixture()
		expect(parsed.models.length).toBeGreaterThan(0)
	})

	it("rejects unsupported marker", () => {
		expect(() =>
			parseCliproxyCacheText(
				JSON.stringify({ $cliproxyCacheContractVersion: 2, any: {} }),
				"fixture-cache.json",
			),
		).toThrow("Unsupported $cliproxyCacheContractVersion")
	})

	it("rejects invalid numeric invariants", () => {
		expect(() =>
			parseCliproxyCacheText(
				JSON.stringify({
					provider: {
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

	it("accepts zero-valued cache limits for passthrough models", () => {
		const parsed = parseCliproxyCacheText(
			JSON.stringify({
				$cliproxyCacheContractVersion: 1,
				nvidia: {
					id: "nvidia",
					name: "NVIDIA",
					npm: "@ai-sdk/openai-compatible",
					models: {
						"nvidia/parakeet-tdt-0.6b-v2": {
							id: "nvidia/parakeet-tdt-0.6b-v2",
							name: "Parakeet TDT 0.6B v2",
							reasoning: false,
							limit: { context: 0, output: 4096 },
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
						},
					},
				},
			}),
			"fixture-cache.json",
		)

		expect(parsed.models).toHaveLength(2)
		expect(parsed.bySource.get("nvidia::nvidia/parakeet-tdt-0.6b-v2")?.limits.context).toBe(0)
	})
})

describe("cliproxy deterministic discovery + resolution", () => {
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

	it("builds isolated cliproxy-* providers for all host presets", () => {
		const config = configBase()
		const cache = cacheFixture()
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "models/claude-sonnet-4-5", display_name: "Claude Sonnet" },
					{ id: "gpt-5", display_name: "GPT-5" },
					{ id: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro" },
					{ id: "vertex-claude", display_name: "Vertex Claude" },
					{ id: "gpt-4.1-mini", display_name: "GPT 4.1 Mini" },
					{ id: "kimi-k2", display_name: "Kimi K2" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({ cache, config, discovered: merged })
		const patch = buildCliproxyProviderPatch({ config, records: resolved.records })

		expect(Object.keys(patch)).toEqual([
			"cliproxy-anthropic",
			"cliproxy-github-copilot",
			"cliproxy-google",
			"cliproxy-google-vertex-anthropic",
			"cliproxy-moonshotai",
			"cliproxy-openai",
		])

		const anthropicModels = patch["cliproxy-anthropic"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(anthropicModels["claude-sonnet-4-5"].headers).toEqual({
			"anthropic-beta":
				"claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
		})

		const copilotProvider = patch["cliproxy-github-copilot"]
		expect(copilotProvider.npm).toBe("@ai-sdk/openai-compatible")
		const copilotModels = copilotProvider.models as Record<string, Record<string, unknown>>
		expect(copilotModels["gpt-4.1-mini"].provider).toEqual({
			npm: "@ai-sdk/openai-compatible",
			api: "https://api.githubcopilot.com",
		})
	})

	it("defaults duplicated OpenAI-family IDs to openai host", () => {
		const config = configBase()
		const cache = cacheFixture()
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "gpt-5", display_name: "GPT-5" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({ cache, config, discovered: merged })
		expect(resolved.records).toHaveLength(1)
		expect(resolved.records[0].source.providerNamespace).toBe("openai")
		expect(resolved.records[0].output.providerBucketId).toBe("cliproxy-openai")
	})

	it("defaults duplicated Gemini-family IDs to google host", () => {
		const config = configBase()
		const cache = cacheFixture()
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [{ id: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro" }],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({ cache, config, discovered: merged })
		expect(resolved.records).toHaveLength(1)
		expect(resolved.records[0].source.providerNamespace).toBe("google")
		expect(resolved.records[0].output.providerBucketId).toBe("cliproxy-google")
	})

	it("preserves explicit source override over native default host", () => {
		const cache = cacheFixture()
		const config = parseCliproxyConfigObject(
			{
				url: "http://localhost:8317",
				models: {
					"gpt-5": {
						source: {
							providerNamespace: "github-copilot",
							modelId: "gpt-5",
						},
					},
				},
			},
			{ env: {}, readCredentialFile: () => "" },
		)
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "gpt-5" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({ cache, config, discovered: merged })
		expect(resolved.records).toHaveLength(1)
		expect(resolved.records[0].source.providerNamespace).toBe("github-copilot")
		expect(resolved.records[0].output.providerBucketId).toBe("cliproxy-github-copilot")
	})

	it("skips ambiguous model sources and includes <canonicalId> in warning", () => {
		const config = configBase()
		const cache = cacheFixture()
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "shared-model" }, { id: "gpt-5" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({ cache, config, discovered: merged })
		expect(resolved.records.some((record) => record.output.modelId === "gpt-5")).toBe(true)
		expect(resolved.records.some((record) => record.output.modelId === "shared-model")).toBe(false)
		expect(resolved.skipWarnings.some((warning) => warning.includes("<shared-model>"))).toBe(true)
	})

	it("fails when override conflicts with preset-required anthropic header", () => {
		const cache = cacheFixture()
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

		expect(() => resolveCliproxyArtifact({ cache, config, discovered: merged })).toThrow(
			"cannot override preset-required",
		)
	})

	it("fails when source override points to nonexistent cache model", () => {
		const cache = cacheFixture()
		const config = parseCliproxyConfigObject(
			{
				url: "http://localhost:8317",
				models: {
					"gpt-5": {
						source: {
							providerNamespace: "openai",
							modelId: "does-not-exist",
						},
					},
				},
			},
			{ env: {}, readCredentialFile: () => "" },
		)
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({ data: [{ id: "gpt-5" }] }),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		expect(() => resolveCliproxyArtifact({ cache, config, discovered: merged })).toThrow(
			"source target for <gpt-5> does not exist",
		)
	})

	it("skips unsupported cache host namespaces as per-model warnings", () => {
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
							name: "GPT-5",
							reasoning: true,
							limit: { context: 400000, output: 128000 },
						},
					},
				},
				customProviderNode: {
					id: "unsupported-host",
					name: "Unsupported Host",
					npm: "@ai-sdk/openai-compatible",
					models: {
						"future-model": {
							id: "future-model",
							name: "Future Model",
							reasoning: false,
							limit: { context: 1000, output: 100 },
						},
					},
				},
			}),
			"fixture-cache.json",
		)
		const config = configBase()
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "future-model", display_name: "Future Model" },
					{ id: "gpt-5", display_name: "GPT-5" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({ cache, config, discovered: merged })
		expect(resolved.records).toHaveLength(1)
		expect(resolved.records[0].output.modelId).toBe("gpt-5")
		expect(resolved.skipWarnings).toContain(
			"[cliproxy] skipped <future-model>: unsupported host namespace <unsupported-host>",
		)
	})

	it("skips discovered models mapped to non-positive cache limits", () => {
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
							name: "GPT-5",
							reasoning: true,
							limit: { context: 0, output: 128000 },
						},
						"gpt-4.1-mini": {
							id: "gpt-4.1-mini",
							name: "GPT-4.1 Mini",
							reasoning: true,
							limit: { context: 128000, output: 16000 },
						},
					},
				},
			}),
			"fixture-cache.json",
		)
		const config = configBase()
		const merged = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [{ id: "gpt-5", display_name: "GPT-5" }, { id: "gpt-4.1-mini" }],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const resolved = resolveCliproxyArtifact({ cache, config, discovered: merged })
		expect(resolved.records).toHaveLength(1)
		expect(resolved.records[0].output.modelId).toBe("gpt-4.1-mini")
		expect(resolved.skipWarnings).toContain("[cliproxy] skipped <gpt-5>: non-positive cache limits")
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
				expect(resolved.skipWarnings.some((warning) => warning.includes(warningFragment))).toBe(
					true,
				)
			}
		})
	}

	it("matches golden: plugin-fail fixture", () => {
		const golden = PARITY_GOLDENS["plugin-fail"] as { message: string }
		expect(golden).toEqual(CLIPROXY_PLUGIN_FAIL_EXPECTATION)
		expectThrowMessageExactly(
			() =>
				parseCliproxyConfigObject(
					{
						url: "http://localhost:8317",
						prefix: "bad",
					},
					{ env: {}, readCredentialFile: () => "" },
				),
			golden.message,
		)
	})
})
