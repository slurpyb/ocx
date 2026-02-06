---
last_full_test: YYYY-MM-DD
ocx_version: x.x.x
platform: macOS
---

# Manual Testing Guide

Comprehensive manual testing checklist for all documented OCX functionality.

> **Pre-Release Testing:** This guide uses locally built registries served via
> `wrangler dev` (`localhost:8787`, `localhost:8788`). This is required because
> deployed registries may not reflect current changes. After release, you can
> optionally verify against production URLs.

## Overview

This document provides a complete testing checklist for OCX. Use it to verify functionality before releases or when making significant changes.

### Purpose

- **QA Sessions**: Step through tests systematically
- **Regression Testing**: Verify changes don't break existing functionality
- **Release Validation**: Complete smoke test before shipping
- **Documentation Sync**: Ensure documented behavior matches implementation

### How to Use

1. Set up the sandbox environment (see Section 1)
2. Work through sections sequentially
3. Check off boxes as you complete tests
4. Note failures or unexpected behavior
5. Update `last_full_test` metadata when complete
6. Reset checkboxes between test sessions

### Out of Scope

- **Performance benchmarking** - Not covered by manual testing
- **Load testing** - Not applicable to CLI tool
- **Windows-specific testing** - Focus on macOS (primary platform)
- **Automated integration tests** - See `packages/cli/tests/`

---

## Testing Philosophy

Manual testing validates that **documentation is accurate**. When following documented commands:

1. **If a command works as documented** → Test PASSES
2. **If a command produces unexpected results** → This is a **DOCUMENTATION BUG**

**Do NOT "figure out" the correct command.** Report the discrepancy between documented behavior and actual behavior. The goal is to ensure users following documentation get expected results.

### Testing Against Documentation

When testing:
- Follow the documented command exactly as written
- If the result doesn't match documentation, note it as a doc bug
- Suggest the fix (either update docs or fix code)
- The test should reflect what users will experience following the docs

---

## 1. Sandbox Setup

### Prerequisites

> **Note:** Replace `$OCX_REPO` in the commands below with the path to your local OCX repository clone.

Before running any tests, build the CLI from source:

```bash
cd "$OCX_REPO"
bun install
bun run build
```

This ensures you're testing the current codebase, not a system-installed version.

### Build and Serve Local Registries

For pre-release testing, use locally built registries instead of deployed URLs.

**Terminal 1: KDCO Registry (components)**
```bash
cd "$OCX_REPO/workers/kdco-registry"
bun run build
wrangler dev
# Serves on http://localhost:8787
```

**Terminal 2: OCX Kit Registry (profiles)**
```bash
cd "$OCX_REPO/workers/ocx-kit"
bun run build
wrangler dev --port 8788
# Serves on http://localhost:8788
```

Keep these terminals running during all manual tests.

**Verify registries are accessible:**
```bash
curl http://localhost:8787/index.json | head -5
curl http://localhost:8788/index.json | head -5
```

### 1.1 Create Isolated Environment

- [ ] **Setup:** Clean slate for testing
- [ ] **Commands:**
  ```bash
  export XDG_CONFIG_HOME=/tmp/ocx-v2-test
  alias ocx="$OCX_REPO/packages/cli/dist/index.js"
  mkdir -p /tmp/ocx-v2-test-project
  cd /tmp/ocx-v2-test-project
  git init
  ```
- [ ] **Expected:** Environment variables set, test project directory created

### Verify Dev Build

Confirm the dev build is being used:

```bash
type ocx
# Expected: ocx is aliased to `$OCX_REPO/packages/cli/dist/index.js'

ocx --version
# Should match package.json version
```

If `type ocx` shows a different command (e.g., `/usr/local/bin/ocx`), the alias didn't take effect. Re-run the alias command in your current shell.
- [ ] **Verify:**
  ```bash
  echo $XDG_CONFIG_HOME  # Should show /tmp/ocx-v2-test
  type ocx               # Should show alias to local dev build
  ocx --version          # Should show current version
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 1.2 Cleanup Between Test Sections

- [ ] **Setup:** Reset state between sections
- [ ] **Commands:**
  ```bash
  rm -rf /tmp/ocx-v2-test
  rm -rf /tmp/ocx-v2-test-project
  mkdir -p /tmp/ocx-v2-test-project
  cd /tmp/ocx-v2-test-project
  git init
  ```
- [ ] **Expected:** Fresh environment for next test section
- [ ] **Verify:** Directories recreated, git initialized
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 1.3 Complete Teardown

- [ ] **Setup:** After all tests complete
- [ ] **Commands:**
  ```bash
  unset XDG_CONFIG_HOME
  rm -rf /tmp/ocx-v2-test /tmp/ocx-v2-test-project
  ```
- [ ] **Expected:** Environment cleaned up
- [ ] **Verify:** No leftover test artifacts
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 1.4 Stop Local Registry Servers

- [ ] **Setup:** When done testing
- [ ] **Action:** Stop the wrangler dev servers
- [ ] **Commands:**
  1. Go to each terminal running `wrangler dev`
  2. Press `Ctrl+C` to stop the server
- [ ] **Verify:** Servers no longer accessible
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 2. README: Quick Start Profiles

Test cases from README.md lines 38-54.

### 2.1 `ocx init --global`

- [ ] **Setup:** Fresh sandbox (Section 1.1)
- [ ] **Command:** `ocx init --global`
- [ ] **Expected:** Creates `~/.config/opencode/` with global config and default profile
- [ ] **Verify:**
  ```bash
  ls -la $XDG_CONFIG_HOME/opencode/
  ls -la $XDG_CONFIG_HOME/opencode/profiles/default/
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc
  cat $XDG_CONFIG_HOME/opencode/profiles/default/ocx.jsonc
  cat $XDG_CONFIG_HOME/opencode/profiles/default/opencode.jsonc
  cat $XDG_CONFIG_HOME/opencode/profiles/default/AGENTS.md
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 2.2 `ocx profile add work`

- [ ] **Setup:** Global profiles initialized (Section 2.1)
- [ ] **Command:** `ocx profile add work --global`
- [ ] **Expected:** Creates new profile `work` with template files
- [ ] **Verify:**
  ```bash
  ocx profile list  # Should show: default, work
  ls -la $XDG_CONFIG_HOME/opencode/profiles/work/
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 2.3 Add Global Registry

