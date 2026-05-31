// defineTranslator — typed factory that freezes a translator spec.
// Use this to register every per-component translator. The factory is the only
// way translators enter the system; the registry is the only place they're
// indexed.

import type { Translator, TranslatorSpec } from "../types"

export const defineTranslator = <TSource, TClaude>(
	spec: TranslatorSpec<TSource, TClaude>,
): Translator<TSource, TClaude> =>
	Object.freeze({
		kind: spec.kind,
		parse: spec.parse,
		translate: spec.translate,
		emit: spec.emit,
	})
