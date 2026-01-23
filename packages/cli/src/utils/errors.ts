/**
 * Custom error classes with error codes
 * Following fail-fast philosophy - clear, actionable errors
 */

export type ErrorCode =
	| "NOT_FOUND"
	| "NETWORK_ERROR"
	| "CONFIG_ERROR"
	| "VALIDATION_ERROR"
	| "CONFLICT"
	| "PERMISSION_ERROR"
	| "INTEGRITY_ERROR"
	| "UPDATE_ERROR"

export const EXIT_CODES = {
	SUCCESS: 0,
	GENERAL: 1,
	NOT_FOUND: 66,
	NETWORK: 69,
	CONFIG: 78,
	INTEGRITY: 1, // Exit code for integrity failures
} as const

export class OCXError extends Error {
	constructor(
		message: string,
		public readonly code: ErrorCode,
		public readonly exitCode: number = EXIT_CODES.GENERAL,
	) {
		super(message)
		this.name = "OCXError"
	}
}

export class NotFoundError extends OCXError {
	constructor(message: string) {
		super(message, "NOT_FOUND", EXIT_CODES.NOT_FOUND)
		this.name = "NotFoundError"
	}
}

export class NetworkError extends OCXError {
	constructor(message: string) {
		super(message, "NETWORK_ERROR", EXIT_CODES.NETWORK)
		this.name = "NetworkError"
	}
}

export class ConfigError extends OCXError {
	constructor(message: string) {
		super(message, "CONFIG_ERROR", EXIT_CODES.CONFIG)
		this.name = "ConfigError"
	}
}

export class ValidationError extends OCXError {
	constructor(message: string) {
		super(message, "VALIDATION_ERROR", EXIT_CODES.GENERAL)
		this.name = "ValidationError"
	}
}

export class ConflictError extends OCXError {
	constructor(message: string) {
		super(message, "CONFLICT", EXIT_CODES.GENERAL)
		this.name = "ConflictError"
	}
}

export class IntegrityError extends OCXError {
	constructor(component: string, expected: string, found: string) {
		const message =
			`Integrity verification failed for "${component}"\n` +
			`  Expected: ${expected}\n` +
			`  Found:    ${found}\n\n` +
			`The registry content has changed since this component was locked.\n` +
			`Use 'ocx update ${component}' to intentionally update this component.`
		super(message, "INTEGRITY_ERROR", EXIT_CODES.INTEGRITY)
		this.name = "IntegrityError"
	}
}

export class SelfUpdateError extends OCXError {
	constructor(message: string) {
		super(message, "UPDATE_ERROR", EXIT_CODES.GENERAL)
		this.name = "SelfUpdateError"
	}
}

export class OcxConfigError extends OCXError {
	constructor(message: string) {
		super(message, "CONFIG_ERROR", EXIT_CODES.CONFIG)
		this.name = "OcxConfigError"
	}
}

// =============================================================================
// PROFILE ERRORS
// =============================================================================

export class ProfileNotFoundError extends OCXError {
	constructor(name: string) {
		super(`Profile "${name}" not found`, "NOT_FOUND", EXIT_CODES.NOT_FOUND)
		this.name = "ProfileNotFoundError"
	}
}

export class ProfileExistsError extends OCXError {
	constructor(name: string) {
		super(`Profile "${name}" already exists`, "CONFLICT", EXIT_CODES.GENERAL)
		this.name = "ProfileExistsError"
	}
}

export class InvalidProfileNameError extends OCXError {
	constructor(name: string, reason: string) {
		super(`Invalid profile name "${name}": ${reason}`, "VALIDATION_ERROR", EXIT_CODES.GENERAL)
		this.name = "InvalidProfileNameError"
	}
}

export class ProfilesNotInitializedError extends OCXError {
	constructor() {
		super(
			"Profiles not initialized. Run 'ocx init --global' first.",
			"NOT_FOUND",
			EXIT_CODES.NOT_FOUND,
		)
		this.name = "ProfilesNotInitializedError"
	}
}