- [ ] **Setup:** Profiles initialized (Section 2.1)
- [ ] **Command:** `ocx registry add http://localhost:8788 --name kit --global`
- [ ] **Expected:** Adds registry to global config
- [ ] **Verify:**
  ```bash
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc  # Should contain kit registry
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 2.4 Install Profile from Registry

- [ ] **Setup:** Global registry configured (Section 2.3)
- [ ] **Command:** `ocx profile add work --from kit/omo --global`
- [ ] **Expected:** Downloads and installs profile from registry
- [ ] **Verify:**
  ```bash
  ocx profile show work
  ls -la $XDG_CONFIG_HOME/opencode/profiles/work/
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 2.5 Launch OpenCode with Profile

- [ ] **Setup:** Work profile exists (Section 2.2 or 2.4)
- [ ] **Command:** `cd /tmp/ocx-v2-test-project && ocx oc -p work run "echo hello"`
- [ ] **Expected:** OpenCode runs with work profile, executes command
- [ ] **Verify:** Command output shows "hello"
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 2.6 Set Default Profile via Environment

- [ ] **Setup:** Work profile exists (Section 2.2 or 2.4)
- [ ] **Commands:**
  ```bash
  export OCX_PROFILE=work
  ocx oc run "echo hello"
  ```
- [ ] **Expected:** Uses work profile automatically without `-p` flag
- [ ] **Verify:** Command executes successfully
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 3. README: Quick Start Components

Test cases from README.md lines 66-86.

### 3.1 `ocx init` (Local)

- [ ] **Setup:** Fresh test project directory
- [ ] **Command:** `ocx init`
- [ ] **Expected:** Creates `.opencode/` directory with config files
- [ ] **Verify:**
  ```bash
  ls -la .opencode/
  cat .opencode/ocx.jsonc
  cat .opencode/opencode.jsonc
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 3.2 One-Command Install with Ephemeral Registry

- [ ] **Setup:** Local config initialized (Section 3.1)
- [ ] **Command:** `ocx add kdco/workspace --from http://localhost:8787`
- [ ] **Expected:** Installs component without saving registry
- [ ] **Verify:**
  ```bash
  ls .opencode/  # Should contain workspace files
  cat .ocx/receipt.jsonc  # Should list kdco/workspace
  cat .opencode/ocx.jsonc  # Should NOT contain registry.kdco.dev
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 3.3 Add npm Plugin Directly

- [ ] **Setup:** Local config initialized (Section 3.1)
- [ ] **Command:** `ocx add npm:@franlol/opencode-md-table-formatter`
- [ ] **Expected:** Plugin is registered in `.opencode/opencode.jsonc`; actual installation is handled by OpenCode runtime
- [ ] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain plugin in "plugins" array
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 3.4 Add Registry Permanently (Local)

- [ ] **Setup:** Local config initialized (Section 3.1)
- [ ] **Commands:**
  ```bash
  ocx registry add http://localhost:8787 --name kdco
  ocx add kdco/workspace
  ```
- [ ] **Expected:** Registry saved to config, component installed
- [ ] **Verify:**
  ```bash
  cat .opencode/ocx.jsonc  # Should contain kdco registry
  ocx registry list  # Should show kdco
  ls .opencode/  # Should contain workspace files
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 4. CLI Reference: ocx init

All variations from CLI.md lines 33-126.

### 4.1 `ocx init` (Default Local)

- [ ] **Setup:** Fresh test project directory
- [ ] **Command:** `ocx init`
- [ ] **Expected:** Creates `.opencode/` with default config
- [ ] **Verify:**
  ```bash
  ls .opencode/
  cat .opencode/ocx.jsonc
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.2 `ocx init --global`

- [ ] **Setup:** Fresh sandbox
- [ ] **Command:** `ocx init --global`
- [ ] **Expected:** Creates `~/.config/opencode/` and default profile
- [ ] **Verify:**
  ```bash
  ls $XDG_CONFIG_HOME/opencode/
  ls $XDG_CONFIG_HOME/opencode/profiles/default/
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.3 `ocx init` (Default Behavior)

- [ ] **Setup:** Test project directory
- [ ] **Command:** `ocx init`
- [ ] **Expected:** Creates config with defaults, no prompts required
- [ ] **Verify:** `.opencode/` created with defaults
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.4 `ocx init` (Error on Existing)

- [ ] **Setup:** Existing `.opencode/` directory
- [ ] **Commands:**
  ```bash
  ocx init
  ocx init  # Run again
  ```
- [ ] **Expected:** Second run fails with error (config already exists)
- [ ] **Verify:**
  ```bash
  # Should error: ocx.jsonc already exists
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.5 `ocx init --registry <path>` (Registry Scaffold Only)

- [ ] **Setup:** Parent directory
- [ ] **Commands:**
  ```bash
  cd /tmp
  ocx init --registry ./ocx-test-registry --namespace my-org
  ```
- [ ] **Expected:** Creates registry project at specified path
- [ ] **Verify:**
  ```bash
  ls ./ocx-test-registry/
  cat ./ocx-test-registry/registry.jsonc
  rm -rf ./ocx-test-registry
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.6 `ocx init --registry` (Scaffold Registry)

- [ ] **Setup:** Empty directory for registry
- [ ] **Command:** `ocx init --registry my-registry --namespace my-org`
- [ ] **Expected:** Scaffolds complete registry project
- [ ] **Verify:**
  ```bash
  ls my-registry/
  cat my-registry/registry.jsonc
  rm -rf my-registry
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.7 `ocx init --registry` with Author

- [ ] **Setup:** Empty directory
- [ ] **Command:** `ocx init --registry my-registry --namespace acme --author "Acme Corp"`
- [ ] **Expected:** Scaffolds registry with custom author
- [ ] **Verify:**
  ```bash
  cat my-registry/registry.jsonc  # Should contain author field
  rm -rf my-registry
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.8 `ocx init --registry --canary`

- [ ] **Setup:** Empty directory
- [ ] **Command:** `ocx init --registry my-registry --canary --namespace test`
- [ ] **Expected:** Uses canary template (main branch)
- [ ] **Verify:** Registry scaffolded successfully
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 5. CLI Reference: ocx add

All variations from CLI.md lines 129-253.

### 5.1 Add Registry Component (Fully Qualified)

- [ ] **Setup:** Local config with registry configured
- [ ] **Commands:**
  ```bash
  ocx init
  ocx registry add http://localhost:8787 --name kdco
  ocx add kdco/researcher
  ```
