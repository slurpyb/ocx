// Translation logic derived from dyoshikawa/rulesync src/features/rules/{opencode,claudecode}-rule.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { defineTranslator } from "../factory"
import { emit } from "./emit"
import { parse } from "./parse"
import { translate } from "./translate"
import type { ClaudeRulesFile, OpencodeRulesFile } from "./types"

export type { ClaudeRulesFile, OpencodeRulesFile }
export { emit, parse, translate }

export const rulesTranslator = defineTranslator<OpencodeRulesFile, ClaudeRulesFile>({
	kind: "rules",
	parse,
	translate,
	emit,
})
