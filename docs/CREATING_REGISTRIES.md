# Creating OCX Registries

OCX registries are collections of components (agents, skills, plugins, commands) distributed as JSON packuments. This guide covers how to build and distribute your own registry.

> **See also:** [Registry Protocol Specification](./REGISTRY_PROTOCOL.md) for the HTTP API that registries must implement.

## Quick Start (Cloudflare Workers)

See `examples/registry-starter` for a minimal reference implementation. This guide covers how to build and distribute your own registry using Cloudflare Workers with static assets.

```bash
# Build the registry (generates dist/)
bun run build

# Deploy to Cloudflare Workers
bun run deploy
```

The build step runs `ocx build . --out dist` which:
1. Validates `registry.jsonc` against the schema
2. Generates `index.json` and component packuments
3. Copies component files to `dist/components/`
4. Generates `.well-known/ocx.json` for discovery

## Registry Philosophy

OCX follows the **Cargo + ShadCN model**:

1. **Namespace as Identity**: Every registry declares a `namespace` (e.g., `kdco`). Components are referenced as `namespace/component` (e.g., `kdco/researcher`).
2. **Clean Component Names**: Components within a registry use clean names (`researcher`, not `kdco-researcher`). The namespace provides provenance.
3. **Explicit Trust**: Cross-namespace dependencies require the user to have that registry configured. No auto-fetching from unknown sources.
4. **Own Your Code**: Components are copied into your project with clean filenames. The receipt file tracks provenance.

## Structure

A registry source directory should look like this:

```
my-registry/
├── registry.jsonc    # Registry manifest
└── files/            # Component source files
    ├── agents/
    ├── plugins/
    ├── skills/
    └── commands/
```

### registry.jsonc

OCX uses **Cargo-style union types** for a clean developer experience: use strings for simple cases, objects when you need more control.

```json
{
  "name": "My Extensions",
  "namespace": "my",
  "version": "1.0.0",
  "author": "Your Name",
  "components": [
    {
      "name": "cool-plugin",
      "type": "plugin",
      "description": "Does something cool",
      "files": ["plugins/my-cool-plugin.ts"],
      "dependencies": []
    }
  ]
}
```

**Key fields:**
- `namespace`: Your registry's unique identifier (lowercase, alphanumeric, hyphens). Users reference components as `namespace/component`.
- `name`: Clean component name (no prefix required). The namespace provides provenance.
- `dependencies`: Use bare names for same-namespace deps (`["utils"]`), qualified names for cross-namespace (`["other/utils"]`).

## Cargo-Style Patterns

### Files

Use string shorthand when the target can be auto-inferred from the path:

```json
// String shorthand (recommended)
"files": ["plugins/my-plugin.ts"]
// Expands to: { "path": "plugins/my-plugin.ts", "target": "plugins/my-plugin.ts" }

// Full object (when you need a custom target)
// Note: V2 uses root-relative targets (no .opencode/ prefix)
"files": [
  {
    "path": "skills/my-skill/SKILL.md",
    "target": "skills/my-skill/SKILL.md"
  }
]
```

### MCP Servers

MCP servers are configured inside the `opencode` block using URL shorthand for remote servers:

```json
"opencode": {
  "mcp": {
    "context7": "https://mcp.context7.com/mcp"
  }
}
// Expands to: { "type": "remote", "url": "https://...", "enabled": true }

// Full object (for local servers or advanced config)
"opencode": {
  "mcp": {
    "local-mcp": {
      "type": "local",
      "command": ["node", "server.js", "--port", "3000"],
      "environment": { "DEBUG": "true" }
    }
  }
}
```

### OpenCode Config Block

Components can specify settings to merge into the user's `opencode.jsonc`:

## Plugin Discovery vs Registration

OpenCode handles plugins in two different ways depending on how they're installed:

### File-Based Plugins (Auto-Discovered)

Registry components with `type: "plugin"` install files to the `plugins/` directory. OpenCode **automatically discovers** these plugins - no configuration needed.

