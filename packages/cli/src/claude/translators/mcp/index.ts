// Translation logic derived from dyoshikawa/rulesync src/features/mcp/{opencode,claudecode}-mcp.ts
// MIT License — Copyright (c) 2024 dyoshikawa
// Modifications: extracted convertFromOpencodeFormat algorithm; rewrapped in ccx's
// Translator interface; replaced rulesync internal utils with bun/ccx deps.

import { defineTranslator } from "../factory"
import { emit } from "./emit"
import { parse } from "./parse"
import { translate } from "./translate"
import type { ClaudeMcpFile, OpencodeMcpFile } from "./types"

export const mcpTranslator = defineTranslator<OpencodeMcpFile, ClaudeMcpFile>({
	kind: "mcp",
	parse,
	translate,
	emit,
})

export type { ClaudeMcpFile, OpencodeMcpFile } from "./types"
