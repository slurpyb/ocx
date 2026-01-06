/**
 * Ghost Init Command
 *
 * Initialize ghost mode by creating the global configuration file
 * at ~/.config/ocx/ghost.jsonc (XDG-compliant path).
 */

import { mkdir } from "node:fs/promises"
import type { Command } from "commander"
import { getGhostConfigDir, getGhostConfigPath, ghostConfigExists } from "../../ghost/config.js"
import { GhostAlreadyInitializedError } from "../../utils/errors.js"
import { handleError, logger } from "../../utils/index.js"
import { addOutputOptions, addVerboseOption } from "../../utils/shared-options.js"

// Default ghost.jsonc content with helpful comments
const DEFAULT_GHOST_CONFIG = `{
  // OCX Ghost Mode Configuration
  // This config is used when running commands with \`ocx ghost\` or \`ocx g\`
  
  // Component registries to use
  "registries": {
    "default": {
      "url": "https://registry.opencode.ai"
    }
  },
  
  // Where to install components (relative to project root)
  "componentPath": "src/components",
  
  // OpenCode configuration (passed via OPENCODE_CONFIG_CONTENT)
  // Customize your preferred model, providers, agents, etc.
  "opencode": {
    // "model": "anthropic/claude-sonnet-4-20250514"
  }
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
	// Get config path early for error message (Law 5: Intentional Naming)
	const configPath = getGhostConfigPath()

	// Guard: Check if already initialized (Law 1: Early Exit)
	if (await ghostConfigExists()) {
		throw new GhostAlreadyInitializedError(configPath)
	}

	// Create config directory if needed
	const configDir = getGhostConfigDir()

	// Create config directory (recursive is idempotent)
	await mkdir(configDir, { recursive: true })

	// Write default configuration
	await Bun.write(configPath, DEFAULT_GHOST_CONFIG)

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
