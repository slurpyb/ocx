# Source-to-Target Migration Map

Complete mapping of all OCX documentation sources to Mintlify destination paths.

## Migration Status Legend

| Status | Description |
|--------|-------------|
| Pending | Not yet started |
| In Progress | Currently being migrated |
| Review | Ready for review |
| Done | Migrated, deployed, and passes all quality gates (see `mintlify-baseline.md`) |
| Blocked | Waiting on dependencies |

### Acceptance Criteria for "Done"

A page moves to "Done" only when **all** of the following are true:

1. Content migrated using the correct template from `templates.md`.
2. Frontmatter contains valid `title` and `description`.
3. All internal links resolve (0 broken links).
4. Visibility matches `visibility-policy.md` classification.
5. URL follows `url-policy.md` conventions.
6. Redirect configured for legacy path (if applicable).
7. Section owner has approved the PR preview.

---

## Core Documentation

| Source Path | Target Mintlify Path | Section | Owner | Status | Notes |
|-------------|---------------------|---------|-------|--------|-------|
| `README.md` | `getting-started/introduction` | Getting Started | @kdcokenny | Done | Landing page, overview content |
| `README.md` | `getting-started/installation` | Getting Started | @kdcokenny | Done | Extract installation section |
| `README.md` | `getting-started/quick-start` | Getting Started | @kdcokenny | Done | Extract quick start section |
| `/cli/commands` | `cli/commands` | CLI | @kdcokenny | Done | Command overview, global opts, exit codes, env vars, config |
| `/cli/commands` | `cli/init` | CLI | @kdcokenny | Done | Init command reference |
| `/cli/commands` | `cli/add` | CLI | @kdcokenny | Done | Add command reference |
| `/cli/commands` | `cli/remove` | CLI | @kdcokenny | Done | Remove command reference (Phase 3) |
| `/cli/commands` | `cli/update` | CLI | @kdcokenny | Done | Update command reference (Phase 3) |
| `/cli/commands` | `cli/search` | CLI | @kdcokenny | Done | Search/list command reference (Phase 3) |
| `/cli/commands` | `cli/verify` | CLI | @kdcokenny | Done | Verify command reference (Phase 3) |
| `/cli/commands` | `cli/registry` | CLI | @kdcokenny | Done | Registry subcommands reference |
| `/cli/commands` | `cli/build` | CLI | @kdcokenny | Done | Build command reference (Phase 3) |
| `/cli/commands` | `cli/self` | CLI | @kdcokenny | Done | Self update/uninstall reference (Phase 3) |
| `/cli/commands` | `cli/profile` | CLI | @kdcokenny | Done | Profile subcommands reference |
| `/cli/commands` | `cli/config` | CLI | @kdcokenny | Done | Config show/edit reference (Phase 3) |
| `/cli/commands` | `cli/opencode` | CLI | @kdcokenny | Done | Opencode command reference |
| `/profiles/overview` | `profiles/overview` | Profiles | @kdcokenny | Done | Core concepts |
| `/profiles/overview` | `profiles/configuration` | Profiles | @kdcokenny | Done | Config file reference |
| `/profiles/overview` | `profiles/security` | Profiles | @kdcokenny | Done | Lock down recipe section |

## Registry Documentation

| Source Path | Target Mintlify Path | Section | Owner | Status | Notes |
|-------------|---------------------|---------|-------|--------|-------|
| `/registries/create` | `registries/create` | Registries | @kdcokenny | Done | Building registries (Phase 3) |
| `/registries/protocol` | `registries/protocol` | Registries | @kdcokenny | Done | Technical specification (Phase 3) |

## Reference Documentation

