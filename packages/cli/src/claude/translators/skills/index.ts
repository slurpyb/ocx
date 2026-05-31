// Translation logic derived from dyoshikawa/rulesync src/features/skills/{opencode,claudecode}-skill.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { defineTranslator } from "../factory"
import { emit } from "./emit"
import { parse } from "./parse"
import { translate } from "./translate"
import type { ClaudeSkill, OpencodeSkill } from "./types"

export const skillsTranslator = defineTranslator<OpencodeSkill, ClaudeSkill>({
	kind: "skills",
	parse,
	translate,
	emit,
})

export type { ClaudeSkill, OpencodeSkill } from "./types"