- [ ] **Expected:** Component installed to `.opencode/`
- [ ] **Verify:**
  ```bash
  ls .opencode/
  cat .ocx/receipt.jsonc  # Should list kdco/researcher
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.2 One-Command Install with `--from`

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `ocx add kdco/workspace --from http://localhost:8787`
- [ ] **Expected:** Installs without saving registry
- [ ] **Verify:**
  ```bash
  cat .opencode/ocx.jsonc  # Should NOT contain registry
  cat .ocx/receipt.jsonc  # Should list component
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.3 Add with Specific Profile

- [ ] **Setup:** Profile configured with registry
- [ ] **Command:** `ocx add kdco/researcher --profile work`
- [ ] **Expected:** Uses profile's registry for resolution
- [ ] **Verify:** Component installed successfully
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.4 Add npm Plugin (Unscoped)

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `ocx add npm:opencode-plugin-foo`
- [ ] **Expected:** Plugin entry added to `.opencode/opencode.jsonc` plugins array; runtime installation handled by OpenCode
- [ ] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain plugin in "plugins" array
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.5 Add npm Plugin (Scoped)

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `ocx add npm:@franlol/opencode-md-table-formatter`
- [ ] **Expected:** Plugin entry added to `.opencode/opencode.jsonc` plugins array; runtime installation handled by OpenCode
- [ ] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain plugin in "plugins" array
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.6 Add npm Plugin with Version

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `ocx add npm:@franlol/opencode-md-table-formatter@0.0.3`
- [ ] **Expected:** Plugin entry added to `.opencode/opencode.jsonc`; runtime installation handled by OpenCode
- [ ] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain "@franlol/opencode-md-table-formatter@0.0.3" in "plugin" array
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.7 Add Multiple Components

- [ ] **Setup:** Registry configured
- [ ] **Command:** `ocx add kdco/researcher kdco/code-philosophy kdco/notify`
- [ ] **Expected:** Installs all three components
- [ ] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Should list all three
  ls .opencode/
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.8 Add with `--dry-run`

- [ ] **Setup:** Registry configured
- [ ] **Command:** `ocx add kdco/researcher --dry-run`
- [ ] **Expected:** Shows what would be installed without making changes
- [ ] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Should NOT list component
  ls .opencode/  # Should NOT contain component files
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.9 Add with `--trust` (Bypass Plugin Validation)

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `ocx add npm:some-non-esm-package --trust`
- [ ] **Expected:** Skips ESM validation, installs anyway
- [ ] **Verify:** Package installed despite validation skip
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.10 Add with `--json` Output

- [ ] **Setup:** Registry configured
- [ ] **Command:** `ocx add kdco/researcher --json`
- [ ] **Expected:** Outputs machine-readable JSON
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.11 Add with `--verbose`

- [ ] **Setup:** Registry configured
- [ ] **Command:** `ocx add kdco/researcher --verbose`
- [ ] **Expected:** Shows detailed file operations
- [ ] **Verify:** Verbose output includes file paths
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 6. CLI Reference: ocx update

All variations from CLI.md lines 256-361.

### 6.1 Update Specific Component

- [ ] **Setup:** Component installed
- [ ] **Command:** `ocx update kdco/researcher`
- [ ] **Expected:** Updates to latest version
- [ ] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Version should update
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 6.2 Update Multiple Components

- [ ] **Setup:** Multiple components installed
- [ ] **Command:** `ocx update kdco/researcher kdco/notify`
- [ ] **Expected:** Updates both components
- [ ] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Both versions updated
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 6.3 Update All Components (`--all`)

- [ ] **Setup:** Multiple components installed
- [ ] **Command:** `ocx update --all`
- [ ] **Expected:** Updates all installed components
- [ ] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # All versions updated
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 6.4 Update All with `--dry-run`

- [ ] **Setup:** Components installed
- [ ] **Command:** `ocx update --all --dry-run`
- [ ] **Expected:** Shows what would be updated without applying
- [ ] **Verify:**
  ```bash
  # Output should list pending updates
  cat .ocx/receipt.jsonc  # Versions should NOT change
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 6.5 Update by Registry (`--registry`)

- [ ] **Setup:** Components from multiple registries installed
- [ ] **Command:** `ocx update --registry kdco`
- [ ] **Expected:** Updates only kdco components
- [ ] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Only kdco components updated
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

- [ ] **Setup:** Component installed
- [ ] **Command:** `ocx update kdco/researcher --json`
- [ ] **Expected:** Machine-readable JSON output
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 6.9 Update with `--verbose`

- [ ] **Setup:** Component installed
- [ ] **Command:** `ocx update kdco/researcher --verbose`
- [ ] **Expected:** Detailed file change information
- [ ] **Verify:** Verbose output shows file operations
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 7. CLI Reference: ocx search

All variations from CLI.md lines 439-516.

### 7.1 Search All Available Components

- [ ] **Setup:** Registry configured
- [ ] **Command:** `ocx search`
- [ ] **Expected:** Lists all components from configured registries
- [ ] **Verify:** Output shows component list
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 7.2 Search with Query

- [ ] **Setup:** Registry configured
- [ ] **Command:** `ocx search agent`
- [ ] **Expected:** Lists components matching "agent"
- [ ] **Verify:** Results filtered by query
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 7.3 Search with Higher Limit

- [ ] **Setup:** Registry configured
- [ ] **Command:** `ocx search agents --limit 50`
- [ ] **Expected:** Shows up to 50 results
- [ ] **Verify:** Limit respected in output
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 7.4 List Installed Components Only

- [ ] **Setup:** Components installed
- [ ] **Command:** `ocx search --installed`
- [ ] **Expected:** Shows only installed components with versions
- [ ] **Verify:**
  ```bash
  # Output should match receipt.jsonc contents
  cat .ocx/receipt.jsonc
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 7.5 Search with `--json` Output

- [ ] **Setup:** Registry configured
- [ ] **Command:** `ocx search --json`
- [ ] **Expected:** Machine-readable JSON component list
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 7.6 Search with `--verbose`

- [ ] **Setup:** Registry configured
- [ ] **Command:** `ocx search agents --verbose`
- [ ] **Expected:** Detailed component information including registry details
- [ ] **Verify:** Verbose output shows extended metadata
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 7.7 Search Alias: `ocx list`

- [ ] **Setup:** Registry configured
- [ ] **Command:** `ocx list`
- [ ] **Expected:** Same output as `ocx search`
- [ ] **Verify:** Lists all components
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 8. CLI Reference: ocx registry

All subcommands from CLI.md lines 519-705.

### 8.1 `ocx registry add` (Local, Name from Hostname)

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `ocx registry add http://localhost:8787 --name kdco`
- [ ] **Expected:** Registry added with custom name "kdco"
- [ ] **Verify:**
  ```bash
  ocx registry list  # Should show kdco
  cat .opencode/ocx.jsonc  # Should contain registry
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.2 `ocx registry add` with Custom Name

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `ocx registry add http://localhost:8787 --name kdco`
- [ ] **Expected:** Registry added with custom name "kdco"
- [ ] **Verify:**
  ```bash
  ocx registry list  # Should show kdco
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.3 `ocx registry add --global`

- [ ] **Setup:** Global profiles initialized
- [ ] **Command:** `ocx registry add http://localhost:8787 --name kdco --global`
- [ ] **Expected:** Registry added to global config
- [ ] **Verify:**
  ```bash
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc  # Should contain kdco
  ocx registry list --global  # Should show kdco
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.4 `ocx registry add --force` (Update Existing)

- [ ] **Setup:** Registry already configured
- [ ] **Command:** `ocx registry add https://new-url.kdco.dev --name kdco --force`
- [ ] **Expected:** Updates existing registry URL
- [ ] **Verify:**
  ```bash
  cat .opencode/ocx.jsonc  # URL should be updated
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.5 `ocx registry add` with `--json` Output

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `ocx registry add http://localhost:8787 --name kdco --json`
- [ ] **Expected:** Machine-readable JSON confirmation
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.6 `ocx registry remove` (Local)

