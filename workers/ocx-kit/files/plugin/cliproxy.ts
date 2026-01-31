import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { readFileSync } from "fs"
import os from "os"

// ============================================================================
// Credential Resolution (MCP Pattern)
// ============================================================================

function resolveCredential(value: unknown): string {
	// Allow undefined/null for unsecured local proxies
	if (value === undefined || value === null || value === "") {
		return ""
	}

	if (typeof value !== "string") {
		console.warn("[cliproxy] apiKey must be a string")
		return ""
	}

	// Environment variable: {env:VARIABLE_NAME}
	if (value.startsWith("{env:") && value.endsWith("}")) {
		const varName = value.slice(5, -1)
		const resolved = process.env[varName]
		if (!resolved) {
			console.warn(`[cliproxy] Environment variable not set: ${varName}`)
		}
		return resolved || ""
	}

	// File reference: {file:PATH}
	if (value.startsWith("{file:") && value.endsWith("}")) {
		const filePath = value.slice(6, -1)
		const resolved = filePath.replace(/^~/, os.homedir())
		try {
			return readFileSync(resolved, "utf-8").trim()
		} catch {
			throw new Error(`[cliproxy] Failed to read credential file: ${resolved}`)
		}
	}

	// Unknown scheme: {foo:bar} - warn and treat as literal
	if (/^\{[a-z]+:.+\}$/.test(value)) {
		const scheme = value.slice(1, value.indexOf(":"))
		console.warn(`[cliproxy] Unknown credential scheme: ${scheme}, treating as literal`)
	}

	// Literal value
	return value
}

// ============================================================================
// Config Loader (Fail Fast on Malformed JSONC)
// ============================================================================

type ProxyConfig = {
	url: string
	apiKey: string
	prefix: string
}

async function loadConfig(): Promise<ProxyConfig | undefined> {
	const homedir = os.homedir()
	const projectConfigDir = process.env.OPENCODE_CONFIG_DIR || ".opencode"
	const globalConfigBase = process.env.XDG_CONFIG_HOME || `${homedir}/.config`
	const globalConfigDir = `${globalConfigBase}/opencode`

	const paths = [
		`${projectConfigDir}/cliproxy.jsonc`,
		`${projectConfigDir}/cliproxy.json`,
		".opencode/cliproxy.jsonc",
		".opencode/cliproxy.json",
		`${globalConfigDir}/cliproxy.jsonc`,
		`${globalConfigDir}/cliproxy.json`,
	]

	for (const configPath of paths) {
		const file = Bun.file(configPath)
		if (!(await file.exists())) continue

		// File exists - MUST be valid or we fail
		const text = await file.text()
		const json = text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")

		let raw: Record<string, unknown>
		try {
			raw = JSON.parse(json)
		} catch {
			throw new Error(`[cliproxy] Invalid JSONC syntax in: ${configPath}`)
		}

		const url = typeof raw.url === "string" ? raw.url : "http://localhost:8317"
		const apiKey = resolveCredential(raw.apiKey)
		const prefix = typeof raw.prefix === "string" ? raw.prefix : "cliproxy"

		if (url) {
			console.info(`[cliproxy] Loaded config from: ${configPath}`)
			return { url, apiKey, prefix } // apiKey can be empty for unsecured local proxies
		}

		console.warn(`[cliproxy] Config missing url: ${configPath}`)
	}

	return undefined
}

// ============================================================================
// Model Discovery
// ============================================================================

type ModelInfo = {
	id: string
	name?: string
	inputTokenLimit?: number
	outputTokenLimit?: number
	reasoning?: boolean
}

function categorize(id: string): "anthropic" | "google" | "openai" {
	if (id.includes("claude")) return "anthropic"
	if (id.startsWith("gemini-") && !id.includes("claude")) return "google"
	return "openai"
}

