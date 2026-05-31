// Translation logic derived from dyoshikawa/rulesync src/features/subagents/{opencode,claudecode}-subagent.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { defineTranslator } from "../factory"
import { emit } from "./emit"
import { parse } from "./parse"
import { translate } from "./translate"
import type { ClaudeSubagent, OpencodeSubagent } from "./types"

export const subagentsTranslator = defineTranslator<OpencodeSubagent, ClaudeSubagent>({
	kind: "subagents",
	parse,
	translate,
	emit,
})

export type { ClaudeSubagent, OpencodeSubagent } from "./types"