- [ ] **Setup:** Registry configured locally
- [ ] **Command:** `ocx registry remove kdco`
- [ ] **Expected:** Registry removed from local config
- [ ] **Verify:**
  ```bash
  ocx registry list  # Should NOT show kdco
  cat .opencode/ocx.jsonc  # Should NOT contain kdco
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.7 `ocx registry remove --global`

- [ ] **Setup:** Registry configured globally
- [ ] **Command:** `ocx registry remove kdco --global`
- [ ] **Expected:** Registry removed from global config
- [ ] **Verify:**
  ```bash
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc  # Should NOT contain kdco
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.8 `ocx registry list` (Local)

- [ ] **Setup:** Registries configured locally
- [ ] **Command:** `ocx registry list`
- [ ] **Expected:** Lists local registries
- [ ] **Verify:** Output matches `.opencode/ocx.jsonc` content
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.9 `ocx registry list --global`

- [ ] **Setup:** Registries configured globally
- [ ] **Command:** `ocx registry list --global`
- [ ] **Expected:** Lists global registries
- [ ] **Verify:** Output matches global config
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.10 `ocx registry list --json`

- [ ] **Setup:** Registries configured
- [ ] **Command:** `ocx registry list --json`
- [ ] **Expected:** Machine-readable JSON with registry list
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 9. CLI Reference: ocx build

All variations from CLI.md lines 708-790.

### 9.1 Build Registry in Current Directory

- [ ] **Setup:** Registry source directory with `registry.jsonc`
- [ ] **Commands:**
  ```bash
  # Create test registry structure
  mkdir -p /tmp/test-registry/files/agent
  echo '{"name": "test-registry", "version": "1.0.0", "components": {}}' > /tmp/test-registry/registry.jsonc
  cd /tmp/test-registry
  ocx build
  ```
- [ ] **Expected:** Builds to `./dist/`
- [ ] **Verify:**
  ```bash
  ls ./dist/
  rm -rf /tmp/test-registry
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 9.2 Build from Specific Directory

- [ ] **Setup:** Registry source directory
- [ ] **Command:** `ocx build /tmp/test-registry`
- [ ] **Expected:** Builds registry from specified path
- [ ] **Verify:**
  ```bash
  ls /tmp/test-registry/dist/
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 9.3 Build with Custom Output Directory

- [ ] **Setup:** Registry source directory
- [ ] **Command:** `ocx build /tmp/test-registry --out ./public`
- [ ] **Expected:** Builds to `./public/` instead of `./dist/`
- [ ] **Verify:**
  ```bash
  ls ./public/
  rm -rf ./public
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 9.4 Build with `--json` Output

- [ ] **Setup:** Registry source directory
- [ ] **Command:** `ocx build /tmp/test-registry --json`
- [ ] **Expected:** Machine-readable JSON build summary
- [ ] **Verify:** Output is valid JSON with component count
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 10. CLI Reference: ocx self

Self-management commands from CLI.md lines 793-870.

### 10.1 `ocx self update`

- [ ] **Setup:** OCX installed
- [ ] **Command:** `ocx self update`
- [ ] **Expected:** Updates to latest version
- [ ] **Verify:**
  ```bash
  ocx --version  # Version should update
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.2 `ocx self update --force`

- [ ] **Setup:** OCX installed
- [ ] **Command:** `ocx self update --force`
- [ ] **Expected:** Forces reinstall even if on latest version
- [ ] **Verify:** Command completes successfully
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.3 `ocx self update --method npm`

- [ ] **Setup:** OCX installed via npm
- [ ] **Command:** `ocx self update --method npm`
- [ ] **Expected:** Uses npm for update
- [ ] **Verify:** Update completes via npm
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.4 `ocx self uninstall --dry-run`

- [ ] **Setup:** OCX installed with test config
- [ ] **Command:** `ocx self uninstall --dry-run`
- [ ] **Expected:** Shows what would be removed without deleting
- [ ] **Verify:**
  ```bash
  # Should list files that would be removed
  ls $XDG_CONFIG_HOME/opencode/  # Files should still exist
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.5 `ocx self uninstall` (Config Only)

- [ ] **Setup:** Test environment (NOT production!)
- [ ] **Command:** `ocx self uninstall`
- [ ] **Expected:** Removes config files, prints binary removal command for package-managed installs
- [ ] **Verify:**
  ```bash
  ls $XDG_CONFIG_HOME/opencode/  # Should be gone or empty
  which ocx  # Should still exist if package-managed
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 11. CLI Reference: ocx profile

All subcommands from CLI.md lines 1024-1273.

### 11.1 `ocx profile list`

- [ ] **Setup:** Global profiles initialized
- [ ] **Command:** `ocx profile list`
- [ ] **Expected:** Lists all profiles (no active indicator)
- [ ] **Verify:**
  ```bash
  # Output should show at least "default"
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.2 `ocx p ls` (Alias)

- [ ] **Setup:** Global profiles initialized
- [ ] **Command:** `ocx p ls`
- [ ] **Expected:** Same output as `ocx profile list`
- [ ] **Verify:** Lists profiles
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.3 `ocx profile list --json`

- [ ] **Setup:** Global profiles initialized
- [ ] **Command:** `ocx profile list --json`
- [ ] **Expected:** Machine-readable JSON with profile list
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.4 `ocx profile add work` (Empty Profile)

- [ ] **Setup:** Global profiles initialized
- [ ] **Command:** `ocx profile add work --global`
- [ ] **Expected:** Creates new empty profile with template files
- [ ] **Verify:**
  ```bash
  ocx p ls  # Should show work
  ls $XDG_CONFIG_HOME/opencode/profiles/work/
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.5 `ocx profile add` Clone from Existing

