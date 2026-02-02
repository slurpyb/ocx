# Profiles

Profiles let you work in any repository with your own configuration, without modifying the project. Perfect for open source contributions, client work, or keeping work and personal configs separate.

## What Profiles Are

Profiles give you a global configuration system that lives outside your project directories. Instead of initializing `.opencode/` in every repo, you define your settings once and bring them anywhere.

### Mental Model: Global vs Local

| Aspect | Local Mode | Profile Mode |
|--------|------------|--------------|
| Config location | `./.opencode/` | `~/.config/opencode/profiles/<name>/` |
| Modifies repo | Yes | No |
| Per-project settings | Yes | Profile-isolated |
| Requires `ocx init` | Yes | No (uses profile config) |

### What's Inside a Profile

Each profile lives in `~/.config/opencode/profiles/<name>/` and contains:

- `ocx.jsonc` - OCX settings (registries, exclude/include patterns, custom binary)
- `opencode.jsonc` - OpenCode configuration
- `AGENTS.md` - Instructions for AI agents

### Why Profiles Exist

1. **Portability** - Bring your config to any repo without modifying it
2. **Isolation** - Control what OpenCode sees in untrusted repositories
3. **Context switching** - Maintain separate configs for work, personal, clients
4. **Zero footprint** - No `.opencode/` directory pollution in projects

## Profile Layering

OCX V2 introduces profile layering: global base + local overlay. When a profile name is specified in `.opencode/ocx.jsonc`, the local overlay takes precedence over the global base profile of the same name.

### Profile Selection Priority

Profiles are resolved in this order:

1. `--profile <name>` / `-p <name>` flag (explicit override)
2. `OCX_PROFILE` environment variable
3. `profile` field in `.opencode/ocx.jsonc` (project-specific profile)
4. `default` profile (if it exists)
5. No profile (base configs only)

### Layering Behavior

When a profile is active:

- **Global base profile** (`~/.config/opencode/profiles/<name>/`): Provides default settings
- **Local overlay** (settings in `.opencode/ocx.jsonc` when `profile` field is set): Overrides base settings
- **Local wins**: Any setting in the local overlay takes precedence

**Example:**

```bash
# ~/.config/opencode/profiles/work/ocx.jsonc (global base)
{
  "exclude": ["**/CLAUDE.md"],
  "registries": { "kdco": { "url": "https://registry.kdco.dev" } }
}

# .opencode/ocx.jsonc (local overlay selection)
{
  "profile": "work",
  "exclude": ["**/CLAUDE.md", "**/AGENTS.md"]
}
```

The local `exclude` array completely replaces the base profile's `exclude` array.

## Controlling What OpenCode Sees

The default profile template ships an exclude list for maximum security. OCX doesn't exclude anything by default - a clean ocx.jsonc includes all project instruction files. You control visibility using exclude/include patterns in your profile's `ocx.jsonc`.

**This is the key power feature.** Use it to protect yourself from untrusted repositories or to curate exactly what context OpenCode receives.

### How Visibility Works

| Pattern Type | Effect |
|--------------|--------|
| `exclude` | Hide matching files from OpenCode |
| `include` | Override excludes, make files visible again |

Patterns follow glob syntax (`**/*.md`, `src/**`, etc.). Include patterns always override exclude patterns, following the same semantics as TypeScript/Vite config.

### Default Configuration (Secure by Default)

The default profile template uses this exclude list:

```jsonc
{
  "exclude": [
    "**/AGENTS.md",
    "**/CLAUDE.md",
    "**/CONTEXT.md",
    "**/.opencode/**",
    "**/opencode.jsonc",
    "**/opencode.json"
  ]
}
```

### Trusting Project Files

For trusted repositories, loosen the template's exclude list by removing patterns or adding include overrides:

```jsonc
{
  // Remove AGENTS.md from exclude list to trust project files
  "exclude": [
    "**/CLAUDE.md",
    "**/CONTEXT.md",
    "**/.opencode/**",
    "**/opencode.jsonc",
    "**/opencode.json"
  ]
}
```

Or use include patterns to override excludes:

