# URL Policy and Naming Conventions

Standard URL conventions for OCX Mintlify documentation.

## Section Prefixes

All documentation paths use these top-level section prefixes:

| Prefix | Description | Visibility |
|--------|-------------|------------|
| `getting-started` | Installation, quick start, introduction | Public |
| `profiles` | Profile configuration, usage, security | Public |
| `cli` | Command reference and usage patterns | Public |
| `registries` | Creating and managing registries | Public |
| `integrations` | Third-party tools and facades | Public |
| `enterprise` | Enterprise features and deployment | Public |
| `reference` | Technical specifications and APIs | Public |
| `security` | Security policies and verification | Public |
| `guides` | Step-by-step tutorials | Public |
| `maintainers` | Internal documentation and processes | Maintainer-only |

## URL Naming Rules

### Path Structure

```
/{section-prefix}/{descriptive-slug}
```

### Slug Conventions

- **Lowercase only**: `quick-start`, not `QuickStart`
- **Hyphen separators**: `lock-down-recipe`, not `lock_down_recipe`
- **No version numbers in paths**: Use `migration-v1-4-0`, not `migration-v1.4.0`
- **No trailing slashes**: `/cli/commands`, not `/cli/commands/`
- **Descriptive over terse**: `oh-my-opencode` preferred over `omo`

### Reserved Patterns

| Pattern | Usage |
|---------|-------|
| `/api/*` | Reserved for future API documentation |
| `/changelog` | Reserved for release notes |
| `/troubleshooting` | Reserved for common issues index |

## Redirect Policy

### When to Create Redirects

Redirects are required when:

- Legacy documentation URL changes
- Content moves between sections
- Page is split into multiple pages
- File is renamed during migration

### Redirect Format

In `mint.json`:

```json
{
  "redirects": [
    {
      "source": "/legacy-path",
      "destination": "/new-path"
    }
  ]
}
```

### Redirect Priority

1. **Exact matches first**: Handle specific paths before wildcards
2. **Chain redirects**: Update old→old→new to old→new directly
3. **Temporary redirects**: Use for content under review
4. **Permanent redirects**: Use for completed migrations

## Anchor Handling Strategy

### Preserving Anchors

When content moves, preserve these anchor types:

| Anchor Type | Example | Handling |
|-------------|---------|----------|
| Heading anchors | `#installation` | Recreate in new location |
| Code anchors | `#profile-add` | Convert to separate page if large |
| Table anchors | `#commands` | Consider splitting table to separate page |

### Anchor Redirects

Mintlify does not support anchor-specific redirects. When anchors change:

1. Update all internal links to new anchors
2. Add note at old location pointing to new location
3. Consider keeping deprecated anchor as hidden heading

### Best Practices

- Keep anchor IDs stable: `## Installation` always uses `#installation`
- Avoid changing heading text without updating links
- Use explicit HTML anchors for stability: `<a name="stable-anchor"></a>`
- Document anchor changes in migration commit messages

## Source Label to Canonical Route Examples

| Source Label | Canonical Route | Notes |
|--------------|-----------------|-------|
| `README.md` (installation) | `/getting-started/installation` | Extracted section |
| `README.md` (quick start) | `/getting-started/quick-start` | Extracted section |
| `/cli/commands` | `/cli/commands` | Full command reference |
| `/profiles/overview` (config split) | `/profiles/configuration` | Split from overview |
| `/profiles/overview` (security split) | `/profiles/security` | Lock down recipe |
| `/registries/create` | `/registries/create` | Guide format |
| `/registries/protocol` | `/registries/protocol` | Technical spec |
| `/reference/opencode` | `/reference/opencode` | Integration docs |
| `/enterprise/overview` | `/enterprise/overview` | Feature overview |
| `SECURITY.md` (policy) | `/security/policy` | Disclosure policy |
| `SECURITY.md` (verification) | `/security/verification` | Integrity system |
| `/guides/index` | `/guides/index` | Guides index page |
| `/guides/oh-my-opencode` | `/guides/oh-my-opencode` | Tutorial format |
| `/guides/kdco-workspace` | `/guides/kdco-workspace` | Tutorial format |
| `/maintainers/migration-v1-4-0` | `/maintainers/migration-v1-4-0` | Internal doc |
| `docs/MANUAL_TESTING.md` | `/maintainers/manual-testing` | Internal doc |
| `facades/opencode-worktree/README.md` | `/integrations/worktree` | Facade docs |
| `facades/opencode-notify/README.md` | `/integrations/notify` | Facade docs |
| `facades/opencode-background-agents/README.md` | `/integrations/background-agents` | Facade docs |
| `facades/opencode-workspace/README.md` | `/integrations/workspace` | Facade docs |
| `workers/kdco-registry/README.md` | `/maintainers/kdco-registry` | Internal worker |
| `workers/ocx-kit/README.md` | `/maintainers/ocx-kit` | Internal worker |
| `workers/ocx-kit/files/profiles/ws/README.md` | `/profiles/ws` | Profile reference |
| `workers/ocx-kit/files/profiles/omo/README.md` | `/profiles/omo` | Profile reference |
| `examples/registry-starter/README.md` | `/registries/starter-example` | Example walkthrough |

## URL Consistency Checklist

Before publishing any page, verify:

- [ ] Path follows `/{section}/{slug}` format
- [ ] Section prefix matches content type (see table above)
- [ ] Slug uses lowercase with hyphens
- [ ] No periods, underscores, or camelCase in slug
- [ ] Redirect created if replacing existing page
- [ ] All internal links use new Mintlify paths
- [ ] No external links pointing to legacy paths
- [ ] Anchor IDs match heading text (lowercase, hyphenated)

## Maintenance

When adding new documentation:

1. Choose appropriate section prefix
2. Create descriptive slug following conventions
3. Check for existing redirects that may conflict
4. Update this document with new mappings
5. Announce URL changes in team communications
