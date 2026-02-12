# Search Check Report

Top user intents and expected primary search results for the OCX documentation site.

## Methodology

Identified the most common user intents based on CLI surface area, documentation structure, and typical developer workflows. For each intent, the expected primary result page is listed along with supporting pages.

## Top Intents and Expected Results

### Installation & Setup

| Search Query | Primary Page | Supporting Pages |
|-------------|-------------|-----------------|
| "install ocx" | `/getting-started/installation` | `/getting-started/quick-start` |
| "getting started" | `/getting-started/introduction` | `/getting-started/installation`, `/getting-started/quick-start` |
| "quick start" | `/getting-started/quick-start` | `/getting-started/installation` |

### CLI Commands

| Search Query | Primary Page | Supporting Pages |
|-------------|-------------|-----------------|
| "ocx add" | `/cli/add` | `/cli/commands` |
| "ocx init" | `/cli/init` | `/cli/commands`, `/getting-started/quick-start` |
| "ocx update" | `/cli/update` | `/cli/add`, `/cli/commands` |
| "ocx remove" | `/cli/remove` | `/cli/commands` |
| "ocx search" | `/cli/search` | `/cli/commands` |
| "ocx verify" | `/cli/verify` | `/security/verification` |
| "ocx build" | `/cli/build` | `/registries/create` |
| "ocx registry" | `/cli/registry` | `/registries/create`, `/registries/protocol` |
| "ocx profile" | `/cli/profile` | `/profiles/overview` |
| "ocx config" | `/cli/config` | `/profiles/configuration` |
| "ocx opencode" | `/cli/opencode` | `/profiles/overview` |
| "ocx self update" | `/cli/self` | `/cli/commands` |
| "cli reference" | `/cli/commands` | All `/cli/*` pages |

### Profiles

| Search Query | Primary Page | Supporting Pages |
|-------------|-------------|-----------------|
| "profiles" | `/profiles/overview` | `/profiles/configuration`, `/profiles/security` |
| "profile configuration" | `/profiles/configuration` | `/profiles/overview` |
| "profile security" | `/profiles/security` | `/profiles/configuration`, `/enterprise/overview` |
| "exclude include patterns" | `/profiles/configuration` | `/profiles/security` |
| "instruction discovery" | `/profiles/configuration` | `/profiles/overview`, `/reference/skills` |
| "AGENTS.md" | `/profiles/configuration` | `/reference/skills` |
| "workspace profile" | `/profiles/ws` | `/integrations/workspace`, `/guides/kdco-workspace` |
| "oh my opencode" | `/profiles/omo` | `/guides/oh-my-opencode` |

### Registries

| Search Query | Primary Page | Supporting Pages |
|-------------|-------------|-----------------|
| "create registry" | `/registries/create` | `/registries/protocol` |
| "registry protocol" | `/registries/protocol` | `/registries/create` |
| "registry api" | `/registries/protocol` | `/registries/create` |

### Reference

| Search Query | Primary Page | Supporting Pages |
|-------------|-------------|-----------------|
| "opencode configuration" | `/reference/configuration` | `/reference/opencode` |
| "plugins" | `/reference/plugins` | `/reference/opencode` |
| "agents" | `/reference/agents` | `/reference/permissions` |
| "skills" | `/reference/skills` | `/reference/agents` |
| "custom tools" | `/reference/tools` | `/reference/mcp` |
| "mcp server" | `/reference/mcp` | `/reference/tools` |
| "permissions" | `/reference/permissions` | `/reference/agents` |

### Enterprise & Security

| Search Query | Primary Page | Supporting Pages |
|-------------|-------------|-----------------|
| "enterprise" | `/enterprise/overview` | `/security/verification` |
| "registry locking" | `/enterprise/overview` | `/profiles/security` |
| "integrity verification" | `/security/verification` | `/enterprise/overview`, `/cli/verify` |
| "security policy" | `/security/policy` | `/security/verification` |
| "SHA-256" | `/security/verification` | `/cli/add`, `/enterprise/overview` |

### Guides & Integrations

| Search Query | Primary Page | Supporting Pages |
|-------------|-------------|-----------------|
| "workspace setup" | `/guides/kdco-workspace` | `/integrations/workspace` |
| "background agents" | `/integrations/background-agents` | `/integrations/workspace` |
| "notifications" | `/integrations/notify` | `/integrations/workspace` |
| "worktree" | `/integrations/worktree` | `/integrations/workspace` |

### Common Concepts

| Search Query | Primary Page | Supporting Pages |
|-------------|-------------|-----------------|
| "exit codes" | `/cli/commands` | — |
| "environment variables" | `/cli/commands` | `/cli/opencode` |
| "receipt file" | `/cli/commands` | `/cli/add`, `/security/verification` |
| "dry run" | `/cli/add` | `/cli/update`, `/cli/remove` |

## Page Coverage Summary

| Navigation Group | Pages | Searchable Intents Covered |
|-----------------|-------|---------------------------|
| Getting Started | 3 | 3 |
| Profiles | 5 | 8 |
| CLI | 13 | 14 |
| Registries | 2 | 3 |
| Reference | 8 | 7 |
| Guides | 3 | 1 |
| Integrations | 4 | 4 |
| Enterprise | 1 | 2 |
| Security | 2 | 3 |
| Maintainers | 3 | 0 (hidden section) |
| **Total** | **44** | **45** |

## Notes

- Mintlify uses Algolia-based search indexing. Pages with clear `title` and `description` frontmatter will rank well for the intents above.
- All 44 pages have valid frontmatter (`title` + `description`), confirmed by automated check.
- Hidden pages (`maintainers/*`) are excluded from search by Mintlify convention.
- No custom search synonyms or boosts are configured; natural content matching is relied upon.

## Conclusion

The documentation structure provides clear primary pages for all major user intents. Each CLI command, profile concept, and reference topic has a dedicated page, avoiding ambiguity in search results. The split from monolithic pages (Phase 2/3) significantly improves search precision — queries like "ocx update" now land directly on `/cli/update` rather than a long commands page.
