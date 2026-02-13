/**
 * Profile Command Group
 *
 * Parent command for managing global profiles.
 * Profiles allow multiple named configurations for different contexts.
 * Global profiles: ~/.config/opencode/profiles/ (user-wide)
 * Local profiles are unsupported and produce a hard error.
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
	const profile = program.command("profile").alias("p").description("Manage profiles (global only)")

	registerProfileListCommand(profile)
	registerProfileAddCommand(profile)
	registerProfileRemoveCommand(profile)
	registerProfileMoveCommand(profile)
	registerProfileShowCommand(profile)
}
