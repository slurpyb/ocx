# Redirect Map

Legacy-to-new URL redirect mappings configured in `mint.json` for the OCX documentation migration.

## Active Redirects

All redirects are configured in `docs/mint.json` under the `"redirects"` key.

| Legacy Source | New Destination | Validated |
|---------------|----------------|-----------|
| `/docs/CLI` | `/cli/commands` | ✓ |
| `/docs/PROFILES` | `/profiles/overview` | ✓ |
| `/docs/ENTERPRISE` | `/enterprise/overview` | ✓ |
| `/SECURITY` | `/security/policy` | ✓ |
| `/docs/MIGRATION-v1.4.0` | `/maintainers/migration-v1-4-0` | ✓ |
| `/docs/CREATING_REGISTRIES` | `/registries/create` | ✓ |
| `/docs/REGISTRY_PROTOCOL` | `/registries/protocol` | ✓ |
| `/docs/OPENCODE_REFERENCE` | `/reference/opencode` | ✓ |
| `/docs/guides` | `/guides/index` | ✓ |
| `/docs/guides/oh-my-opencode` | `/guides/oh-my-opencode` | ✓ |
| `/docs/guides/kdco-workspace` | `/guides/kdco-workspace` | ✓ |

**Total redirects**: 11

## Validation

### Destination File Check

All redirect destinations point to pages that exist in the navigation and have corresponding `.mdx` files:

```
cli/commands.mdx         ✓
profiles/overview.mdx    ✓
enterprise/overview.mdx  ✓
security/policy.mdx      ✓
maintainers/migration-v1-4-0.mdx ✓
registries/create.mdx    ✓
registries/protocol.mdx  ✓
reference/opencode.mdx   ✓
guides/index.mdx         ✓
guides/oh-my-opencode.mdx ✓
guides/kdco-workspace.mdx ✓
```

### Coverage Analysis

| Source Type | Sources Mapped | Notes |
|-------------|---------------|-------|
| Top-level markdown (`/SECURITY`) | 1 | Root-level files |
| `docs/` directory markdown | 8 | Major documentation pages |
| `docs/guides/` subdirectory | 2 | Guide pages |
| Package READMEs | 0 | Not applicable — these are in-repo references, not web URLs |

### Unmapped Legacy Paths

The following source files do not have redirects because they were never published at web-accessible URLs:

| Source File | Reason Not Mapped |
|-------------|-------------------|
| `README.md` | GitHub root — visitors land on repo page, not docs site |
| `docs/MANUAL_TESTING.md` | Not yet migrated (Phase 5) |
| `docs/TEST_PARITY_MATRIX.md` | Intentionally removed as stale internal artifact; no migration target |
| `facades/*/README.md` | Package READMEs — accessed from GitHub, not docs site |
| `workers/*/README.md` | Package READMEs — accessed from GitHub, not docs site |
| `examples/registry-starter/README.md` | Excluded from migration (see source-target-map rationale) |

## Redirect Format

Mintlify redirect syntax in `mint.json`:

```json
{
  "redirects": [
    {
      "source": "/docs/CLI",
      "destination": "/cli/commands"
    }
  ]
}
```

Mintlify performs 301 (permanent) redirects. No client-side or meta-refresh redirects are used.

## Conclusion

All 11 legacy redirects are configured and validated. Every destination resolves to an existing page in the navigation. No redirect loops or chains exist.
