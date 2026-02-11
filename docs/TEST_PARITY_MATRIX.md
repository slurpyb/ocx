# Testing Parity Matrix (v1)

This document maps OCX workflows to their testing coverage, distinguishing between manual verification (README-first) and automated testing (anti-theater approach).

## Purpose

The parity matrix serves as the single source of truth for:

- **README-first manual testing** - Critical user paths documented for human verification
- **Automation for the rest** - Systematic coverage of command surfaces and edge cases
- **Anti-theater enforcement** - Preventing tests that pass without asserting meaningful behavior

We optimize for tests that fail when behavior changes, not tests that give green checkmarks for exercising code paths.

## Definitions

### Priority Levels

| Level | Description | Automation Target |
|-------|-------------|-------------------|
| **P0** | Critical user paths - installation, init, profile setup, core add/registry workflows | Strong guard (must be automated) |
| **P1** | Important command surfaces - remove, update, search, config management | Automated with manual fallback acceptable |
| **P2** | Advanced/registry authoring features - build, deploy, complex scenarios | Manual-first, automate as patterns stabilize |

### Coverage Terms

**Strong guard** - An automated test that:
- Asserts on observable behavior (files created, output content, exit codes)
- Would fail if the implementation changes meaningfully
- Does not mock the system under test unless necessary
- Has no `skip` or `todo` without linked issue

**Skip debt** - A `.skip()` or `.todo()` test without:
- A linked GitHub issue explaining why it is skipped
- A timeline for resolution
- Clear criteria for when it can be unskipped

### Status Values

| Status | Meaning |
|--------|---------|
| `covered-good` | Automated with strong guards, would catch regressions |
| `covered-weak` | Has tests but may not catch meaningful changes (theater risk) |
| `missing` | No automated coverage exists |
| `manual-only-intentional` | Consciously manual (e.g., interactive workflows, external services) |
| `duplicate/theater` | Test exists but overlaps with other tests or asserts nothing meaningful |

## KPI Formulas

Track these metrics to measure testing health:

- **P0 Mapping %** - `(P0 scenarios with covered-good status) / (total P0 scenarios) * 100`
- **P0 Skip Debt** - `count of .skip() in P0 test files without linked issues`
- **P1 Automation %** - `(P1 scenarios with covered-good or covered-weak) / (total P1 scenarios) * 100`
- **Flake Rate** - `(CI failures that pass on retry) / (total CI runs) * 100`
- **Runtime Budget** - `median wall-clock time for full test suite (target: <30s)`
- **Theater Burn-down %** - `(tests moved from duplicate/theater to covered-good) / (total theater tests) * 100`

## How to Update This Matrix

When adding or modifying tests:

1. [ ] Identify the scenario ID in the matrix below
2. [ ] Run the test and verify it asserts meaningful behavior
3. [ ] Update `Automated status` to `covered-good` or `covered-weak`
4. [ ] Add test file path to `Evidence/tests` column
5. [ ] If skipping a test, create a skip debt issue and link it
6. [ ] If removing duplicate tests, update status to `duplicate/theater` and note replacement
7. [ ] Update `last_updated` in matrix header
8. [ ] Run full test suite: `bun run test`
9. [ ] Update KPIs at top of this section

## Anti-Theater Gate Checklist

Before marking any test as `covered-good`, verify:

- [ ] **Behavior-visible** - Test asserts on output, files, or side effects a user could observe
- [ ] **Mutation-relevant** - Changing the implementation would cause this test to fail
- [ ] **Non-duplicate** - Does not overlap with existing tests (check `Evidence/tests` column)
- [ ] **Deterministic** - Same code produces same result (no race conditions, no external state)
- [ ] **Stable observable contract** - Tests public behavior, not internal implementation details
- [ ] **Production-path focused** - Tests the code path users actually hit
- [ ] **Intent/assertion alignment** - Test name describes what is actually asserted

## P0 Workflows (Critical User Paths)

*Strong guard required. Every P0 scenario must have automated coverage with meaningful assertions.*

| Scenario ID | Workflow | Primary docs source | Manual status | Automated status | Owner | Evidence/tests | Skip debt issue | Notes |
|-------------|----------|---------------------|---------------|------------------|-------|----------------|-----------------|-------|
| P0-001 | Install OCX (curl/npm) | README.md | TBD | TBD | - | - | - | Package manager variations |
| P0-002 | `ocx init --global` | README.md | documented | TBD | - | - | - | Creates global config + default profile |
| P0-003 | `ocx profile add <name> --global` | README.md | documented | TBD | - | - | - | Creates empty profile with templates |
| P0-004 | `ocx profile add <name> --source <name/component> --global` | README.md | documented | TBD | - | - | - | Downloads profile from registry |
| P0-005 | `ocx oc -p <profile>` | README.md | documented | TBD | - | - | - | Launch with explicit profile |
| P0-006 | `ocx oc` (default resolution) | README.md | documented | TBD | - | - | - | Flag > env var > default profile |
| P0-007 | `ocx init` (local) | README.md | documented | TBD | - | - | - | Creates `.opencode/` directory |
| P0-008 | `ocx add <name/component> --from <url>` | README.md | documented | TBD | - | - | - | One-command install without saving registry |
| P0-009 | `ocx add npm:<package>` | README.md | documented | TBD | - | - | - | Plugin registration in opencode.jsonc |
| P0-010 | `ocx registry add <url> --name <name>` | README.md | documented | TBD | - | - | - | Saves registry to config |
| P0-011 | `ocx add <name/component>` | README.md | documented | TBD | - | - | - | Install from configured registry |