```bash
ocx add kdco/workspace-plugin
# Installs to: plugins/workspace-plugin.ts
# OpenCode auto-discovers it - no opencode.jsonc entry needed
```

### npm Plugins (Explicitly Registered)

npm plugins are installed via `ocx add npm:package-name` and require registration in `opencode.jsonc`:

```bash
ocx add npm:@franlol/opencode-md-table-formatter
# Installs to: node_modules/
# Adds to opencode.jsonc: {"plugin": ["@franlol/opencode-md-table-formatter"]}
```

### The `opencode` Field in Component Manifests

When a component manifest includes an `opencode` field, it specifies **configuration to merge** into the user's `opencode.jsonc`. This is used for:

- **npm dependencies** the component needs (via `opencode.plugin`)
- **Permissions** the component requires (via `opencode.permission`)
- **Other OpenCode settings** the component wants to configure

```jsonc
{
  "name": "background-agents",
  "type": "plugin",
  "files": ["plugins/background-agents.ts"],
  "opencode": {
    "permission": {
      "task": "deny"  // This permission gets merged into opencode.jsonc
    }
  }
}
```

The component itself does NOT need to be listed in `opencode.plugin` - it's auto-discovered from the `plugins/` directory.

---

```json
{
  "name": "my-agent",
  "type": "agent",
  "files": ["agents/my-agent.md"],
  "dependencies": [],
  "opencode": {
    "plugin": ["@some-org/opencode-plugin"],
    "tools": {
      "webfetch": false
    },
    "agent": {
      "my-agent": {
        "tools": {
          "read": true,
          "write": true,
          "bash": false
        },
        "temperature": 0.7
      }
    },
    "instructions": ["Always follow best practices"]
  }
}
```

| Field | Description |
|-------|-------------|
| `opencode.mcp` | MCP servers (URL shorthand or full config) |
| `opencode.plugin` | npm packages added to `opencode.jsonc` plugin array |
| `opencode.tools` | Global tool enable/disable settings |
| `opencode.agent` | Per-agent configuration (tools, temperature, permission, prompt) |
| `opencode.permission` | Permission settings for bash/edit/mcp |
| `opencode.instructions` | Global instructions appended to config |
| `npmDependencies` | Array of npm packages required by this component |
| `permission` | Permission level for the component (`dangerous`, `normal`) |

## Component Types

| Type | Target Directory | Description |
|------|-----------------|-------------|
| `agent` | `agents/` | Markdown files defining specialized agents. |
| `skill` | `skills/` | Instruction sets (must follow `skills/<name>/SKILL.md`). |
| `plugin` | `plugins/` | TypeScript/JavaScript extensions for tools and hooks. |
| `command` | `commands/` | Markdown templates for TUI commands. |
| `tool` | `tools/` | Custom tool implementations. |
| `bundle` | N/A | Virtual components that install multiple other components. |
| `profile` | N/A | Shareable profile configuration. |

## Building

Use the OCX CLI to validate and build your registry:

```bash
ocx build ./my-registry --out dist
```

This command will:
1. Validate your `registry.jsonc` against the Zod schema.
2. Verify that all listed dependencies exist (same-namespace) or are properly qualified (cross-namespace).
3. Generate an `index.json` and individual packument files (e.g., `cool-plugin.json`) in the output directory.

## Distribution

OCX registries are static JSON files served via Cloudflare Workers static assets, or any static file host (Vercel, Netlify, GitHub Pages, etc.).

### Hosted Registry Structure

After running `ocx build`, your `dist/` folder contains:

```
dist/
├── .well-known/
│   └── ocx.json           # Discovery endpoint
├── index.json             # Registry index
└── components/
    ├── cool-plugin.json   # Component packument
    └── cool-plugin/
        └── plugin.ts      # Raw file content
```

### Cloudflare Workers (Recommended)

This registry uses Cloudflare Workers with static assets. The `wrangler.jsonc` config points to `dist/` as the assets directory:

