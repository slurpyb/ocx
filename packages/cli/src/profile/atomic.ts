import { rename, symlink, unlink } from "node:fs/promises"

/**
 * Atomically write data to a file using temp file + rename pattern.
 * Uses PID in temp filename for concurrent write safety.
 * File is created with 0o600 permissions.
 *
 * Based on CCS profile-registry.ts pattern.
 *
 * @param filePath - Target file path
 * @param data - Data to write (will be JSON stringified)
 */
export async function atomicWrite(filePath: string, data: unknown): Promise<void> {
	const tempPath = `${filePath}.tmp.${process.pid}`
	try {
		await Bun.write(tempPath, JSON.stringify(data, null, "\t"), { mode: 0o600 })
		await rename(tempPath, filePath)
	} catch (error) {
		// Cleanup temp file on failure
		try {
			await unlink(tempPath)
		} catch {
			// Ignore cleanup errors
		}
		throw error
	}
}

/**
 * Atomically copy file bytes from source to target.
 * Uses temp file + rename pattern so readers never observe partial writes.
 * Target file is created with 0o600 permissions.
 *
 * @param sourcePath - Source file path
 * @param targetPath - Target file path
 */
export async function atomicCopy(sourcePath: string, targetPath: string): Promise<void> {
	const tempPath = `${targetPath}.tmp.${process.pid}`
	try {
		const sourceFile = Bun.file(sourcePath)
		const sourceBytes = await sourceFile.arrayBuffer()
		await Bun.write(tempPath, sourceBytes, { mode: 0o600 })
		await rename(tempPath, targetPath)
	} catch (error) {
		// Cleanup temp file on failure
		try {
			await unlink(tempPath)
		} catch {
			// Ignore cleanup errors
		}
		throw error
	}
}

/**
 * Atomically swap a symlink to point to a new target.
 * Uses temp symlink + rename pattern (POSIX atomic).
 *
 * @param target - New symlink target (relative or absolute path)
 * @param linkPath - Path where symlink should exist
 */
export async function atomicSymlink(target: string, linkPath: string): Promise<void> {
	const tempLink = `${linkPath}.tmp.${process.pid}`
	try {
		await symlink(target, tempLink)
		await rename(tempLink, linkPath)
	} catch (error) {
		// Cleanup temp symlink on failure
		try {
			await unlink(tempLink)
		} catch {
			// Ignore cleanup errors
		}
		throw error
	}
}
