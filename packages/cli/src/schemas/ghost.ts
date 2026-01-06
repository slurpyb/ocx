/**
 * Ghost Mode Config Schema
 *
 * Schema for ghost.jsonc - the global OCX configuration file
 * stored at ~/.config/ocx/ghost.jsonc (XDG-compliant).
 *
 * Ghost mode allows OCX to work without project-local config files
 * by storing registries globally.
 */

import { z } from "zod"
import { safeRelativePathSchema } from "./common.js"
import { registryConfigSchema } from "./config.js"

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
})

export type GhostConfig = z.infer<typeof ghostConfigSchema>
