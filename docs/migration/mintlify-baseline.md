# Mintlify Baseline Setup

This document outlines the baseline setup requirements for migrating OCX documentation to Mintlify.

## Prerequisites

- Node.js 18+ installed locally
- Mintlify CLI installed globally: `npm install -g mintlify`
- Access to OCX Mintlify project (production environment)
- Git repository with appropriate branch permissions

## Baseline Setup Checklist

### Environment Setup

- [ ] Install Mintlify CLI globally
- [ ] Clone/fork repository for documentation migration
- [ ] Verify `docs/` directory exists at repository root
- [ ] Confirm `mint.json` configuration file present
- [ ] Set up environment variables for production deployment (if required)

### Configuration Verification

- [ ] Review `mint.json` structure matches OCX documentation hierarchy
- [ ] Confirm navigation groups align with section prefixes (see `url-policy.md`)
- [ ] Verify analytics integration (if applicable)
- [ ] Check SEO metadata configuration
- [ ] Validate code block syntax highlighting languages

### Content Preparation

- [ ] Copy existing assets (images, diagrams) to Mintlify `images/` directory
- [ ] Verify all internal links use relative paths
- [ ] Confirm no broken external links exist
- [ ] Review and update frontmatter on all migrated pages

## Local Preview Workflow

### Starting Local Development Server

```bash
# Navigate to documentation root
cd docs/

# Start Mintlify development server
mintlify dev

# Server starts on http://localhost:3000
# Hot reload enabled for all file changes
```

### Preview Best Practices

1. **Before making changes**: Start fresh server to ensure baseline state
2. **During migration**: Keep dev server running to catch errors immediately
3. **Before commit**: Navigate through entire site to verify links
4. **Check mobile view**: Mintlify preview supports responsive testing

### Common Issues

| Issue | Resolution |
|-------|------------|
| Port already in use | `mintlify dev --port 3001` |
| File changes not reflecting | Restart dev server |
| Image not loading | Verify path is relative from `docs/` root |
| Build errors | Check `mint.json` for syntax issues |

## Preview Deployment Path

### Development Preview

Every pull request automatically generates a preview deployment:

1. Push branch with documentation changes
2. Mintlify generates preview URL automatically
3. Share preview link in PR for stakeholder review
4. Preview URL persists until PR is merged or closed

### Staging Process

- [ ] Create feature branch: `docs/migration-section-name`
- [ ] Commit changes with clear messages
- [ ] Open PR against `main` branch
- [ ] Verify preview deployment renders correctly
- [ ] Request review from documentation owner
- [ ] Address feedback iteratively

### Production Deployment

Production deployment triggers on merge to `main`:

1. Merge approved PR to `main`
2. Mintlify auto-deploys to production within 2-3 minutes
3. Verify production URL matches expected state
4. Check critical pages load without errors
5. Update migration status in `source-target-map.md`

## Assumptions and Prerequisites

### Content Assumptions

- Source documentation is in valid Markdown format
- All code examples are tested and functional
- Images/screenshots are current and accurately represent the UI
- No proprietary or sensitive information in public docs

### Technical Assumptions

- Mintlify platform remains stable and available
- No breaking changes to Mintlify configuration format during migration
- Custom domains (if applicable) are already configured
- Search indexing updates automatically on deployment

### Process Assumptions

- Migration happens incrementally by section
- Each migrated page is reviewed before publication
- Legacy documentation remains available during transition
- Redirects are in place before removing legacy content

### Prerequisites Summary

| Requirement | Status | Notes |
|-------------|--------|-------|
| Mintlify account access | Required | Production environment |
| Repository write access | Required | For branch/PR creation |
| Local development environment | Required | Node.js 18+, Mintlify CLI |
| Content audit completed | Recommended | Identify outdated content |
| Redirect strategy defined | Required | See `url-policy.md` |
| Section owners identified | Required | See `source-target-map.md` |

## Quality Gates

Every migrated page must pass these measurable gates before its status can move to "Done":

| Gate | Metric | Threshold |
|------|--------|-----------|
| Link health | % of internal links resolving without 404 | 100% |
| Frontmatter | Pages with valid `title` + `description` frontmatter | 100% |
| Template compliance | Pages following a concept/task/command-reference template | 100% |
| Code block language | Fenced code blocks with explicit language tag | 100% |
| Image alt text | Images with non-empty alt text | 100% |
| Heading hierarchy | No skipped heading levels (h1→h3) | 0 violations |
| Broken external links | External URLs returning non-2xx status | 0 |
| Build | `mintlify dev` starts without errors | Pass |

### Measuring Quality

```bash
# Link health — use a Markdown link checker (mintlify CLI has no broken-links command)
# Install: npm install -g markdown-link-check
find docs/ -name '*.md' -exec markdown-link-check {} \;

# Build gate
mintlify dev          # must start without errors

# Frontmatter audit (list .md files that lack a title frontmatter field)
rg --files-without-match '^title:' docs/ --glob '*.md'   # expect 0 results
```

### Per-Phase Sign-Off

Each migration phase (see `source-target-map.md`) requires:

1. All pages in the phase pass every quality gate above.
2. Local preview reviewed (desktop + mobile).
3. PR preview deployment approved by section owner.

## Rollback Procedures

If production deployment causes issues:

1. Revert the merged PR immediately
2. Mintlify will redeploy previous version automatically
3. Notify team via standard communication channels
4. Document issue for post-mortem
5. Re-migrate after fixing root cause

## References

- [Mintlify Documentation](https://mintlify.com/docs)
- [URL Policy](./url-policy.md)
- [Source-Target Map](./source-target-map.md)
