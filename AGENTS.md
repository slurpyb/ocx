# AGENTS.md

Practical guide for coding agents working in the OCX monorepo.

## Project Snapshot

- **Project:** OCX (OpenCode extension CLI + registries + workers)
- **Runtime:** Bun (`bun@1.3.5` from root `package.json`)
- **Language:** TypeScript (`strict: true`)
- **Monorepo orchestration:** Turbo (`turbo run ...`)
- **Primary package:** `packages/cli` (published `ocx` CLI)

## Repository Layout (high-signal only)

```text
packages/cli/          Main CLI implementation and tests
registry/              Registry source packages
workers/ocx/           OCX worker
workers/kdco-registry/ KDCO registry worker
workers/ocx-kit/       Kit worker/registry
```

## Build, Lint, Type-Check, Test

### Root commands (run from repo root)

```bash
bun run build    # turbo run build
bun run check    # turbo run check (Biome + TypeScript)
bun run test     # turbo run test
bun run format   # biome check --write .
```

Notes from `turbo.json`:
- `test` depends on `^build` (workspace dependencies build first)
- `check` has no extra dependency wiring (runs per package task)

### Single-test commands (explicit examples)

```bash
# Run one exact test file from repo root
bun test packages/cli/tests/add.test.ts

# Run one exact test file from repo root (another example)
bun test packages/cli/tests/opencode.test.ts

# Run matching tests by name
bun test --grep "should resolve profile"

# Run tests in watch mode
bun test --watch
```

### Package-level commands

From `packages/cli/`:

```bash
bun run build
bun run check
bun run check:biome
bun run check:types
bun test
```

## Code Style and Conventions

### Formatting (Biome, from `biome.json`)

- Tabs, width 2
- Max line width 100
- Double quotes
- Semicolons: `asNeeded`
- Import organization enabled (`source.organizeImports: on`)

### Imports

- Use `import type` for type-only imports (enforced)
- Prefer external imports first, then internal modules
- Do not hand-sort aggressively; let Biome organize when possible

### TypeScript and types

- `strict: true` is required
- `noUnusedVariables` and `noUnusedImports` are enforced as errors
- Prefer explicit return types on exported/public functions
- Parse boundary input with Zod; use `z.infer<typeof Schema>` for shared types
- Avoid `any`; prefer `unknown` + parsing
- In `packages/cli`, `noUncheckedIndexedAccess` is enabled

### Naming conventions

| Element | Convention | Example |
|---|---|---|
| variables/functions | camelCase | `resolveProfile`, `configPath` |
| types/interfaces | PascalCase | `RegistryConfig`, `ProfileContext` |
| classes | PascalCase | `OCXError`, `NetworkError` |
| constants | SCREAMING_SNAKE_CASE | `EXIT_CODES` |
| files | kebab-case | `handle-error.ts` |

### Error handling

- Use typed errors from `packages/cli/src/utils/errors.ts`
- Prefer specific classes: `NotFoundError`, `NetworkError`, `ConfigError`, `ValidationError`, `ConflictError`, `IntegrityError`
- Profile-specific errors exist for profile workflows (`ProfileNotFoundError`, `ProfileExistsError`, etc.)
- Use `EXIT_CODES` for deterministic process exits
- In Commander actions, either:
  - wrap handlers with `wrapAction(...)`, or
  - use `try/catch` and delegate to `handleError(error, options)`
- At CLI entrypoint level, errors are finalized through `handleError(...)`
- Fail fast with clear, actionable messages (do not swallow errors)

### Testing conventions (`bun:test`)

- Use `describe/it/expect` from `bun:test`
- For CLI behavior tests, use shared helpers in `packages/cli/tests/helpers.ts`
  - `runCLI(...)` for subprocess execution
  - `runCLIIsolated(...)` for deterministic environment tests
  - `createTempDir(...)` + `cleanupTempDir(...)` for fixture lifecycle
- Assert on **exit code + output**, not output alone
- Prefer deterministic tests (explicit env and temp paths)
- Keep tests independent; clean up in `afterEach`/`afterAll`

### Practical implementation patterns

- Prefer focused functions with early returns (guard clauses)
- Parse input at boundaries; keep internals on trusted types
- Use `Bun.file()` / `Bun.write()` for Bun-native file access
- Use JSONC parsing (`jsonc-parser`) for config files
- Prefer `async/await` over chained `.then()` in CLI logic
- Avoid hidden mutation and side effects where possible

## OCX-specific Architecture Notes (condensed)

### Profile resolution priority

1. `--profile` / `-p`
2. `OCX_PROFILE`
3. `default` profile
4. fallback: base/no profile

### Profile config behavior

- Profile OCX configs merge global + local profile layers (local wins conflicts)
- Array fields replace; object fields deep-merge
- Active profile scope isolates registry behavior for component operations

### `ocx opencode` behavior (summary)

- Resolves active profile via priority above
- Discovers instruction files while walking up to git root
- Applies include/exclude patterns from profile config
- Launches OpenCode with merged settings and isolated OCX config scope

## Cursor / Copilot Rule Files

Checked repository root for:

- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

**Status:** none of these files are present in this repo currently.
