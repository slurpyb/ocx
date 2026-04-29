import { execFile } from "node:child_process"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { promisify } from "node:util"
import { type Plugin, tool } from "@opencode-ai/plugin"

const execFileAsync = promisify(execFile)

const FLOW_EXPLORER_TEMP_ROOT = path.join(os.tmpdir(), "kdco-flow")
const ALLOWED_GIT_OPERATIONS = ["status", "log", "show", "diff", "rev-parse"] as const

export type AllowedGitOperation = (typeof ALLOWED_GIT_OPERATIONS)[number]

function parseRepositoryPathSegment(input: string, label: string): string {
	const segment = input.trim().replace(/\.git$/, "")
	if (segment === "." || segment === "..") {
		throw new Error(`${label} cannot be "." or "..".`)
	}

	if (!/^[A-Za-z0-9_.-]+$/.test(segment)) {
		throw new Error(`${label} must contain only letters, numbers, dots, underscores, or hyphens.`)
	}

	return segment
}

export function parseRepositoryOwner(input: string): string {
	return parseRepositoryPathSegment(input, "Repository owner")
}

export function parseRepositoryName(input: string): string {
	return parseRepositoryPathSegment(input, "Repository name")
}

export function parseRepositoryUrl(input: string): URL {
	const url = new URL(input)
	if (!/^https?:$/.test(url.protocol)) {
		throw new Error("Repository URL must use https:// or http://.")
	}

	if (url.username || url.password) {
		throw new Error("Repository URL must not include embedded credentials.")
	}

	return url
}

function parseGitOperation(input: string): AllowedGitOperation {
	if (ALLOWED_GIT_OPERATIONS.includes(input as AllowedGitOperation)) {
		return input as AllowedGitOperation
	}

	throw new Error(`Unsupported git operation "${input}". Allowed: ${ALLOWED_GIT_OPERATIONS.join(", ")}.`)
}

function assertSafeGitPathspec(argument: string): void {
	if (argument.startsWith("-")) {
		throw new Error(`Git pathspec cannot be a flag: ${argument}`)
	}

	if (argument.includes("\0")) {
		throw new Error("Git pathspec cannot contain NUL bytes.")
	}

	if (path.isAbsolute(argument)) {
		throw new Error(`Git pathspec cannot be absolute: ${argument}`)
	}

	if (argument.split(/[\\/]+/).includes("..")) {
		throw new Error(`Git pathspec cannot escape with "..": ${argument}`)
	}
}

function assertSafeGitRef(argument: string): void {
	if (argument.startsWith("-")) {
		throw new Error(`Git ref cannot be a flag: ${argument}`)
	}

	if (!/^[A-Za-z0-9._/@{}^~-]+$/.test(argument)) {
		throw new Error(`Git ref contains unsupported characters: ${argument}`)
	}
}

function assertNoDangerousGitArgument(argument: string): void {
	const deniedPrefixes = [
		"--output",
		"--no-index",
		"--ext-diff",
		"--config-env",
		"--git-dir",
		"--work-tree",
		"--exec-path",
	]
	const deniedExact = ["-c"]

	if (deniedExact.includes(argument) || deniedPrefixes.some((prefix) => argument === prefix || argument.startsWith(`${prefix}=`))) {
		throw new Error(`Git argument is not allowed for read-only explorer operations: ${argument}`)
	}
}

function parseGitArgumentArray(input: string): string[] {
	if (!input.trim()) return []

	const parsedArguments = JSON.parse(input)
	if (!Array.isArray(parsedArguments)) {
		throw new Error("Git arguments must be a JSON array of strings.")
	}

	for (const parsedArgument of parsedArguments) {
		if (typeof parsedArgument !== "string") {
			throw new Error("Every git argument must be a string.")
		}

		assertNoDangerousGitArgument(parsedArgument)
	}

	return parsedArguments
}

function buildSafeStatusArguments(argsJson: string): string[] {
	const args = parseGitArgumentArray(argsJson)
	const allowedStatusForms = ["", "--short", "--porcelain"]
	const joinedArgs = args.join(" ")

	if (allowedStatusForms.includes(joinedArgs)) return args

	throw new Error("git status only allows no args, --short, or --porcelain.")
}

function buildSafeLogArguments(argsJson: string): string[] {
	const args = parseGitArgumentArray(argsJson)
	const safeArgs: string[] = []

	for (const arg of args) {
		if (["--oneline", "--decorate", "--stat", "--name-only"].includes(arg)) {
			safeArgs.push(arg)
			continue
		}

		if (/^--max-count=\d{1,4}$/.test(arg)) {
			safeArgs.push(arg)
			continue
		}

		assertSafeGitRef(arg)
		safeArgs.push(arg)
	}

	return safeArgs
}

