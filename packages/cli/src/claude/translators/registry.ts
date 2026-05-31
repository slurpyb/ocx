// Registry — the single place every translator is wired in.
// Adding a component = adding to this map. Pipeline iterates the values.
//
// Each translator is a frozen Translator<TSource, TClaude>. The map's value
// type is widened to `Translator<unknown, unknown>` so the registry can be
// iterated as a uniform collection; the original generics live inside each
// translator and are preserved at its call site.

import type { ComponentKind, Translator } from "../types"
import { commandsTranslator } from "./commands/index"
import { hooksTranslator } from "./hooks/index"
import { mcpTranslator } from "./mcp/index"
import { permissionsTranslator } from "./permissions/index"
import { rulesTranslator } from "./rules/index"
import { skillsTranslator } from "./skills/index"
import { subagentsTranslator } from "./subagents/index"

type AnyTranslator = Translator<unknown, unknown>

export const translators: Readonly<Record<ComponentKind, AnyTranslator>> = Object.freeze({
	rules: rulesTranslator as AnyTranslator,
	mcp: mcpTranslator as AnyTranslator,
	commands: commandsTranslator as AnyTranslator,
	subagents: subagentsTranslator as AnyTranslator,
	skills: skillsTranslator as AnyTranslator,
	hooks: hooksTranslator as AnyTranslator,
	permissions: permissionsTranslator as AnyTranslator,
})

export const translatorList: readonly AnyTranslator[] = Object.freeze(Object.values(translators))