- [ ] **Setup:** Profile "work" exists
- [ ] **Command:** `ocx profile add client-x --from work --global`
- [ ] **Expected:** Clones work profile to client-x
- [ ] **Verify:**
  ```bash
  ocx p ls  # Should show both work and client-x
  diff $XDG_CONFIG_HOME/opencode/profiles/work/ocx.jsonc \
       $XDG_CONFIG_HOME/opencode/profiles/client-x/ocx.jsonc
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.6 `ocx profile add` Install from Registry (Shorthand)

- [ ] **Setup:** Global registry configured
- [ ] **Command:** `ocx profile add ws --from kit/ws --global`
- [ ] **Expected:** Downloads profile from kit registry
- [ ] **Verify:**
  ```bash
  ocx p show ws
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.7 `ocx profile add` Install from URL

- [ ] **Setup:** None required
- [ ] **Command:** `ocx profile add ws --from http://localhost:8788/ws --global`
- [ ] **Expected:** Downloads profile from URL directly
- [ ] **Verify:**
  ```bash
  ocx p show ws
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.8 `ocx profile add` (Remove and Add to Overwrite)

- [ ] **Setup:** Profile "ws" already exists
- [ ] **Commands:**
  ```bash
  ocx profile remove ws --global
  ocx profile add ws --from kit/ws --global
  ```
- [ ] **Expected:** Removes and reinstalls profile
- [ ] **Verify:**
  ```bash
  ocx p show ws  # Should show fresh content
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.9 `ocx p add` (Alias)

- [ ] **Setup:** Global profiles initialized
- [ ] **Command:** `ocx p add personal --global`
- [ ] **Expected:** Creates new profile (same as `profile add`)
- [ ] **Verify:**
  ```bash
  ocx p ls  # Should show personal
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.10 `ocx profile remove work` (Local Default)

- [ ] **Setup:** Local profile "work" exists
- [ ] **Command:** `ocx profile remove work`
- [ ] **Expected:** Deletes local profile immediately (no confirmation)
- [ ] **Verify:**
  ```bash
  ls .opencode/profiles/  # work/ should be gone
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.11 `ocx profile remove --global`

- [ ] **Setup:** Global profile "old-profile" exists
- [ ] **Command:** `ocx profile remove old-profile --global`
- [ ] **Expected:** Deletes global profile (no confirmation)
- [ ] **Verify:**
  ```bash
  ocx p ls  # Should NOT show old-profile
  ls $XDG_CONFIG_HOME/opencode/profiles/  # old-profile/ should be gone
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.12 `ocx p rm` (Alias)

- [ ] **Setup:** Profile exists
- [ ] **Command:** `ocx p rm old-profile`
- [ ] **Expected:** Deletes profile (same as `profile remove`)
- [ ] **Verify:** Profile deleted
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.13 `ocx profile move work client-work` (Local Default)

- [ ] **Setup:** Local profile "work" exists
- [ ] **Command:** `ocx profile move work client-work`
- [ ] **Expected:** Renames local profile from work to client-work
- [ ] **Verify:**
  ```bash
  ls .opencode/profiles/  # client-work/ exists, work/ gone
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.14 `ocx profile move --global`

- [ ] **Setup:** Global profile "work" exists
- [ ] **Command:** `ocx profile move work client-work --global`
- [ ] **Expected:** Renames global profile from work to client-work
- [ ] **Verify:**
  ```bash
  ocx p ls  # Should show client-work, NOT work
  ls $XDG_CONFIG_HOME/opencode/profiles/  # client-work/ exists, work/ gone
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.15 `ocx p mv` (Alias)

- [ ] **Setup:** Profile exists
- [ ] **Command:** `ocx p mv personal home`
- [ ] **Expected:** Renames profile (same as `profile move`)
- [ ] **Verify:**
  ```bash
  ocx p ls  # Should show home
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.16 `ocx profile show` (Current Profile)

- [ ] **Setup:** Profile active via environment or flag
- [ ] **Command:** `OCX_PROFILE=work ocx profile show`
- [ ] **Expected:** Shows currently resolved profile details
- [ ] **Verify:** Output displays work profile info
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.17 `ocx profile show work`

- [ ] **Setup:** Profile "work" exists
- [ ] **Command:** `ocx profile show work`
- [ ] **Expected:** Shows work profile config and files
- [ ] **Verify:**
  ```bash
  # Output should list files and configuration
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.18 `ocx p show` (Alias)

- [ ] **Setup:** Profile exists
- [ ] **Command:** `ocx p show work`
- [ ] **Expected:** Same output as `profile show work`
- [ ] **Verify:** Profile details displayed
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.19 `ocx profile show --json`

- [ ] **Setup:** Profile exists
- [ ] **Command:** `ocx profile show work --json`
- [ ] **Expected:** Machine-readable JSON with profile details
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 12. CLI Reference: ocx config

All subcommands from CLI.md lines 1276-1381.

### 12.1 `ocx config show` (Current Scope)

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `ocx config show`
- [ ] **Expected:** Shows merged config from current scope
- [ ] **Verify:**
  ```bash
  # Output should display registries, settings
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.2 `ocx config show --origin`

- [ ] **Setup:** Local config with profile active
- [ ] **Command:** `ocx config show --origin`
- [ ] **Expected:** Shows config with source annotations
- [ ] **Verify:**
  ```bash
  # Output should indicate source (local, profile, global)
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.3 `ocx config show -p work`

- [ ] **Setup:** Profile "work" exists
- [ ] **Command:** `ocx config show -p work`
- [ ] **Expected:** Shows config from work profile scope
- [ ] **Verify:** Output shows work profile settings
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.4 `ocx config show --json`

- [ ] **Setup:** Config exists
- [ ] **Command:** `ocx config show --json`
- [ ] **Expected:** Machine-readable JSON config
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.5 `ocx config edit` (Local)

- [ ] **Setup:** Local config exists, `$EDITOR` set
- [ ] **Command:** `EDITOR=cat ocx config edit`
- [ ] **Expected:** Opens `.opencode/ocx.jsonc` in editor
- [ ] **Verify:**
  ```bash
  # Editor should open local config file
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.6 `ocx config edit --global`

- [ ] **Setup:** Global config exists, `$EDITOR` set
- [ ] **Command:** `EDITOR=cat ocx config edit --global`
- [ ] **Expected:** Opens `~/.config/opencode/ocx.jsonc` in editor
- [ ] **Verify:** Editor opens global config
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.7 `ocx config edit -p work`

