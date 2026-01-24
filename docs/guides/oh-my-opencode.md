# Using OCX with Oh-My-OpenCode

Set up [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) with OCX profiles for a fully portable AI coding environment.

> **Prerequisites:** [OCX installed](../CLI.md#installation) and [global profiles initialized](../PROFILES.md)

## Quick Start

### 1. Add the kit registry (one-time)

```bash
ocx registry add https://ocx-kit.kdco.dev --name kit --global
```

### 2. Install the omo profile

```bash
ocx profile add omo --from kit/omo
```

### 3. Launch

```bash
ocx oc -p omo
```

That's it! The profile comes pre-configured with free [OpenCode Zen](https://opencode.ai/docs/zen/) models.

## What's Included

The `omo` profile includes:

| File | Purpose |
|------|---------|
| `opencode.jsonc` | Default models + oh-my-opencode plugin |
| `oh-my-opencode.json` | Agent configurations with free models |
| `ocx.jsonc` | Profile isolation settings |
| `AGENTS.md` | Quick reference |

**Pre-configured models:**
- **Big Pickle** → Orchestrator (Sisyphus), Executor (Atlas)
- **GPT-5 Nano** → Research, exploration, documentation, planning

## Customize Models

Edit your profile's oh-my-opencode config:

```bash
# View available models
opencode models

# Edit the config
$EDITOR ~/.config/opencode/profiles/omo/oh-my-opencode.json
```

See the [oh-my-opencode configuration docs](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/configurations.md) for all options.

## Tips

**Set as default profile:**
```bash
export OCX_PROFILE=omo  # Add to ~/.zshrc or ~/.bashrc
```

**Clone for variations:**
```bash
ocx profile add work --from omo
```

**For untrusted repos**, see [Lock Down Recipe](../PROFILES.md#lock-down-recipe).

---

For manual setup or advanced configuration, see the [oh-my-opencode documentation](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/configurations.md).
