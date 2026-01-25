# Using OCX with KDCO Workspace

Set up the KDCO Workspace multi-agent harness with OCX profiles for a fully portable AI coding environment.

> **Prerequisites:** [OCX installed](../CLI.md#installation) and [global profiles initialized](../PROFILES.md)

## Quick Start

### 1. Add the registries (one-time)

```bash
ocx registry add https://ocx-kit.kdco.dev --name kit --global
ocx registry add https://registry.kdco.dev --name kdco --global
```

### 2. Install the ws profile

```bash
ocx profile add ws --from kit/ws
```

### 3. Launch

```bash
ocx oc -p ws
```

That's it! The profile comes pre-configured with free [OpenCode Zen](https://opencode.ai/docs/zen/) models and the full workspace bundle.

## What's Included

The `ws` profile installs the complete KDCO Workspace:

| Category | Components                                                       |
| -------- | ---------------------------------------------------------------- |
| Plugins  | workspace-plugin, background-agents, notify, worktree            |
| Agents   | researcher, coder, scribe, reviewer                              |
| Skills   | plan-protocol, code-review, code-philosophy, frontend-philosophy |
| Commands | /review                                                          |
| MCP      | Context7, Exa, GitHub Grep                                       |

**Pre-configured models:**

| Agent                                 | Model      |
| ------------------------------------- | ---------- |
| plan, build, coder                    | Big Pickle |
| explore, researcher, scribe, reviewer | GPT-5 Nano |

## Customize Models

Edit your profile's OpenCode config:

```bash
# View available models
opencode models

# Edit the config
$EDITOR ~/.config/opencode/profiles/ws/opencode.jsonc
```

## Tips

**Set as default profile:**
```bash
export OCX_PROFILE=ws  # Add to ~/.zshrc or ~/.bashrc
```

**Clone for variations:**
```bash
ocx profile add work --from ws
```

**For untrusted repos**, see [Lock Down Recipe](../PROFILES.md#lock-down-recipe).

---

For architecture details, agent boundaries, and component documentation, see the [Workspace README](../../facades/opencode-workspace/README.md).
