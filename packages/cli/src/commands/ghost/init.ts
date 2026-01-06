/**
 * Ghost Init Command
 *
 * Initialize ghost mode by creating the global configuration file
 * at ~/.config/ocx/ghost.jsonc (XDG-compliant path).
 */

import { mkdir, writeFile } from "node:fs/promises"
import type { Command } from "commander"
import { getGhostConfigDir, getGhostConfigPath } from "../../ghost/config.js"
import { GhostAlreadyInitializedError } from "../../utils/errors.js"
import { handleError, logger } from "../../utils/index.js"
import { addOutputOptions, addVerboseOption } from "../../utils/shared-options.js"

// Default ghost.jsonc content with helpful comments
// Note: OpenCode configuration is stored separately in opencode.jsonc
const DEFAULT_GHOST_CONFIG = `{
  // OCX Ghost Mode Configuration
  // This config is used when running commands with \`ocx ghost\` or \`ocx g\`
  // Note: OpenCode settings go in ~/.config/ocx/opencode.jsonc (see: ocx ghost opencode --edit)
  
  // Component registries to use
  "registries": {
    "default": {
      "url": "https://registry.opencode.ai"
    }
  },
  
  // Where to install components (relative to project root)
  "componentPath": "src/components"
}
`

interface GhostInitOptions {
	json?: boolean
	quiet?: boolean
	verbose?: boolean
}

export function registerGhostInitCommand(parent: Command): void {
	const cmd = parent.command("init").description("Initialize ghost mode with global configuration")

	// Add shared options for consistency (no --cwd for ghost init)
	addOutputOptions(cmd)
	addVerboseOption(cmd)

	cmd.action(async (options: GhostInitOptions) => {
		try {
			await runGhostInit(options)
		} catch (error) {
			handleError(error, { json: options.json })
		}
	})
}

async function runGhostInit(options: GhostInitOptions): Promise<void> {
	// Get paths early for error message (Law 5: Intentional Naming)
	const configPath = getGhostConfigPath()
	const configDir = getGhostConfigDir()

	// Create config directory (recursive is idempotent, safe if exists)
	await mkdir(configDir, { recursive: true })

	// Atomic exclusive create - eliminates TOCTOU race condition (Law 4: Fail Fast)
	try {
		await writeFile(configPath, DEFAULT_GHOST_CONFIG, { flag: "wx" })
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EEXIST") {
			throw new GhostAlreadyInitializedError(configPath)
		}
		throw err
	}

	// Output success
	if (options.json) {
		console.log(JSON.stringify({ success: true, path: configPath }))
		return
	}

	if (!options.quiet) {
		logger.success("Ghost mode initialized")
		logger.info(`Created ${configPath}`)
		logger.info("")
		logger.info("Next steps:")
		logger.info("  1. Edit your config: ocx ghost config")
		logger.info("  2. Add registries: ocx ghost registry add <url> --name <name>")
		logger.info("  3. Add components: ocx ghost add <component>")
	}
}
