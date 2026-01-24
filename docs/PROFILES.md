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

## Controlling What OpenCode Sees

By default, OpenCode sees everything in your project. Profiles let you filter visibility using exclude/include patterns.

**This is the key power feature.** Use it to protect yourself from untrusted repositories or to curate exactly what context OpenCode receives.

### How Visibility Works

| Pattern Type | Effect |
|--------------|--------|
| `exclude` | Hide matching files from OpenCode |
| `include` | Override excludes, make files visible again |

Patterns follow glob syntax (`**/*.md`, `src/**`, etc.). Include patterns always override exclude patterns, following the same semantics as TypeScript/Vite config.

### Default Configuration

The default profile includes project `AGENTS.md` files while excluding other config files:

```jsonc
{
  "exclude": [
    // "**/AGENTS.md",  // Uncomment to hide project instructions
    "**/CLAUDE.md",
    "**/CONTEXT.md",
    "**/.opencode/**",
    "**/opencode.jsonc",
    "**/opencode.json"
  ],
  "include": []
}
```

### Lock Down Recipe

For maximum isolation (untrusted repos), exclude everything:

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

### How Discovery Works

When you run `ocx opencode`, OCX:

1. Walks up from the project directory to the git root
2. Finds instruction files (`AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`) at each level
3. Filters files using exclude/include patterns from the active profile
4. Merges `opencode.jsonc` from profile and local (if not excluded)
5. Launches OpenCode with the filtered config and instructions

Files are discovered deepest-first (most specific to most general). Profile instructions come last and have the highest priority.

## Profile Resolution

Profiles are resolved in this order:

1. `--profile <name>` / `-p <name>` flag (explicit override)
2. `OCX_PROFILE` environment variable
3. `default` profile (if it exists)
4. No profile (base configs only)

**Examples:**

```bash
# Explicit profile selection
ocx opencode -p work

# Environment variable
OCX_PROFILE=work ocx opencode

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
# First, add a global registry
ocx registry add https://registry.kdco.dev --name kdco --global

# Then install the profile
ocx profile add minimal --from kdco/minimal

# Force overwrite existing profile
ocx profile add minimal --from kdco/minimal --force
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
| `ocx opencode [path]` | Launch OpenCode with config |
| `ocx oc [path]` | Alias for `opencode` |
| `ocx opencode -p <name>` | Launch with specific profile |

**Examples:**

```bash
# Launch in current directory (uses profile resolution)
ocx opencode

# Launch with explicit profile
ocx opencode -p work

# Launch in specific directory
ocx opencode ~/projects/my-app

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

.opencode/                    # Local config (no profiles)
├── ocx.jsonc
└── opencode.jsonc
```

## Configuration Isolation

OCX configs (`ocx.jsonc`) are **ISOLATED per scope** - they do NOT merge.

### Registry Isolation (Security Model)

- **Global registries** (in `~/.config/opencode/ocx.jsonc`) - ONLY used for downloading global settings like profiles
- **Profile registries** (in profile's `ocx.jsonc`) - ONLY available when using that profile
- **Local registries** (in `.opencode/ocx.jsonc`) - ONLY for that project

This prevents global registries from injecting components into all projects.

### What DOES Merge

- **OpenCode config files** (`opencode.jsonc`) merge: profile → local (if not excluded by patterns)
- Profile's exclude/include patterns control which project files OpenCode can see

## Examples

### Trusted Repository

Include project configuration files while filtering specific instruction files:

```jsonc
{
  "exclude": [
    "**/CLAUDE.md",
    "**/CONTEXT.md"
  ],
  "include": [
    "**/AGENTS.md",
    "**/.opencode/**"
  ]
}
```

### Untrusted Repository

Maximum isolation - profile instructions only:

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

### Selective Inclusion

Exclude all instruction files but include the root one:

```jsonc
{
  "exclude": ["**/AGENTS.md"],
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
OCX_PROFILE=client-x ocx opencode ~/projects/client-app

# Switch to personal project
OCX_PROFILE=default ocx opencode ~/projects/my-side-project

# Contribute to open source (locked down)
OCX_PROFILE=untrusted ocx opencode ~/projects/external-repo
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
