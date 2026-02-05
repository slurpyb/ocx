/**
 * Instruction Path Resolution Utilities
 *
 * Handles validation and resolution of registry-provided instruction paths.
 * Registry instruction paths are install-root-relative and resolved to absolute
 * paths at runtime before launching OpenCode.
 *
 * Follows the 5 Laws of Elegant Defense:
 * - Law 1 (Early Exit): Guard clauses validate paths upfront
 * - Law 2 (Parse Don't Validate): Paths validated at boundary, trusted internally
 * - Law 4 (Fail Fast): Invalid paths throw descriptive errors immediately
 * - Law 5 (Intentional Naming): Functions named to describe exact behavior
 */

import { existsSync } from "node:fs"
import * as path from "node:path"
import { Glob } from "bun"
import { ValidationError } from "./errors"

/**
 * Check if a path is a URL (http/https).
 * URLs are allowed and passed through without resolution.
 */
export function isUrl(path: string): boolean {
	return path.startsWith("http://") || path.startsWith("https://")
}

/**
 * Validate a registry instruction path.
 * Registry paths must be:
 * - Relative (not absolute)
 * - No parent directory traversal (..)
 * - URLs (http/https) are allowed
 *
 * @param rawPath - The path to validate
 * @param source - Source description for error messages (e.g., "registry component kdco/foo")
 * @throws ValidationError if path is invalid
 */
export function validateRegistryInstructionPath(rawPath: string, source: string): void {
	// Early exit: URLs are always valid
	if (isUrl(rawPath)) {
		return
	}

	// Fail fast: No absolute paths in registry instructions (check both POSIX and Windows)
	if (path.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath)) {
		throw new ValidationError(
			`Absolute path not allowed in registry instructions: "${rawPath}" (from ${source})`,
		)
	}

	// Fail fast: No home directory paths
	if (rawPath.startsWith("~")) {
		throw new ValidationError(
			`Home directory path not allowed in registry instructions: "${rawPath}" (from ${source})`,
		)
	}

	// Fail fast: No parent directory traversal
	// Check BEFORE normalization by splitting on both / and \
	const segments = rawPath.split(/[/\\]/)
	if (segments.some((segment) => segment === "..")) {
		throw new ValidationError(
			`Path traversal (..) not allowed in registry instructions: "${rawPath}" (from ${source})`,
		)
	}
}

/**
 * Resolve a single registry instruction path to absolute.
 * - URLs are passed through unchanged
 * - Glob patterns are expanded and resolved
 * - Simple paths are resolved relative to install root
 *
 * @param instructionPath - The install-root-relative path or URL
 * @param installRoot - The install root directory (absolute)
 * @param source - Source description for error messages
 * @returns Array of absolute paths (multiple if glob expands)
 * @throws ValidationError if path is invalid or doesn't exist
 */
export function resolveRegistryInstructionPath(
	instructionPath: string,
	installRoot: string,
	source: string,
): string[] {
	// Early exit: URLs pass through unchanged
	if (isUrl(instructionPath)) {
		return [instructionPath]
	}

	// Validate path at boundary (Law 2: Parse Don't Validate)
	validateRegistryInstructionPath(instructionPath, source)

	// Check if path contains glob patterns
	const hasGlobPattern =
		instructionPath.includes("*") || instructionPath.includes("?") || instructionPath.includes("[")

	if (hasGlobPattern) {
		// Expand glob relative to install root
		const glob = new Glob(instructionPath)
		const matches: string[] = []

		// Scan install root for matches
		for (const entry of glob.scanSync(installRoot)) {
			const absolutePath = path.join(installRoot, entry)
			matches.push(absolutePath)
		}

		return matches // May be empty - caller can decide if that's an error
	}

	// Simple path - resolve to absolute
	const absolutePath = path.join(installRoot, instructionPath)

	// Fail fast: Path must exist (Law 4: Fail Fast, Fail Loud)
	if (!existsSync(absolutePath)) {
		throw new ValidationError(
			`Registry instruction file not found: "${instructionPath}" (from ${source})\n` +
				`Expected at: ${absolutePath}`,
		)
	}

	return [absolutePath]
}

/**
 * Resolve all registry instruction paths to absolute paths.
 * - Validates each path
 * - Expands globs
 * - Deduplicates results
 * - Preserves order (first occurrence wins)
 *
 * @param paths - Array of install-root-relative paths or URLs
 * @param installRoot - The install root directory (absolute)
 * @param source - Source description for error messages
 * @returns Deduplicated array of absolute paths
 * @throws ValidationError if any path is invalid or doesn't exist
 */
export function resolveRegistryInstructionPaths(
	paths: string[],
	installRoot: string,
	source: string,
): string[] {
	const resolved: string[] = []
	const seen = new Set<string>()

	for (const instructionPath of paths) {
		const expandedPaths = resolveRegistryInstructionPath(instructionPath, installRoot, source)

		for (const absolutePath of expandedPaths) {
			// Deduplicate - first occurrence wins
			if (!seen.has(absolutePath)) {
				seen.add(absolutePath)
				resolved.push(absolutePath)
			}
		}
	}

	return resolved
}