function buildSafeShowArguments(argsJson: string): string[] {
	const args = parseGitArgumentArray(argsJson)
	const safeArgs: string[] = []
	let refCount = 0

	for (const arg of args) {
		if (["--stat", "--name-only", "--format=fuller"].includes(arg)) {
			safeArgs.push(arg)
			continue
		}

		refCount++
		if (refCount > 1) {
			throw new Error("git show only allows one ref argument.")
		}

		assertSafeGitRef(arg)
		safeArgs.push(arg)
	}

	return safeArgs
}

function buildSafeDiffArguments(argsJson: string): string[] {
	const args = parseGitArgumentArray(argsJson)
	const safeArgs: string[] = []
	let refCount = 0
	let isReadingPathspecs = false

	for (const arg of args) {
		if (!isReadingPathspecs && ["--stat", "--name-only", "--cached"].includes(arg)) {
			safeArgs.push(arg)
			continue
		}

		if (arg === "--") {
			isReadingPathspecs = true
			safeArgs.push(arg)
			continue
		}

		if (isReadingPathspecs) {
			assertSafeGitPathspec(arg)
			safeArgs.push(arg)
			continue
		}

		refCount++
		if (refCount > 2) {
			throw new Error("git diff only allows up to two ref arguments before -- pathspecs.")
		}

		assertSafeGitRef(arg)
		safeArgs.push(arg)
	}

	return safeArgs
}

function buildSafeRevParseArguments(argsJson: string): string[] {
	const args = parseGitArgumentArray(argsJson)
	const safeArgs: string[] = []

	for (const arg of args) {
		if (["--show-toplevel", "--is-inside-work-tree", "--abbrev-ref", "--short"].includes(arg)) {
			safeArgs.push(arg)
			continue
		}

		assertSafeGitRef(arg)
		safeArgs.push(arg)
	}

	return safeArgs
}

export function buildSafeGitArguments(operation: AllowedGitOperation, argsJson: string): string[] {
	if (operation === "status") return buildSafeStatusArguments(argsJson)
	if (operation === "log") return buildSafeLogArguments(argsJson)
	if (operation === "show") return buildSafeShowArguments(argsJson)
	if (operation === "diff") return buildSafeDiffArguments(argsJson)
	if (operation === "rev-parse") return buildSafeRevParseArguments(argsJson)

	throw new Error(`Unsupported git operation "${operation}".`)
}

function buildClonePath(owner: string, name: string): string {
	return path.join(FLOW_EXPLORER_TEMP_ROOT, owner, name)
}

async function ensurePathStaysInsideTempRoot(candidatePath: string): Promise<string> {
	const tempRoot = await fs.realpath(FLOW_EXPLORER_TEMP_ROOT).catch(async (error) => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		await fs.mkdir(FLOW_EXPLORER_TEMP_ROOT, { recursive: true })
		return fs.realpath(FLOW_EXPLORER_TEMP_ROOT)
	})
	const realCandidatePath = await fs.realpath(candidatePath)
	const relativePath = path.relative(tempRoot, realCandidatePath)

	if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
		return realCandidatePath
	}

	throw new Error(`Path escapes kdco-flow temp root: ${candidatePath}`)
}

async function ensureExactCloneDirectory(candidatePath: string, owner: string, name: string): Promise<string> {
	const tempRoot = await fs.realpath(FLOW_EXPLORER_TEMP_ROOT)
	const realCandidatePath = await ensurePathStaysInsideTempRoot(candidatePath)
	const relativePath = path.relative(tempRoot, realCandidatePath)
	const relativeSegments = relativePath.split(path.sep)

	if (relativeSegments.length === 2 && relativeSegments[0] === owner && relativeSegments[1] === name) {
		return realCandidatePath
	}

	throw new Error(`Path is not the exact kdco-flow clone directory for ${owner}/${name}: ${candidatePath}`)
}

function formatToolError(error: unknown): string {
	if (error instanceof Error) return `Blocked: ${error.message}`

	return "Blocked: Unknown flow explorer error."
}

async function runGitWithoutShell(args: string[], cwd?: string): Promise<string> {
	const { stdout, stderr } = await execFileAsync("git", args, {
		cwd,
		timeout: 120_000,
		maxBuffer: 1024 * 1024 * 10,
	})

	return [stdout, stderr].filter(Boolean).join("\n").trim()
}

