/**
 * Ghost Mode Config Schema
 *
 * Schema for ghost.jsonc - the global OCX configuration file
 * stored at ~/.config/ocx/ghost.jsonc (XDG-compliant).
 *
 * Ghost mode allows OCX to work without project-local config files
 * by storing registries globally.
 */

import { Glob } from "bun"
import { z } from "zod"
import { safeRelativePathSchema } from "./common.js"
import { registryConfigSchema } from "./config.js"

// =============================================================================
// GLOB PATTERN SCHEMA
// =============================================================================

/**
 * Valid glob pattern - validated at parse boundary (Law 2).
 * Uses Bun's Glob constructor as the authoritative parser.
 */
const globPatternSchema = z
	.string()
	.min(1, "Pattern cannot be empty")
	.refine((val) => !val.includes("\0"), "Pattern cannot contain null bytes")
	.refine((val) => val.trim() === val, "Pattern cannot have leading/trailing whitespace")
	.refine(
		(val) => {
			try {
				new Glob(val)
				return true
			} catch {
				return false
			}
		},
		(val) => ({ message: `Invalid glob pattern: "${val}"` }),
	)

// =============================================================================
// GHOST CONFIG SCHEMA (ghost.jsonc)
// =============================================================================

/**
 * Ghost mode configuration schema
 *
 * Contains OCX-specific settings (registries, componentPath).
 * OpenCode configuration is stored separately in opencode.jsonc.
 */
export const ghostConfigSchema = z.object({
	/** Schema URL for IDE support */
	$schema: z.string().optional(),

	/**
	 * Configured registries for ghost mode
	 * Same format as ocx.jsonc registries
	 */
	registries: z.record(registryConfigSchema).default({}),

	/**
	 * Optional default component path for installations
	 * If not set, uses the standard .opencode directory
	 * Uses safeRelativePathSchema to prevent path traversal attacks
	 */
	componentPath: safeRelativePathSchema.optional(),

	/**
	 * Glob patterns for OpenCode project files to include in ghost mode.
	 * By default, all OpenCode files (AGENTS.md, .opencode/, etc.) are excluded
	 * from the symlink farm. Patterns here specify which to include back.
	 *
	 * Example: `["AGENTS.md", ".opencode/skills/**"]`
	 */
	include: z.array(globPatternSchema).optional(),

	/**
	 * Glob patterns to exclude from include results.
	 * Use this to create exceptions to include patterns.
	 *
	 * Example: `["vendor/**", "node_modules/**"]`
	 */
	exclude: z.array(globPatternSchema).optional(),
})

export type GhostConfig = z.infer<typeof ghostConfigSchema>