```jsonc
{
  "name": "kdco-registry",
  "assets": { "directory": "./dist" }
}
```

Deploy with `wrangler deploy` after building.

### Registry Discovery (Optional)

Add a `/.well-known/ocx.json` endpoint to enable automatic discovery:

```json
{
  "version": 1,
  "registry": "/index.json"
}
```

This allows users to register using just the domain:
```bash
ocx registry add https://example.com --name my
```

Without discovery, users must specify the full index URL.

### Adding and Using Registries

Users can add your registry using:
```bash
ocx registry add https://example.com/registry --name my
```

> **Tip:** Use `--global` to add the registry to your global config for profile management (e.g., `ocx profile add --from registry/profile`). For project work, configure registries in your profile or local config:
> ```bash
> ocx registry add https://example.com --name my --global
> ```

After adding the registry, users install components with:
```bash
ocx add my/cool-plugin
```

## Dependencies

### Instruction Files for Registry Components

Registry components can provide instruction files in two ways: **discovery-based** and **config-based**.

#### Discovery-Based Instructions (Not Recommended for Registries)

**Do NOT install to `AGENTS.md`, `CLAUDE.md`, or `CONTEXT.md` in standard locations:**
- `.opencode/AGENTS.md` or project root `AGENTS.md` are reserved for user's project-specific instructions
- Subject to OpenCode's "first type wins" discovery and profile `exclude`/`include` filtering
- Can conflict with user's own instruction files

#### Config-Based Instructions (Recommended)

Use custom paths with the `instructions` config field instead:

```jsonc
{
  "name": "my-component",
  "type": "bundle",
  "files": ["instructions/my-guidelines.md"],
  "opencode": {
    "instructions": ["instructions/my-guidelines.md"]
  }
}
```

**Path Resolution for Registry Components:**
- Registry `opencode.instructions` paths are **install-root-relative** (not cwd-relative)
- OCX resolves them to absolute paths at runtime based on installation scope (project, profile, or global)
- **Absolute paths are NOT allowed** in registry components
- User-defined `opencode.jsonc` instructions remain OpenCode-native (cwd-relative)

**Example:**
```jsonc
{
  "name": "coding-standards",
  "files": ["instructions/style-guide.md"],
  "opencode": {
    "instructions": ["instructions/style-guide.md"]
  }
}
```

When installed via `ocx add`, the path `instructions/style-guide.md` resolves to:
- **Project**: `.opencode/instructions/style-guide.md`
- **Profile**: `~/.config/opencode/profiles/myprofile/instructions/style-guide.md`
- **Global**: `~/.config/opencode/instructions/style-guide.md`

**Benefits of config-based approach:**
- **Bypass filtering**: Config-based instructions are **always loaded** and **bypass** profile `exclude`/`include` patterns
- **No conflicts**: Avoids overwriting user's `AGENTS.md`
- **Explicit loading**: Clear what gets loaded via `opencode.jsonc`
- **Additive**: Works alongside discovered instruction files

**Caution**: Because config-based instructions bypass filtering, users installing your component will load these instructions even in untrusted repositories. Design your instruction files accordingly.

## Component Dependencies

### Same-Namespace Dependencies

Use bare component names for dependencies within the same registry:

```json
{
  "name": "researcher",
  "dependencies": ["background-agents", "utils"]
}
```

These resolve to `my/background-agents` and `my/utils` automatically.

### Cross-Namespace Dependencies

Use qualified names for dependencies from other registries:

```json
{
  "name": "researcher",
  "dependencies": ["background-agents", "acme/shared-utils"]
}
```

The user must have the `acme` registry configured in their `ocx.jsonc` for cross-namespace deps to resolve.

## Conflict Handling

If a user tries to install a component that would overwrite an existing file from a different component:

```bash
$ ocx add acme/researcher
Error: File conflict detected
  agent/researcher.md already exists (installed from kdco/researcher)

To resolve:
  1. Remove existing file and update receipt
  2. Or rename existing file manually
  3. Then retry: ocx add acme/researcher
```