```jsonc
{
  "exclude": [
    "**/AGENTS.md",
    "**/CLAUDE.md",
    "**/CONTEXT.md",
    "**/.opencode/**",
    "**/opencode.jsonc",
    "**/opencode.json"
  ],
  "include": [
    "**/AGENTS.md"  // Override: allow project AGENTS.md files
  ]
}
```

### Lock Down Recipe

For maximum isolation (untrusted repos), the default profile template already excludes everything. No changes needed.

### How Discovery Works

When you run `ocx opencode`, OCX:

1. Walks up from the project directory to the git root
2. Finds instruction files (`AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`) at each level
3. Filters files using exclude/include patterns from the active profile
4. Merges `opencode.jsonc` from profile and local (if not excluded)
5. Launches OpenCode with the filtered config and instructions

Files are discovered deepest-first (most specific to most general). Profile instructions come last and have the highest priority.

## Instruction File Discovery

OCX discovers instruction files in this exact order (low to high priority), matching OpenCode's behavior:

| Order | Scope           | Path                                         | Priority | Filtering |
| ----- | --------------- | -------------------------------------------- | -------- | --------- |
| 1     | Global          | `~/.config/opencode/AGENTS.md`                 | Lowest   | Always included |
| 2     | Global Profile  | `~/.config/opencode/profiles/<name>/AGENTS.md` | ↓        | Always included |
| 3     | Local (Project) | `./AGENTS.md`, `./src/AGENTS.md`, etc.         | ↓        | Filtered by patterns |
| 4     | Local Profile   | `.opencode/profiles/<name>/AGENTS.md`          | Highest  | Always included |

**Discovery details:**
- Local project files are discovered **deepest-first** (walking up from current directory to git root)
- Profile instructions come last and have the highest priority
- Global `AGENTS.md` is **always included** regardless of profile selection
- **Claude Code compatibility**: If no global `AGENTS.md` exists, OCX checks `~/.claude/CLAUDE.md` as a fallback (disable with `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1`)

### File Type Priority ("First Type Wins")

OpenCode uses a **"first type wins"** discovery strategy:

1. **Search for `AGENTS.md`** first (walking up the project tree)
2. **If any `AGENTS.md` is found**: Collect **all** `AGENTS.md` files and **STOP** (ignore `CLAUDE.md` and `CONTEXT.md` entirely)
3. **If no `AGENTS.md`**: Search for `CLAUDE.md` (and ignore `CONTEXT.md`)
4. **If no `CLAUDE.md`**: Search for `CONTEXT.md` (**deprecated**, will be removed)

**Example:** If your project contains any `AGENTS.md` file, all `CLAUDE.md` files in the tree are completely ignored.

**Recommendation:** Use `AGENTS.md` (preferred). `CLAUDE.md` is a fallback. `CONTEXT.md` is **deprecated** and legacy-only.

### Pattern Filtering (Local Files Only)

Profile `exclude` and `include` patterns apply **ONLY to local (project) instruction files**. Global and profile instruction files are **always included** regardless of patterns.

### Source Alignment

OCX's instruction discovery aligns with OpenCode's implementation. See:
- **Instruction discovery logic**: https://github.com/sst/opencode/blob/dev/packages/opencode/src/session/instruction.ts
- **File system traversal**: https://github.com/sst/opencode/blob/dev/packages/opencode/src/util/filesystem.ts



**Examples:**

```bash
# Explicit profile selection
ocx opencode -p work

# Environment variable
OCX_PROFILE=work ocx opencode

# Project-specific profile (from .opencode/ocx.jsonc)
ocx opencode  # Uses profile specified in local config

# Falls back to default profile
ocx opencode  # Uses ~/.config/opencode/profiles/default/ if exists
```

## Profile Management

### Profile Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `ocx profile list` | `ocx p ls` | List all global profiles |
| `ocx profile add <name>` | `ocx p add` | Create new profile or install from registry |
| `ocx profile remove <name>` | `ocx p rm` | Delete profile |
| `ocx profile move <old> <new>` | `ocx p mv` | Rename a profile |
| `ocx profile show [name]` | `ocx p show` | Display profile contents |

