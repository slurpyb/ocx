# CLIProxy Provider Bundle

Pre-configured providers for [CLIProxyAPI](https://github.com/cliproxyapis/cliproxyapi) - a unified proxy for AI model APIs.

## Prerequisites

- CLIProxyAPI running locally on port 18317
- `CLIPROXY_API_KEY` environment variable set

## Quick Start

1. Add the kit registry (if not already added):
   ```bash
   ocx registry add https://ocx-kit.kdco.dev --name kit --global
   ```

2. Install the bundle:
   ```bash
   ocx add kit/cliproxy
   ```

3. Set your API key:
   ```bash
   export CLIPROXY_API_KEY="your-api-key-here"
   ```

4. Verify installation:
   ```bash
   # Global/local install
   opencode models
   
   # Or with a profile
   ocx oc -p <profile-name> models
   ```

## Using with Quotio

[Quotio](https://github.com/cliproxyapis/quotio) is a GUI wrapper for CLIProxyAPI. If you prefer a graphical interface:

1. Open Quotio
2. Start the proxy from the UI
3. The default port (18317) is the same, so this bundle works out of the box

## Included Providers

| Provider | Models | Description |
|----------|--------|-------------|
| `cliproxy-anthropic` | 11 models | Claude Max + Antigravity (gemini-claude-*) |
| `cliproxy-google` | 6 models | Gemini 2.5-3.0 family |
| `cliproxy-openai` | 9 models | GPT 5-5.2 family |

## Subscription Tiers

Different subscriptions provide access to different models:

| Subscription | Provider | Models |
|--------------|----------|--------|
| **Claude Max** | `cliproxy-anthropic` | `claude-opus-4-5-*`, `claude-sonnet-4-5-*`, `claude-haiku-4-5-*` |
| **Antigravity** | `cliproxy-anthropic` | `gemini-claude-opus-4-5-thinking`, `gemini-claude-sonnet-4-5`, `gemini-claude-sonnet-4-5-thinking` |
| **Google** | `cliproxy-google` | `gemini-2.5-*`, `gemini-3-*` |
| **OpenAI** | `cliproxy-openai` | `gpt-5*` |

## Discovering Available Models

After installation, view all available models based on your subscription:

```bash
# If installed globally or in local .opencode/
opencode models

# If installed to a profile (recommended)
ocx oc -p <profile-name> models

# Example: if you installed to a profile called "work"
ocx oc -p work models
```

## Setting Your Model

### Option 1: Edit your config file

In your `opencode.jsonc` (or profile's `opencode.jsonc`):

```jsonc
{
  "model": "cliproxy-anthropic/gemini-claude-opus-4-5-thinking"
}
```

### Option 2: Via command line

```bash
# Direct opencode (global/local install)
opencode
# Then use /model to switch models interactively

# With a profile
ocx oc -p <profile-name>
# Then use /model to switch models interactively
```

## Model Reference

### Anthropic Models (Claude Max + Antigravity)

| Model ID | Name | Context | Output | Thinking |
|----------|------|---------|--------|----------|
| `claude-opus-4-5-20251101` | Claude 4.5 Opus | 200k | 64k | ✓ |
| `claude-sonnet-4-5-20250929` | Claude 4.5 Sonnet | 200k | 64k | ✓ |
| `claude-haiku-4-5-20251001` | Claude 4.5 Haiku | 200k | 64k | ✗ |
| `claude-opus-4-1-20250805` | Claude 4.1 Opus | 200k | 32k | ✓ |
| `claude-opus-4-20250514` | Claude 4 Opus | 200k | 32k | ✓ |
| `claude-sonnet-4-20250514` | Claude 4 Sonnet | 200k | 64k | ✓ |
| `claude-3-7-sonnet-20250219` | Claude 3.7 Sonnet | 128k | 8k | ✓ |
| `claude-3-5-haiku-20241022` | Claude 3.5 Haiku | 128k | 8k | ✗ |
| `gemini-claude-opus-4-5-thinking` | Claude Opus 4.5 Thinking (Antigravity) | 200k | 64k | ✓ |
| `gemini-claude-sonnet-4-5` | Claude Sonnet 4.5 (Antigravity) | 200k | 64k | ✗ |
| `gemini-claude-sonnet-4-5-thinking` | Claude Sonnet 4.5 Thinking (Antigravity) | 200k | 64k | ✓ |

### Google Models

| Model ID | Name | Context | Output | Thinking |
|----------|------|---------|--------|----------|
| `gemini-2.5-pro` | Gemini 2.5 Pro | 1M | 65k | ✓ |
| `gemini-2.5-flash` | Gemini 2.5 Flash | 1M | 65k | ✓ |
| `gemini-2.5-flash-lite` | Gemini 2.5 Flash Lite | 1M | 65k | ✓ |
| `gemini-3-pro-preview` | Gemini 3 Pro Preview | 1M | 65k | ✓ |
| `gemini-3-flash-preview` | Gemini 3 Flash Preview | 1M | 65k | ✓ |
| `gemini-3-pro-image-preview` | Gemini 3 Pro Image Preview | 1M | 65k | ✓ |

### OpenAI Models

| Model ID | Name | Context | Output | Reasoning |
|----------|------|---------|--------|-----------|
| `gpt-5` | GPT 5 | 400k | 128k | medium |
| `gpt-5-codex` | GPT 5 Codex | 400k | 128k | medium |
| `gpt-5-codex-mini` | GPT 5 Codex Mini | 400k | 128k | low |
| `gpt-5.1` | GPT 5.1 | 400k | 128k | medium |
| `gpt-5.1-codex` | GPT 5.1 Codex | 400k | 128k | medium |
| `gpt-5.1-codex-mini` | GPT 5.1 Codex Mini | 400k | 128k | low |
| `gpt-5.1-codex-max` | GPT 5.1 Codex Max | 400k | 128k | high |
| `gpt-5.2` | GPT 5.2 | 400k | 128k | medium |
| `gpt-5.2-codex` | GPT 5.2 Codex | 400k | 128k | medium |

## Customization

### Changing Thinking Budget (Claude/Gemini)

Models with thinking support use a token budget. To adjust in your config:

```jsonc
{
  "provider": {
    "cliproxy-anthropic": {
      "models": {
        "claude-opus-4-5-20251101": {
          "options": {
            "thinking": {
              "budgetTokens": 20000
            }
          }
        }
      }
    }
  }
}
```

### Changing Reasoning Effort (OpenAI)

OpenAI models use effort levels: `low`, `medium`, `high`. To adjust:

```jsonc
{
  "provider": {
    "cliproxy-openai": {
      "models": {
        "gpt-5": {
          "options": {
            "reasoning": {
              "effort": "high"
            }
          }
        }
      }
    }
  }
}
```

### Custom Base URL

If running CLIProxyAPI on a different port or remote server:

```jsonc
{
  "provider": {
    "cliproxy-anthropic": {
      "options": {
        "baseURL": "http://your-server:8080/v1"
      }
    }
  }
}
```

## Adding More Providers

This bundle covers Anthropic, Google, and OpenAI. CLIProxyAPI supports additional providers:

- **iFlow** (DeepSeek, Qwen, Kimi, GLM, MiniMax)
- **Vertex AI** (service account auth)

See the [CLIProxyAPI documentation](https://github.com/cliproxyapis/cliproxyapi) for the full model list and setup instructions.

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| Connection refused | Proxy not running | Start CLIProxyAPI or open Quotio and start the proxy |
| 401 Unauthorized | Invalid API key | Check `CLIPROXY_API_KEY` environment variable |
| Model not found | Subscription tier | Run `opencode models` to see available models for your subscription |

## Support

- [CLIProxyAPI GitHub](https://github.com/cliproxyapis/cliproxyapi)
- [Quotio GitHub](https://github.com/clipproxyapis/quotio) (GUI wrapper)
- [OCX Documentation](https://github.com/kdcokenny/ocx)

For issues with this bundle, check your config:
```bash
# Global/local
ocx config show

# With profile
ocx config show -p <profile-name>
```
