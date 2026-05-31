# NOTICE

`@slurpyb/ocx` is a fork of **`kdcokenny/ocx`**.

## Upstream

- **ocx** — https://github.com/kdcokenny/ocx
  Copyright (c) 2025 kenny. Licensed under the MIT License (see `LICENSE`).

This fork retains the upstream MIT licence and copyright. Our changes are likewise
MIT-licensed. We track `kdcokenny/ocx` and keep our diff small; the private-registry
authentication change is intended to be contributed back upstream.

## Fork additions

- **Private-registry authentication** — per-registry `headers` with `${ENV_VAR}` expansion,
  threaded through every registry fetch. Designed for use behind Cloudflare Access service tokens.
- **Native Claude Code output** — translators and pipeline that emit `.claude/`, `.mcp.json`, and
  `settings.json` after profile mutations. Ported from the `ccx` tool.

## Third-party lineage (ported Claude translators)

The Claude translation layer ported from `ccx` is itself derived in part from:

- **rulesync** — https://github.com/dyoshikawa/rulesync
  Copyright (c) dyoshikawa. Licensed under the MIT License.

Per-file attribution headers are retained in the ported sources.