### Creating Profiles

**Create an empty profile:**

```bash
ocx profile add work
```

**Install profile from registry:**

```bash
# Install directly from registry
ocx profile add ws --from https://ocx-kit.kdco.dev/ws

# Or first add global registry, then install
ocx registry add https://ocx-kit.kdco.dev --name kit --global
ocx profile add ws --from kit/ws

# Force overwrite existing profile
ocx profile add ws --from kit/ws --force
```

**Clone from existing profile:**

```bash
ocx profile add client-x --from work
```

### Managing Profiles

**List all profiles:**

```bash
ocx profile list
# or
ocx p ls
```

**View profile contents:**

```bash
ocx profile show work
# or
ocx p show work

# Show active profile (from resolution)
ocx p show
```

**Rename a profile:**

```bash
ocx profile move work work-old
# or
ocx p mv work work-old
```

**Delete a profile:**

```bash
ocx profile remove work-old
# or
ocx p rm work-old
```

## Config Commands

### View Configuration

| Command | Description |
|---------|-------------|
| `ocx config show` | Show config from current scope |
| `ocx config show --origin` | Show config with sources |
| `ocx config show -p <name>` | Show specific profile config |

**Examples:**

```bash
# Show active config (follows profile resolution)
ocx config show

# Show where each setting comes from
ocx config show --origin

# Show specific profile
ocx config show -p work
```

### Edit Configuration

| Command | Description |
|---------|-------------|
| `ocx config edit` | Edit local `.opencode/ocx.jsonc` |
| `ocx config edit --global` | Edit global `~/.config/opencode/ocx.jsonc` |
| `ocx config edit -p <name>` | Edit profile config |

**Examples:**

```bash
# Edit local project config
ocx config edit

# Edit global base config
ocx config edit --global

# Edit profile config
ocx config edit -p work
```

## OpenCode Commands

### Launch OpenCode

| Command | Description |
|---------|-------------|
| `ocx opencode` | Launch OpenCode with config |
| `ocx oc` | Alias for `opencode` |
| `ocx opencode -p <name>` | Launch with specific profile |

**Note:** The `ocx oc` command runs from the current working directory. Only `-p`/`--profile` and `--no-rename` are OCX-specific flags. Everything else passes through to OpenCode. Use `--` only if you need to pass conflicting tags to opencode itself (rare).

**Examples:**

```bash
# Launch in current directory (uses profile resolution)
ocx opencode

# Launch with explicit profile
ocx opencode -p work

# Launch in a specific directory - use cd first
cd ~/projects/my-app
ocx opencode

# Use environment variable
OCX_PROFILE=work ocx opencode
```

### Custom OpenCode Binary

To use a custom OpenCode binary (e.g., a development build), set the `bin` option in your profile's `ocx.jsonc`:

```jsonc
{
  "bin": "/path/to/custom/opencode"
}
```

**Resolution order:**

1. `bin` in profile's `ocx.jsonc`
2. `OPENCODE_BIN` environment variable
3. `opencode` (system PATH)

## Config Location

### Global Profiles

```
~/.config/opencode/
├── ocx.jsonc                 # Global base config
└── profiles/
    ├── default/
    │   ├── ocx.jsonc         # Profile OCX settings
    │   ├── opencode.jsonc    # Profile OpenCode config
    │   └── AGENTS.md         # Profile instructions
    └── work/
        ├── ocx.jsonc
        ├── opencode.jsonc
        └── AGENTS.md
```

### Local Project Config

```
.opencode/                    # Local config
├── ocx.jsonc                 # Local OCX config (can specify profile)
└── opencode.jsonc            # Local OpenCode config
```

### Profile Selection via Local Config

You can specify which profile to use in your project's `.opencode/ocx.jsonc`:

```jsonc
{
  "profile": "work"
}
```

This enables profile layering: the global `work` profile provides defaults, and the local config can override settings.

## Configuration Isolation

OCX configs (`ocx.jsonc`) are **ISOLATED per scope** - they do NOT merge, except for profile layering.

