// Translation pipeline.
//
// Given a SourceContext (ocx profile) and a TargetContext (Claude dir + scope),
// run every translator in the registry in parallel and emit Claude-shaped
// artifacts. After all translators finish, merge any `.ccx-fragments/*.json`
// fragments into `<claudeDir>/settings.json` so hooks + permissions land in
// the single file Claude reads.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { translators } from "./translators/registry"
import {
	emptyEmit,
	mergeEmits,
	type PipelineComponentResult,
	type PipelineReport,
	type SourceContext,
	type TargetContext,
	type Translator,
} from "./types"

type AnyTranslator = Translator<unknown, unknown>

interface PipelineOptions {
	readonly source: SourceContext
	readonly target: TargetContext
	/** Subset of components to run (default: all). */
	readonly only?: readonly string[]
}

const FRAGMENTS_DIRNAME = ".ccx-fragments"
// project scope → settings.local.json (per-machine override, gitignored convention)
// global scope  → settings.json       (user's home, no .local variant exists there)
const SETTINGS_FILENAME_PROJECT = "settings.local.json"
const SETTINGS_FILENAME_GLOBAL = "settings.json"

const runOne = async (
	t: AnyTranslator,
	source: SourceContext,
	target: TargetContext,
): Promise<PipelineComponentResult> => {
	try {
		const sources = await t.parse(source)
		if (sources.length === 0) {
			return { kind: t.kind, status: "ok", written: [], skipped: [] }
		}
		const emits = await Promise.all(
			sources.map(async (s) => {
				const claude = t.translate(s)
				return t.emit(claude, target)
			}),
		)
		const merged = emits.length > 0 ? mergeEmits(emits) : emptyEmit()
		return {
			kind: t.kind,
			status: "ok",
			written: merged.written,
			skipped: merged.skipped,
		}
	} catch (err) {
		return {
			kind: t.kind,
			status: "error",
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

const isObjectRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Always write `<claudeDir>/settings.local.json` (project) or `settings.json`
 * (global). Even when no hooks/permissions fragments exist, ccx emits the file
 * (with `{}` body) so downstream tooling can rely on its presence.
 *
 * When fragments DO exist:
 *   - Read existing settings file (if any) into `merged`.
 *   - For each fragment, shallow-overwrite top-level keys it touches.
 *   - Leave other top-level user keys alone.
 *   - Delete fragments + fragments dir on success.
 */
const writeSettingsFile = (target: TargetContext): readonly string[] => {
	const fragmentsDir = join(target.claudeDir, FRAGMENTS_DIRNAME)
	const settingsFilename =
		target.scope === "global" ? SETTINGS_FILENAME_GLOBAL : SETTINGS_FILENAME_PROJECT
	const settingsPath = join(target.claudeDir, settingsFilename)

	let merged: Record<string, unknown> = {}
	if (existsSync(settingsPath)) {
		try {
			const raw = readFileSync(settingsPath, "utf-8")
			const parsed: unknown = JSON.parse(raw)
			if (isObjectRecord(parsed)) merged = parsed
		} catch {
			merged = {}
		}
	}

	// Apply fragments if any.
	if (existsSync(fragmentsDir)) {
		const fragmentFiles = readdirSync(fragmentsDir)
			.filter((name) => name.endsWith(".json"))
			.map((name) => join(fragmentsDir, name))

		for (const fragPath of fragmentFiles) {
			try {
				const raw = readFileSync(fragPath, "utf-8")
				const fragment: unknown = JSON.parse(raw)
				if (!isObjectRecord(fragment)) continue
				for (const [key, value] of Object.entries(fragment)) {
					merged[key] = value
				}
			} catch {}
		}

		// Clean up fragments after applying.
		for (const fragPath of fragmentFiles) {
			try {
				const fs = require("node:fs") as typeof import("node:fs")
				fs.unlinkSync(fragPath)
			} catch {
				// ignore
			}
		}
		try {
			const fs = require("node:fs") as typeof import("node:fs")
			fs.rmdirSync(fragmentsDir)
		} catch {
			// ignore
		}
	}

	mkdirSync(target.claudeDir, { recursive: true })
	writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf-8")
	return [settingsPath]
}

export const runPipeline = async (opts: PipelineOptions): Promise<PipelineReport> => {
	const { source, target, only } = opts

	const selected: readonly AnyTranslator[] = only
		? Object.values(translators).filter((t) => only.includes(t.kind))
		: Object.values(translators)

	// Ensure the target dir exists once up-front so emitters don't race on mkdir.
	mkdirSync(target.claudeDir, { recursive: true })

	const results = await Promise.all(selected.map((t) => runOne(t, source, target)))

	const extras = writeSettingsFile(target)

	return { results, source, target, extras }
}
