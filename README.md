# OCX

[![CI](https://github.com/kdcokenny/ocx/actions/workflows/ci.yml/badge.svg)](https://github.com/kdcokenny/ocx/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ocx.svg)](https://www.npmjs.com/package/ocx)
[![License](https://img.shields.io/github/license/kdcokenny/ocx.svg)](https://github.com/kdcokenny/ocx/blob/main/LICENSE)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/kdcokenny/ocx)

Your OpenCode config, anywhere.

## Why OCX?

- 📁 **Profiles** — Work in any repo with YOUR config. Control exactly what OpenCode sees.
- 📦 **Registries** — Install profiles and components from curated registries.
- 🔒 **Auditable** — SHA-verified, code you own.

![OCX Profiles Demo](./assets/profiles-demo.gif)

*Demo uses [oh-my-opencode](./docs/guides/oh-my-opencode.md). See [more guides](./docs/guides/).*

## Installation

OCX supports macOS (x64, Apple Silicon), Linux (x64, arm64), and Windows (x64).

```bash
# Recommended (macOS/Linux)
curl -fsSL https://ocx.kdco.dev/install.sh | sh

# Or via npm (any platform)
npm install -g ocx
```

The install script handles PATH configuration automatically or prints instructions if manual setup is needed.

## Quick Start

Work in any repo without modifying it. Your config, their code.

```bash
# One-time setup
ocx init --global

# Install a pre-configured profile from a registry
# Registry name comes from the source reference (e.g., kit/omo uses 'kit')
ocx profile add omo --source kit/omo --from https://ocx-kit.kdco.dev --global

# Use in any repo
cd ~/oss/some-project
ocx oc -p omo              # Launch OpenCode with your profile

# Or set a default
export OCX_PROFILE=omo
ocx oc                     # Uses omo profile automatically
```

Profiles control what OpenCode sees through `exclude`/`include` patterns. Each profile has isolated registries for security. OpenCode config merges safely between profile and local settings.

> **Visual Profile Builder:** Prefer a UI? [TweakOC](https://tweakoc.com) helps you build and configure profiles (OhMyOpenCode, KDCO Workspace, etc.) visually, then outputs an `ocx profile add` command you can run.

> **Security Note:** An empty exclude list includes all project instruction files; the default profile template ships a secure exclude list. For trusted repos, edit your profile to loosen the template's exclude list. See [Lock Down Recipe](./docs/PROFILES.md#lock-down-recipe).

**[Profile Deep Dive →](./docs/PROFILES.md)**

## Common Commands

| Command | Description |
|---------|-------------|
| `ocx profile add <name> --source <registry/profile> --from <url> --global` | Install a profile from a registry |
| `ocx profile add <name> --clone <existing> --global` | Clone an existing profile |
| `ocx oc -p <name>` | Launch OpenCode with a profile |
| `ocx profile list --global` | List your profiles |
| `ocx config edit --global` | Edit your global config |
| `ocx migrate` | Dry-run preview of v1.4.6 → v2 migration (shows what would change, no writes) |
| `ocx migrate --apply` | Apply migration to receipt format |

**[Full CLI Reference →](./docs/CLI.md)**

## Advanced Usage

### Components

Add individual components to projects (copied to `.opencode/`, not `node_modules`):

```bash
# One-time local setup
ocx init

# Add a registry with a name
ocx registry add https://registry.kdco.dev --name kdco

# Install components using name/component syntax
ocx add kdco/workspace
```

See [Components & Registries](./docs/REGISTRIES.md) for more.

### Upgrading from v1.4.6

If you have an existing v1.4.6 project, migrate to the v2 receipt format:

```bash
ocx migrate          # Dry-run: shows what would be migrated (no files written)
ocx migrate --apply  # Apply migration
ocx verify           # Confirm integrity post-migration
```

### Creating Registries

Scaffold and deploy your own registry:

```bash
npx ocx init --registry my-registry
```

See [Creating Registries](./docs/CREATING_REGISTRIES.md) for details.

## Philosophy

OCX follows the **ShadCN model**: components are copied into your project (`.opencode/`), not hidden in `node_modules`. You own the code—customize freely.

Like **Cargo**, OCX resolves dependencies and verifies integrity. Every component is SHA-256 verified.

*Your AI agent never runs code you haven't reviewed.*

## Documentation

- **[Profiles](./docs/PROFILES.md)** — Deep dive into profile configuration and isolation
- **[CLI Reference](./docs/CLI.md)** — Complete command documentation
- **[Creating Registries](./docs/CREATING_REGISTRIES.md)** — Build and distribute your own components
- **[Guides](./docs/guides/)** — Step-by-step tutorials

## Disclaimer

This project is not built by the OpenCode team and is not affiliated with [OpenCode](https://github.com/sst/opencode) in any way.

## License

MIT