### Registry Isolation (Security Model)

- **Global registries** (in `~/.config/opencode/ocx.jsonc`) - ONLY used for downloading global settings like profiles
- **Profile registries** (in profile's `ocx.jsonc`) - ONLY available when using that profile
- **Local registries** (in `.opencode/ocx.jsonc`) - ONLY for that project

This prevents global registries from injecting components into all projects.

### Profile Layering

When a profile name is specified in `.opencode/ocx.jsonc`:

- **Global base profile** (`~/.config/opencode/profiles/<name>/`) provides defaults
- **Local overlay** (settings in `.opencode/ocx.jsonc`) takes precedence
- Local overlay completely replaces (not merges) array values like `exclude`

### What DOES Merge

- **OpenCode config files** (`opencode.jsonc`) merge: profile → local (if not excluded by patterns)
- Profile's exclude/include patterns control which project files OpenCode can see

## Examples

### Trusted Repository

The default profile template excludes all instruction files. For trusted repos, selectively loosen the exclude list:

```jsonc
{
  // Remove AGENTS.md from exclude list
  "exclude": [
    "**/CLAUDE.md",
    "**/CONTEXT.md",
    "**/.opencode/**",
    "**/opencode.jsonc",
    "**/opencode.json"
  ]
}
```

Or use include overrides:

```jsonc
{
  "exclude": [
    "**/AGENTS.md",
    "**/CLAUDE.md",
    "**/CONTEXT.md",
    "**/.opencode/**",
    "**/opencode.jsonc",
    "**/opencode.json"
  ],
  "include": [
    "**/AGENTS.md"  // Override: allow project AGENTS.md files
  ]
}
```

### Untrusted Repository

Maximum isolation is the default profile template. No changes needed - the template excludes all project instruction files.

### Selective Inclusion

Exclude all instruction files but include specific ones:

```jsonc
{
  "exclude": [
    "**/AGENTS.md",
    "**/CLAUDE.md",
    "**/CONTEXT.md"
  ],
  "include": ["./AGENTS.md"]  // Only root AGENTS.md
}
```

### Work Profile with Custom Binary

```jsonc
{
  "bin": "/Users/kenny/code/opencode/bin/opencode",
  "exclude": [
    "**/CLAUDE.md",
    "**/CONTEXT.md"
  ],
  "registries": {
    "work": { "url": "https://registry.company.internal" }
  }
}
```

## Workflow Examples

### Initial Setup

```bash
# Initialize global profiles
ocx init --global

# Create your first profile
ocx profile add default

# Edit its configuration
ocx config edit -p default
```

### Daily Usage

```bash
# Navigate to any project
cd ~/projects/client-repo

# Launch with your profile
ocx opencode -p work

# Or set default environment
export OCX_PROFILE=work
ocx opencode  # Automatically uses work profile
```

### Context Switching

```bash
# Work on client project
cd ~/projects/client-app
OCX_PROFILE=client-x ocx opencode

# Switch to personal project
cd ~/projects/my-side-project
OCX_PROFILE=default ocx opencode

# Contribute to open source (locked down)
cd ~/projects/external-repo
OCX_PROFILE=untrusted ocx opencode
```

### Profile Cloning

```bash
# Start from an existing profile
ocx profile add client-new --from work

# Customize for the client
ocx config edit -p client-new
```

## Key Differences from Local Mode

| Aspect | Local Mode | Profile Mode |
|--------|------------|--------------|
| Config location | `./.opencode/` | `~/.config/opencode/profiles/<name>/` |
| Modifies repo | Yes | No |
| Per-project settings | Yes | Profile-isolated |
| Requires `ocx init` | Yes | No (uses profile config) |
| Visibility control | No | Yes (exclude/include) |
| Registry scope | Project-only | Profile-isolated |
| Best for | Single project customization | Multi-project workflows |

**When to use local mode:**
- Project has its own component registry
- Team shares `.opencode/` in version control
- Project-specific OpenCode settings

**When to use profiles:**
- Working across multiple repositories
- Contributing to external projects
- Need to control what OpenCode sees
- Want zero-footprint in repositories
