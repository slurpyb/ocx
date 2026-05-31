/**
 * Expand `${VAR}` references in registry header values from `process.env`.
 *
 * Keeps secrets (e.g. Cloudflare Access service-token credentials) out of
 * `ocx.jsonc`: headers are written as `"${CF_ACCESS_CLIENT_ID}"` and resolved at
 * fetch time. Throws if a referenced variable is unset, so a misconfigured
 * private registry fails loudly instead of silently sending an empty credential.
 */
export function expandEnvVars(headers: Record<string, string>): Record<string, string> {
	const expanded: Record<string, string> = {}
	for (const [name, value] of Object.entries(headers)) {
		expanded[name] = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, varName: string) => {
			const resolved = process.env[varName]
			if (resolved === undefined) {
				throw new Error(
					`Registry header "${name}" references environment variable \${${varName}}, but it is not set.`,
				)
			}
			return resolved
		})
	}
	return expanded
}
