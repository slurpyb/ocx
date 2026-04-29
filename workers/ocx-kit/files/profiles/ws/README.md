# KDCO Flow Profile

Multi-agent orchestration harness for `kdco/flow` with OpenCode Zen free-plan defaults and optional premium model recommendations.

`ws` now installs `kdco/flow`. The old `kdco/workspace` bundle is legacy/deprecated and should be installed only by users who intentionally need the previous harness.

## Default Model Assignments (OpenCode Zen free plan)

These are the out-of-the-box `ws` defaults.

| Agent | Model | Role |
|-------|-------|------|
| `conductor` | Big Pickle | Read-only flow orchestrator |
| `plan` | Big Pickle | Planning orchestrator |
| `build` | Big Pickle | Build orchestrator |
| `coder` | Big Pickle | Implementation |
| `explorer` | GPT-5 Nano | Temp-root clone/read/git-metadata/cleanup only; no clone code execution |
| `explore` | GPT-5 Nano | Codebase search |
| `researcher` | GPT-5 Nano | External research |
| `scribe` | GPT-5 Nano | Documentation |
| `reviewer` | GPT-5 Nano | Code review |
| `plan-reviewer` | GPT-5 Nano | Approves the saved plan before implementation |
| `qa-reviewer` | GPT-5 Nano | Approves the final result before commit/PR/report |

## Recommended Models

Use these when customizing with premium/custom providers (separate from the free-plan defaults above).

| Role | Recommended | Why |
|------|-------------|-----|
| Orchestrators (`conductor`, `plan`, `build`) | `GPT-5.4` or `Claude Opus 4.6` | Heavy reasoning and long-horizon planning. |
| Implementation (`coder`) | `GPT-5.3 Codex` or `Claude Sonnet 4.6` | Strong agentic coding for complex implementation work. |
| Specialists (`explorer`, `explore`, `researcher`, `scribe`) | `Kimi K2.5` | Accurate, low hallucination, and usually cheaper/faster. |
| Review (`reviewer`, `plan-reviewer`, `qa-reviewer`) | `GPT-5.4` or `Claude Opus 4.6` | Review is high-stakes; use a very smart model to catch bugs and edge cases. |

These are recommended model classes; tune by provider, latency, and budget for your environment.

## Customize

After installing, tune model choices in your local profile config:

```bash
$EDITOR ~/.config/opencode/profiles/ws/opencode.jsonc
```

If you installed the profile under a different name, edit that profile's `opencode.jsonc` instead.

## Architecture

See [Workspace README](https://github.com/kdcokenny/ocx/blob/main/facades/opencode-workspace/README.md) for migration notes and flow component details.
