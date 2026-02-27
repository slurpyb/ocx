import type { Receipt } from "../schemas/config"
import { parseQualifiedComponent } from "../schemas/registry"
import { NotFoundError, ValidationError } from "./errors"
import { parseCanonicalId } from "./receipt"

function isShorthandComponentRef(ref: string): boolean {
	return ref.includes("/") && !ref.includes("::")
}

function parseShorthandComponentRef(ref: string): { registryName: string; componentName: string } {
	try {
		const { namespace, component } = parseQualifiedComponent(ref)
		return { registryName: namespace, componentName: component }
	} catch (error) {
		throw new ValidationError(
			error instanceof Error ? error.message : `Invalid component ref: '${ref}'`,
		)
	}
}

function formatAmbiguousRefMessage(ref: string, matchingCanonicalIds: string[]): string {
	return (
		`Ambiguous component reference '${ref}'. Found ${matchingCanonicalIds.length} installed matches:\n` +
		matchingCanonicalIds.map((canonicalId) => `  - ${canonicalId}`).join("\n") +
		"\n\nUse one of the canonical IDs above."
	)
}

function formatUnknownRefMessage(ref: string): string {
	return `Component '${ref}' is not installed.\nRun 'ocx search --installed' to see installed components.`
}

export function resolveInstalledComponentRef(ref: string, receipt: Receipt): string {
	const installedCanonicalIds = Object.keys(receipt.installed)

	if (receipt.installed[ref]) {
		return ref
	}

	if (isShorthandComponentRef(ref)) {
		const { registryName, componentName } = parseShorthandComponentRef(ref)
		const matchingCanonicalIds = installedCanonicalIds
			.filter((canonicalId) => {
				const parsed = parseCanonicalId(canonicalId)
				return parsed.registryName === registryName && parsed.name === componentName
			})
			.sort()

		if (matchingCanonicalIds.length === 1) {
			const [canonicalId] = matchingCanonicalIds
			if (!canonicalId) {
				throw new Error("Unexpected empty canonical ID result")
			}
			return canonicalId
		}

		if (matchingCanonicalIds.length > 1) {
			throw new ValidationError(formatAmbiguousRefMessage(ref, matchingCanonicalIds))
		}
	}

	throw new NotFoundError(formatUnknownRefMessage(ref))
}

export function resolveInstalledComponentRefs(refs: string[], receipt: Receipt): string[] {
	return refs.map((ref) => resolveInstalledComponentRef(ref, receipt))
}