## P1 Workflows (Important Command Surfaces)

*Automated coverage expected. Manual-only acceptable with justification.*

| Scenario ID | Workflow | Primary docs source | Manual status | Automated status | Owner | Evidence/tests | Skip debt issue | Notes |
|-------------|----------|---------------------|---------------|------------------|-------|----------------|-----------------|-------|
| P1-001 | `ocx remove <component>` | CLI.md | documented | TBD | - | - | - | Remove installed component |
| P1-002 | `ocx remove --all` | CLI.md | documented | TBD | - | - | - | Remove all components |
| P1-003 | `ocx update <component>` | CLI.md | documented | TBD | - | - | - | Update specific component |
| P1-004 | `ocx update --all` | CLI.md | documented | TBD | - | - | - | Update all components |
| P1-005 | `ocx verify` | CLI.md | documented | TBD | - | - | - | Verify component integrity |
| P1-006 | `ocx search` | CLI.md | documented | TBD | - | - | - | Search all registries |
| P1-007 | `ocx search <query>` | CLI.md | documented | TBD | - | - | - | Search with filter |
| P1-008 | `ocx list` | CLI.md | documented | TBD | - | - | - | Alias for search |
| P1-009 | `ocx registry remove <name>` | CLI.md | documented | TBD | - | - | - | Remove registry from config |
| P1-010 | `ocx registry list` | CLI.md | documented | TBD | - | - | - | List configured registries |
| P1-011 | `ocx registry add <url> --name <name> --global` | CLI.md | documented | TBD | - | - | - | Add global registry with explicit name |
| P1-012 | `ocx config show` | CLI.md | documented | TBD | - | - | - | Show merged config |
| P1-013 | `ocx config show --origin` | CLI.md | documented | TBD | - | - | - | Show with source annotations |
| P1-014 | `ocx config edit` | CLI.md | documented | TBD | - | - | - | Open config in $EDITOR |
| P1-015 | `ocx profile list` | CLI.md | documented | TBD | - | - | - | List all profiles |
| P1-016 | `ocx profile show <name>` | CLI.md | documented | TBD | - | - | - | Display profile contents |
| P1-017 | `ocx profile move <old> <new>` | CLI.md | documented | TBD | - | - | - | Rename profile |
| P1-018 | `ocx profile remove <name>` | CLI.md | documented | TBD | - | - | - | Delete profile |
| P1-019 | `ocx oc` with `OCX_PROFILE` env | CLI.md | documented | TBD | - | - | - | Environment variable resolution |
| P1-020 | `ocx oc` with custom binary | CLI.md | documented | TBD | - | - | - | Profile `bin` or `OPENCODE_BIN` env |
| P1-021 | `ocx self update` | CLI.md | documented | TBD | - | - | - | Update OCX to latest |
| P1-022 | `ocx self uninstall` | CLI.md | documented | TBD | - | - | - | Remove OCX config and binary |

## P2 Workflows (Advanced/Registry Authoring)

*Manual-first approach. Automate as patterns stabilize.*

| Scenario ID | Workflow | Primary docs source | Manual status | Automated status | Owner | Evidence/tests | Skip debt issue | Notes |
|-------------|----------|---------------------|---------------|------------------|-------|----------------|-----------------|-------|
| P2-001 | `ocx init --registry <path>` | CLI.md | documented | TBD | - | - | - | Scaffold new registry project |
| P2-002 | `ocx build` | CLI.md | documented | TBD | - | - | - | Build registry from source |
| P2-003 | `ocx build --out <dir>` | CLI.md | documented | TBD | - | - | - | Custom output directory |
| P2-004 | Registry deployment (Cloudflare Workers) | CREATING_REGISTRIES.md | documented | TBD | - | - | - | Deploy to production |
| P2-005 | Local registry testing with `wrangler dev` | CREATING_REGISTRIES.md | documented | TBD | - | - | - | Development server |
| P2-006 | Profile layering (global + local) | PROFILES.md | documented | TBD | - | - | - | Deep merge behavior |
| P2-007 | Exclude/include pattern matching | PROFILES.md | documented | TBD | - | - | - | File discovery filtering |
| P2-008 | Instruction file discovery (deepest-first) | PROFILES.md | documented | TBD | - | - | - | AGENTS.md priority |

## Initial Known Gaps (2026-02-06)

- ~~Manual guide missing explicit remove/verify sections~~ → MANUAL_TESTING.md now has dedicated sections
- ~~No dedicated CLI verify test file yet~~ → verify.test.ts exists with comprehensive coverage
- ~~`add --from` coverage gap in add.test.ts~~ → add.test.ts now has full `--from` ephemeral registry tests
- ~~Skipped core update tests in update.test.ts~~ → All update tests now run (no .skip() markers)
