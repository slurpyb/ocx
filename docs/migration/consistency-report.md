# Consistency Report

Terminology, flag naming, and configuration key consistency findings from the OCX documentation migration.

## Summary

| Category | Findings | Fixes Applied |
|----------|----------|---------------|
| Flag naming | 0 inconsistencies | — |
| Command naming | 1 clarification added | Alias note in `profiles/security.mdx` |
| Config key naming | 0 inconsistencies | — |
| Path conventions | 1 escaping issue | Fixed in `cli/commands.mdx` |
| Terminology | 0 inconsistencies | — |

## Flag Naming Audit

All CLI pages use consistent flag conventions:

| Flag | Long Form | Used Consistently |
|------|-----------|-------------------|
| `-q` | `--quiet` | Yes — all command pages |
| `-v` | `--verbose` | Yes — all command pages |
| `-f` | `--force` | Yes — `remove` only (correct) |
| `-p` | `--profile <name>` | Yes — `add`, `opencode`, `config`, etc. |
| `-g` | `--global` | Yes — `add`, `profile`, `config` |

No flag conflicts or inconsistencies found.

## Command Naming Audit

### `ocx opencode` / `ocx oc`

- **Finding**: The `ocx oc` alias is used throughout guides and profile pages but was not explicitly called out in `profiles/security.mdx`, which used `OCX_PROFILE=... ocx opencode` exclusively.
- **Fix**: Added a `<Tip>` note clarifying `ocx oc` as a shorthand alias for `ocx opencode`, and updated examples to use the shorter form where natural.
- **Affected file**: `docs/profiles/security.mdx`

### Subcommand Aliases

All alias documentation is consistent:

| Command | Alias | Documented |
|---------|-------|------------|
| `ocx opencode` | `ocx oc` | `cli/opencode.mdx` ✓ |
| `ocx profile` | `ocx p` | `cli/profile.mdx` ✓ |
| `ocx profile list` | `ocx p ls` | `cli/profile.mdx` ✓ |
| `ocx profile remove` | `ocx p rm` | `cli/profile.mdx` ✓ |
| `ocx profile move` | `ocx p mv` | `cli/profile.mdx` ✓ |
| `ocx search` | `ocx list` | `cli/search.mdx` ✓ |

## Configuration Key Naming

Consistent usage verified across all pages:

| Key | Format | Pages Using |
|-----|--------|-------------|
| `registries` | Object with named entries | `commands`, `configuration`, `overview`, `security` |
| `exclude` | String array of globs | `configuration`, `security`, `overview` |
| `include` | String array of globs | `configuration`, `security` |
| `bin` | Absolute path string | `configuration`, `opencode` |
| `profile` | Profile name string | `configuration`, `opencode` |
| `lockRegistries` | Boolean | `commands`, `enterprise/overview` |

## Path Convention Audit

### Escaping Issue

- **Finding**: `cli/commands.mdx` line 120 used `\<name\>` backslash-escaping in the heading `#### ~/.config/opencode/profiles/\<name\>/ocx.jsonc`, which rendered incorrectly in Mintlify.
- **Fix**: Changed to HTML entity escaping: `&lt;name&gt;`.

### Path Format Consistency

All configuration path references use consistent formatting:

| Pattern | Format | Consistent |
|---------|--------|------------|
| Global config | `~/.config/opencode/ocx.jsonc` | Yes |
| Global profiles | `~/.config/opencode/profiles/<name>/` | Yes |
| Local config | `.opencode/ocx.jsonc` | Yes |
| Receipt file | `.ocx/receipt.jsonc` | Yes |

## Terminology Audit

| Term | Variations Found | Resolution |
|------|-----------------|------------|
| "Profile" | Always capitalized as "Profile" in headings, lowercase in body | Consistent |
| "OpenCode" | Always PascalCase | Consistent |
| "registry" | Lowercase in body, capitalized in headings | Consistent with Mintlify convention |
| "component" | Always lowercase | Consistent |
| "instruction file" | Always lowercase | Consistent |
| "exclude/include" | Always code-formatted as `exclude`/`include` | Consistent |

## Conclusion

No systemic inconsistencies found. Two minor issues fixed (alias clarification, heading escaping). All flag names, config keys, and terminology are consistent across the 44-page documentation set.