| Source Path | Target Mintlify Path | Section | Owner | Status | Notes |
|-------------|---------------------|---------|-------|--------|-------|
| `/reference/opencode` | `reference/opencode` | Reference | @kdcokenny | Done | Index/landing page (Phase 3) |
| `/reference/opencode` §1 | `reference/plugins` | Reference | @kdcokenny | Done | Plugin development (Phase 3) |
| `/reference/opencode` §2 | `reference/configuration` | Reference | @kdcokenny | Done | opencode.jsonc config, SDK (Phase 3) |
| `/reference/opencode` §3 | `reference/agents` | Reference | @kdcokenny | Done | Agent configuration (Phase 3) |
| `/reference/opencode` §4 | `reference/skills` | Reference | @kdcokenny | Done | Skills & instruction discovery (Phase 3) |
| `/reference/opencode` §5 | `reference/tools` | Reference | @kdcokenny | Done | Custom tool dev (Phase 3) |
| `/reference/opencode` §6 | `reference/mcp` | Reference | @kdcokenny | Done | MCP server config (Phase 3) |
| `/reference/opencode` §7 | `reference/permissions` | Reference | @kdcokenny | Done | Permission system (Phase 3) |

## Enterprise & Security

| Source Path | Target Mintlify Path | Section | Owner | Status | Notes |
|-------------|---------------------|---------|-------|--------|-------|
| `/enterprise/overview` | `enterprise/overview` | Enterprise | @kdcokenny | Done | Enterprise features |
| `SECURITY.md` | `security/policy` | Security | @kdcokenny | Done | Security policy |
| `SECURITY.md` | `security/verification` | Security | @kdcokenny | Done | Integrity verification |

## Guides

| Source Path | Target Mintlify Path | Section | Owner | Status | Notes |
|-------------|---------------------|---------|-------|--------|-------|
| `/guides/index` | `guides/index` | Guides | @kdcokenny | Done | Guides landing page (Phase 3) |
| `/guides/oh-my-opencode` | `guides/oh-my-opencode` | Guides | @kdcokenny | Done | Profile tutorial (Phase 3) |
| `/guides/kdco-workspace` | `guides/kdco-workspace` | Guides | @kdcokenny | Done | Workspace setup guide (Phase 3) |

## Maintenance & Testing

| Source Path | Target Mintlify Path | Section | Owner | Status | Notes |
|-------------|---------------------|---------|-------|--------|-------|
| `/maintainers/migration-v1-4-0` | `maintainers/migration-v1-4-0` | Maintainers | @kdcokenny | Done | v1.4.0 migration notes |
| `docs/MANUAL_TESTING.md` | `maintainers/manual-testing` | Maintainers | @kdcokenny | Pending | Testing procedures |

## Package Documentation

### Facades

| Source Path | Target Mintlify Path | Section | Owner | Status | Notes |
|-------------|---------------------|---------|-------|--------|-------|
| `facades/opencode-worktree/README.md` | `integrations/worktree` | Integrations | @kdcokenny | Done | Worktree facade docs (Phase 3) |
| `facades/opencode-notify/README.md` | `integrations/notify` | Integrations | @kdcokenny | Done | Notification facade docs (Phase 3) |
| `facades/opencode-background-agents/README.md` | `integrations/background-agents` | Integrations | @kdcokenny | Done | Background agents docs (Phase 3) |
| `facades/opencode-workspace/README.md` | `integrations/workspace` | Integrations | @kdcokenny | Done | Workspace facade docs (Phase 3) |

### Workers

| Source Path | Target Mintlify Path | Section | Owner | Status | Notes |
|-------------|---------------------|---------|-------|--------|-------|
| `workers/kdco-registry/README.md` | `maintainers/kdco-registry` | Maintainers | @kdcokenny | Done | Registry worker docs (Phase 3, hidden) |
| `workers/ocx-kit/README.md` | `maintainers/ocx-kit` | Maintainers | @kdcokenny | Done | OCX kit worker docs (Phase 3, hidden) |

### Worker Profiles

| Source Path | Target Mintlify Path | Section | Owner | Status | Notes |
|-------------|---------------------|---------|-------|--------|-------|
| `workers/ocx-kit/files/profiles/ws/README.md` | `profiles/ws` | Profiles | @kdcokenny | Done | Workspace profile docs (Phase 3) |
| `workers/ocx-kit/files/profiles/omo/README.md` | `profiles/omo` | Profiles | @kdcokenny | Done | OhMyOpenCode profile docs (Phase 3) |

### Examples

