import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

/**
 * Returns the global OpenCode config directory path.
 * Uses XDG_CONFIG_HOME if set and absolute, otherwise ~/.config/opencode
 */
export function getGlobalConfigPath(): string {
	const xdg = process.env.XDG_CONFIG_HOME
	const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config")
	return join(base, "opencode")
}

/**
 * Checks if the global OpenCode config directory exists.
 * Returns true if ~/.config/opencode/ (or XDG equivalent) is a directory.
 */
export async function globalDirectoryExists(): Promise<boolean> {
	try {
		const info = await stat(getGlobalConfigPath())
		return info.isDirectory()
	} catch {
		return false
	}
}

/**
 * V2: Resolves a component target path for install location.
 * Targets in registry are root-relative (e.g., "plugins/foo.ts").
 * V2 always uses root-relative paths - NO .opencode/ prefix.
 *
 * @param target - Root-relative target path from registry (e.g., "plugins/foo.ts")
 * @param _isFlattened - Kept for backward compatibility but ignored in V2
 * @returns The install path: "plugins/foo.ts" (always root-relative)
 */
export function resolveTargetPath(target: string, _isFlattened: boolean): string {
	// V2: Always use root-relative paths
	return target
}
