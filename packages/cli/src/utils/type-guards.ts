/**
 * Type guard to check if a value is a plain object.
 * Returns true only for plain objects (not arrays, not null, not primitives).
 *
 * @param value - Value to check
 * @returns true if value is a plain object
 *
 * @example
 * isPlainObject({}) // true
 * isPlainObject([]) // false
 * isPlainObject(null) // false
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	)
}