| Source Path | Target Mintlify Path | Section | Owner | Status | Notes |
|-------------|---------------------|---------|-------|--------|-------|
| `examples/registry-starter/README.md` | — | — | @kdcokenny | **Excluded** | See rationale below |

#### Exclusion Rationale: `examples/registry-starter/README.md`

The registry starter example README is **excluded** from Mintlify migration for these reasons:

1. **Self-contained template**: The starter is designed to be forked/cloned as a standalone project. Its README must remain in the repo root for GitHub discoverability.
2. **Covered by existing docs**: The content (component types, build/deploy, structure) is fully covered by the [Creating Registries](/registries/create) guide, which links to the starter.
3. **Avoid duplication**: Migrating it would create a maintenance burden of keeping two copies in sync.
4. **Cross-reference instead**: The registries docs link users to the starter repo for the actual template. The `ocx init --registry` command scaffolds from this template directly.

---

## Migration Priority

### Phase 1: Foundation (Complete)

1. ✅ `README.md` → Getting Started section
2. ✅ `/cli/commands` → CLI section (high-traffic pages)
3. ✅ `/profiles/overview` → Profiles section

### Phase 2: Core Ecosystem (Complete)

1. ✅ `/enterprise/overview` → Enterprise section
2. ✅ `SECURITY.md` → Security section
3. ✅ `/maintainers/migration-v1-4-0` → Maintainers section

### Phase 3: Full CLI, Reference, Registries, Guides, Ecosystem (Complete)

1. ✅ `/cli/commands` → Full CLI section (remaining commands: remove, update, search, verify, build, self, config)
2. ✅ `/reference/opencode` → Reference section (split into 8 pages)
3. ✅ `/registries/create` → Registries section
4. ✅ `/registries/protocol` → Registries section
5. ✅ `/guides/*` → Guides section (index + 2 guides)
6. ✅ `facades/*/README.md` → Integrations section (4 facades)
7. ✅ `workers/*/README.md` → Maintainers section (hidden, 2 workers)
8. ✅ `workers/ocx-kit/files/profiles/*/README.md` → Profiles section (2 profiles)
9. ✅ `examples/registry-starter/README.md` → Excluded (see rationale above)

### Phase 4: QA, Link Validation & Migration Artifacts (Complete)

1. ✅ Broken anchor links fixed (3 links pointed to `#ocx-*` anchors on commands page, now point to dedicated pages)
2. ✅ Missing assets added (logo/dark.svg, logo/light.svg, favicon.svg)
3. ✅ Escaping issue fixed in `cli/commands.mdx` path heading
4. ✅ Alias clarification added to `profiles/security.mdx`
5. ✅ Migration artifacts produced: link-report, consistency-report, redirect-map, search-check-report

### Phase 5: Remaining Maintainer Docs (Future)

1. `docs/MANUAL_TESTING.md` → `maintainers/manual-testing`

---

## Cross-References to Maintain

When migrating, preserve these internal links:

| From Page | Link Target | New Target Path |
|-----------|-------------|-----------------|
| `README.md` | `/profiles/overview` | `/profiles/overview` |
| `README.md` | `/cli/commands` | `/cli/commands` |
| `README.md` | `/guides/oh-my-opencode` | `/guides/oh-my-opencode` |
| `README.md` | `/guides/index` | `/guides/index` |
| `README.md` | `/registries/create` | `/registries/create` |
| `/guides/oh-my-opencode` | `/profiles/overview` | `/profiles/overview` |
| `/registries/create` | `/registries/protocol` | `/registries/protocol` |
| `/reference/opencode` | (internal sections) | `/reference/*` (split pages) |

---

## Post-Migration Checklist

- [x] Phase 1 pages migrated
- [x] Phase 2 pages migrated
- [x] Phase 3 pages migrated
- [x] Phase 4 QA & artifacts completed
- [x] Cross-references updated to Mintlify paths
- [x] Redirects configured for legacy URLs
- [x] Navigation structure validated in Mintlify
- [x] Internal link validation passed (0 broken links)
- [ ] Search indexing completed
- [ ] Stakeholder sign-off received