- [ ] **Setup:** Profile "work" exists, `$EDITOR` set
- [ ] **Command:** `EDITOR=cat ocx config edit -p work`
- [ ] **Expected:** Opens work profile's `ocx.jsonc` in editor
- [ ] **Verify:** Editor opens profile config
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 13. CLI Reference: ocx opencode

All variations from CLI.md lines 1383-1509.

### 13.1 `ocx opencode` (Default Profile)

- [ ] **Setup:** Default profile exists, test project directory
- [ ] **Command:** `cd /tmp/ocx-v2-test-project && ocx oc run "echo hello"`
- [ ] **Expected:** Launches OpenCode with default profile
- [ ] **Verify:** Output shows "hello"
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.2 `ocx opencode -p work`

- [ ] **Setup:** Work profile exists
- [ ] **Command:** `ocx oc -p work run "echo hello"`
- [ ] **Expected:** Launches with work profile explicitly
- [ ] **Verify:** Command executes successfully
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.3 `ocx opencode` with `OCX_PROFILE` Environment

- [ ] **Setup:** Profile exists
- [ ] **Commands:**
  ```bash
  export OCX_PROFILE=work
  ocx oc run "echo hello"
  ```
- [ ] **Expected:** Uses profile from environment variable
- [ ] **Verify:** Command executes with work profile
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.4 `ocx oc` (Alias)

- [ ] **Setup:** Profile exists
- [ ] **Command:** `ocx oc run "echo hello"`
- [ ] **Expected:** Same behavior as `ocx opencode`
- [ ] **Verify:** Command executes
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.5 `ocx opencode --no-rename`

- [ ] **Setup:** Profile exists, in terminal with window support
- [ ] **Command:** `ocx oc --no-rename run "echo hello"`
- [ ] **Expected:** Skips automatic window renaming
- [ ] **Verify:** Terminal window name unchanged
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.6 `ocx oc -- --help` (Pass-Through to OpenCode)

- [ ] **Setup:** OpenCode installed
- [ ] **Command:** `ocx oc -- --help`
- [ ] **Expected:** Shows OpenCode's help, not OCX help
- [ ] **Verify:** Help output is from OpenCode
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.7 Profile Resolution Priority: Flag Wins

- [ ] **Setup:** Multiple profiles, `OCX_PROFILE` set
- [ ] **Commands:**
  ```bash
  export OCX_PROFILE=default
  ocx oc -p work run "echo hello"
  ```
- [ ] **Expected:** Uses work profile (flag overrides env)
- [ ] **Verify:** Work profile used
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.8 Profile Resolution: Environment Variable

- [ ] **Setup:** Profile exists, no local config
- [ ] **Commands:**
  ```bash
  export OCX_PROFILE=work
  ocx oc run "echo hello"
  ```
- [ ] **Expected:** Uses profile from environment
- [ ] **Verify:** Work profile used
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.9 Profile Resolution: Local Config Field

- [ ] **Setup:** `.opencode/ocx.jsonc` with `"profile": "work"`
- [ ] **Command:** `ocx oc run "echo hello"`
- [ ] **Expected:** Uses profile specified in local config
- [ ] **Verify:**
  ```bash
  cat .opencode/ocx.jsonc  # Should have "profile": "work"
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.10 Profile Resolution: Default Profile Fallback

- [ ] **Setup:** Default profile exists, no explicit selection
- [ ] **Commands:**
  ```bash
  unset OCX_PROFILE
  ocx oc run "echo hello"
  ```
- [ ] **Expected:** Falls back to default profile
- [ ] **Verify:** Default profile used
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.11 Custom Binary via Profile Config

- [ ] **Setup:** Profile with `"bin": "/custom/path/opencode"`
- [ ] **Command:** `ocx oc -p work run "echo hello"`
- [ ] **Expected:** Uses custom binary from profile config
- [ ] **Verify:**
  ```bash
  cat $XDG_CONFIG_HOME/opencode/profiles/work/ocx.jsonc  # Should have "bin"
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.12 Custom Binary via `OPENCODE_BIN` Environment

- [ ] **Setup:** OpenCode available at custom path
- [ ] **Commands:**
  ```bash
  export OPENCODE_BIN=/custom/path/opencode
  ocx oc run "echo hello"
  ```
- [ ] **Expected:** Uses binary from environment variable
- [ ] **Verify:** Custom binary executed
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 14. Profile System Tests

From PROFILES.md - advanced profile behaviors.

### 14.1 Profile Layering: Global Base + Local Overlay

- [ ] **Setup:** Global profile "work" exists, local config specifies profile
- [ ] **Commands:**
  ```bash
  ocx init --global
  ocx profile add work --global
  ocx config edit -p work  # Add registries
  cd /tmp/ocx-v2-test-project
  ocx init
  # Edit .opencode/ocx.jsonc to add: "profile": "work"
  ocx config show --origin
  ```
- [ ] **Expected:** Local overlay takes precedence over global base
- [ ] **Verify:** `--origin` shows layering sources
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.2 Exclude/Include Pattern Behavior

- [ ] **Setup:** Profile with exclude patterns
- [ ] **Commands:**
  ```bash
  # Create profile with exclude: ["**/AGENTS.md"]
  echo "# Test" > AGENTS.md
  ocx oc -p work run "echo hello"
  ```
- [ ] **Expected:** AGENTS.md excluded from OpenCode context
- [ ] **Verify:** File not visible to OpenCode
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.3 Include Overrides Exclude

- [ ] **Setup:** Profile with exclude and include patterns
- [ ] **Commands:**
  ```bash
  # Profile config:
  # "exclude": ["**/AGENTS.md"]
  # "include": ["./AGENTS.md"]
  echo "# Test" > AGENTS.md
  ocx oc -p work run "echo hello"
  ```
- [ ] **Expected:** Root AGENTS.md included despite exclude pattern
- [ ] **Verify:** Include overrides exclude
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.4 Registry Isolation: Profile Registries Only

- [ ] **Setup:** Global registry configured, profile with different registry
- [ ] **Commands:**
  ```bash
  ocx registry add https://registry-a.com --name a --global
  ocx profile add work --global
  ocx config edit -p work  # Add registry-b.com
  ocx search -p work
  ```
- [ ] **Expected:** Only profile's registries visible, NOT global
- [ ] **Verify:** Search shows only registry-b components
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.5 Registry Isolation: Local Registries Only

- [ ] **Setup:** Local config with registries, no profile
- [ ] **Commands:**
  ```bash
  ocx init
  ocx registry add https://registry-c.com --name c
  ocx search
  ```
