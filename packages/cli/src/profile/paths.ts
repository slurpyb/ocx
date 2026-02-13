import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

// =============================================================================
// FILE NAME CONSTANTS
// =============================================================================

/** OCX configuration file name */
export const OCX_CONFIG_FILE = "ocx.jsonc"

/** OpenCode configuration file name */
export const OPENCODE_CONFIG_FILE = "opencode.jsonc"

/** Local config directory name */
export const LOCAL_CONFIG_DIR = ".opencode"

// =============================================================================
// PROFILE PATH HELPERS
// =============================================================================

/**
 * Get the global profiles directory path.
 * Respects XDG_CONFIG_HOME if set.
 * @returns Absolute path to ~/.config/opencode/profiles/
 */
export function getProfilesDir(): string {
	const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config")
	return path.join(base, "opencode", "profiles")
}

/**
 * Get the local profiles directory path (within project).
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns Absolute path to .opencode/profiles/
 */
export function getLocalProfilesDir(cwd = process.cwd()): string {
	const localConfigDir = findLocalConfigDir(cwd)
	if (localConfigDir) {
		return path.join(localConfigDir, "profiles")
	}
	return path.join(cwd, LOCAL_CONFIG_DIR, "profiles")
}

/**
 * Get a specific global profile's directory path.
 * @param name - Profile name
 * @returns Absolute path to the global profile directory
 */
export function getProfileDir(name: string): string {
	return path.join(getProfilesDir(), name)
}

/**
 * Get a specific local profile's directory path.
 * Used only for detecting local profile presence (guard in getLayered).
 * @param name - Profile name
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns Absolute path to the local profile directory
 */
export function getLocalProfileDir(name: string, cwd = process.cwd()): string {
	return path.join(getLocalProfilesDir(cwd), name)
}

/**
 * Get the path to a profile's ocx.jsonc file.
 * @param name - Profile name
 * @returns Absolute path to ocx.jsonc
 */
export function getProfileOcxConfig(name: string): string {
	return path.join(getProfileDir(name), "ocx.jsonc")
}

/**
 * Get the path to a profile's opencode.jsonc file.
 * @param name - Profile name
 * @returns Absolute path to opencode.jsonc
 */
export function getProfileOpencodeConfig(name: string): string {
	return path.join(getProfileDir(name), "opencode.jsonc")
}

/**
 * Get the path to a profile's AGENTS.md file.
 * @param name - Profile name
 * @returns Absolute path to AGENTS.md
 */
export function getProfileAgents(name: string): string {
	return path.join(getProfileDir(name), "AGENTS.md")
}

// =============================================================================
// LOCAL CONFIG DISCOVERY
// =============================================================================

/**
 * Find the local config directory by walking up from cwd.
 * Stops at first .opencode/ directory or git root.
 * @param cwd - Starting directory
 * @returns Path to .opencode/ directory, or null if not found
 */
export function findLocalConfigDir(cwd: string): string | null {
	let currentDir = cwd

	while (true) {
		// Check for .opencode/ directory at this level
		const configDir = path.join(currentDir, LOCAL_CONFIG_DIR)
		if (existsSync(configDir) && statSync(configDir).isDirectory()) {
			return configDir
		}

		// Check if we've hit the git root (.git directory)
		const gitDir = path.join(currentDir, ".git")
		if (existsSync(gitDir)) {
			// At git root, stop searching
			return null
		}

		// Move up one directory
		const parentDir = path.dirname(currentDir)
		if (parentDir === currentDir) {
			// Reached filesystem root
			return null
		}
		currentDir = parentDir
	}
}

// =============================================================================
// GLOBAL CONFIG HELPERS
// =============================================================================

/**
 * Get the global base ocx.jsonc path.
 * @returns Path to ~/.config/opencode/ocx.jsonc
 */
export function getGlobalConfig(): string {
	const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config")
	return path.join(base, "opencode", "ocx.jsonc")
}