const FLOW_SYSTEM_RULES = `<system-reminder>
<kdco-flow policy_level="critical">

## KDCO Flow State Machine

You are operating under the kdco/flow harness. Drive work through this sequence:

1. Intake
2. Research/Exploration
3. Plan Draft
4. Plan Review
5. Implementation
6. QA Review
7. Finalize
8. Done

Blocked is the only non-terminal stop state. Enter Blocked only for impossible, unsafe, or externally unavailable work.

## Gate Rules

- Implementation MUST NOT start until the plan-reviewer returns APPROVE.
- A plan MUST be saved with \`plan_save\` before plan review.
- The plan-reviewer MUST inspect saved plan content from \`plan_read\` before approving.
- Implementation MUST NOT start until the saved plan exists and the plan-reviewer returns APPROVE.
- Final commit, PR, or final report MUST NOT occur until the qa-reviewer returns APPROVE.
- If either reviewer returns REQUEST_CHANGES, address the feedback and request that same review again.

## Agent Boundaries

| Agent | Boundary |
|-------|----------|
| conductor | Main read-only orchestrator. Owns state transitions and delegation only. |
| researcher | Read-only external documentation and current-source research. |
| explorer | Read-only code/repo exploration, including external clone reading inside the harness temp root only. |
| plan-reviewer | Read-only plan and high-level logic gate. |
| coder | Write-capable implementation and verification only after plan approval. |
| qa-reviewer | Read-only QA/manual-experience gate before any final terminal goal. |

## Autonomy Contract

Full autonomy mode means you do not return to the user during intermediate states. Continue until Done or Blocked.

Allowed terminal goals:
- pr: after QA APPROVE, prepare/open the PR into \`main\` through delegated execution when permitted by the user or task, unless the user explicitly overrides the target branch.
- commit: after QA APPROVE, create the final commit through delegated execution when permitted by the user or task.
- report: after QA APPROVE, provide the final implementation report.

If the requested terminal goal is not explicit, use report.

</kdco-flow>
</system-reminder>`

function shouldInjectFlowRules(agent: string | undefined): boolean {
	if (!agent) return false

	return ["conductor", "plan", "build"].includes(agent)
}

export const FlowPlugin: Plugin = async () => {
	return {
		tool: {
			flow_explorer_clone: tool({
				description:
					"Clone a repository into the kdco/flow explorer temp root using non-shell git execution. Only for the explorer agent.",
				args: {
					repositoryUrl: tool.schema.string().describe("HTTPS repository URL to clone."),
					owner: tool.schema.string().describe("Repository owner directory under the temp root."),
					name: tool.schema.string().describe("Repository name directory under the owner."),
				},
				async execute(args) {
					try {
						const repositoryUrl = parseRepositoryUrl(args.repositoryUrl).toString()
						const owner = parseRepositoryOwner(args.owner)
						const name = parseRepositoryName(args.name)
						const clonePath = buildClonePath(owner, name)

						await fs.mkdir(path.dirname(clonePath), { recursive: true })
						const ownerRoot = await ensurePathStaysInsideTempRoot(path.dirname(clonePath))
						const existingClonePath = await fs.realpath(clonePath).catch(() => null)
						if (existingClonePath) {
							await ensureExactCloneDirectory(existingClonePath, owner, name)
							return `Clone already exists: ${existingClonePath}`
						}

						await runGitWithoutShell(["clone", "--", repositoryUrl, clonePath], ownerRoot)
						const realClonePath = await ensureExactCloneDirectory(clonePath, owner, name)

						return `Cloned ${owner}/${name} to ${realClonePath}`
					} catch (error) {
						return formatToolError(error)
					}
				},
			}),

			flow_explorer_git: tool({
				description:
					"Run an allowed read-only git metadata operation against a kdco/flow temp-root clone without invoking a shell.",
				args: {
					owner: tool.schema.string().describe("Repository owner directory under the temp root."),
					name: tool.schema.string().describe("Repository name directory under the owner."),
					operation: tool.schema.string().describe("Allowed operation: status, log, show, diff, or rev-parse."),
					argsJson: tool.schema
						.string()
						.describe('Additional git arguments as a JSON string array, for example ["--oneline", "--max-count=5"].'),
				},
				async execute(args) {
					try {
						const owner = parseRepositoryOwner(args.owner)
						const name = parseRepositoryName(args.name)
						const operation = parseGitOperation(args.operation)
						const gitArguments = buildSafeGitArguments(operation, args.argsJson)
						const clonePath = await ensureExactCloneDirectory(buildClonePath(owner, name), owner, name)
						const output = await runGitWithoutShell([operation, ...gitArguments], clonePath)

						return output || `git ${operation} completed with no output.`
					} catch (error) {
						return formatToolError(error)
					}
				},
			}),

			flow_explorer_cleanup: tool({
				description: "Delete one kdco/flow temp-root clone after validating its real path stays under the temp root.",
				args: {
					owner: tool.schema.string().describe("Repository owner directory under the temp root."),
					name: tool.schema.string().describe("Repository name directory under the owner."),
				},
				async execute(args) {
					try {
						const owner = parseRepositoryOwner(args.owner)
						const name = parseRepositoryName(args.name)
						const clonePath = await ensureExactCloneDirectory(buildClonePath(owner, name), owner, name)

						await fs.rm(clonePath, { recursive: true, force: true })

						return `Removed kdco-flow explorer clone: ${clonePath}`
					} catch (error) {
						return formatToolError(error)
					}
				},
			}),
		},

		"experimental.chat.system.transform": async (
			input: { sessionID?: string; model: unknown; agent?: string },
			output: { system: string[] },
		) => {
			if (!shouldInjectFlowRules(input.agent)) return

			output.system.push(FLOW_SYSTEM_RULES)
		},
	}
}

export default FlowPlugin
