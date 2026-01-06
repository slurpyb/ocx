/**
 * Ghost Mode Config Loader
 *
 * Handles loading, saving, and managing the global ghost configuration
 * stored at ~/.config/ocx/ghost.jsonc (XDG-compliant path).
 */

import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import path, { dirname, join } from "node:path"
import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import type { output, ZodError, ZodTypeAny } from "zod"
import type { GhostConfig } from "../schemas/ghost.js"
import { ghostConfigSchema } from "../schemas/ghost.js"
import { GhostConfigError, GhostNotInitializedError } from "../utils/errors.js"
import { isAbsolutePath } from "../utils/path-helpers.js"

// =============================================================================
// CONSTANTS
// =============================================================================

const CONFIG_DIR_NAME = "ocx"
const CONFIG_FILE_NAME = "ghost.jsonc"

// =============================================================================
// JSONC PARSING HELPERS
// =============================================================================

/**
 * Format a Zod validation error into actionable, human-readable messages.
 *
 * @param error - The Zod error to format
 * @returns Formatted error string with indented issues
 */
function formatZodError(error: ZodError): string {
	return error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n")
}

/**
 * Parse raw JSONC content with proper error handling.
 *
 * Use this when you need to parse JSONC without schema validation.
 * For schema-validated parsing, use parseJsoncFile instead.
 *
 * @param filePath - Path to the file (for error messages)
 * @param content - Raw file content to parse
 * @returns Parsed JSON value
 * @throws GhostConfigError on syntax errors
 */
function parseRawJsonc(filePath: string, content: string): unknown {
	const errors: ParseError[] = []
	const raw = parseJsonc(content, errors, { allowTrailingComma: true })

	// Guard: Fail fast on JSONC syntax errors with precise location (Law 1 + 4)
	const firstError = errors[0]
	if (firstError) {
		throw new GhostConfigError(
			`Invalid JSON in ${filePath}:\n  Offset ${firstError.offset}: ${printParseErrorCode(firstError.error)}`,
		)
	}

	return raw
}

/**
 * Parse a JSONC file and validate against a Zod schema.
 *
 * Uses the 5 Laws of Elegant Defense:
 * - Early Exit: Fails immediately on syntax errors
 * - Parse Don't Validate: Returns trusted, typed data
 * - Fail Fast: Provides actionable error messages with location info
 *
 * @param filePath - Path to the file (for error messages)
 * @param content - Raw file content to parse
 * @param schema - Zod schema to validate against
 * @returns Parsed and validated data of type T
 * @throws GhostConfigError on syntax errors or validation failures
 */
function parseJsoncFile<T extends ZodTypeAny>(
	filePath: string,
	content: string,
	schema: T,
): output<T> {
	const raw = parseRawJsonc(filePath, content)

	// Parse don't validate: schema transforms to trusted type (Law 2)
	const result = schema.safeParse(raw)
	if (!result.success) {
		throw new GhostConfigError(`Invalid config in ${filePath}:\n${formatZodError(result.error)}`)
	}

	return result.data
}

// =============================================================================
// PATH HELPERS
// =============================================================================

/**
 * Get the ghost config directory path (XDG-compliant).
 *
 * Per XDG Base Directory Specification, if XDG_CONFIG_HOME is set but invalid
 * (e.g., relative path), it should be treated as unset and fall back to ~/.config.
 * This matches behavior of directories-rs, xdg-base-dirs, and fish shell.
 *
 * @see https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
 */
export function getGhostConfigDir(): string {
	const xdgConfigHome = process.env.XDG_CONFIG_HOME

	// XDG spec: only use if set AND absolute path (relative paths are invalid per spec)
	if (xdgConfigHome && isAbsolutePath(xdgConfigHome)) {
		return path.join(xdgConfigHome, CONFIG_DIR_NAME)
	}

	// Fall back to ~/.config/ocx
	return path.join(homedir(), ".config", CONFIG_DIR_NAME)
}

/**
 * Get the full path to the ghost config file.
 *
 * Returns ~/.config/ocx/ghost.jsonc or $XDG_CONFIG_HOME/ocx/ghost.jsonc
 */
export function getGhostConfigPath(): string {
	return join(getGhostConfigDir(), CONFIG_FILE_NAME)
}

// =============================================================================
// CONFIG OPERATIONS
// =============================================================================

/**
 * Check if ghost mode is initialized (config file exists).
 */
export async function ghostConfigExists(): Promise<boolean> {
	const configPath = getGhostConfigPath()
	const file = Bun.file(configPath)
	return file.exists()
}

/**
 * Load the ghost config from disk.
 *
 * @throws GhostNotInitializedError if config file doesn't exist
 * @throws GhostConfigError if config file is invalid (syntax or schema)
 */
export async function loadGhostConfig(): Promise<GhostConfig> {
	const configPath = getGhostConfigPath()
	const file = Bun.file(configPath)

	// Guard: Check if file exists (Law 1: Early Exit)
	if (!(await file.exists())) {
		throw new GhostNotInitializedError()
	}

	const content = await file.text()

	// Parse and validate in one step (Law 2: Parse Don't Validate)
	return parseJsoncFile(configPath, content, ghostConfigSchema)
}

/**
 * Save the ghost config to disk.
 *
 * Creates the config directory if it doesn't exist.
 * Writes as plain JSON (not JSONC) since we're generating the file.
 */
export async function saveGhostConfig(config: GhostConfig): Promise<void> {
	const configPath = getGhostConfigPath()
	const configDir = dirname(configPath)

	// Ensure config directory exists (recursive is idempotent)
	await mkdir(configDir, { recursive: true })

	// Validate before saving (Law 4: Fail Fast)
	const result = ghostConfigSchema.safeParse(config)
	if (!result.success) {
		throw new GhostConfigError(`Invalid config:\n${formatZodError(result.error)}`)
	}

	const content = JSON.stringify(result.data, null, 2)
	await Bun.write(configPath, content)
}

// =============================================================================
// OPENCODE CONFIG (opencode.jsonc)
// =============================================================================

const OPENCODE_CONFIG_FILE_NAME = "opencode.jsonc"

/**
 * Get the path to the ghost opencode.jsonc file
 */
export function getGhostOpencodeConfigPath(): string {
	return join(getGhostConfigDir(), OPENCODE_CONFIG_FILE_NAME)
}

/**
 * Load the OpenCode config from the ghost config directory.
 * This is the opencode.jsonc file generated by `ghost add`.
 *
 * Uses atomic read pattern to avoid TOCTOU race condition:
 * Instead of exists() then read(), we attempt the read and handle ENOENT.
 *
 * @returns The parsed config object, or empty object if file doesn't exist
 * @throws GhostConfigError if config file has invalid JSON syntax
 */
export async function loadGhostOpencodeConfig(): Promise<Record<string, unknown>> {
	const configPath = getGhostOpencodeConfigPath()

	try {
		const content = await Bun.file(configPath).text()
		return parseRawJsonc(configPath, content) as Record<string, unknown>
	} catch (err) {
		// File doesn't exist - return empty config (Law 1: Early Exit)
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return {}
		}
		// Re-throw other errors (Law 4: Fail Fast)
		throw err
	}
}
