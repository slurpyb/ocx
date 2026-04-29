# opencode-workspace

Legacy facade for the previous KDCO Workspace harness. New installs should use `kdco/flow`.

## Quick Start (Recommended)

```bash
# One-time setup
ocx init --global

# Install the KDCO Flow profile (OpenCode Free Models Only)
ocx profile add ws --source kit/ws --from https://ocx-kit.kdco.dev --global

# Launch
ocx oc -p ws
```

The `ws` profile now installs `kdco/flow`. Existing `kdco/workspace` users can keep using the legacy bundle, but it is deprecated and no longer the default for new profile installs.

## Direct Install

```bash
# Recommended harness
ocx add kdco/flow --from https://registry.kdco.dev

# Legacy harness, only when intentionally needed
ocx add kdco/workspace --from https://registry.kdco.dev
```

## What `kdco/flow` Provides

`kdco/flow` is the primary autonomous OpenCode harness. It defines six distinct agents and a gated delivery state machine.

### Flow State Machine

`Intake → Research/Exploration → Plan Draft → Plan Review → Implementation → QA Review → Finalize → Done`

`Blocked` is the only non-terminal stop state.

### Gates

- Implementation cannot start until `plan-reviewer` returns `APPROVE`.
- Final commit, PR, or report cannot happen until `qa-reviewer` returns `APPROVE`.

### Terminal Goals

- `pr`
- `commit`
- `report`

The `pr` terminal goal targets `main` unless explicitly overridden. Full autonomy mode continues until `Done` or `Blocked`; when users intentionally launch OpenCode with a permission-skipping mode such as `--dangerously-skip-permissions`, the flow still enforces explicit agent denies and both review gates.

## Agents

| Agent | Boundary |
|-------|----------|
| `conductor` | Main read-only orchestrator |
| `researcher` | Read-only external research |
| `explorer` | Read-only local and sandboxed external repository exploration |
| `plan-reviewer` | Read-only plan/high-level logic approval gate |
| `coder` | Write-capable implementation and verification agent |
| `qa-reviewer` | Read-only final QA/manual-experience approval gate |

## Explorer Sandbox

The `explorer` agent may clone only under the harness temp root at `/{TMP DIR}/{repo author}/{repo name}` through dedicated `flow_explorer_*` tools and may only read, inspect git metadata, and clean up that scoped clone. Bash, package managers, interpreters, build/test tools, shell scripts, and arbitrary executables from clones are denied.

## Legacy Workspace

`kdco/workspace` remains installable so existing users are not silently broken. It is legacy/deprecated and should not be used for new installs unless you intentionally need the previous harness behavior.

## Contributing

This facade is maintained from the main [OCX monorepo](https://github.com/kdcokenny/ocx).

Key source files:

- https://github.com/kdcokenny/ocx/blob/main/workers/kdco-registry/registry.jsonc
- https://github.com/kdcokenny/ocx/tree/main/workers/kdco-registry/files
- https://github.com/kdcokenny/ocx/tree/main/workers/ocx-kit/files/profiles/ws

Please open issues and pull requests in the monorepo, not this facade repository.

## Disclaimer

This project is not built by the OpenCode team and is not affiliated with [OpenCode](https://github.com/sst/opencode) in any way.

## License

MIT
