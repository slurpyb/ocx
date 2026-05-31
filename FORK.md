# Fork maintenance (`@slurpyb/ocx`)

This is a fork of [`kdcokenny/ocx`](https://github.com/kdcokenny/ocx). The architecture is
shaped to keep `git merge upstream/main` cheap. See `NOTICE.md` for attribution.

## Branch model

- **`main`** is a *clean mirror* of `upstream/main`. Never commit fork work here.
- **`slurpyb`** carries all our commits as a tidy, ordered stack (rebrand → claude-port →
  auth-if-not-upstreamed).

Remotes:

```
origin    https://github.com/slurpyb/ocx.git      # the fork
upstream  https://github.com/kdcokenny/ocx.git     # the source
```

## Routine: sync with upstream

```sh
git fetch upstream
git switch main && git merge --ff-only upstream/main   # main stays pristine
git switch slurpyb && git rebase main                  # replay our stack on top
bun install
bun run check                                           # turbo: biome + tsc across workspace
bun run build                                           # rebuild dist
cd packages/cli && bun test                             # prove the sync (1375+ pass)
```

Conflict surface is intentionally tiny. The only edits to upstream-owned files are
`packages/cli/package.json` (rebrand) and — once they land — one line in `cli/bootstrap.ts`
and a `claude?` field in `schemas/config.ts`. Everything else lives in **new files**
(`packages/cli/src/claude/**`, `packages/cli/src/utils/expand-env.ts`,
`.github/workflows/slurpyb-ci.yml`, `NOTICE.md`, `FORK.md`) that never conflict. The
registry-auth change is destined for an upstream PR, so it ideally becomes a no-op diff after it
is merged upstream.

## GitHub Actions on the fork

Actions are **enabled** on this fork. The two workflows we never want to fire from here are
already **self-guarded** by upstream with `if: github.repository == 'kdcokenny/ocx'`, so they
no-op on the fork:

- `release.yml` — npm publish + GitHub release on `v*` tags (also gated on `NPM_TOKEN`).
- `sync-facades.yml` — pushes to the upstream facade repos (gated on `FACADE_SYNC_TOKEN`).

Our own CI is `slurpyb-ci.yml`, which runs `check` + `build` + `bun test` on the `slurpyb`
branch and PRs into it. Upstream `ci.yml` only triggers on `main`, which we keep pristine, so it
does not run on our work.

The remaining upstream workflows (`examples.yml`, `pr-preview-cli.yml`, `pr-title.yml`) are
harmless (no secrets, no publish) but will run on PRs/`main` pushes that touch their paths. If
you want to silence them on the fork:

```sh
gh workflow disable examples.yml      --repo slurpyb/ocx
gh workflow disable "PR Preview (CLI)" --repo slurpyb/ocx
gh workflow disable "PR Title"         --repo slurpyb/ocx
```

## Toolchain

Bun workspaces + Turbo. The CLI uses **Biome** (lint/format) and **`bun test`** (not Vitest).
Key scripts (root unless noted):

| Script | What it does |
|---|---|
| `bun run check` | `turbo run check` → `biome check .` + `tsc --noEmit` |
| `bun run build` | `turbo run build` → builds `packages/cli/dist/index.js` |
| `bun run test` | `turbo run test` (per package `bun test`) |
| `bun run format` | `biome check --write .` |
| `cd packages/cli && bun run dev` | run the CLI from source (`src/index.ts`) |

The published entry / binary is `packages/cli/dist/index.js` (`bin.ocx`). It runs under Bun.

## Publishing

Not published to npm yet — run via local build (`bun run build` then
`packages/cli/dist/index.js`) or `bun link` in `packages/cli`. Publish to the `@slurpyb` scope
later if desired (`publishConfig.access` is already `public`).
