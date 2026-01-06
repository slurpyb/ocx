/**
 * Path Helper Utilities
 *
 * Cross-platform path utilities for consistent behavior across
 * macOS, Linux, and Windows.
 */

import path from "node:path"

/**
 * Cross-platform check for absolute paths.
 *
 * Uses both posix and win32 checks because path.isAbsolute() is platform-specific:
 * - On macOS/Linux: path.isAbsolute('\\\\server\\share') returns FALSE
 * - On Windows: returns TRUE
 *
 * By using path.win32.isAbsolute(), we can detect Windows paths on any platform.
 *
 * @see https://github.com/vitejs/vite (uses this pattern)
 */
export function isAbsolutePath(p: string): boolean {
	return path.posix.isAbsolute(p) || path.win32.isAbsolute(p)
}
