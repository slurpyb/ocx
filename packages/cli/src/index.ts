#!/usr/bin/env bun
/**
 * OCX CLI - OpenCode Extensions
 *
 * A ShadCN-style CLI for installing agents, skills, plugins, and commands
 * into OpenCode projects.
 */

import { Command } from "commander"
import { registerAddCommand } from "./commands/add.js"
import { registerBuildCommand } from "./commands/build.js"
import { registerDiffCommand } from "./commands/diff.js"
import { registerGhostCommand } from "./commands/ghost/index.js"
import { registerInitCommand } from "./commands/init.js"
import { registerRegistryCommand } from "./commands/registry.js"
import { registerSearchCommand } from "./commands/search.js"
import { registerUpdateCommand } from "./commands/update.js"
import { handleError } from "./utils/index.js"

// Version injected at build time
declare const __VERSION__: string
const version = typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev"

async function main() {
	const program = new Command()
		.name("ocx")
		.description("OpenCode Extensions - Install agents, skills, plugins, and commands")
		.version(version)

	// Register all commands using the registration pattern
	registerInitCommand(program)
	registerAddCommand(program)
	registerUpdateCommand(program)
	registerDiffCommand(program)
	registerSearchCommand(program)
	registerRegistryCommand(program)
	registerBuildCommand(program)
	registerGhostCommand(program)

	// Parse and handle errors
	await program.parseAsync(process.argv)
}

// Only run CLI when executed directly, not when imported as a library
if (import.meta.main) {
	main().catch((err) => {
		handleError(err)
	})
}

// Library exports - for programmatic use
export { type BuildRegistryOptions, type BuildRegistryResult, buildRegistry } from "./lib/index.js"

// Schema exports - for validation
export {
	type ComponentManifest,
	componentManifestSchema,
	type OcxConfig,
	type OcxLock,
	// Config schemas
	ocxConfigSchema,
	ocxLockSchema,
	type Packument,
	packumentSchema,
	type Registry,
	// Registry schemas
	registrySchema,
} from "./schemas/index.js"
