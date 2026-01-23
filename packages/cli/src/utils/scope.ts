/**
 * Scope Resolution Utilities
 *
 * Determines the target directory for config operations based on CLI flags.
 * Enforces mutual exclusivity between --global, --profile, and explicit --cwd.
 */

import path from "node:path"
import { getProfileDir } from "../profile/paths"
import { profileNameSchema } from "../profile/schema"
import { ConfigError, ValidationError } from "./errors"
import { getGlobalConfigPath } from "./paths"

// =============================================================================
// TYPES
// =============================================================================

export interface ScopeOptions {
	/** Target global config directory */
	global?: boolean
	/** Target a specific profile */
	profile?: string
	/** Working directory (may be explicit or defaulted) */
	cwd?: string
}

export interface ResolveTargetScopeOptions extends ScopeOptions {
	/** Whether --cwd was explicitly provided by the user */
	isCwdExplicit?: boolean
}

// =============================================================================
// SCOPE RESOLUTION
// =============================================================================

/**
 * Resolves the target directory path based on CLI flags.
 *
 * Enforces mutual exclusivity:
 * - --global and --profile cannot be used together
 * - --global and explicit --cwd cannot be used together
 * - --profile and explicit --cwd cannot be used together
 *
 * @param options - CLI options containing global, profile, and cwd flags
 * @returns Absolute path to the target directory
 * @throws ConfigError if mutually exclusive options are provided
 * @throws ValidationError if profile name is invalid
 */
export function resolveTargetScope(options: ResolveTargetScopeOptions): string {
	const { global: isGlobal, profile, isCwdExplicit } = options

	// Guard: Check mutual exclusivity between --global and --profile
	if (isGlobal && profile) {
		throw new ConfigError("Cannot use --global and --profile together")
	}

	// Guard: Check mutual exclusivity between --global and explicit --cwd
	if (isGlobal && isCwdExplicit) {
		throw new ConfigError("Cannot use --global and --cwd together")
	}

	// Guard: Check mutual exclusivity between --profile and explicit --cwd
	if (profile && isCwdExplicit) {
		throw new ConfigError("Cannot use --profile and --cwd together")
	}

	// Handle --global flag
	if (isGlobal) {
		return getGlobalConfigPath()
	}

	// Handle --profile flag with validation
	if (profile) {
		const parseResult = profileNameSchema.safeParse(profile)
		if (!parseResult.success) {
			const firstError = parseResult.error.errors[0]
			throw new ValidationError(`Invalid profile name "${profile}": ${firstError?.message}`)
		}
		return getProfileDir(profile)
	}

	// Default: use cwd (explicit or process.cwd)
	return path.resolve(options.cwd || process.cwd())
}
