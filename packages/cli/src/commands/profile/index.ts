/**
 * Profile Command Group
 *
 * Parent command for managing profiles (local and global).
 * Profiles allow multiple named configurations for different contexts.
 * - Local profiles: .opencode/profiles/ (project-specific)
 * - Global profiles: ~/.config/opencode/profiles/ (user-wide)
 *
 * Alias: `ocx p` (shorthand for `ocx profile`)
 */

import type { Command } from "commander"
import { registerProfileAddCommand } from "./add"
import { registerProfileListCommand } from "./list"
import { registerProfileMoveCommand } from "./move"
import { registerProfileRemoveCommand } from "./remove"
import { registerProfileShowCommand } from "./show"

/**
 * Register the profile command and all subcommands.
 */
export function registerProfileCommand(program: Command): void {
	const profile = program
		.command("profile")
		.alias("p")
		.description("Manage profiles (local and global)")

	registerProfileListCommand(profile)
	registerProfileAddCommand(profile)
	registerProfileRemoveCommand(profile)
	registerProfileMoveCommand(profile)
	registerProfileShowCommand(profile)
}
