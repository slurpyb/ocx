// Translation logic derived from dyoshikawa/rulesync src/features/permissions/{opencode,claudecode}-permissions.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted parse + emit algorithms; rewrapped in ccx's
// Translator interface; output to a .ccx-fragments file rather than directly to
// settings.json so the pipeline can merge alongside the hooks translator.

import { defineTranslator } from "../factory"
import { emit } from "./emit"
import { parse } from "./parse"
import { translate } from "./translate"
import type { ClaudePermissionsFragment, OpencodePermissionsFile } from "./types"

export type { ClaudePermissionsFragment, OpencodePermissionsFile }
export { emit, parse, translate }

export const permissionsTranslator = defineTranslator<
	OpencodePermissionsFile,
	ClaudePermissionsFragment
>({
	kind: "permissions",
	parse,
	translate,
	emit,
})
