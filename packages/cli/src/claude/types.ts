// Core type surface for ccx translators.
// Discriminated unions and branded paths keep contexts unmixable.

// ─── Branded paths ─────────────────────────────────────────────────────────────
// Prevents `ClaudeDir` flowing where a `ProfileDir` is expected.

declare const brand: unique symbol
type Brand<K, T extends string> = K & { readonly [brand]: T }

export type ProfileDir = Brand<string, "ProfileDir">
export type ClaudeDir = Brand<string, "ClaudeDir">
export type ProjectRoot = Brand<string, "ProjectRoot">

export const asProfileDir = (s: string): ProfileDir => s as ProfileDir
export const asClaudeDir = (s: string): ClaudeDir => s as ClaudeDir
export const asProjectRoot = (s: string): ProjectRoot => s as ProjectRoot

// ─── Component kinds ───────────────────────────────────────────────────────────

export const COMPONENT_KINDS = [
	"rules",
	"mcp",
	"commands",
	"subagents",
	"skills",
	"hooks",
	"permissions",
] as const

export type ComponentKind = (typeof COMPONENT_KINDS)[number]

// ─── Contexts ──────────────────────────────────────────────────────────────────

export type Scope = "project" | "global"

export interface SourceContext {
	readonly profileDir: ProfileDir
	/** Profile name (basename of profileDir). Convenience for emitters. */
	readonly profileName: string
}

export interface TargetContext {
	readonly scope: Scope
	/** Where Claude reads from. `.claude/` for project, `~/.claude/` for global. */
	readonly claudeDir: ClaudeDir
	/** Cwd when scope=project; equal to user home when scope=global. */
	readonly projectRoot: ProjectRoot
}

// ─── Emit results ──────────────────────────────────────────────────────────────

export interface EmitResult {
	readonly written: readonly string[]
	readonly skipped: readonly string[]
}

export const emptyEmit = (): EmitResult => ({ written: [], skipped: [] })

export const mergeEmits = (parts: readonly EmitResult[]): EmitResult => ({
	written: parts.flatMap((p) => p.written),
	skipped: parts.flatMap((p) => p.skipped),
})

// ─── Translator interface ──────────────────────────────────────────────────────

export interface Translator<TSource, TClaude> {
	readonly kind: ComponentKind
	/** Read OpenCode-shaped artifacts from a profile dir. */
	parse(ctx: SourceContext): Promise<readonly TSource[]>
	/** Pure translation OpenCode shape → Claude shape. */
	translate(source: TSource): TClaude
	/** Write Claude-shaped artifacts into the target. */
	emit(claude: TClaude, ctx: TargetContext): Promise<EmitResult>
}

export interface TranslatorSpec<TSource, TClaude> {
	readonly kind: ComponentKind
	parse: (ctx: SourceContext) => Promise<readonly TSource[]>
	translate: (source: TSource) => TClaude
	emit: (claude: TClaude, ctx: TargetContext) => Promise<EmitResult>
}

// ─── Pipeline reporting ────────────────────────────────────────────────────────

export type PipelineComponentResult =
	| {
			readonly kind: ComponentKind
			readonly status: "ok"
			readonly written: readonly string[]
			readonly skipped: readonly string[]
	  }
	| {
			readonly kind: ComponentKind
			readonly status: "error"
			readonly error: string
	  }

export interface PipelineReport {
	readonly results: readonly PipelineComponentResult[]
	readonly target: TargetContext
	readonly source: SourceContext
	/**
	 * Non-component writes performed by the pipeline itself (e.g. the merged
	 * settings.json that consolidates fragments from hooks + permissions).
	 */
	readonly extras: readonly string[]
}
