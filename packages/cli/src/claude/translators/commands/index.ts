// Translation logic derived from dyoshikawa/rulesync src/features/commands/{opencode,claudecode}-command.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { defineTranslator } from "../factory"
import { emit } from "./emit"
import { parse } from "./parse"
import { translate } from "./translate"
import type { ClaudeCommand, OpencodeCommand } from "./types"

export const commandsTranslator = defineTranslator<OpencodeCommand, ClaudeCommand>({
	kind: "commands",
	parse,
	translate,
	emit,
})

export type { ClaudeCommand, OpencodeCommand } from "./types"
