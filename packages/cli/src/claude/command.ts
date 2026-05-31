// `ocx claude` — emit Claude Code files from the resolved OpenCode profile.
//
// Subcommands:
//   ocx claude sync [profile]   translate a profile into ./.claude/ (or ~/.claude/ with --global)
//   ocx claude status           show the resolved profile + target
//
// This is the explicit entry point; a post-mutation hook (see ./hook) runs the
// same pipeline automatically after `ocx add`, `ocx profile add`, etc.

import { existsSync } from "node:fs"
import type { Command } from "commander"
import { logger } from "../utils/logger"
import { runPipeline } from "./pipeline"
import { ProfileResolutionError, resolveProfile, resolveTarget } from "./resolve"
import type { PipelineReport, Scope } from "./types"

interface SyncOptions {
	global?: boolean
	profile?: string
}

export const reportPipeline = (report: PipelineReport): void => {
	const produced = report.results.filter((r) => r.status === "ok" && r.written.length > 0)
	const errs = report.results.filter((r) => r.status === "error")
	const totalFiles =
		produced.reduce((n, r) => n + (r.status === "ok" ? r.written.length : 0), 0) +
		report.extras.length

	logger.info(
		`claude: ${produced.length}/${report.results.length} translators produced output ` +
			`(${totalFiles} files, scope: ${report.target.scope})`,
	)

	for (const r of produced) {
		if (r.status !== "ok") continue
		for (const path of r.written) {
			logger.info(`claude:   ${r.kind} → ${path}`)
		}
	}
	for (const path of report.extras) {
		logger.info(`claude:   settings → ${path}`)
	}

	if (errs.length > 0) {
		logger.error(`claude: ${errs.length} translator(s) failed:`)
		for (const e of errs) {
			if (e.status === "error") {
				logger.error(`  - ${e.kind}: ${e.error}`)
			}
		}
	}
}

const runSync = async (profileArg: string | undefined, options: SyncOptions): Promise<void> => {
	const scope: Scope = options.global ? "global" : "project"
	const explicit = options.profile ?? profileArg

	const source = resolveProfile(explicit !== undefined ? { explicit } : {})
	const target = resolveTarget({ scope })

	logger.info(`claude: syncing profile "${source.profileName}" → ${target.claudeDir}`)

	const report = await runPipeline({ source, target })
	reportPipeline(report)

	if (report.results.some((r) => r.status === "error")) {
		process.exitCode = 1
	}
}

const runStatus = (): void => {
	try {
		const source = resolveProfile({})
		const target = resolveTarget({ scope: "project" })
		logger.info(`claude status`)
		logger.info(`  profile (resolved): ${source.profileName}`)
		logger.info(`    ↳ ${source.profileDir}`)
		logger.info(`  target (project):   ${target.claudeDir}`)
		logger.info(`    ↳ exists: ${existsSync(target.claudeDir)}`)
	} catch (err) {
		if (err instanceof ProfileResolutionError) {
			logger.info(`claude status`)
			logger.info(`  profile: (unresolved) — ${err.message}`)
			return
		}
		throw err
	}
}

export function registerClaudeCommand(program: Command): void {
	const claude = program
		.command("claude")
		.description(
			"Emit Claude Code files (.claude/, .mcp.json, settings) from your OpenCode profile",
		)

	claude
		.command("sync")
		.description("Translate a profile into the Claude target (./.claude/ or ~/.claude/)")
		.argument(
			"[profile]",
			"Profile to translate (else: local .opencode → pin → OCX_PROFILE → single)",
		)
		.option("-g, --global", "Target ~/.claude/ instead of ./.claude/")
		.option("-p, --profile <name>", "Override profile resolution")
		.action(async (profileArg: string | undefined, options: SyncOptions) => {
			try {
				await runSync(profileArg, options)
			} catch (err) {
				if (err instanceof ProfileResolutionError) {
					logger.error(`claude: ${err.message}`)
					process.exitCode = 2
					return
				}
				throw err
			}
		})

	claude
		.command("status")
		.description("Show the resolved profile and Claude target")
		.action(() => {
			runStatus()
		})
}
