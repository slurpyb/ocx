// Post-mutation hook: after a successful profile-mutating command, translate the
// resolved OpenCode profile into Claude Code files automatically.
//
// This is what makes the standalone `ccx` shim unnecessary — `ocx add`,
// `ocx profile add`, etc. now emit `.claude/` output themselves. Gated by the
// optional `claude.enabled` config toggle (default: enabled). The hook never
// throws and never speaks in machine/silent modes: a translation failure must
// not fail or pollute the underlying ocx command.

import type { Command } from "commander"
import { readOcxConfig } from "../schemas/config"
import { logger } from "../utils/logger"
import { reportPipeline } from "./command"
import { runPipeline } from "./pipeline"
import { ProfileResolutionError, resolveProfile, resolveTarget } from "./resolve"
import type { Scope } from "./types"

const TOP_LEVEL_MUTATING = new Set(["add", "remove", "update", "init", "migrate"])
const PROFILE_MUTATING = new Set(["add", "remove", "rm", "move", "mv", "clone"])

const isMutatingCommand = (name: string, parentName: string | undefined): boolean => {
	if (parentName === "profile") return PROFILE_MUTATING.has(name)
	if (parentName === undefined || parentName === "ocx") return TOP_LEVEL_MUTATING.has(name)
	return false
}

const isClaudeDisabled = async (cwd: string): Promise<boolean> => {
	try {
		const config = await readOcxConfig(cwd, { emitParseDiagnostics: false })
		return config?.claude?.enabled === false
	} catch {
		// Config unreadable → fall back to default (enabled).
		return false
	}
}

interface HookOptions {
	global?: boolean
	profile?: string
	json?: boolean
	quiet?: boolean
}

export function registerClaudeSyncHook(program: Command): void {
	program.hook("postAction", async (_thisCommand, actionCommand) => {
		try {
			const name = actionCommand.name()
			const parentName = actionCommand.parent?.name()
			if (!isMutatingCommand(name, parentName)) {
				return
			}

			// Read flags including inherited globals so --json / --quiet are honoured
			// wherever they appear on the command line.
			const options = (
				typeof actionCommand.optsWithGlobals === "function"
					? actionCommand.optsWithGlobals()
					: actionCommand.opts()
			) as HookOptions

			// Stay completely silent and side-effect-free in machine/silent modes:
			// these contracts require clean stdout, so the auto-sync must not run.
			if (options.json || options.quiet) {
				return
			}

			const cwd = process.cwd()
			if (await isClaudeDisabled(cwd)) {
				return
			}

			const scope: Scope = options.global ? "global" : "project"
			const source = resolveProfile(
				options.profile !== undefined ? { explicit: options.profile } : {},
			)
			const target = resolveTarget({ scope })

			const report = await runPipeline({ source, target })
			reportPipeline(report)
		} catch (err) {
			// Never interrupt the underlying ocx command. A resolution miss just means
			// there's nothing to translate (most non-profile mutations) — stay silent.
			// Only surface a genuine translation failure, and only in verbose mode.
			if (err instanceof ProfileResolutionError) {
				return
			}
			if (process.env.OCX_VERBOSE) {
				logger.warn(
					`claude: translate failed (${err instanceof Error ? err.message : String(err)})`,
				)
			}
		}
	})
}