async function discoverModels(url: string, apiKey: string): Promise<ModelInfo[]> {
	try {
		const [v1betaResponse, v1Response] = await Promise.all([
			fetch(`${url}/v1beta/models`, {
				headers: { "x-api-key": apiKey },
				signal: AbortSignal.timeout(5000),
			}),
			fetch(`${url}/v1/models`, {
				headers: { "x-api-key": apiKey, "User-Agent": "claude-cli" },
				signal: AbortSignal.timeout(5000),
			}),
		])

		const v1betaData = v1betaResponse.ok
			? ((await v1betaResponse.json()) as {
					models?: {
						name?: string
						displayName?: string
						inputTokenLimit?: number
						outputTokenLimit?: number
					}[]
				})
			: { models: [] }
		const v1Data = v1Response.ok
			? ((await v1Response.json()) as {
					data?: { id?: string; display_name?: string; thinking?: boolean }[]
				})
			: { data: [] }

		const modelMap = new Map<string, ModelInfo>()

		for (const model of v1betaData.models || []) {
			if (!model.name) continue
			const id = model.name.replace("models/", "")
			modelMap.set(id, {
				id,
				name: model.displayName,
				inputTokenLimit: model.inputTokenLimit,
				outputTokenLimit: model.outputTokenLimit,
			})
		}

		for (const model of v1Data.data || []) {
			if (!model.id) continue
			const existing = modelMap.get(model.id) || { id: model.id }
			modelMap.set(model.id, {
				...existing,
				name: existing.name || model.display_name,
				reasoning: model.thinking,
			})
		}

		return Array.from(modelMap.values())
	} catch {
		console.warn("[cliproxy] Failed to discover models from proxy")
		return []
	}
}

// ============================================================================
// Main Plugin (Config Hook)
// ============================================================================

export const CliproxyPlugin: Plugin = async (_ctx) => {
	const config = await loadConfig()

	if (!config) {
		console.warn("[cliproxy] No valid config found. Create .opencode/cliproxy.jsonc")
		return {}
	}

	const models = await discoverModels(config.url, config.apiKey)
	console.info(`[cliproxy] Discovered ${models.length} models`)

	const hooks: Hooks = {
		config: async (cfg) => {
			cfg.provider = cfg.provider || {}
			const prefix = config.prefix

			const anthropicModels = models.filter((m) => categorize(m.id) === "anthropic")
			const googleModels = models.filter((m) => categorize(m.id) === "google")
			const openaiModels = models.filter((m) => categorize(m.id) === "openai")

			if (anthropicModels.length > 0) {
				cfg.provider[`${prefix}-anthropic`] = {
					id: `${prefix}-anthropic`,
					name: `${prefix} (Anthropic)`,
					api: "@ai-sdk/anthropic",
					options: {
						apiKey: config.apiKey,
						baseURL: `${config.url}/v1`,
						headers: { "x-api-key": config.apiKey },
					},
					models: Object.fromEntries(
						anthropicModels.map((m) => [
							m.id,
							{
								id: m.id,
								name: m.name || m.id,
								cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
								limit: { context: m.inputTokenLimit ?? 128000, output: m.outputTokenLimit ?? 8192 },
								reasoning: m.reasoning || false,
							},
						]),
					),
				}
			}

			if (googleModels.length > 0) {
				cfg.provider[`${prefix}-google`] = {
					id: `${prefix}-google`,
					name: `${prefix} (Google)`,
					api: "@ai-sdk/google",
					options: {
						apiKey: config.apiKey,
						baseURL: `${config.url}/v1beta`,
						headers: { "x-api-key": config.apiKey },
					},
					models: Object.fromEntries(
						googleModels.map((m) => [
							m.id,
							{
								id: m.id,
								name: m.name || m.id,
								cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
								limit: { context: m.inputTokenLimit ?? 128000, output: m.outputTokenLimit ?? 8192 },
								reasoning: m.reasoning || false,
							},
						]),
					),
				}
			}

			if (openaiModels.length > 0) {
				cfg.provider[`${prefix}-openai`] = {
					id: `${prefix}-openai`,
					name: `${prefix} (OpenAI)`,
					api: "@ai-sdk/openai-compatible",
					options: {
						apiKey: config.apiKey,
						baseURL: `${config.url}/v1`,
						headers: { "x-api-key": config.apiKey },
					},
					models: Object.fromEntries(
						openaiModels.map((m) => [
							m.id,
							{
								id: m.id,
								name: m.name || m.id,
								cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
								limit: { context: m.inputTokenLimit ?? 128000, output: m.outputTokenLimit ?? 8192 },
								reasoning: m.reasoning || false,
							},
						]),
					),
				}
			}
		},
	}

	return hooks
}

export default CliproxyPlugin