- [ ] **Expected:** Only local registries visible
- [ ] **Verify:** Search shows only registry-c components
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.6 OpenCode Config Merging

- [ ] **Setup:** Profile with `opencode.jsonc`, local with different settings
- [ ] **Commands:**
  ```bash
  # Profile opencode.jsonc: {"agents": ["coder"]}
  # Local opencode.jsonc: {"agents": ["researcher"]}
  ocx config show -p work
  ```
- [ ] **Expected:** Configs merge (profile → local)
- [ ] **Verify:** Both agent sets visible
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.7 Instruction File Discovery (Deepest-First)

- [ ] **Setup:** Multi-level project with instruction files
- [ ] **Commands:**
  ```bash
  mkdir -p /tmp/ocx-v2-test-project/subdir
  cd /tmp/ocx-v2-test-project
  git init
  echo "# Root" > AGENTS.md
  echo "# Subdir" > subdir/AGENTS.md
  cd subdir
  ocx oc run "echo hello"
  ```
- [ ] **Expected:** Files discovered from subdir up to git root (AGENTS → CLAUDE → CONTEXT priority; first type wins)
- [ ] **Verify:** Both AGENTS.md files considered (deepest first)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.8 First Type Wins

- [ ] **Setup:** Project directory with multiple instruction file types
- [ ] **Commands:**
  ```bash
  cd /tmp/ocx-v2-test-project
  git init
  echo "# Agents" > AGENTS.md
  echo "# Claude" > CLAUDE.md
  echo "# Context" > CONTEXT.md
  ocx oc run "echo hello"
  ```
- [ ] **Expected:** Only AGENTS.md is loaded; CLAUDE.md and CONTEXT.md are ignored (AGENTS → CLAUDE → CONTEXT priority)
- [ ] **Verify:** First type wins behavior enforced
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.9 CONTEXT.md Deprecated

- [ ] **Setup:** Project with only CONTEXT.md
- [ ] **Commands:**
  ```bash
  cd /tmp/ocx-v2-test-project
  git init
  rm -f AGENTS.md CLAUDE.md
  echo "# Context" > CONTEXT.md
  ocx oc run "echo hello"
  ```
- [ ] **Expected:** CONTEXT.md loads, but document that it is deprecated (AGENTS.md or CLAUDE.md preferred)
- [ ] **Verify:** CONTEXT.md loaded successfully
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.10 Profile Instructions Have Highest Priority

- [ ] **Setup:** Profile with AGENTS.md, project with AGENTS.md
- [ ] **Commands:**
  ```bash
  echo "# Profile instructions" > $XDG_CONFIG_HOME/opencode/profiles/work/AGENTS.md
  echo "# Project instructions" > /tmp/ocx-v2-test-project/AGENTS.md
  ocx oc -p work run "echo hello"
  ```
- [ ] **Expected:** Profile instructions loaded last (highest priority)
- [ ] **Verify:** Profile AGENTS.md overrides project
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.11 Local vs Global Profile Distinction

#### Test: Default creates local profile
- [ ] **Setup:** In a project directory with `.opencode/` initialized
- [ ] **Command:** `ocx profile add test-local`
- [ ] **Expected:** Creates local profile at `.opencode/profiles/test-local/`
- [ ] **Verify:**
  ```bash
  ls .opencode/profiles/test-local/  # Should exist
  ls $XDG_CONFIG_HOME/opencode/profiles/test-local/  # Should NOT exist
  ```

#### Test: --global creates global profile
- [ ] **Setup:** Global config initialized
- [ ] **Command:** `ocx profile add test-global --global`
- [ ] **Expected:** Creates global profile at `$XDG_CONFIG_HOME/opencode/profiles/test-global/`
- [ ] **Verify:**
  ```bash
  ls $XDG_CONFIG_HOME/opencode/profiles/test-global/  # Should exist
  ls .opencode/profiles/test-global/  # Should NOT exist
  ```

#### Test: ocx profile list shows only global profiles
- [ ] **Setup:** Both local and global profiles exist
- [ ] **Command:** `ocx profile list`
- [ ] **Expected:** Shows only global profiles, not local ones
- [ ] **Verify:** Local profile name should NOT appear in list

#### Test: Profile merging when both global and local exist
- [ ] **Setup:** Create both global and local profiles with same name
- [ ] **Commands:**
  ```bash
  ocx init --global
  ocx profile add test --global
  # Add to global profile ocx.jsonc: {"registries": {"global-reg": {"url": "https://global.com"}}}
  
  cd /tmp/ocx-v2-test-project
  ocx init
  ocx profile add test  # Local with same name
  # Add to local profile ocx.jsonc: {"registries": {"local-reg": {"url": "https://local.com"}}}
  
  ocx config show -p test
  ```
- [ ] **Expected:** Both registries appear in merged config
- [ ] **Verify:** 
  - Config contains both `global-reg` and `local-reg`
  - Deep merge occurred (not simple replacement)

---

## 15. Error Path Tests

Common errors from CLI.md error tables.

### 15.1 Error: No ocx.jsonc Found (Init)

- [ ] **Setup:** Empty directory, no config
- [ ] **Command:** `ocx add kdco/researcher`
- [ ] **Expected:** Error: "No ocx.jsonc found"
- [ ] **Verify:** Exit code 78 (CONFIG error)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 15.2 Error: Registry Not Found

- [ ] **Setup:** Config initialized, registry not configured
- [ ] **Command:** `ocx add unknown/component`
- [ ] **Expected:** Error: "Registry not found"
- [ ] **Verify:** Exit code 66 (NOT_FOUND)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 15.3 Error: Component Not Installed (Update)

- [ ] **Setup:** Config initialized, component not installed
- [ ] **Command:** `ocx update kdco/researcher`
- [ ] **Expected:** Error: "Component 'kdco/researcher' is not installed"
- [ ] **Verify:** Exit code 66 (NOT_FOUND)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 15.4 Error: File Conflict (Add)

- [ ] **Setup:** Component already installed, modified locally
- [ ] **Commands:**
  ```bash
  ocx add kdco/researcher
  echo "// modified" >> .opencode/agents/file.md
  ocx add kdco/researcher
  ```
- [ ] **Expected:** Error: "File conflicts detected"
- [ ] **Verify:** Exit code 6 (CONFLICT)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 15.5 Error: Registry Already Exists (Add Registry)

- [ ] **Setup:** Registry configured
- [ ] **Commands:**
  ```bash
  ocx registry add http://localhost:8787 --name kdco
  ocx registry add https://other.com --name kdco
  ```
