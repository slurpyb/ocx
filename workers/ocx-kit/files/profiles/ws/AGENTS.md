# KDCO Workspace Profile

Multi-agent orchestration harness with free [OpenCode Zen](https://opencode.ai/docs/zen/) models.

## Models

| Agent      | Model      | Role                  |
| ---------- | ---------- | --------------------- |
| `plan`       | Big Pickle | Planning orchestrator |
| `build`      | Big Pickle | Build orchestrator    |
| `coder`      | Big Pickle | Implementation        |
| `explore`    | GPT-5 Nano | Codebase search       |
| `researcher` | GPT-5 Nano | External research     |
| `scribe`     | GPT-5 Nano | Documentation         |
| `reviewer`   | GPT-5 Nano | Code review           |

## Customize

Edit your profile's config:

```bash
$EDITOR ~/.config/opencode/profiles/ws/opencode.jsonc
```

## Architecture

See [Workspace README](https://github.com/kdcokenny/ocx/blob/main/facades/opencode-workspace/README.md) for full architecture and component details.
