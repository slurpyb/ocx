import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { ConflictError, ValidationError } from "./errors"

const ROOT_PAIRS = {
	agent: "agents",
	command: "commands",
	plugin: "plugins",
	skill: "skills",
	tool: "tools",
	bundle: "bundles",
	profile: "profiles",
} as const

type SingularRoot = keyof typeof ROOT_PAIRS
type PluralRoot = (typeof ROOT_PAIRS)[SingularRoot]

type RootPair = {
	singular: SingularRoot
	plural: PluralRoot
}

const ROOT_LOOKUP = new Map<string, RootPair>(
	Object.entries(ROOT_PAIRS).flatMap(([singular, plural]) => {
		const pair = {
			singular: singular as SingularRoot,
			plural,
		}

		return [
			[singular, pair],
			[plural, pair],
		]
	}),
)

function readRootState(installRoot: string, rootSegment: string): "missing" | "directory" {
	const candidatePath = join(installRoot, rootSegment)

	if (!existsSync(candidatePath)) {
		return "missing"
	}

	const stats = statSync(candidatePath)
	if (!stats.isDirectory()) {
		throw new ValidationError(
			`Component root "${rootSegment}" exists at "${candidatePath}" but is not a directory.`,
		)
	}

	return "directory"
}

function resolvePreferredRoot(installRoot: string, pair: RootPair): SingularRoot | PluralRoot {
	const singularState = readRootState(installRoot, pair.singular)
	const pluralState = readRootState(installRoot, pair.plural)

	if (singularState === "directory" && pluralState === "directory") {
		return pair.plural
	}

	if (singularState === "directory") {
		return pair.singular
	}

	if (pluralState === "directory") {
		return pair.plural
	}

	return pair.plural
}

function assertNoCrossRootCollision(
	installRoot: string,
	originalTarget: string,
	selectedRoot: SingularRoot | PluralRoot,
	pair: RootPair,
	suffix: string,
): void {
	if (!suffix) {
		return
	}

	const alternateRoot = selectedRoot === pair.plural ? pair.singular : pair.plural
	const alternateRelativePath = `${alternateRoot}/${suffix}`
	const alternateAbsolutePath = join(installRoot, alternateRelativePath)

	if (!existsSync(alternateAbsolutePath)) {
		return
	}

	throw new ConflictError(
		`Cross-root logical collision for "${originalTarget}": selected root "${selectedRoot}" but "${alternateRelativePath}" already exists.`,
	)
}

/**
 * Resolve singular/plural component root segments for installation targets.
 * Preserves all nested path segments exactly.
 */
export function resolveComponentTargetRoot(targetPath: string, installRoot: string): string {
	const [firstSegment, ...remainingSegments] = targetPath.split("/")
	if (!firstSegment) {
		return targetPath
	}

	const pair = ROOT_LOOKUP.get(firstSegment)
	if (!pair) {
		return targetPath
	}

	const preferredRoot = resolvePreferredRoot(installRoot, pair)
	const suffix = remainingSegments.join("/")

	assertNoCrossRootCollision(installRoot, targetPath, preferredRoot, pair, suffix)

	if (!suffix) {
		return preferredRoot
	}

	return `${preferredRoot}/${suffix}`
}
