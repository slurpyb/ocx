/**
 * Config Token Resolution
 *
 * Temporary workaround for OpenCode's inline config token-resolution gap.
 * OpenCode does NOT resolve {env:...} / {file:...} tokens when config is
 * passed via OPENCODE_CONFIG_CONTENT (only in file-based load paths).
 *
 * This shim pre-resolves tokens before passing config content to OpenCode.
 *
 * TODO: Remove once upstream OpenCode resolves tokens in OPENCODE_CONFIG_CONTENT.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { ConfigError } from "./errors"

// =============================================================================
// ENV TOKEN RESOLUTION
// =============================================================================

/**
 * Replace all `{env:VAR_NAME}` tokens with their environment variable values.
 * Missing variables resolve to empty string.
 *
 * @param text - Raw config text containing `{env:...}` tokens
 * @param env - Environment variable source (defaults to process.env)
 * @returns Text with all env tokens replaced
 */
export function resolveEnvVars(
	text: string,
	env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string {
	return text.replace(/\{env:([^}]+)\}/g, (_match, varName: string) => {
		const value = env[varName] ?? ""
		// JSON-escape the value so quotes, backslashes, and newlines don't break JSON strings
		return JSON.stringify(value).slice(1, -1)
	})
}

// =============================================================================
// FILE TOKEN RESOLUTION
// =============================================================================

/**
 * Replace all `{file:path}` tokens with file contents.
 *
 * Path resolution:
 * - `~/` expands to user home directory
 * - Absolute paths are used as-is
 * - Relative paths resolve from configDir
 *
 * File contents are trimmed and JSON-escaped for safe insertion into
 * JSON string values.
 *
 * @param text - Raw config text containing `{file:...}` tokens
 * @param configDir - Base directory for resolving relative paths
 * @returns Text with all file tokens replaced with escaped file contents (single-pass, no re-substitution)
 * @throws ConfigError if a referenced file cannot be read
 */
export function resolveFilePatterns(text: string, configDir: string): string {
	const filePattern = /\{file:([^}]+)\}/g

	// Early exit: no file tokens to resolve
	if (!filePattern.test(text)) return text

	// Precompute a cache of rawPath → escaped content so each file is read once
	const escapedContentByPath = new Map<string, string>()

	// Reset lastIndex after .test() consumed the regex state
	filePattern.lastIndex = 0

	// Single-pass regex replace: the callback handles every match atomically,
	// so injected content can never be re-interpreted as a token
	return text.replace(filePattern, (fullMatch, rawPath: string) => {
		if (!rawPath) return fullMatch

		const cached = escapedContentByPath.get(rawPath)
		if (cached !== undefined) return cached

		const resolvedPath = resolveFilePath(rawPath, configDir)
		const fileContent = readConfigFile(resolvedPath, rawPath)
		// JSON-escape file content for safe insertion into JSON string values
		const escaped = JSON.stringify(fileContent.trim()).slice(1, -1)
		escapedContentByPath.set(rawPath, escaped)
		return escaped
	})
}

/**
 * Resolve a file path token to an absolute path.
 * Handles home directory expansion and relative path resolution.
 */
function resolveFilePath(rawPath: string, configDir: string): string {
	// Home directory expansion
	if (rawPath.startsWith("~/")) {
		return join(homedir(), rawPath.slice(2))
	}

	// Absolute paths used as-is
	if (isAbsolute(rawPath)) {
		return rawPath
	}

	// Relative paths resolve from configDir
	return resolve(configDir, rawPath)
}

/**
 * Read a file referenced by a config token.
 * Fails fast with a descriptive ConfigError if the file cannot be read.
 */
function readConfigFile(absolutePath: string, originalToken: string): string {
	try {
		return readFileSync(absolutePath, "utf8")
	} catch (error) {
		const reason = error instanceof Error ? error.message : "Unknown read error"
		throw new ConfigError(
			`Failed to resolve config file token {file:${originalToken}}: ${reason}\n` +
				`  Resolved path: ${absolutePath}`,
		)
	}
}

// =============================================================================
// COMBINED RESOLUTION
// =============================================================================

/**
 * Resolve all config tokens in text: env vars first, then file patterns.
 *
 * Order matters: env vars are resolved first so that file paths can contain
 * environment variable references (e.g., `{file:{env:MY_DIR}/keys.json}`
 * is NOT supported - env tokens in file paths would require a second pass).
 *
 * @param text - Raw config text with `{env:...}` and `{file:...}` tokens
 * @param configDir - Base directory for resolving relative file paths
 * @param env - Environment variable source (defaults to process.env)
 * @returns Text with all tokens resolved
 */
export function resolveConfigPatterns(
	text: string,
	configDir: string,
	env?: Record<string, string | undefined>,
): string {
	const envResolved = resolveEnvVars(text, env)
	return resolveFilePatterns(envResolved, configDir)
}
