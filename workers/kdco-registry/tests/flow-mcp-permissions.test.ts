import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"
import { parse } from "jsonc-parser"

const registryPath = join(import.meta.dir, "..", "registry.jsonc")
const conductorAgentPath = join(import.meta.dir, "..", "files", "agents", "conductor.md")

function readRegistry(): Record<string, unknown> {
	const registryContents = readFileSync(registryPath, "utf8")
	return parse(registryContents) as Record<string, unknown>
}

function readComponent(name: string): Record<string, unknown> {
	const registry = readRegistry()
	const components = registry.components

	if (!Array.isArray(components)) {
		throw new Error("Registry must define a components array.")
	}

	const component = components.find((candidate) => {
		return typeof candidate === "object" && candidate !== null && (candidate as { name?: unknown }).name === name
	})

	if (!component || typeof component !== "object") {
		throw new Error(`Registry component not found: ${name}`)
	}

	return component as Record<string, unknown>
}

function readNestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
	const child = parent[key]

	if (!child || typeof child !== "object" || Array.isArray(child)) {
		throw new Error(`Expected ${key} to be an object.`)
	}

	return child as Record<string, unknown>
}

const allowedGithubTools = [
	"github_get_me",
	"github_get_repository_tree",
	"github_get_file_contents",
	"github_search_code",
	"github_search_repositories",
	"github_get_commit",
	"github_list_branches",
	"github_list_commits",
	"github_list_tags",
	"github_search_issues",
	"github_search_pull_requests",
	"github_issue_read",
	"github_pull_request_read",
] as const

describe("kdco/flow GitHub MCP explorer permissions", () => {
	it("keeps the conductor prompt in the agent markdown instead of the flow bundle config", () => {
		const flow = readComponent("flow")
		const opencode = readNestedRecord(flow, "opencode")
		const agents = readNestedRecord(opencode, "agent")
		const conductor = readNestedRecord(agents, "conductor")
		const conductorMarkdown = readFileSync(conductorAgentPath, "utf8")

		expect(conductor.prompt).toBeUndefined()
		expect(conductorMarkdown).toContain("You are the kdco/flow conductor")
		expect(conductorMarkdown).toContain("full autonomy after the initial human/AI alignment phase")
		expect(conductorMarkdown).toContain("GitHub MCP read-only tools first")
		expect(conductorMarkdown).toContain("plan-reviewer")
		expect(conductorMarkdown).toContain("qa-reviewer")
	})

	it("uses hosted GitHub MCP in read-only mode with exact tool narrowing", () => {
		const explorer = readComponent("explorer")
		const opencode = readNestedRecord(explorer, "opencode")
		const mcp = readNestedRecord(opencode, "mcp")
		const github = readNestedRecord(mcp, "github")
		const headers = readNestedRecord(github, "headers")

		expect(github.type).toBe("remote")
		expect(github.url).toBe("https://api.githubcopilot.com/mcp/")
		expect(headers["X-MCP-Readonly"]).toBe("true")
		expect(headers["X-MCP-Tools"]).toBe(
			allowedGithubTools.map((tool) => tool.replace(/^github_/, "")).join(","),
		)
	})

	it("denies GitHub MCP globally and allows only documented read-only explorer tools", () => {
		const explorer = readComponent("explorer")
		const opencode = readNestedRecord(explorer, "opencode")
		const globalPermission = readNestedRecord(opencode, "permission")
		const agents = readNestedRecord(opencode, "agent")
		const explorerAgent = readNestedRecord(agents, "explorer")
		const explorerPermission = readNestedRecord(explorerAgent, "permission")

		expect(globalPermission["github_*"]).toBe("deny")

		const githubPermissions = Object.entries(explorerPermission).filter(([toolName]) => toolName.startsWith("github_"))
		expect(githubPermissions).toEqual(allowedGithubTools.map((toolName) => [toolName, "allow"]))
	})

	it("allows only explorer to use the minimal clone cleanup primitive", () => {
		const explorer = readComponent("explorer")
		const opencode = readNestedRecord(explorer, "opencode")
		const globalPermission = readNestedRecord(opencode, "permission")
		const agents = readNestedRecord(opencode, "agent")
		const explorerAgent = readNestedRecord(agents, "explorer")
		const explorerPermission = readNestedRecord(explorerAgent, "permission")

		expect(globalPermission["explorer_clone*"]).toBe("deny")
		expect(explorerPermission.explorer_clone).toBe("allow")
		expect(explorerPermission.explorer_clone_cleanup).toBe("allow")

		const clonePermissions = Object.keys(explorerPermission).filter((toolName) => toolName.startsWith("explorer_clone"))
		expect(clonePermissions.sort()).toEqual(["explorer_clone", "explorer_clone_cleanup"])
	})

	it("ships the narrow explorer clone plugin in kdco/flow without a broad git wrapper", () => {
		const explorerClone = readComponent("explorer-clone")
		const flow = readComponent("flow")
		const explorer = readComponent("explorer")
		const dependencies = flow.dependencies
		const explorerDependencies = explorer.dependencies

		if (!Array.isArray(dependencies) || !Array.isArray(explorerDependencies)) {
			throw new Error("Flow and explorer components must define dependencies.")
		}

		expect(explorerClone.files).toEqual(["plugins/explorer-clone.ts"])
		expect(dependencies).toContain("explorer-clone")
		expect(explorerDependencies).toContain("explorer-clone")
		expect(dependencies).not.toContain(["flow", "plugin"].join("-"))
		expect(dependencies).not.toContain(["flow", "explorer", "git"].join("_"))
	})

	it("keeps the flow bundle free of the removed custom explorer plugin", () => {
		const registry = readRegistry()
		const components = registry.components

		if (!Array.isArray(components)) {
			throw new Error("Registry must define a components array.")
		}

		const componentNames = components.map((component) => (component as { name?: unknown }).name)
		const flow = readComponent("flow")
		const dependencies = flow.dependencies
		const removedCustomExplorerPluginName = ["flow", "plugin"].join("-")

		if (!Array.isArray(dependencies)) {
			throw new Error("Flow bundle must define dependencies.")
		}

		expect(componentNames).not.toContain(removedCustomExplorerPluginName)
		expect(dependencies).not.toContain(removedCustomExplorerPluginName)
	})
})
