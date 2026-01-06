/**
 * ConfigProvider Interface
 *
 * Abstract configuration provider pattern following the 5 Laws of Elegant Defense:
 * - Parse at boundary (async factory), sync getters (trusted internal state)
 * - Early exit via guard clauses in factories
 * - Fail fast with descriptive errors
 *
 * Implementations parse config at construction; getters are sync and pure.
 */

import { getGhostConfigDir, loadGhostConfig } from "../ghost/config.js"
import type { OcxConfig, RegistryConfig } from "../schemas/config.js"
import { readOcxConfig } from "../schemas/config.js"
import type { GhostConfig } from "../schemas/ghost.js"
import { ConfigError } from "../utils/errors.js"

// =============================================================================
// INTERFACE
// =============================================================================

/**
 * Abstract configuration provider interface.
 * Implementations parse config at construction (boundary), getters are sync and pure.
 */
export interface ConfigProvider {
	/** Working directory for this config context */
	readonly cwd: string

	/** Get registries (sync - data already parsed at construction) */
	getRegistries(): Record<string, RegistryConfig>

	/** Get component installation path */
	getComponentPath(): string
}

// =============================================================================
// LOCAL CONFIG PROVIDER
// =============================================================================

/**
 * Provides configuration from local project (ocx.jsonc).
 *
 * Use this when operating on a project with an ocx.jsonc file.
 */
export class LocalConfigProvider implements ConfigProvider {
	readonly cwd: string
	private readonly config: OcxConfig // immutable, parsed at construction

	private constructor(cwd: string, config: OcxConfig) {
		this.cwd = cwd
		this.config = config
	}

	/**
	 * Static factory - parses config at boundary, throws on invalid.
	 * @throws ConfigError if ocx.jsonc doesn't exist or is invalid
	 */
	static async create(cwd: string): Promise<LocalConfigProvider> {
		const config = await readOcxConfig(cwd)

		// Guard: No config file (Law 1: Early Exit)
		if (!config) {
			throw new ConfigError("No ocx.jsonc found. Run 'ocx init' first.")
		}

		return new LocalConfigProvider(cwd, config)
	}

	getRegistries(): Record<string, RegistryConfig> {
		return this.config.registries
	}

	getComponentPath(): string {
		// Default to .opencode directory for local projects
		return ".opencode"
	}

	/** Get the raw config for advanced use cases */
	getConfig(): OcxConfig {
		return this.config
	}
}

// =============================================================================
// GHOST CONFIG PROVIDER
// =============================================================================

/**
 * Provides configuration from ghost mode (~/.config/ocx/ghost.jsonc).
 *
 * Use this when operating in ghost mode (no local project config).
 */
export class GhostConfigProvider implements ConfigProvider {
	readonly cwd: string
	private readonly config: GhostConfig // immutable, parsed at construction

	private constructor(cwd: string, config: GhostConfig) {
		this.cwd = cwd
		this.config = config
	}

	/**
	 * Static factory - parses at boundary, throws GhostNotInitializedError if missing.
	 *
	 * Note: The _cwd parameter is kept for API compatibility but ignored.
	 * Ghost mode always uses the ghost config directory as its working directory.
	 *
	 * @throws GhostNotInitializedError if ghost config doesn't exist
	 * @throws GhostConfigError if ghost config is invalid
	 */
	static async create(_cwd: string): Promise<GhostConfigProvider> {
		const config = await loadGhostConfig()
		return new GhostConfigProvider(getGhostConfigDir(), config)
	}

	getRegistries(): Record<string, RegistryConfig> {
		return this.config.registries
	}

	getComponentPath(): string {
		return this.config.componentPath ?? ".opencode"
	}

	/** Get the raw config for advanced use cases */
	getConfig(): GhostConfig {
		return this.config
	}
}