- [ ] **Expected:** Error: "Registry 'kdco' already exists"
- [ ] **Verify:** Exit code 6 (CONFLICT)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 15.6 Error: Invalid Version Specifier (Update)

- [ ] **Setup:** Component installed
- [ ] **Command:** `ocx update kdco/researcher@`
- [ ] **Expected:** Error: "Invalid version specifier"
- [ ] **Verify:** Exit code 78 (CONFIG)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 15.7 Error: Mutually Exclusive Options (Update)

- [ ] **Setup:** Components installed
- [ ] **Command:** `ocx update --all --registry kdco`
- [ ] **Expected:** Error: "Cannot use --all with --registry"
- [ ] **Verify:** Exit code 1 (GENERAL)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 15.8 Error: Profile Not Found (Move)

- [ ] **Setup:** Profiles initialized
- [ ] **Command:** `ocx profile move nonexistent new-name`
- [ ] **Expected:** Error: "Profile 'nonexistent' not found"
- [ ] **Verify:** Exit code 66 (NOT_FOUND)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 15.9 Error: Profile Already Exists (Move)

- [ ] **Setup:** Multiple profiles exist
- [ ] **Commands:**
  ```bash
  ocx profile add work --global
  ocx profile add client --global
  ocx profile move work client
  ```
- [ ] **Expected:** Error: "Cannot move: profile 'client' already exists"
- [ ] **Verify:** Exit code 6 (CONFLICT)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 15.10 Error: Integrity Check Failed

- [ ] **Setup:** Component installed with mismatched hash
- [ ] **Commands:**
  ```bash
  # Manually corrupt hash in receipt
  ocx update kdco/researcher
  ```
- [ ] **Expected:** Error: "Integrity check failed"
- [ ] **Verify:** Exit code indicates integrity failure
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 16. Verification Checklist

Master summary for full test sessions.

### 16.1 All README Commands Verified

- [ ] Quick Start Profiles (Section 2): 6 test cases
- [ ] Quick Start Components (Section 3): 4 test cases

### 16.2 All CLI.md Commands Verified

- [ ] ocx init (Section 4): 8 test cases
- [ ] ocx add (Section 5): 11 test cases
- [ ] ocx update (Section 6): 9 test cases
- [ ] ocx search (Section 7): 7 test cases
- [ ] ocx registry (Section 8): 11 test cases
- [ ] ocx build (Section 9): 4 test cases
- [ ] ocx self (Section 10): 5 test cases
- [ ] ocx profile (Section 11): 17 test cases
- [ ] ocx config (Section 12): 7 test cases
- [ ] ocx opencode (Section 13): 12 test cases

### 16.3 Profile System Verified

- [ ] Profile Layering (Section 14): 8 test cases

### 16.4 Error Paths Verified

- [ ] Common Errors (Section 15): 10 test cases

### 16.5 Documentation Sync

- [ ] All README examples tested
- [ ] All CLI.md examples tested
- [ ] All PROFILES.md examples tested
- [ ] Error exit codes verified
- [ ] JSON output formats verified

---

## 17. Sync Checklist

For maintainability when commands change.

### 17.1 When to Update This Document

- [ ] New command added to CLI
- [ ] New option added to existing command
- [ ] Command behavior changes
- [ ] Error handling changes
- [ ] Before major releases
- [ ] After significant refactoring

### 17.2 Cross-Reference Links

| Section | Source Document | Lines |
|---------|----------------|-------|
| Section 2 | [README.md](../README.md) | 38-54 |
| Section 3 | [README.md](../README.md) | 66-86 |
| Section 4 | [CLI.md](./CLI.md) | 33-126 |
| Section 5 | [CLI.md](./CLI.md) | 129-253 |
| Section 6 | [CLI.md](./CLI.md) | 256-361 |
| Section 7 | [CLI.md](./CLI.md) | 439-516 |
| Section 8 | [CLI.md](./CLI.md) | 519-705 |
| Section 9 | [CLI.md](./CLI.md) | 708-790 |
| Section 10 | [CLI.md](./CLI.md) | 793-870 |
| Section 11 | [CLI.md](./CLI.md) | 1024-1273 |
| Section 12 | [CLI.md](./CLI.md) | 1276-1381 |
| Section 13 | [CLI.md](./CLI.md) | 1383-1509 |
| Section 14 | [PROFILES.md](./PROFILES.md) | Full document |
| Section 15 | [CLI.md](./CLI.md) | Error tables throughout |

### 17.3 Version Tracking

- [ ] Update `ocx_version` in metadata after testing
- [ ] Update `last_full_test` date when complete session finishes
- [ ] Note platform tested (macOS, Linux)
- [ ] Track any skipped tests and reasons

### 17.4 Automated Test Coverage

For reference, automated tests exist in:

| Test File | Coverage |
|-----------|----------|
| `packages/cli/tests/add.test.ts` | Component installation |
| `packages/cli/tests/update.test.ts` | Component updates |
| `packages/cli/tests/registry.test.ts` | Registry management |
| `packages/cli/tests/profile.test.ts` | Profile management |
| `packages/cli/tests/config.test.ts` | Config resolution |

Manual testing supplements automated tests with:
- End-to-end workflows
- User experience validation
- Cross-command interactions
- Error message quality
- Documentation accuracy

---

## Notes

### Platform-Specific Behavior

- **macOS**: Primary testing platform
- **Linux**: Most commands identical to macOS
- **Windows**: Not covered by this document (see Windows-specific testing guide)

### Test Environment Best Practices

1. Always use `XDG_CONFIG_HOME` for isolation
2. Clean up between sections to avoid state pollution
3. Use development build from workspace (not installed version)
4. Test with real registries when possible for integration validation
5. Document any test failures or unexpected behavior immediately

### Contributing Test Cases

When adding new test cases:

1. Follow existing format (Setup, Command, Expected, Verify)
2. Include checkbox for QA tracking
3. Add "Last tested" placeholder
4. Reference source documentation (file + line numbers)
5. Update Section 18 verification checklist
6. Update Section 19 sync checklist with cross-references

### Exit Codes Reference

| Code | Name       | Examples |
|------|------------|----------|
| 0    | Success    | Successful operations |
| 1    | General    | Unspecified errors |
| 6    | Conflict   | Registry/profile already exists, file conflicts |
| 66   | Not Found  | Registry/component/profile not found |
| 69   | Network    | Network errors, registry unreachable |
| 78   | Config     | Invalid config, mutually exclusive options |

---

**End of Manual Testing Guide**

_Last updated: 2026-02-01_
_Document version: 1.0_
