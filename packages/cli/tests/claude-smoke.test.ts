// End-to-end smoke for the ported Claude translation pipeline (from ccx).
// Builds a fake OpenCode profile, runs the pipeline, asserts Claude-shaped output.

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runPipeline } from "../src/claude/pipeline"
import { resolveTarget } from "../src/claude/resolve"
import { asClaudeDir, asProfileDir, asProjectRoot } from "../src/claude/types"

let workDir: string
let profileDir: string
let projectRoot: string
let claudeDir: string

beforeAll(() => {
	workDir = mkdtempSync(join(tmpdir(), "ocx-claude-smoke-"))
	profileDir = join(workDir, "profile")
	projectRoot = join(workDir, "project")
	claudeDir = join(projectRoot, ".claude")

	mkdirSync(join(profileDir, "agents"), { recursive: true })
	mkdirSync(join(profileDir, "commands"), { recursive: true })
	mkdirSync(join(profileDir, "skills/sample-skill/references"), { recursive: true })
	mkdirSync(join(profileDir, ".ccx"), { recursive: true })

	writeFileSync(join(profileDir, "AGENTS.md"), "# Test profile\n\nUse TypeScript strict mode.\n")

	writeFileSync(
		join(profileDir, "opencode.jsonc"),
		JSON.stringify({
			mcp: {
				local_one: {
					type: "local",
					command: ["npx", "-y", "@example/mcp"],
					environment: { KEY: "value" },
					enabled: true,
				},
				remote_one: { type: "remote", url: "https://example.com/mcp", enabled: true },
			},
			permission: {
				bash: { "git *": "allow", "rm *": "deny", "*": "ask" },
				edit: "allow",
			},
		}),
	)

	writeFileSync(
		join(profileDir, "commands/greet.md"),
		"---\ndescription: Greet the user\nmodel: claude-sonnet-4-5\nagent: coding\n---\nSay hello.\n",
	)

	writeFileSync(
		join(profileDir, "agents/reviewer.md"),
		"---\ndescription: Reviewer\nmode: subagent\ntools:\n  read: true\n  write: false\n  bash: true\ntemperature: 0.2\n---\nReview code.\n",
	)

	writeFileSync(
		join(profileDir, "skills/sample-skill/SKILL.md"),
		"---\nname: sample-skill\ndescription: Sample\n---\nSkill body.\n",
	)

	writeFileSync(join(profileDir, "skills/sample-skill/references/notes.md"), "Reference content.\n")

	writeFileSync(
		join(profileDir, ".ccx/hooks.json"),
		JSON.stringify({
			version: 1,
			hooks: {
				sessionStart: [{ type: "command", command: "echo hi" }],
				preToolUse: [{ type: "command", command: "bun lint", matcher: "Write|Edit" }],
			},
		}),
	)

	mkdirSync(projectRoot, { recursive: true })
})

afterAll(() => {
	rmSync(workDir, { recursive: true, force: true })
})

describe("claude pipeline (ported from ccx)", () => {
	test("translates all 7 components into Claude shape", async () => {
		const report = await runPipeline({
			source: { profileDir: asProfileDir(profileDir), profileName: "smoketest" },
			target: {
				scope: "project",
				claudeDir: asClaudeDir(claudeDir),
				projectRoot: asProjectRoot(projectRoot),
			},
		})

		const errors = report.results.filter((r) => r.status === "error")
		expect(errors).toHaveLength(0)
		expect(report.results).toHaveLength(7)
	})

	test("writes CLAUDE.md from AGENTS.md", () => {
		const p = join(claudeDir, "CLAUDE.md")
		expect(existsSync(p)).toBe(true)
		expect(readFileSync(p, "utf-8")).toContain("Use TypeScript strict mode")
	})

	test("writes .mcp.json with translated server shapes", () => {
		const p = join(projectRoot, ".mcp.json")
		expect(existsSync(p)).toBe(true)
		const mcp = JSON.parse(readFileSync(p, "utf-8")) as {
			mcpServers: Record<
				string,
				{
					type: string
					command?: string
					args?: string[]
					env?: Record<string, string>
					url?: string
				}
			>
		}
		expect(mcp.mcpServers.local_one?.type).toBe("stdio")
		expect(mcp.mcpServers.local_one?.command).toBe("npx")
		expect(mcp.mcpServers.local_one?.args).toEqual(["-y", "@example/mcp"])
		expect(mcp.mcpServers.local_one?.env).toEqual({ KEY: "value" })
		expect(mcp.mcpServers.remote_one?.type).toBe("http")
		expect(mcp.mcpServers.remote_one?.url).toBe("https://example.com/mcp")
	})

	test("writes commands/greet.md with agent field stripped", () => {
		const p = join(claudeDir, "commands/greet.md")
		expect(existsSync(p)).toBe(true)
		const content = readFileSync(p, "utf-8")
		expect(content).toContain("description: Greet the user")
		expect(content).toContain("model: claude-sonnet-4-5")
		expect(content).not.toContain("agent:")
	})

	test("writes agents/reviewer.md with tools as filtered string list", () => {
		const p = join(claudeDir, "agents/reviewer.md")
		expect(existsSync(p)).toBe(true)
		const content = readFileSync(p, "utf-8")
		expect(content).toMatch(/tools:\s*['"]?read,\s*bash['"]?/)
		expect(content).not.toContain("mode:")
		expect(content).not.toContain("temperature:")
	})

	test("mirrors skill SKILL.md + support files", () => {
		expect(existsSync(join(claudeDir, "skills/sample-skill/SKILL.md"))).toBe(true)
		expect(existsSync(join(claudeDir, "skills/sample-skill/references/notes.md"))).toBe(true)
		expect(readFileSync(join(claudeDir, "skills/sample-skill/references/notes.md"), "utf-8")).toBe(
			"Reference content.\n",
		)
	})

	test("merges hooks + permissions into settings.local.json", () => {
		const p = join(claudeDir, "settings.local.json")
		expect(existsSync(p)).toBe(true)
		const settings = JSON.parse(readFileSync(p, "utf-8")) as {
			hooks?: Record<string, unknown>
			permissions?: { allow?: string[]; deny?: string[]; ask?: string[] }
		}
		expect(settings.hooks).toBeDefined()
		expect(settings.hooks?.SessionStart).toBeDefined()
		expect(settings.hooks?.PreToolUse).toBeDefined()
		expect(settings.permissions?.allow).toContain("Bash(git *)")
		expect(settings.permissions?.deny).toContain("Bash(rm *)")
		expect(settings.permissions?.ask).toContain("Bash")
	})

	test("cleans up .ccx-fragments after merge", () => {
		expect(existsSync(join(claudeDir, ".ccx-fragments"))).toBe(false)
	})
})

describe("claude target resolution", () => {
	test("project scope targets <cwd>/.claude", () => {
		const t = resolveTarget({ scope: "project", cwd: "/tmp/example-project" })
		expect(t.scope).toBe("project")
		expect(t.claudeDir).toBe("/tmp/example-project/.claude")
		expect(t.projectRoot).toBe("/tmp/example-project")
	})

	test("global scope targets ~/.claude", () => {
		const t = resolveTarget({ scope: "global" })
		expect(t.scope).toBe("global")
		expect(t.claudeDir.endsWith("/.claude")).toBe(true)
	})
})
