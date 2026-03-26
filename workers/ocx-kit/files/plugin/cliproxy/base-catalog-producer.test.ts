import { describe, expect, it } from "bun:test"

import {
	buildOpencodeBaseCatalogArtifact,
	buildOpencodeBaseCatalogArtifactFromProviders,
	deriveOpencodeBaseCatalogSidecarPath,
	serializeOpencodeBaseCatalogArtifact,
} from "./base-catalog-producer"
import {
	buildCliproxyGenerationArtifact,
	mergeBaseCatalogSources,
	mergeDiscoveryModels,
	parseBaseCatalogText,
	parseCliproxyCacheText,
	parseCliproxyConfigObject,
	parseV1BetaDiscoveryPayload,
	parseV1DiscoveryPayload,
	resolveOptionalOpencodeBaseCatalogPath,
} from "./core"

describe("opencode base catalog producer", () => {
	it("builds deterministic envelope payload that cliproxy parser accepts", () => {
		const artifact = buildOpencodeBaseCatalogArtifactFromProviders({
			generatedAt: "2026-03-25T00:00:00.000Z",
			providers: {
				openai: {
					models: {
						"gpt-5": {
							name: "GPT-5 (opencode)",
							family: "gpt",
							release_date: "2026-03-01",
							last_updated: "2026-03-02",
							knowledge: "2026-02-01",
							status: "active",
							attachment: true,
							temperature: false,
							tool_call: true,
							structured_output: true,
							open_weights: false,
							interleaved: {
								field: "reasoning_content",
							},
							options: {
								reasoningEffort: "high",
							},
							headers: {
								"x-test": "1",
							},
							api: { npm: "@ai-sdk/openai" },
							capabilities: {
								reasoning: true,
								temperature: false,
								attachment: true,
								toolcall: true,
								interleaved: {
									field: "reasoning_content",
								},
								input: { text: true, audio: true },
								output: { text: true },
							},
							limit: { context: 400000, output: 128000 },
							cost: {
								input: 1,
								output: 2,
								reasoning: 0.4,
								cache: { read: 0.5, write: 0.25 },
								experimentalOver200K: {
									input: 1.5,
									output: 2.5,
									cache: { read: 0.6 },
								},
							},
							variants: {
								reasoning: {},
								fast: {},
							},
						},
						"codex-mini": {
							name: "Codex Mini (opencode)",
							api: { npm: "@ai-sdk/openai" },
							reasoning: true,
							limit: { context: 200000, output: 100000 },
						},
					},
				},
			},
		})

		expect(artifact.baseCatalog.models.map((entry) => entry.source)).toEqual([
			"openai/codex-mini",
			"openai/gpt-5",
		])
		expect(artifact.baseCatalog.models[1]).toMatchObject({
			source: "openai/gpt-5",
			family: "gpt",
			releaseDate: "2026-03-01",
			lastUpdated: "2026-03-02",
			knowledgeCutoff: "2026-02-01",
			status: "active",
			attachment: true,
			temperature: false,
			toolCall: true,
			structuredOutput: true,
			openWeights: false,
			interleaved: {
				field: "reasoning_content",
			},
			options: {
				reasoningEffort: "high",
			},
			headers: {
				"x-test": "1",
			},
			cost: {
				input: 1,
				output: 2,
				reasoning: 0.4,
				cacheRead: 0.5,
				cacheWrite: 0.25,
				contextOver200k: {
					input: 1.5,
					output: 2.5,
					cacheRead: 0.6,
				},
			},
		})
		expect(artifact.baseCatalog.models[0].status).toBe("active")

		const parsed = parseBaseCatalogText(
			serializeOpencodeBaseCatalogArtifact(artifact),
			"/tmp/opencode/opencode-base-catalog.json",
		)

		expect(parsed.bySource.get("openai/gpt-5")?.displayName).toBe("GPT-5 (opencode)")
		expect(parsed.bySource.get("openai/gpt-5")?.baseSource).toBe("opencode")
		expect(parsed.bySource.get("openai/gpt-5")?.attachment).toBe(true)
		expect(parsed.bySource.get("openai/gpt-5")?.capabilities).toEqual({
			modalities: ["audio", "text"],
			variants: ["fast", "reasoning"],
		})
	})

	it("preserves deterministic opencode fields for cliproxy-openai GPT catalog rows", () => {
		const artifact = buildOpencodeBaseCatalogArtifactFromProviders({
			providers: {
				"cliproxy-openai": {
					models: {
						"gpt-5.3-codex": {
							name: "GPT-5.3 Codex",
							family: "gpt-codex",
							release_date: "2026-02-24",
							last_updated: "2026-02-24",
							knowledge: "2025-08-31",
							attachment: true,
							reasoning: true,
							temperature: false,
							tool_call: true,
							structured_output: true,
							open_weights: false,
							api: { npm: "@ai-sdk/openai", id: "https://opencode.ai/zen/v1" },
							limit: { context: 400000, input: 272000, output: 128000 },
							cost: { input: 1.75, output: 14, cache: { read: 0.175 } },
							capabilities: {
								input: { text: true, image: true, pdf: true },
								output: { text: true },
							},
							variants: {
								low: {},
								medium: {},
								high: {},
								xhigh: {},
							},
						},
						"gpt-5.3-codex-spark": {
							name: "GPT-5.3 Codex Spark",
							family: "gpt-codex-spark",
							release_date: "2026-02-12",
							last_updated: "2026-02-12",
							knowledge: "2025-08-31",
							attachment: false,
							reasoning: true,
							temperature: false,
							tool_call: true,
							structured_output: true,
							open_weights: false,
							api: { npm: "@ai-sdk/openai", id: "https://opencode.ai/zen/v1" },
							limit: { context: 128000, input: 128000, output: 128000 },
							cost: { input: 1.75, output: 14, cache: { read: 0.175 } },
							capabilities: {
								input: { text: true },
								output: { text: true },
							},
							variants: {
								low: {},
								medium: {},
								high: {},
								xhigh: {},
							},
						},
						"gpt-5.4": {
							name: "GPT-5.4",
							family: "gpt",
							release_date: "2026-03-05",
							last_updated: "2026-03-05",
							knowledge: "2025-08-31",
							attachment: true,
							reasoning: true,
							temperature: false,
							tool_call: true,
							structured_output: true,
							open_weights: false,
							api: { npm: "@ai-sdk/openai", id: "https://opencode.ai/zen/v1" },
							limit: { context: 1050000, input: 922000, output: 128000 },
							cost: { input: 2.5, output: 15, cache: { read: 0.25 } },
							capabilities: {
								input: { text: true, image: true, pdf: true },
								output: { text: true },
							},
							variants: {
								none: {},
								low: {},
								medium: {},
								high: {},
								xhigh: {},
							},
						},
						"gpt-5.4-mini": {
							name: "GPT-5.4 Mini",
							family: "gpt-mini",
							release_date: "2026-03-17",
							last_updated: "2026-03-17",
							knowledge: "2025-08-31",
							attachment: true,
							reasoning: true,
							temperature: false,
							tool_call: true,
							structured_output: true,
							open_weights: false,
							api: { npm: "@ai-sdk/openai", id: "https://opencode.ai/zen/v1" },
							limit: { context: 400000, input: 272000, output: 128000 },
							cost: { input: 0.75, output: 4.5, cache: { read: 0.075 } },
							capabilities: {
								input: { text: true, image: true, pdf: true },
								output: { text: true },
							},
							variants: {
								none: {},
								low: {},
								medium: {},
								high: {},
								xhigh: {},
							},
						},
					},
				},
			},
		})

		expect(artifact.baseCatalog.models.map((entry) => entry.source)).toEqual([
			"cliproxy-openai/gpt-5.3-codex",
			"cliproxy-openai/gpt-5.3-codex-spark",
			"cliproxy-openai/gpt-5.4",
			"cliproxy-openai/gpt-5.4-mini",
		])
		expect(artifact.baseCatalog.models[1]).toMatchObject({
			source: "cliproxy-openai/gpt-5.3-codex-spark",
			lastUpdated: "2026-02-12",
			knowledgeCutoff: "2025-08-31",
			structuredOutput: true,
			openWeights: false,
			capabilities: {
				variants: ["high", "low", "medium", "xhigh"],
			},
			status: "active",
		})
		expect(artifact.baseCatalog.models[2].capabilities?.variants).toEqual([
			"high",
			"low",
			"medium",
			"none",
			"xhigh",
		])
		expect(artifact.baseCatalog.models[3].capabilities?.variants).toEqual([
			"high",
			"low",
			"medium",
			"none",
			"xhigh",
		])

		expect(() =>
			parseBaseCatalogText(
				serializeOpencodeBaseCatalogArtifact(artifact),
				"/tmp/opencode/opencode-base-catalog.json",
			),
		).not.toThrow()
	})

	it("propagates base-catalog releaseDate into cliproxy provider patch models", () => {
		const artifact = buildOpencodeBaseCatalogArtifactFromProviders({
			providers: {
				openai: {
					models: {
						"gpt-5.4": {
							name: "GPT-5.4",
							release_date: "2026-03-05",
							reasoning: true,
							api: { npm: "@ai-sdk/openai" },
							limit: { context: 1050000, input: 922000, output: 128000 },
						},
						"gpt-5.4-mini": {
							name: "GPT-5.4 Mini",
							release_date: "2026-03-17",
							reasoning: true,
							api: { npm: "@ai-sdk/openai" },
							limit: { context: 400000, input: 272000, output: 128000 },
						},
					},
				},
			},
		})

		const cache = parseBaseCatalogText(
			serializeOpencodeBaseCatalogArtifact(artifact),
			"/tmp/opencode/opencode-base-catalog.json",
		)

		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "gpt-5.4", display_name: "GPT-5.4" },
					{ id: "gpt-5.4-mini", display_name: "GPT-5.4 Mini" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const generated = buildCliproxyGenerationArtifact({
			cache,
			config: parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
				},
				{ env: {}, readCredentialFile: () => "" },
			),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(generated.failed).toEqual([])
		const openaiModels = generated.providerPatch["cliproxy-openai"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(openaiModels["gpt-5.4"].release_date).toBe("2026-03-05")
		expect(openaiModels["gpt-5.4-mini"].release_date).toBe("2026-03-17")
	})

	it("fails loudly when reasoning metadata fields conflict", () => {
		expect(() =>
			buildOpencodeBaseCatalogArtifact({
				models: [
					{
						providerID: "openai",
						modelID: "gpt-5",
						name: "GPT-5",
						api: { npm: "@ai-sdk/openai" },
						reasoning: true,
						capabilities: {
							reasoning: false,
						},
						limit: { context: 400000, output: 128000 },
					},
				],
			}),
		).toThrow(
			"[cliproxy] opencode base catalog producer models[0].reasoning: conflicts with model.capabilities.reasoning; both fields must agree when provided",
		)
	})

	it("fails with scoped errors for malformed nested producer boundaries", () => {
		const malformedCases: Array<{ label: string; run: () => unknown; expectedMessage: string }> = [
			{
				label: "input root",
				run: () => buildOpencodeBaseCatalogArtifact(null as unknown as never),
				expectedMessage: "[cliproxy] opencode base catalog producer input: must be an object",
			},
			{
				label: "input.api",
				run: () =>
					buildOpencodeBaseCatalogArtifact({
						models: [
							{
								providerID: "openai",
								modelID: "gpt-5",
								name: "GPT-5",
								api: "@ai-sdk/openai" as unknown as { npm: string },
								reasoning: true,
								limit: { context: 400000, output: 128000 },
							},
						],
					}),
				expectedMessage:
					"[cliproxy] opencode base catalog producer models[0].api: must be an object",
			},
			{
				label: "input.limit",
				run: () =>
					buildOpencodeBaseCatalogArtifact({
						models: [
							{
								providerID: "openai",
								modelID: "gpt-5",
								name: "GPT-5",
								api: { npm: "@ai-sdk/openai" },
								reasoning: true,
								limit: "bad" as unknown as { context: number; output: number },
							},
						],
					}),
				expectedMessage:
					"[cliproxy] opencode base catalog producer models[0].limit: must be an object",
			},
			{
				label: "input.providers",
				run: () =>
					buildOpencodeBaseCatalogArtifactFromProviders({
						providers: [] as unknown,
					} as unknown as Parameters<typeof buildOpencodeBaseCatalogArtifactFromProviders>[0]),
				expectedMessage:
					"[cliproxy] opencode base catalog producer input.providers: must be an object",
			},
			{
				label: "provider.models",
				run: () =>
					buildOpencodeBaseCatalogArtifactFromProviders({
						providers: {
							openai: {
								models: "bad",
							},
						},
					} as unknown as Parameters<typeof buildOpencodeBaseCatalogArtifactFromProviders>[0]),
				expectedMessage:
					"[cliproxy] opencode base catalog producer input.providers.openai.models: must be an object",
			},
			{
				label: "capability maps",
				run: () =>
					buildOpencodeBaseCatalogArtifact({
						models: [
							{
								providerID: "openai",
								modelID: "gpt-5",
								name: "GPT-5",
								api: { npm: "@ai-sdk/openai" },
								capabilities: {
									reasoning: true,
									input: "text" as unknown as Record<string, boolean>,
								},
								limit: { context: 400000, output: 128000 },
							},
						],
					}),
				expectedMessage:
					"[cliproxy] opencode base catalog producer models[0].capabilities.input: must be an object",
			},
			{
				label: "variants",
				run: () =>
					buildOpencodeBaseCatalogArtifact({
						models: [
							{
								providerID: "openai",
								modelID: "gpt-5",
								name: "GPT-5",
								api: { npm: "@ai-sdk/openai" },
								reasoning: true,
								limit: { context: 400000, output: 128000 },
								variants: ["fast"] as unknown as Record<string, unknown>,
							},
						],
					}),
				expectedMessage:
					"[cliproxy] opencode base catalog producer models[0].variants: must be an object",
			},
		]

		for (const malformedCase of malformedCases) {
			expect(malformedCase.run, malformedCase.label).toThrow(malformedCase.expectedMessage)
		}
	})

	it("uses locale-independent deterministic ordering for providers, models, and variants", () => {
		const artifact = buildOpencodeBaseCatalogArtifactFromProviders({
			providers: {
				älpha: {
					models: {
						m: {
							name: "M",
							api: { npm: "@ai-sdk/alpha" },
							reasoning: true,
							limit: { context: 10, output: 10 },
						},
					},
				},
				zeta: {
					models: {
						"ä-model": {
							name: "A-Umlaut Model",
							api: { npm: "@ai-sdk/zeta" },
							reasoning: true,
							limit: { context: 10, output: 10 },
						},
						"z-model": {
							name: "Z Model",
							api: { npm: "@ai-sdk/zeta" },
							reasoning: true,
							limit: { context: 10, output: 10 },
							variants: {
								"ä-variant": {},
								"z-variant": {},
							},
						},
					},
				},
			},
		})

		expect(artifact.baseCatalog.models.map((entry) => entry.source)).toEqual([
			"zeta/z-model",
			"zeta/ä-model",
			"älpha/m",
		])

		expect(artifact.baseCatalog.models[0].capabilities?.variants).toEqual([
			"z-variant",
			"ä-variant",
		])
	})

	it("derives the sidecar path used by the existing cliproxy loader", () => {
		const modelsPath = "/tmp/opencode/models.json"
		const sidecarPath = deriveOpencodeBaseCatalogSidecarPath(modelsPath)

		const resolved = resolveOptionalOpencodeBaseCatalogPath({
			modelsPath,
			env: {},
			pathExists: (candidatePath: string) => candidatePath === sidecarPath,
		})

		expect(sidecarPath).toBe("/tmp/opencode/opencode-base-catalog.json")
		expect(resolved).toEqual({
			path: sidecarPath,
			isExplicit: false,
		})
	})

	it("merges produced opencode base over models.dev while preserving fallback siblings", () => {
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
			"models.dev-cache.json",
		)

		const produced = buildOpencodeBaseCatalogArtifactFromProviders({
			generatedAt: "2026-03-25T00:00:00.000Z",
			providers: {
				openai: {
					models: {
						"gpt-5": {
							name: "GPT-5 (opencode)",
							api: { npm: "@ai-sdk/openai" },
							attachment: true,
							reasoning: true,
							capabilities: {
								input: { text: true, image: true, pdf: true },
								output: { text: true },
							},
							limit: { context: 400000, output: 128000 },
						},
					},
				},
			},
		})

		const opencodeBase = parseBaseCatalogText(
			serializeOpencodeBaseCatalogArtifact(produced),
			"/tmp/opencode/opencode-base-catalog.json",
		)

		const merged = mergeBaseCatalogSources({
			opencodeBase,
			modelsDevBase,
		})

		expect(merged.models.map((model) => model.source.key)).toEqual([
			"openai/codex-mini",
			"openai/gpt-5",
		])
		expect(merged.bySource.get("openai/gpt-5")?.displayName).toBe("GPT-5 (opencode)")
		expect(merged.bySource.get("openai/gpt-5")?.baseSource).toBe("opencode")
		expect(merged.bySource.get("openai/codex-mini")?.displayName).toBe("Codex Mini (models.dev)")
		expect(merged.bySource.get("openai/codex-mini")?.baseSource).toBe("models.dev")
	})

	it("supports full producer -> artifact -> consumer flow while preserving cliproxy-* emitted IDs", () => {
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
			"models.dev-cache-e2e.json",
		)

		const produced = buildOpencodeBaseCatalogArtifactFromProviders({
			providers: {
				openai: {
					models: {
						"gpt-5": {
							name: "GPT-5 (opencode)",
							api: { npm: "@ai-sdk/openai" },
							attachment: true,
							reasoning: true,
							capabilities: {
								input: { text: true, image: true, pdf: true },
								output: { text: true },
							},
							limit: { context: 400000, output: 128000 },
						},
					},
				},
			},
		})

		const mergedBase = mergeBaseCatalogSources({
			opencodeBase: parseBaseCatalogText(
				serializeOpencodeBaseCatalogArtifact(produced),
				"/tmp/opencode/opencode-base-catalog.json",
			),
			modelsDevBase,
		})

		const availability = mergeDiscoveryModels(
			parseV1DiscoveryPayload({
				data: [
					{ id: "gpt-5", display_name: "GPT 5" },
					{ id: "codex-mini", display_name: "Codex Mini" },
				],
			}),
			parseV1BetaDiscoveryPayload({ models: [] }),
		)

		const artifact = buildCliproxyGenerationArtifact({
			cache: mergedBase,
			config: parseCliproxyConfigObject(
				{
					url: "http://localhost:8317",
				},
				{ env: {}, readCredentialFile: () => "" },
			),
			availabilityModels: availability,
			availabilitySource: "live",
		})

		expect(artifact.failed).toEqual([])
		expect(Object.keys(artifact.providerPatch)).toEqual(["cliproxy-openai"])

		const openaiModels = artifact.providerPatch["cliproxy-openai"].models as Record<
			string,
			Record<string, unknown>
		>
		expect(openaiModels["gpt-5"].metadata).toEqual({
			canonicalId: "gpt-5",
			baseCatalogSource: "opencode",
			sourceProvider: "openai",
			sourceModelId: "gpt-5",
			modalities: ["image", "pdf", "text"],
		})
		expect(openaiModels["gpt-5"].attachment).toBe(true)
		expect(openaiModels["gpt-5"].modalities).toEqual({
			input: ["image", "pdf", "text"],
			output: ["text"],
		})
		expect(openaiModels["codex-mini"].metadata).toEqual({
			canonicalId: "codex-mini",
			baseCatalogSource: "models.dev",
			sourceProvider: "openai",
			sourceModelId: "codex-mini",
		})
	})
})
