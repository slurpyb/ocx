// Translation logic derived from dyoshikawa/rulesync src/features/hooks/{opencode,claudecode}-hooks.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; output to a .ccx-fragments file rather than directly to
// settings.json so the pipeline can merge alongside the permissions translator.

import { defineTranslator } from "../factory"
import { emit } from "./emit"
import { parse } from "./parse"
import { translate } from "./translate"
import type { ClaudeHooksFragment, OpencodeHooksFile } from "./types"

export const hooksTranslator = defineTranslator<OpencodeHooksFile, ClaudeHooksFragment>({
	kind: "hooks",
	parse,
	translate,
	emit,
})

export type { ClaudeHooksFragment, OpencodeHooksFile } from "./types"
