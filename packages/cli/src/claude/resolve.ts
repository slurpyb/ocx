// Resolve which ocx source profile to translate, and where Claude artifacts land.
//
// Source resolution priority (first match wins):
//   1. Explicit name (CLI flag / programmatic input) — a global profile name
//   2. Project-local `<cwd>/.opencode/` if present — ocx's default install target
//   3. Nearest ancestor with `.ocx/profile` or `.ccx/profile` (one-line file)
//   4. OCX_PROFILE environment variable
//   5. Single global profile at ~/.config/opencode/profiles/<only-one>
//   6. Fail with an actionable error
//
// Target resolution: project scope → `<cwd>/.claude/`, global scope → `~/.claude/`.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, parse } from "node:path"
import {
	asClaudeDir,
	asProfileDir,
	asProjectRoot,
	type ProfileDir,
	type Scope,
	type SourceContext,
	type TargetContext,
} from "./types"

export class ProfileResolutionError extends Error {
	override readonly name = "ProfileResolutionError"
}

export interface ResolveProfileInput {
	readonly cwd?: string
	/** CLI / programmatic override; takes priority over heuristics. */
	readonly explicit?: string
}

const PROFILES_ROOT = join(homedir(), ".config", "opencode", "profiles")
const LOCAL_OPENCODE_DIR = ".opencode"
// Pin files, checked in order. `.ocx/profile` is preferred; `.ccx/profile` is
// honoured for backward compatibility with the standalone ccx tool.
const PIN_PATHS = [
	[".ocx", "profile"],
	[".ccx", "profile"],
] as const

const profileDirFor = (name: string): ProfileDir => asProfileDir(join(PROFILES_ROOT, name))

const profileExists = (name: string): boolean => existsSync(join(PROFILES_ROOT, name))

const findLocalOpencodeDir = (cwd: string): string | undefined => {
	const local = join(cwd, LOCAL_OPENCODE_DIR)
	if (existsSync(local)) {
		try {
			if (statSync(local).isDirectory()) return local
		} catch {
			return undefined
		}
	}
	return undefined
}

const findPinnedProfileName = (start: string): string | undefined => {
	const { root } = parse(start)
	let current = start
	while (true) {
		for (const segments of PIN_PATHS) {
			const pinPath = join(current, ...segments)
			if (existsSync(pinPath)) {
				const content = readFileSync(pinPath, "utf-8").trim()
				if (content.length > 0) return content
			}
		}
		if (current === root) return undefined
		const parent = dirname(current)
		if (parent === current) return undefined
		current = parent
	}
}

const listProfiles = (): readonly string[] => {
	if (!existsSync(PROFILES_ROOT)) return []
	try {
		return readdirSync(PROFILES_ROOT, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name)
	} catch {
		return []
	}
}

export const resolveProfile = (input: ResolveProfileInput = {}): SourceContext => {
	const cwd = input.cwd ?? process.cwd()

	if (input.explicit && input.explicit.length > 0) {
		if (!profileExists(input.explicit)) {
			throw new ProfileResolutionError(`Profile "${input.explicit}" not found at ${PROFILES_ROOT}.`)
		}
		return {
			profileDir: profileDirFor(input.explicit),
			profileName: input.explicit,
		}
	}

	// Project-local .opencode/ — what ocx writes by default (no --global).
	const localOpencode = findLocalOpencodeDir(cwd)
	if (localOpencode) {
		return {
			profileDir: asProfileDir(localOpencode),
			profileName: "(local .opencode)",
		}
	}

	const pinned = findPinnedProfileName(cwd)
	if (pinned) {
		if (!profileExists(pinned)) {
			throw new ProfileResolutionError(
				`Pinned profile "${pinned}" (from .ocx/profile or .ccx/profile) not found at ${PROFILES_ROOT}.`,
			)
		}
		return { profileDir: profileDirFor(pinned), profileName: pinned }
	}

	const envProfile = process.env.OCX_PROFILE
	if (envProfile && envProfile.length > 0) {
		if (!profileExists(envProfile)) {
			throw new ProfileResolutionError(
				`Profile "${envProfile}" (from OCX_PROFILE) not found at ${PROFILES_ROOT}.`,
			)
		}
		return { profileDir: profileDirFor(envProfile), profileName: envProfile }
	}

	const profiles = listProfiles()
	if (profiles.length === 1) {
		const only = profiles[0]
		if (only) return { profileDir: profileDirFor(only), profileName: only }
	}

	if (profiles.length === 0) {
		throw new ProfileResolutionError(
			"No source found. Either run `ocx add <component>` in this directory (creates .opencode/), or specify a global profile via --profile / OCX_PROFILE / .ocx/profile.",
		)
	}
	throw new ProfileResolutionError(
		`Multiple profiles available (${profiles.join(", ")}). Specify one via --profile, OCX_PROFILE, or a .ocx/profile file. (Or run \`ocx add <component>\` here to use a project-local .opencode/.)`,
	)
}

export interface ResolveTargetInput {
	readonly scope: Scope
	/** Working directory. Defaults to process.cwd(). Ignored for global scope. */
	readonly cwd?: string
}

export const resolveTarget = (input: ResolveTargetInput): TargetContext => {
	if (input.scope === "global") {
		const home = homedir()
		return {
			scope: "global",
			claudeDir: asClaudeDir(join(home, ".claude")),
			projectRoot: asProjectRoot(home),
		}
	}
	const cwd = input.cwd ?? process.cwd()
	return {
		scope: "project",
		claudeDir: asClaudeDir(join(cwd, ".claude")),
		projectRoot: asProjectRoot(cwd),
	}
}

export { PROFILES_ROOT }
