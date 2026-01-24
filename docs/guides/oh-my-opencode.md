# Using OCX with Oh-My-OpenCode

Set up [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) with OCX profiles for a fully portable AI coding environment.

> **Prerequisites:** [OCX installed](../CLI.md#installation) and [global profiles initialized](../PROFILES.md)

## Overview

```
~/.config/opencode/profiles/omo/
├── ocx.jsonc              # Visibility control (what OpenCode sees)
├── opencode.jsonc         # Plugin + provider configuration
├── oh-my-opencode.json    # Agent/category/skill definitions
└── AGENTS.md              # Your custom instructions
```

## Quick Setup

### 1. Create a profile

```bash
ocx init --global           # One-time setup
ocx profile add omo
```

### 2. Install oh-my-opencode

```bash
bunx oh-my-opencode install
```

This runs an interactive setup that configures your providers and creates the config files.

### 3. Launch with your profile

```bash
ocx oc -p omo
```

## Configuration Files

### opencode.jsonc

Plugin and provider settings:

```jsonc
{
  "plugin": ["oh-my-opencode@latest"],
  "provider": {
    "anthropic": {
      "name": "Anthropic",
      "options": { "apiKey": "env:ANTHROPIC_API_KEY" }
    }
  }
}
```

### oh-my-opencode.json

Agent, category, and skill definitions. Add the schema for autocomplete:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  "agents": { ... },
  "categories": { ... },
  "skills": { ... }
}
```

| Section      | Purpose                              | Docs                                                                                                                     |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `agents`     | Override model/behavior per agent    | [Agents Guide](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/features.md)                                 |
| `categories` | Domain presets (visual, quick, etc.) | [Category System](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/category-skill-guide.md#2-category-system) |
| `skills`     | Knowledge modules + MCP servers      | [Skill System](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/category-skill-guide.md#3-skill-system)       |

## Tips

**Set a default profile:**
```bash
export OCX_PROFILE=omo  # Add to ~/.zshrc or ~/.bashrc
```

**Clone for variations:**
```bash
ocx profile add personal --from omo
```

**For untrusted repos**, see [Lock Down Recipe](../PROFILES.md#lock-down-recipe).

---

For full configuration options, see the [oh-my-opencode documentation](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/configurations.md).
