# Visibility Policy

Guidelines for public versus maintainer-only documentation content.

## Content Visibility Levels

| Level | Description | Audience | Example Content |
|-------|-------------|----------|-----------------|
| **Public** | Default visible to all visitors | End users, integrators | Installation guides, CLI reference |
| **Maintainer** | Hidden from default navigation | Core team, contributors | Testing procedures, architecture docs |
| **Internal** | Not in documentation site | Founders only | Security runbooks, incident response |

## Section Visibility Matrix

| Section | Default Visibility | Navigation | Searchable |
|---------|-------------------|------------|------------|
| `getting-started` | Public | Yes | Yes |
| `profiles` | Public | Yes | Yes |
| `cli` | Public | Yes | Yes |
| `registries` | Public | Yes | Yes |
| `integrations` | Public | Yes | Yes |
| `enterprise` | Public | Yes | Yes |
| `reference` | Public | Yes | Yes |
| `security` | Public | Yes | Yes |
| `guides` | Public | Yes | Yes |
| `maintainers` | Maintainer | Hidden | Yes |

## Keeping Maintainer Docs Out of Public Navigation

### Method 1: Hidden Group in Navigation

In `mint.json`:

```json
{
  "navigation": [
    {
      "group": "Getting Started",
      "pages": ["getting-started/introduction"]
    },
    {
      "group": "Maintainers",
      "pages": ["maintainers/manual-testing"],
      "hidden": true
    }
  ]
}
```

The `hidden: true` property keeps the group out of the default sidebar while keeping pages accessible via direct URL.

### Method 2: Separate Navigation Structure

Create a maintainer-specific navigation file:

```jsonc
// mint.maintainers.jsonc — JSONC allows comments; strip before use in mint.json
{
  "name": "OCX Maintainers",
  "navigation": [
    {
      "group": "Processes",
      "pages": [
        "maintainers/manual-testing",
        "maintainers/migration-v1-4-0"
      ]
    }
  ]
}
```

Maintainers access via direct URL: `docs.ocx.dev/maintainers/manual-testing`

### Method 3: No Navigation Entry (Direct Link Only)

Omit maintainer pages from `mint.json` entirely:

```json
{
  "navigation": [
    {
      "group": "Getting Started",
      "pages": ["getting-started/introduction"]
    }
  ]
}
```

Pages exist and are searchable but not linked from navigation. Only public sections are listed in `mint.json`; maintainer pages are omitted entirely.

## Recommended Approach for OCX

Use **Method 1 (Hidden Group)** for these benefits:

- Maintainers can bookmark the section
- Search still indexes content (maintainers can find it)
- Simple configuration in single `mint.json` file
- Easy to make public later by removing `hidden` flag

## Governance Rules

### Content Classification

Before creating documentation, determine visibility:

**Questions to Ask:**

1. Does this help end users accomplish their goals? → **Public**
2. Does this describe internal processes or architecture? → **Maintainer**
3. Could this information be used maliciously? → **Internal** (don't document)
4. Is this specific to a single contributor's workflow? → **Personal notes** (not in docs)

### Classification Examples

| Content | Visibility | Rationale |
|---------|------------|-----------|
| `ocx init` command reference | Public | Users need this to get started |
| Security disclosure policy | Public | Required for responsible disclosure |
| Manual testing procedures | Maintainer | Internal process documentation |
| Registry protocol spec | Public | Needed for third-party registry authors |
| Worker deployment steps | Maintainer | Internal infrastructure |
| Profile configuration guide | Public | Core user feature |
| v1.4.0 migration notes | Maintainer | Historical reference for maintainers |

### Update Governance

#### Public Documentation

- **Approval**: Requires review from at least one other maintainer
- **Changes**: Must not break existing workflows or remove features
- **Deprecation**: 30-day notice before removing or significantly changing
- **Ownership**: Each public page has an assigned owner

#### Maintainer Documentation

- **Approval**: Self-merge acceptable for minor updates
- **Changes**: Can be updated as processes evolve
- **Deprecation**: No notice required, but document reason in commit
- **Ownership**: Section is collectively maintained

### Review Process

#### For New Public Pages

1. Author creates page using appropriate template
2. Assigns section owner as reviewer
3. Reviewer checks:
   - Accuracy of technical content
   - Consistency with existing docs
   - Appropriate visibility classification
4. Merge after approval
5. Update `source-target-map.md` status to "Done"

#### For New Maintainer Pages

1. Author creates page
2. Self-review for accuracy
3. Merge to main
4. Verify page accessible via direct URL
5. Update `source-target-map.md`

### Visibility Escalation

When maintainer content should become public:

1. Identify the need (user question, feature maturity, etc.)
2. Review content for public appropriateness
3. Update tone and examples for end-user audience
4. Move to appropriate public section
5. Update `mint.json` to include in navigation
6. Add redirect if URL changes
7. Update this policy document

### Visibility Restriction

When public content should become maintainer-only:

1. Document the reason (security, complexity, etc.)
2. Verify no external links point to this content
3. Add `hidden: true` to navigation group or remove from `mint.json`
4. Update internal links to use direct URLs
5. Announce change in release notes
6. Update this policy document

## Access Patterns

### For End Users

- Browse via navigation sidebar
- Use search for specific topics
- Access only public sections

### For Maintainers

- Use navigation for public sections
- Bookmark maintainer section URLs
- Use search to find all content (including maintainer)
- Share maintainer URLs directly with team

### For Search Engines

- Public pages: Indexed normally
- Maintainer pages: Indexed but not linked from navigation
- Internal pages: Not in documentation site

## Maintenance Checklist

Quarterly review:

- [ ] All pages have correct visibility classification
- [ ] No sensitive information in public docs
- [ ] Maintainer docs are up-to-date
- [ ] No orphaned pages (not in navigation and not linked)
- [ ] Visibility policy still matches team needs
- [ ] Section owners documented in `source-target-map.md`

## Exceptions

Emergency situations may override this policy:

- Security incidents: Content may be temporarily hidden
- Breaking changes: Docs may be updated without 30-day notice
- Experimental features: May be documented as maintainer-only until stable

Document any exceptions in commit messages and update policy if pattern emerges.
