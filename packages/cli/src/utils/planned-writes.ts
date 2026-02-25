import { ConflictError } from "./errors"

export interface PlannedWrite {
	absolutePath: string
	relativePath: string
	content: Buffer
	source: string
}

/**
 * Registers an in-flight write target and fails loud on duplicates.
 * Policy: duplicate targets are always rejected, even for identical content.
 */
export function registerPlannedWriteOrThrow(
	plannedWrites: Map<string, PlannedWrite>,
	candidate: PlannedWrite,
): void {
	const existing = plannedWrites.get(candidate.absolutePath)
	if (!existing) {
		plannedWrites.set(candidate.absolutePath, candidate)
		return
	}

	const contentRelation = existing.content.equals(candidate.content)
		? "identical content"
		: "different content"

	throw new ConflictError(
		`Intra-batch target collision at "${candidate.relativePath}". ` +
			`Both "${existing.source}" and "${candidate.source}" resolve to this path with ${contentRelation}. ` +
			"Rename one manifest target so each component writes to a unique path.",
	)
}
