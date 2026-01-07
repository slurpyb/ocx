# OCX CLI Reference

Command-line interface for managing OpenCode extensions and component registries.

## Installation

```bash
# Using bun (recommended)
bunx @ocx/cli <command>

# Or install globally
bun add -g @ocx/cli
ocx <command>
```

## Commands

- [`ocx init`](#ocx-init) - Initialize OCX in your project
- [`ocx add`](#ocx-add) - Add components from a registry
- [`ocx update`](#ocx-update) - Update installed components
- [`ocx diff`](#ocx-diff) - Compare installed vs upstream
- [`ocx search`](#ocx-search) - Search for components
- [`ocx registry`](#ocx-registry) - Manage registries
- [`ocx build`](#ocx-build) - Build a registry from source

---

## ocx init

Initialize OCX configuration in your project or scaffold a new registry.

### Usage

```bash
ocx init [directory] [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `directory` | Target directory (default: current directory) |

### Options

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip prompts and use defaults |
| `--cwd <path>` | Working directory (default: current directory) |
| `-q, --quiet` | Suppress output |
| `-v, --verbose` | Verbose output |
| `--json` | Output as JSON |
| `--registry` | Scaffold a new OCX registry project |
| `--namespace <name>` | Registry namespace (e.g., `my-org`) |
| `--author <name>` | Author name for the registry |
| `--canary` | Use canary (main branch) instead of latest release |
| `--local <path>` | Use local template directory instead of fetching |

### Examples

```bash
# Initialize in current directory
ocx init

# Initialize with defaults (no prompts)
ocx init -y

# Overwrite existing configuration
ocx init --yes

# Initialize in a specific directory
ocx init ./my-project
```

### Scaffolding a Registry

```bash
# Create a new registry project
ocx init my-registry --registry --namespace my-org

# Use custom author
ocx init my-registry --registry --namespace acme --author "Acme Corp"

# Use latest development version
ocx init my-registry --registry --canary
```

### Output Files

After initialization, OCX creates:

| File | Description |
|------|-------------|
| `ocx.jsonc` | Configuration file with registry settings |
| `ocx.lock` | Lock file tracking installed components |

### Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `ocx.jsonc already exists` | Config file exists | Use `--yes` to overwrite |
| `Invalid namespace format` | Namespace contains invalid characters | Use lowercase letters, numbers, and hyphens only |
| `Directory is not empty` | Target directory has files | Use `--yes` to proceed anyway |

---

## ocx add

Add components from configured registries to your project.

### Usage

```bash
ocx add <components...> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `components` | One or more components to install (required) |

### Options

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip prompts and overwrite files |
| `--dry-run` | Show what would be installed without making changes |
| `--cwd <path>` | Working directory (default: current directory) |
| `-q, --quiet` | Suppress output |
| `-v, --verbose` | Verbose output |
| `--json` | Output as JSON |

### Component Syntax

Components can be specified in two formats:

```bash
# Fully qualified (recommended)
ocx add kdco/agents

# Multiple components
ocx add kdco/agents kdco/skills kdco/plugins
```

### Examples

```bash
# Add a single component
ocx add kdco/background-agents

# Add multiple components
ocx add kdco/agents kdco/notify

# Preview installation
ocx add kdco/agents --dry-run

# Overwrite existing files without prompts
ocx add kdco/agents --yes

# Get machine-readable output
ocx add kdco/agents --json

# Verbose output showing all file operations
ocx add kdco/agents --verbose
```

### Behavior

1. **Resolves dependencies** - Fetches component manifest and resolves any dependencies
2. **Pre-flight checks** - Validates all files before writing any (atomic operation)
3. **Conflict detection** - Checks for modified local files
4. **Writes files** - Installs component files to target paths
5. **Updates opencode.jsonc** - Merges component configuration
6. **Updates lock file** - Records installed version and hash

### Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `No ocx.jsonc found` | Not initialized | Run `ocx init` first |
| `File conflicts detected` | Local files modified | Use `--yes` to overwrite or review changes |
| `Integrity check failed` | Hash mismatch | Component was modified; resolve manually |
| `File conflict: already exists` | Another component installed this file | Remove conflicting file first |

---

## ocx update

Update installed components to their latest versions or pin to specific versions.

### Usage

```bash
ocx update [components...] [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `components` | Components to update (optional with `--all` or `--registry`) |

### Options

| Option | Description |
|--------|-------------|
| `--all` | Update all installed components |
| `--registry <name>` | Update all components from a specific registry |
| `--dry-run` | Preview changes without applying |
| `--cwd <path>` | Working directory (default: current directory) |
| `-q, --quiet` | Suppress output |
| `-v, --verbose` | Verbose output |
| `--json` | Output as JSON |

### Version Pinning

Use the `@version` syntax (like npm/bun) to pin to a specific version:

```bash
# Pin to specific version
ocx update kdco/agents@1.2.0

# Multiple components with different versions
ocx update kdco/agents@1.2.0 kdco/skills@2.0.0
```

### Examples

```bash
# Update a specific component to latest
ocx update kdco/background-agents

# Update multiple components
ocx update kdco/agents kdco/plugins

# Update all installed components
ocx update --all

# Preview what would be updated
ocx update --all --dry-run

# Update all components from one registry
ocx update --registry kdco

# Pin to a specific version
ocx update kdco/agents@1.2.0

# Get machine-readable output
ocx update --all --json

# Verbose output showing file changes
ocx update kdco/agents --verbose
```

### Behavior

1. **Validates arguments** - Ensures valid component selection
2. **Fetches latest versions** - Gets current registry state
3. **Compares hashes** - Determines which components have changes
4. **Applies updates** - Writes new files (skipped in dry-run mode)
5. **Updates lock file** - Records new version and hash

### Dry Run Output

```bash
$ ocx update --all --dry-run

Would update:
  kdco/agents (1.0.0 → 1.2.0)
  kdco/plugins (0.5.0 → 0.6.0)

Already up to date:
  kdco/skills

Run without --dry-run to apply changes.
```

### Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `No ocx.jsonc found` | Not initialized | Run `ocx init` first |
| `Nothing installed yet` | Lock file empty | Run `ocx add <component>` first |
| `Specify components, use --all, or use --registry` | No arguments provided | Provide components or use a flag |
| `Cannot specify components with --all` | Mutually exclusive options | Use one or the other |
| `Cannot specify components with --registry` | Mutually exclusive options | Use one or the other |
| `Cannot use --all with --registry` | Mutually exclusive options | Use one or the other |
| `Component 'name' must include a registry prefix` | Missing namespace | Use fully qualified name (e.g., `kdco/agents`) |
| `Component 'name' is not installed` | Not in lock file | Install first with `ocx add` |
| `Invalid version specifier` | Empty version after `@` | Provide version or omit `@` |

---

## ocx diff

Show differences between installed components and upstream registry versions.

### Usage

```bash
ocx diff [component] [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `component` | Component to diff (optional; diffs all if omitted) |

### Options

| Option | Description |
|--------|-------------|
| `--cwd <path>` | Working directory (default: current directory) |
| `--json` | Output as JSON |
| `-q, --quiet` | Suppress output |

### Examples

```bash
# Diff all installed components
ocx diff

# Diff a specific component
ocx diff kdco/agents

# Get machine-readable output
ocx diff --json

# Diff with quiet mode (only show differences)
ocx diff --quiet
```

### Output

Components without changes show a success message:

```bash
$ ocx diff kdco/agents
kdco/agents: No changes
```

Modified components show a unified diff:

```bash
$ ocx diff kdco/plugins

Diff for kdco/plugins:
--- upstream
+++ local
@@ -10,6 +10,7 @@
 export function notify() {
+  console.log("Debug: entering notify")
   // ...
 }
```

### Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `No ocx.lock found` | No lock file | Run `ocx add` first |
| `No ocx.jsonc found` | Not initialized | Run `ocx init` first |
| `Component 'name' not found in lockfile` | Not installed | Check spelling or install first |
| `Registry 'name' not configured` | Registry removed from config | Add registry back with `ocx registry add` |

---

## ocx search

Search for components across registries or list installed components.

### Usage

```bash
ocx search [query] [options]
```

### Aliases

```bash
ocx list [query] [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `query` | Search query (optional; lists all if omitted) |

### Options

| Option | Description |
|--------|-------------|
| `--cwd <path>` | Working directory (default: current directory) |
| `--json` | Output as JSON |
| `-q, --quiet` | Suppress output |
| `-v, --verbose` | Verbose output |
| `-i, --installed` | List installed components only |
| `-l, --limit <n>` | Limit results (default: 20) |

### Examples

```bash
# List all available components
ocx search

# Search for components
ocx search agents

# Search with a higher result limit
ocx search agents --limit 50

# List installed components only
ocx search --installed

# Get machine-readable output
ocx search --json

# Verbose output showing registry details
ocx search agents --verbose
```

### Output

```bash
$ ocx search agent
Found 3 components:
  kdco/agents (agent) - AI agent definitions
  kdco/background-agents (plugin) - Background agent sync plugin
  acme/agent-utils (lib) - Agent utility functions

$ ocx search --installed
Installed components (2):
  kdco/agents v1.2.0 from kdco
  kdco/plugins v0.5.0 from kdco
```

### Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `No ocx.jsonc found` | Not initialized | Run `ocx init` first |
| `No components installed` | Lock file empty | Run `ocx add` first |

---

## ocx registry

Manage configured registries.

### Subcommands

- [`ocx registry add`](#ocx-registry-add) - Add a registry
- [`ocx registry remove`](#ocx-registry-remove) - Remove a registry
- [`ocx registry list`](#ocx-registry-list) - List configured registries

---

### ocx registry add

Add a new registry to your configuration.

#### Usage

```bash
ocx registry add <url> [options]
```

#### Arguments

| Argument | Description |
|----------|-------------|
| `url` | Registry URL (required) |

#### Options

| Option | Description |
|--------|-------------|
| `--name <name>` | Registry alias (defaults to hostname) |
| `--version <version>` | Pin to specific version |
| `--cwd <path>` | Working directory (default: current directory) |
| `--json` | Output as JSON |
| `-q, --quiet` | Suppress output |

#### Examples

```bash
# Add a registry (name derived from hostname)
ocx registry add https://registry.example.com

# Add with custom name
ocx registry add https://registry.example.com --name myregistry

# Pin to specific version
ocx registry add https://registry.example.com --name myregistry --version 1.0.0

# Get machine-readable output
ocx registry add https://registry.example.com --json
```

#### Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `No ocx.jsonc found` | Not initialized | Run `ocx init` first |
| `Registries are locked` | `lockRegistries: true` in config | Remove lock or edit config manually |
| `Registry 'name' already exists` | Duplicate name | Use a different `--name` |

---

### ocx registry remove

Remove a registry from your configuration.

#### Usage

```bash
ocx registry remove <name> [options]
```

#### Arguments

| Argument | Description |
|----------|-------------|
| `name` | Registry name (required) |

#### Options

| Option | Description |
|--------|-------------|
| `--cwd <path>` | Working directory (default: current directory) |
| `--json` | Output as JSON |
| `-q, --quiet` | Suppress output |

#### Examples

```bash
# Remove a registry
ocx registry remove myregistry

# Get machine-readable output
ocx registry remove myregistry --json
```

#### Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `No ocx.jsonc found` | Not initialized | Run `ocx init` first |
| `Registries are locked` | `lockRegistries: true` in config | Remove lock or edit config manually |
| `Registry 'name' not found` | Registry doesn't exist | Check name with `ocx registry list` |

---

### ocx registry list

List all configured registries.

#### Usage

```bash
ocx registry list [options]
```

#### Options

| Option | Description |
|--------|-------------|
| `--cwd <path>` | Working directory (default: current directory) |
| `--json` | Output as JSON |
| `-q, --quiet` | Suppress output |

#### Examples

```bash
# List registries
ocx registry list

# Get machine-readable output
ocx registry list --json
```

#### Output

```bash
$ ocx registry list
Configured registries:
  kdco: https://ocx.kdco.dev (latest)
  acme: https://registry.acme.com (1.0.0)

$ ocx registry list --json
{
  "success": true,
  "data": {
    "registries": [
      { "name": "kdco", "url": "https://ocx.kdco.dev", "version": "latest" },
      { "name": "acme", "url": "https://registry.acme.com", "version": "1.0.0" }
    ],
    "locked": false
  }
}
```

---

## ocx build

Build a registry from source files. This command is for registry authors who want to publish their own components.

### Usage

```bash
ocx build [path] [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `path` | Registry source directory (default: current directory) |

### Options

| Option | Description |
|--------|-------------|
| `--out <dir>` | Output directory (default: `./dist`) |
| `--cwd <path>` | Working directory (default: current directory) |
| `--json` | Output as JSON |
| `-q, --quiet` | Suppress output |

### Examples

```bash
# Build registry in current directory
ocx build

# Build from specific directory
ocx build ./my-registry

# Specify output directory
ocx build --out ./public

# Get machine-readable output
ocx build --json
```

### Output

```bash
$ ocx build
Building registry...
Built 5 components to dist

$ ocx build --json
{
  "success": true,
  "data": {
    "name": "my-registry",
    "version": "1.0.0",
    "components": 5,
    "output": "/path/to/dist"
  }
}
```

### Source Structure

The build command expects a `registry.json` file in the source directory:

```
my-registry/
  registry.json         # Registry manifest
  files/
    agent/
      my-agent.md       # Agent definition
    plugin/
      my-plugin.ts      # Plugin file
    skill/
      my-skill/
        SKILL.md        # Skill definition
```

### Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Build errors | Invalid registry.json or missing files | Check error messages for details |

---

## Global Options

These options are available on all commands:

| Option | Description |
|--------|-------------|
| `--cwd <path>` | Set working directory |
| `--json` | Output as JSON for scripting |
| `-q, --quiet` | Suppress non-essential output |
| `-v, --verbose` | Show detailed output |
| `-h, --help` | Show help for command |
| `-V, --version` | Show version number |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Validation error |
| `3` | Not found |
| `4` | Network error |
| `5` | Configuration error |
| `6` | Conflict error |
| `7` | Integrity error |

---

## Configuration Files

### ocx.jsonc

Main configuration file created by `ocx init`:

```jsonc
{
  "$schema": "https://ocx.dev/schemas/ocx.schema.json",
  "registries": {
    "kdco": {
      "url": "https://ocx.kdco.dev",
      "version": "1.0.0"  // optional: pin version
    }
  },
  "lockRegistries": false  // prevent registry modification
}
```

### ocx.lock

Lock file tracking installed components (managed automatically):

```json
{
  "lockVersion": 1,
  "installed": {
    "kdco/agents": {
      "registry": "kdco",
      "version": "1.2.0",
      "hash": "abc123...",
      "files": [".opencode/agents.md"],
      "installedAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-20T14:00:00Z"
    }
  }
}
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OCX_NO_COLOR` | Disable colored output |
| `NO_COLOR` | Standard no-color flag |

---

## See Also

- [Registry Protocol](./REGISTRY_PROTOCOL.md) - How registries work
- [Contributing Guide](../CONTRIBUTING.md) - Development setup

---

## Ghost Mode Commands

Ghost mode lets you work in repositories without modifying them.

| Command | Description |
|---------|-------------|
| `ocx ghost init` | Initialize ghost mode (`~/.config/ocx/ghost.jsonc`) |
| `ocx ghost config` | Open ghost config in `$EDITOR` |
| `ocx ghost registry list` | List configured registries |
| `ocx ghost registry add <url> [--name <n>]` | Add a registry |
| `ocx ghost registry remove <name>` | Remove a registry |
| `ocx ghost add <component...>` | Add components using ghost config |
| `ocx ghost search [query]` | Search ghost registries |
| `ocx ghost opencode [args...]` | Run OpenCode with ghost config (isolated from project) |

**Alias:** All ghost commands support `ocx g` shorthand (e.g., `ocx g add`).

### Ghost Config Reference

The ghost config file (`~/.config/ocx/ghost.jsonc`) supports these fields:

| Field | Type | Description |
|-------|------|-------------|
| `registries` | `object` | Registry name → URL mapping |
| `componentPath` | `string` | Where to install components (default: `.opencode`) |
| `include` | `string[]` | Glob patterns for project files to include in ghost sessions |
| `exclude` | `string[]` | Glob patterns to filter out from include results |

#### Include/Exclude Patterns

By default, ghost mode hides all OpenCode project files from the symlink farm. Use `include` and `exclude` to customize:

```jsonc
{
  "registries": { "kdco": { "url": "https://registry.kdco.dev" } },
  
  // Include specific OpenCode files in ghost sessions
  "include": [
    "**/AGENTS.md",           // Include all AGENTS.md files
    ".opencode/skills/**"     // Include skills directory
  ],
  
  // Exclude patterns filter the include results  
  "exclude": [
    "**/vendor/**"            // But not files in vendor directories
  ]
}
```

This follows the TypeScript-style include/exclude model—`include` selects files, `exclude` filters the results.
