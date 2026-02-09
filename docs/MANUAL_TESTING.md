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

> **Testing Coverage**: See [TEST_PARITY_MATRIX.md](./TEST_PARITY_MATRIX.md) for the complete mapping of workflows to manual and automated test coverage.

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

> **MUST:** Use one persistent shell session for the entire test run. Environment variables set in one terminal are not visible in others. Do not split commands across multiple terminal windows or tabs.

Set up the environment variables at the start of your session:

```bash
export OCX_REPO=/path/to/your/ocx/clone
export OCX_BIN="$OCX_REPO/packages/cli/dist/index.js"
```

> **Note:** Replace `/path/to/your/ocx/clone` with the actual path to your local OCX repository.

Before running any tests, build the CLI from source:

```bash
cd "$OCX_REPO"
bun install
bun run build
```

This ensures you're testing the current codebase, not a system-installed version.

### Build and Serve Local Registries

For pre-release testing, use locally built registries instead of deployed URLs.

**REQUIRED:** Both registries MUST be running before proceeding to Section 2 or any
subsequent tests. All component and profile operations depend on these local servers.

**Terminal 1: KDCO Registry (components)**
```bash
cd "$OCX_REPO/workers/kdco-registry"
bun run dev
# Serves on http://localhost:8787
```

**Terminal 2: OCX Kit Registry (profiles)**
```bash
cd "$OCX_REPO/workers/ocx-kit"
bun run dev --port 8788
# Serves on http://localhost:8788
```

**CRITICAL:** Keep both terminals running for the ENTIRE manual test session. Do not
stop or restart the servers between sections. If a server dies, restart it before
continuing any tests.

**Verify registries are accessible:**
```bash
curl http://localhost:8787/index.json | head -5
curl http://localhost:8788/index.json | head -5
```

Both curl commands must return JSON output. If either fails, the corresponding
registry server is not running—start it before proceeding.

### 1.1 Create Isolated Environment

- [ ] **Setup:** Clean slate for testing
- [ ] **Commands:**
  ```bash
  export XDG_CONFIG_HOME=/tmp/ocx-v2-test
  mkdir -p /tmp/ocx-v2-test-project
  cd /tmp/ocx-v2-test-project
  git init
  ```
- [ ] **Expected:** Environment variables set, test project directory created

### Preflight Checklist

Run these checks before each major section to verify your environment:

```bash
echo $XDG_CONFIG_HOME           # Should show /tmp/ocx-v2-test
test -f "$OCX_BIN" && echo "OK: Binary exists" || echo "FAIL: Binary not found"
$OCX_BIN --version              # Should show current dev version
$OCX_BIN profile rm --help | grep -q '\-\-global' && echo "OK: Help works" || echo "FAIL: Help error"
```

**Registry Health Check (fail-fast):**
```bash
curl -sf http://localhost:8787/index.json > /dev/null && echo "OK: KDCO registry (8787)" || echo "FAIL: KDCO registry not running"
curl -sf http://localhost:8788/index.json > /dev/null && echo "OK: Kit registry (8788)" || echo "FAIL: Kit registry not running"
```

All checks must pass before proceeding. If either registry check fails, restart
the corresponding server now before continuing.

> **REMINDER:** If a registry server died during testing, restart it with `bun run dev`
> (port 8787 for KDCO, port 8788 for Kit) before resuming tests.

### Verify Dev Build

Confirm the dev build is being used:

```bash
$OCX_BIN --version
# Should match package.json version (e.g., 0.5.0)
```

If the version does not match the current codebase, verify `$OCX_BIN` points to the correct path.

- [ ] **Verify:**
  ```bash
  echo $XDG_CONFIG_HOME           # Should show /tmp/ocx-v2-test
  test -f "$OCX_BIN" && echo "OK: Binary exists"
  $OCX_BIN --version              # Should show current dev version
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
  # Re-establish XDG isolation after cleanup
  export XDG_CONFIG_HOME=/tmp/ocx-v2-test
  # Re-run preflight checklist before proceeding
  echo $XDG_CONFIG_HOME
  test -f "$OCX_BIN" && echo "OK: Binary exists"
  $OCX_BIN --version
  ```
- [ ] **Expected:** Fresh environment for next test section
- [ ] **Verify:** Directories recreated, git initialized, XDG isolation active
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
- [ ] **Command:** `$OCX_BIN init --global`
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

### 2.2 `ocx profile add work` (Manual Creation)

> **Note:** Sections 2.2 and 2.4 are **alternative paths**. Choose ONE:
> - **2.2**: Create profile manually from template
> - **2.4**: Install profile from registry
>
> If running both sequentially, remove the profile first:
> ```bash
> $OCX_BIN profile rm work --global
> ```

- [ ] **Setup:** Global profiles initialized (Section 2.1)
- [ ] **Commands:**
  ```bash
  $OCX_BIN profile add work --global
  # Pin to free Zen model for manual testing
  echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle"}' > $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc
  ```
- [ ] **Expected:** Creates new profile `work` with template files and model pins
- [ ] **Verify:**
  ```bash
   $OCX_BIN profile list --global  # Should show: default, work
  ls -la $XDG_CONFIG_HOME/opencode/profiles/work/
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc  # Should contain model pins
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 2.3 Add Global Registry

- [ ] **Setup:** Profiles initialized (Section 2.1)
- [ ] **Command:** `$OCX_BIN registry add http://localhost:8788 --name kit --global`
- [ ] **Expected:** Adds registry to global config
- [ ] **Verify:**
  ```bash
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc  # Should contain kit registry
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 2.4 Install Profile from Registry (Alternative to 2.2)

> **Note:** This is an **alternative** to Section 2.2. Both create a profile named `work`.
> Choose ONE path (2.2 OR 2.4), not both.
>
> If you already ran 2.2, either:
> - Skip this section, OR
> - Remove the existing profile first: `ocx profile rm work --global`

- [ ] **Setup:** Global registry configured (Section 2.3)
- [ ] **Commands:**
  ```bash
  $OCX_BIN profile add work --source kit/omo --global
  # Pin to free Zen model for manual testing
  echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle"}' > $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc
  ```
- [ ] **Expected:** Downloads and installs profile from registry with model pins
- [ ] **Verify:**
  ```bash
   $OCX_BIN profile show work --global
   ls -la $XDG_CONFIG_HOME/opencode/profiles/work/
   cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc  # Should contain model pins
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 2.5 Launch OpenCode with Profile

- [ ] **Setup:** Work profile exists with model pins (Section 2.2 OR 2.4 — complete one of them first)
- [ ] **Commands:**
  ```bash
  cd /tmp/ocx-v2-test-project
  # Verify model pins are set before running
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc | grep -q "opencode/big-pickle" && echo "OK: Model pins verified" || echo "FAIL: Model pins missing"
  $OCX_BIN oc -p work run "echo hello"
  ```
- [ ] **Expected:** OpenCode runs with work profile and free Zen model, executes command
- [ ] **Verify:** Command output shows "hello"
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 2.6 Set Default Profile via Environment

- [ ] **Setup:** Work profile exists with model pins (Section 2.2 OR 2.4 — complete one of them first)
- [ ] **Commands:**
  ```bash
  # Verify model pins are set before running
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc | grep -q "opencode/big-pickle" && echo "OK: Model pins verified" || echo "FAIL: Model pins missing"
  export OCX_PROFILE=work
  $OCX_BIN oc run "echo hello"
  ```
- [ ] **Expected:** Uses work profile automatically without `-p` flag
- [ ] **Verify:** Command executes successfully
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 3. README: Quick Start Components

Test cases from README.md lines 66-86.

### 3.1 `ocx init` (Local)

- [ ] **Setup:** Fresh test project directory
- [ ] **Command:** `$OCX_BIN init`
- [ ] **Expected:** Creates `.opencode/` directory with config files
- [ ] **Verify:**
  ```bash
  ls -la .opencode/
  cat .opencode/ocx.jsonc
  cat .opencode/opencode.jsonc
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 3.2 One-Command Install with Ephemeral Registry

> **Note:** Sections 3.2 and 3.3 are **alternative tests**. Choose ONE:
> - **3.2**: Install component from registry (includes plugins)
> - **3.3**: Add npm plugin directly
>
> If running both sequentially, reset the environment first:
> ```bash
> rm -rf /tmp/ocx-v2-test
> rm -rf /tmp/ocx-v2-test-project
> mkdir -p /tmp/ocx-v2-test-project
> cd /tmp/ocx-v2-test-project
> git init
> $OCX_BIN init
> ```

- [ ] **Setup:** Local config initialized (Section 3.1)
- [ ] **Command:** `$OCX_BIN add kdco/workspace --from http://localhost:8787`
- [ ] **Expected:** Installs component without saving registry
- [ ] **Verify:**
  ```bash
  ls .opencode/  # Should contain workspace files
  cat .ocx/receipt.jsonc  # Should list kdco/workspace
  cat .opencode/ocx.jsonc  # Should NOT contain registry.kdco.dev
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 3.3 Add npm Plugin Directly

> **Note:** This is an **alternative** to Section 3.2. Both modify `.opencode/opencode.jsonc`.
> Choose ONE path (3.2 OR 3.3), not both.
>
> If you already ran 3.2, either:
> - Skip this section, OR
> - Reset the environment first (see 3.2 reset commands)

- [ ] **Setup:** Local config initialized (Section 3.1), plugin not already added
- [ ] **Command:** `$OCX_BIN add npm:@franlol/opencode-md-table-formatter`
- [ ] **Expected:** Plugin is registered in `.opencode/opencode.jsonc`; actual installation is handled by OpenCode runtime
- [ ] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain plugin in "plugin" array
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 3.4 Add Registry Permanently (Local)

- [ ] **Setup:** Local config initialized (Section 3.1)
- [ ] **Commands:**
  ```bash
  $OCX_BIN registry add http://localhost:8787 --name kdco
  $OCX_BIN add kdco/workspace
  ```
- [ ] **Expected:** Registry saved to config, component installed
- [ ] **Verify:**
  ```bash
  cat .opencode/ocx.jsonc  # Should contain kdco registry
  $OCX_BIN registry list  # Should show kdco
  ls .opencode/  # Should contain workspace files
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 4. CLI Reference: ocx init

All variations from CLI.md lines 33-126.

### 4.1 `ocx init` (Default Local)

- [ ] **Setup:** Fresh test project directory
- [ ] **Command:** `$OCX_BIN init`
- [ ] **Expected:** Creates `.opencode/` with default config
- [ ] **Verify:**
  ```bash
  ls .opencode/
  cat .opencode/ocx.jsonc
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.2 `ocx init --global`

- [ ] **Setup:** Fresh sandbox
- [ ] **Command:** `$OCX_BIN init --global`
- [ ] **Expected:** Creates `~/.config/opencode/` and default profile
- [ ] **Verify:**
  ```bash
  ls $XDG_CONFIG_HOME/opencode/
  ls $XDG_CONFIG_HOME/opencode/profiles/default/
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.3 `ocx init` (Default Behavior)

- [ ] **Setup:** Test project directory
- [ ] **Command:** `$OCX_BIN init`
- [ ] **Expected:** Creates config with defaults, no prompts required
- [ ] **Verify:** `.opencode/` created with defaults
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.4 `ocx init` (Error on Existing Local Config)

- [ ] **Setup:** Local config already exists (run Section 4.1 or 4.3 first)
- [ ] **Command:** `$OCX_BIN init`
- [ ] **Expected:** Fails with error (config already exists)
- [ ] **Verify:** Error message indicates `ocx.jsonc` already exists
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.5 `ocx init --registry <path>` (Registry Scaffold Only)

- [ ] **Setup:** Parent directory
- [ ] **Commands:**
  ```bash
  cd /tmp
  $OCX_BIN init --registry ./ocx-test-registry --namespace my-org
  ```
- [ ] **Expected:** Creates registry project at specified path
- [ ] **Verify:**
  ```bash
  ls ./ocx-test-registry/
  cat ./ocx-test-registry/registry.jsonc
  rm -rf ./ocx-test-registry
  cd /tmp/ocx-v2-test-project
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.6 `ocx init --registry` (Scaffold Registry)

- [ ] **Setup:** Empty directory for registry
- [ ] **Command:** `$OCX_BIN init --registry my-registry --namespace my-org`
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
- [ ] **Command:** `$OCX_BIN init --registry my-registry --namespace acme --author "Acme Corp"`
- [ ] **Expected:** Scaffolds registry with custom author
- [ ] **Verify:**
  ```bash
  cat my-registry/registry.jsonc  # Should contain author field
  rm -rf my-registry
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 4.8 `ocx init --registry --canary`

- [ ] **Setup:** Empty directory
- [ ] **Command:** `$OCX_BIN init --registry my-registry --canary --namespace test`
- [ ] **Expected:** Uses canary template (main branch)
- [ ] **Verify:** Registry scaffolded successfully
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 5. CLI Reference: ocx add

All variations from CLI.md lines 129-253.

> **Section Setup:** Run cleanup (Section 1.2) before starting this section to ensure
> no existing local config or cwd state interferes with `init` commands.

### 5.1 Add Registry Component (Fully Qualified)

- [ ] **Setup:** Local config with registry configured
- [ ] **Commands:**
  ```bash
  $OCX_BIN init
  $OCX_BIN registry add http://localhost:8787 --name kdco
  $OCX_BIN add kdco/researcher
  ```
- [ ] **Expected:** Component installed to `.opencode/`
- [ ] **Verify:**
  ```bash
  ls .opencode/
  cat .ocx/receipt.jsonc  # Should list kdco/researcher
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.2 One-Command Install with `--from` (Ephemeral Registry)

> **Note:** This test is an **alternative** to Section 5.1. Both install a component
> from the kdco registry, but 5.1 persists the registry while 5.2 uses `--from` for
> ephemeral access (registry NOT saved to config).
>
> If running sequentially after 5.1, first clean up to ensure the registry is not
> already persisted:
> ```bash
> rm -rf /tmp/ocx-v2-test
> rm -rf /tmp/ocx-v2-test-project
> mkdir -p /tmp/ocx-v2-test-project
> cd /tmp/ocx-v2-test-project
> git init
> export XDG_CONFIG_HOME=/tmp/ocx-v2-test
> ```

- [ ] **Setup:** Fresh local config (NO registry configured)
  ```bash
  $OCX_BIN init
  # Do NOT run registry add - the --from flag provides ephemeral access
  ```
- [ ] **Command:** `$OCX_BIN add kdco/workspace --from http://localhost:8787`
- [ ] **Expected:** Installs component without saving registry to config
- [ ] **Verify:**
  ```bash
  cat .opencode/ocx.jsonc  # Should NOT contain kdco registry
  cat .ocx/receipt.jsonc  # Should list kdco/workspace component
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.3 Add with Specific Profile

- [ ] **Setup:** Profile configured with registry
- [ ] **Command:** `$OCX_BIN add kdco/researcher --profile work`
- [ ] **Expected:** Uses profile's registry for resolution
- [ ] **Verify:** Component installed successfully
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.4 Add npm Plugin (Unscoped)

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `$OCX_BIN add npm:chalk`
- [ ] **Expected:** Plugin entry added to `.opencode/opencode.jsonc` plugins array; runtime installation handled by OpenCode
- [ ] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain "chalk" in "plugin" array
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.5 Add npm Plugin (Scoped)

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `$OCX_BIN add npm:@franlol/opencode-md-table-formatter`
- [ ] **Expected:** Plugin entry added to `.opencode/opencode.jsonc` plugins array; runtime installation handled by OpenCode
- [ ] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain plugin in "plugin" array
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.6 Add npm Plugin with Version

> **Note:** This is an **alternative** to Section 5.5 for the same package.
> Running 5.5 first adds `@franlol/opencode-md-table-formatter` without a version,
> which conflicts with this versioned add.
>
> If running sequentially after 5.5, reset to a fresh local config first:
> ```bash
> rm -rf /tmp/ocx-v2-test-project
> mkdir -p /tmp/ocx-v2-test-project
> cd /tmp/ocx-v2-test-project
> git init
> $OCX_BIN init
> ```

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `$OCX_BIN add npm:@franlol/opencode-md-table-formatter@0.0.3`
- [ ] **Expected:** Plugin entry added to `.opencode/opencode.jsonc`; runtime installation handled by OpenCode
- [ ] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain "@franlol/opencode-md-table-formatter@0.0.3" in "plugin" array
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.7 Add Multiple Components

- [ ] **Setup:** Registry configured
- [ ] **Command:** `$OCX_BIN add kdco/researcher kdco/code-philosophy kdco/notify`
- [ ] **Expected:** Installs all three components
- [ ] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Should list all three
  ls .opencode/
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.8 Add with `--dry-run`

> **Note:** Uses `kdco/workspace` (not installed in Section 5.7) to ensure
> deterministic behavior in sequential test runs.

- [ ] **Setup:** Registry configured
- [ ] **Command:** `$OCX_BIN add kdco/workspace --dry-run`
- [ ] **Expected:** Shows what would be installed without making changes
- [ ] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Should NOT list kdco/workspace (dry-run makes no changes)
  ls .opencode/  # Should NOT contain workspace component files
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.9 Add with `--trust` (Bypass Plugin Validation)

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `$OCX_BIN add npm:lodash --trust`
- [ ] **Expected:** Skips ESM plugin validation and adds package entry anyway
- [ ] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain "lodash" in "plugin" array
  ```
- [ ] **Note:** This specifically tests trust-bypass behavior for non-ESM packages.
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.10 Add with `--json` Output

- [ ] **Setup:** Registry configured
- [ ] **Command:** `$OCX_BIN add kdco/researcher --json`
- [ ] **Expected:** Outputs machine-readable JSON
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 5.11 Add with `--verbose`

- [ ] **Setup:** Registry configured
- [ ] **Command:** `$OCX_BIN add kdco/researcher --verbose`
- [ ] **Expected:** Shows detailed file operations
- [ ] **Verify:** Verbose output includes file paths
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 6. CLI Reference: ocx update

All variations from CLI.md lines 256-361.

### 6.1 Update Specific Component

> **Note:** Component must be installed first. Complete Section 5.1, or run:
> ```bash
> $OCX_BIN init
> $OCX_BIN registry add http://localhost:8787 --name kdco
> $OCX_BIN add kdco/researcher
> ```

- [ ] **Setup:** Component installed (Section 5.1)
- [ ] **Command:** `$OCX_BIN update kdco/researcher`
- [ ] **Expected:** Updates to latest version
- [ ] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Version should update
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 6.2 Update Multiple Components

- [ ] **Setup:** Multiple components installed
- [ ] **Command:** `$OCX_BIN update kdco/researcher kdco/notify`
- [ ] **Expected:** Updates both components
- [ ] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Both versions updated
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 6.3 Update All Components (`--all`)

- [ ] **Setup:** Multiple components installed
- [ ] **Command:** `$OCX_BIN update --all`
- [ ] **Expected:** Updates all installed components
- [ ] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # All versions updated
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 6.4 Update All with `--dry-run`

- [ ] **Setup:** Components installed
- [ ] **Command:** `$OCX_BIN update --all --dry-run`
- [ ] **Expected:** Shows what would be updated without applying
- [ ] **Verify:**
  ```bash
  # Output should list pending updates
  cat .ocx/receipt.jsonc  # Versions should NOT change
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 6.5 Update by Registry (`--registry`)

- [ ] **Setup:** Components from multiple registries installed
- [ ] **Command:** `$OCX_BIN update --registry kdco`
- [ ] **Expected:** Updates only kdco components
- [ ] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Only kdco components updated
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

- [ ] **Setup:** Component installed
- [ ] **Command:** `$OCX_BIN update kdco/researcher --json`
- [ ] **Expected:** Machine-readable JSON output
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 6.6 Update with `--verbose`

- [ ] **Setup:** Component installed
- [ ] **Command:** `$OCX_BIN update kdco/researcher --verbose`
- [ ] **Expected:** Detailed file change information
- [ ] **Verify:** Verbose output shows file operations
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 7. CLI Reference: ocx search

All variations from CLI.md lines 439-516.

### 7.1 Search All Available Components

- [ ] **Setup:** Registry configured
- [ ] **Command:** `$OCX_BIN search`
- [ ] **Expected:** Lists all components from configured registries
- [ ] **Verify:** Output shows component list
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 7.2 Search with Query

- [ ] **Setup:** Registry configured
- [ ] **Command:** `$OCX_BIN search agent`
- [ ] **Expected:** Lists components matching "agent"
- [ ] **Verify:** Results filtered by query
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 7.3 Search with Higher Limit

- [ ] **Setup:** Registry configured
- [ ] **Command:** `$OCX_BIN search agents --limit 50`
- [ ] **Expected:** Shows up to 50 results
- [ ] **Verify:** Limit respected in output
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 7.4 List Installed Components Only

- [ ] **Setup:** Components installed
- [ ] **Command:** `$OCX_BIN search --installed`
- [ ] **Expected:** Shows only installed components with versions
- [ ] **Verify:**
  ```bash
  # Output should match receipt.jsonc contents
  cat .ocx/receipt.jsonc
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 7.5 Search with `--json` Output

- [ ] **Setup:** Registry configured
- [ ] **Command:** `$OCX_BIN search --json`
- [ ] **Expected:** Machine-readable JSON component list
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 7.6 Search with `--verbose`

- [ ] **Setup:** Registry configured
- [ ] **Command:** `$OCX_BIN search agents --verbose`
- [ ] **Expected:** Detailed component information including registry details
- [ ] **Verify:** Verbose output shows extended metadata
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 7.7 Search Alias: `ocx list`

- [ ] **Setup:** Registry configured
- [ ] **Command:** `$OCX_BIN list`
- [ ] **Expected:** Same output as `ocx search`
- [ ] **Verify:** Lists all components
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 8. CLI Reference: ocx registry

All subcommands from CLI.md lines 519-705.

> **Section Setup:** Run cleanup (Section 1.2) before starting this section to ensure
> no existing `kdco` registry from earlier sections interferes with these tests.

### 8.1 `ocx registry add` (Local, Name from Hostname)

> **Note:** If you ran Sections 3.4 or 5.1 earlier, the `kdco` registry already exists.
> Either run Section 1.2 cleanup first, or remove the existing registry:
> ```bash
> $OCX_BIN registry remove kdco
> ```

- [ ] **Setup:** Local config initialized, `kdco` registry does NOT exist
- [ ] **Command:** `$OCX_BIN registry add http://localhost:8787 --name kdco`
- [ ] **Expected:** Registry added with custom name "kdco"
- [ ] **Verify:**
  ```bash
  $OCX_BIN registry list  # Should show kdco
  cat .opencode/ocx.jsonc  # Should contain registry
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.2 `ocx registry add` with Custom Name

> **Note:** Alternative to Section 8.1. If 8.1 already ran, `kdco` registry already exists.
> Either skip this test, or remove the existing registry first:
> ```bash
> $OCX_BIN registry remove kdco
> ```

- [ ] **Setup:** Local config initialized, `kdco` registry does NOT exist
- [ ] **Command:** `$OCX_BIN registry add http://localhost:8787 --name kdco`
- [ ] **Expected:** Registry added with custom name "kdco"
- [ ] **Verify:**
  ```bash
  $OCX_BIN registry list  # Should show kdco
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.3 `ocx registry add --global`

- [ ] **Setup:** Global profiles initialized
- [ ] **Command:** `$OCX_BIN registry add http://localhost:8787 --name kdco --global`
- [ ] **Expected:** Registry added to global config
- [ ] **Verify:**
  ```bash
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc  # Should contain kdco
  $OCX_BIN registry list --global  # Should show kdco
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.4 `ocx registry add --force` (Update Existing)

- [ ] **Setup:** Registry already configured (run Section 8.1 first to add `kdco` registry)
- [ ] **Command:** `$OCX_BIN registry add http://localhost:8787 --name kdco --force`
- [ ] **Expected:** Overwrites existing registry with same URL (force update behavior)
- [ ] **Verify:**
  ```bash
  cat .opencode/ocx.jsonc  # Should still contain kdco registry
  $OCX_BIN registry list  # Should show kdco
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.5 `ocx registry add` with `--json` Output

> **Note:** Alternative to Sections 8.1/8.2. If those already ran, `kdco` registry
> already exists. Either skip this test, remove the registry first
> (`$OCX_BIN registry remove kdco`), or use a different name.

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `$OCX_BIN registry add http://localhost:8787 --name kdco --json`
- [ ] **Expected:** Machine-readable JSON confirmation
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.6 `ocx registry remove` (Local)

- [ ] **Setup:** Registry configured locally
- [ ] **Command:** `$OCX_BIN registry remove kdco`
- [ ] **Expected:** Registry removed from local config
- [ ] **Verify:**
  ```bash
  $OCX_BIN registry list  # Should NOT show kdco
  cat .opencode/ocx.jsonc  # Should NOT contain kdco
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.7 `ocx registry remove --global`

- [ ] **Setup:** Registry configured globally
- [ ] **Command:** `$OCX_BIN registry remove kdco --global`
- [ ] **Expected:** Registry removed from global config
- [ ] **Verify:**
  ```bash
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc  # Should NOT contain kdco
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.8 `ocx registry list` (Local)

- [ ] **Setup:** Registries configured locally
- [ ] **Command:** `$OCX_BIN registry list`
- [ ] **Expected:** Lists local registries
- [ ] **Verify:** Output matches `.opencode/ocx.jsonc` content
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.9 `ocx registry list --global`

- [ ] **Setup:** Registries configured globally
- [ ] **Command:** `$OCX_BIN registry list --global`
- [ ] **Expected:** Lists global registries
- [ ] **Verify:** Output matches global config
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 8.10 `ocx registry list --json`

- [ ] **Setup:** Registries configured
- [ ] **Command:** `$OCX_BIN registry list --json`
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
  echo '{"name": "test-registry", "version": "1.0.0", "namespace": "test", "author": "Test Author", "components": []}' > /tmp/test-registry/registry.jsonc
  cd /tmp/test-registry
  $OCX_BIN build
  ```
- [ ] **Expected:** Builds to `./dist/`
- [ ] **Verify:**
  ```bash
  ls ./dist/
  rm -rf /tmp/test-registry
  cd /tmp  # Return to safe directory after deleting cwd
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 9.2 Build from Specific Directory

> **Note:** Section 9.1 deletes `/tmp/test-registry` and changes to `/tmp`. Ensure you are in a safe directory and recreate:
> ```bash
> cd /tmp
> mkdir -p /tmp/test-registry/files/agent
> echo '{"name": "test-registry", "version": "1.0.0", "namespace": "test", "author": "Test Author", "components": []}' > /tmp/test-registry/registry.jsonc
> ```

- [ ] **Setup:** Registry source directory (recreate if needed)
- [ ] **Command:** `$OCX_BIN build /tmp/test-registry`
- [ ] **Expected:** Builds registry from specified path to `./dist/` in current working directory
- [ ] **Verify:**
  ```bash
  ls ./dist/  # Output is relative to cwd, not the source directory
  rm -rf ./dist
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 9.3 Build with Custom Output Directory

> **Note:** Section 9.1 deletes `/tmp/test-registry` and changes to `/tmp`. Ensure you are in a safe directory and recreate:
> ```bash
> cd /tmp
> mkdir -p /tmp/test-registry/files/agent
> echo '{"name": "test-registry", "version": "1.0.0", "namespace": "test", "author": "Test Author", "components": []}' > /tmp/test-registry/registry.jsonc
> ```

- [ ] **Setup:** Registry source directory (recreate if needed)
- [ ] **Command:** `$OCX_BIN build /tmp/test-registry --out ./public`
- [ ] **Expected:** Builds to `./public/` instead of `./dist/`
- [ ] **Verify:**
  ```bash
  ls ./public/
  rm -rf ./public
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 9.4 Build with `--json` Output

- [ ] **Setup:** Registry source directory
- [ ] **Command:** `$OCX_BIN build /tmp/test-registry --json`
- [ ] **Expected:** Machine-readable JSON build summary
- [ ] **Verify:** Output is valid JSON with component count
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 10. CLI Reference: ocx profile

All subcommands from CLI.md lines 1024-1273.

### 10.1 `ocx profile list`

- [ ] **Setup:** Global profiles initialized
- [ ] **Command:** `$OCX_BIN profile list --global`
- [ ] **Expected:** Lists all profiles (no active indicator)
- [ ] **Verify:**
  ```bash
  # Output should show at least "default"
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.2 `ocx p ls` (Alias)

- [ ] **Setup:** Global profiles initialized
- [ ] **Command:** `$OCX_BIN p ls --global`
- [ ] **Expected:** Same output as `ocx profile list`
- [ ] **Verify:** Lists profiles
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.3 `ocx profile list --json`

- [ ] **Setup:** Global profiles initialized
- [ ] **Command:** `$OCX_BIN profile list --global --json`
- [ ] **Expected:** Machine-readable JSON with profile list
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.4 `ocx profile add work` (Empty Profile)

- [ ] **Setup:** Local config initialized
- [ ] **Commands:**
  ```bash
  $OCX_BIN profile add work
  # Pin to free Zen model for manual testing
  echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle"}' > .opencode/profiles/work/opencode.jsonc
  ```
- [ ] **Expected:** Creates new empty profile with template files and model pins
- [ ] **Verify:**
  ```bash
  $OCX_BIN p ls  # Should show work
  ls .opencode/profiles/work/
  cat .opencode/profiles/work/opencode.jsonc  # Should contain model pins
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.5 `ocx profile add` Clone from Existing

- [ ] **Setup:** Profile "work" exists
- [ ] **Command:** `$OCX_BIN profile add client-x --clone work`
- [ ] **Expected:** Clones work profile to client-x
- [ ] **Verify:**
  ```bash
  $OCX_BIN p ls  # Should show both work and client-x
  diff .opencode/profiles/work/ocx.jsonc \
       .opencode/profiles/client-x/ocx.jsonc
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.6 `ocx profile add` Install from Registry (Shorthand)

- [ ] **Setup:** Local registry configured
- [ ] **Command:** `$OCX_BIN profile add ws --source kit/ws --global`
- [ ] **Expected:** Downloads profile from kit registry
- [ ] **Verify:**
  ```bash
  $OCX_BIN p show ws --global
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.7 `ocx profile add` Install from URL

> **Note:** Uses a different profile name (`ws-alt`) than Section 10.6 (`ws`) so both
> tests can run sequentially without conflict.

- [ ] **Setup:** None required
- [ ] **Command:** `$OCX_BIN profile add ws-alt --source kit/ws --from http://localhost:8788 --global`
- [ ] **Expected:** Downloads profile from ephemeral registry URL
- [ ] **Verify:**
  ```bash
  $OCX_BIN p show ws-alt --global
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.8 `ocx profile add` (Remove and Add to Overwrite)

- [ ] **Setup:** Profile "ws" already exists
- [ ] **Commands:**
  ```bash
  $OCX_BIN profile remove ws --global
  $OCX_BIN profile add ws --source kit/ws --global
  ```
- [ ] **Expected:** Removes and reinstalls profile
- [ ] **Verify:**
  ```bash
  $OCX_BIN p show ws --global  # Should show fresh content
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.9 `ocx p add` (Alias)

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `$OCX_BIN p add personal`
- [ ] **Expected:** Creates new profile (same as `profile add`)
- [ ] **Verify:**
  ```bash
  $OCX_BIN p ls  # Should show personal
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.10 `ocx profile remove work` (Local Default)

- [ ] **Setup:** Local profile "work" exists
- [ ] **Commands:**
  ```bash
  $OCX_BIN profile add work  # Create local profile first
  $OCX_BIN profile remove work
  ```
- [ ] **Expected:** Deletes local profile immediately (no confirmation)
- [ ] **Verify:**
  ```bash
  ls .opencode/profiles/  # work/ should be gone
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.11 `ocx profile remove --global`

- [ ] **Setup:** Global profiles initialized
- [ ] **Commands:**
  ```bash
  $OCX_BIN profile add old-profile --global  # Create profile first
  $OCX_BIN profile remove old-profile --global
  ```
- [ ] **Expected:** Deletes global profile (no confirmation)
- [ ] **Verify:**
  ```bash
  $OCX_BIN p ls --global  # Should NOT show old-profile
  ls $XDG_CONFIG_HOME/opencode/profiles/  # old-profile/ should be gone
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.12 `ocx p rm` (Alias)

- [ ] **Setup:** Global profiles initialized
- [ ] **Commands:**
  ```bash
  $OCX_BIN p add temp-profile --global  # Create profile first
  $OCX_BIN p rm temp-profile --global
  ```
- [ ] **Expected:** Deletes profile (same as `profile remove`)
- [ ] **Verify:**
  ```bash
  $OCX_BIN p ls --global  # Should NOT show temp-profile
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.13 `ocx profile move work client-work` (Local Default)

- [ ] **Setup:** Local profile "work" exists
- [ ] **Commands:**
  ```bash
  $OCX_BIN profile add work  # Ensure local work profile exists
  $OCX_BIN profile move work client-work
  ```
- [ ] **Expected:** Renames local profile from work to client-work
- [ ] **Verify:**
  ```bash
  ls .opencode/profiles/  # client-work/ exists, work/ gone
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.14 `ocx profile move --global`

- [ ] **Setup:** Global profiles initialized
- [ ] **Commands:**
  ```bash
  # Clean up any conflicting profiles first for deterministic test
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile rm client-work --global 2>/dev/null || true
  # Create source profile and move it
  $OCX_BIN profile add work --global
  $OCX_BIN profile move work client-work --global
  ```
- [ ] **Expected:** Renames global profile from work to client-work
- [ ] **Verify:**
  ```bash
  $OCX_BIN p ls --global  # Should show client-work, NOT work
  ls $XDG_CONFIG_HOME/opencode/profiles/  # client-work/ exists, work/ gone
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.15 `ocx p mv` (Alias)

- [ ] **Setup:** Profile exists
- [ ] **Commands:**
  ```bash
  # Clean up any conflicting profiles first for deterministic test
  $OCX_BIN profile rm personal --global 2>/dev/null || true
  $OCX_BIN profile rm home --global 2>/dev/null || true
  # Create source profile and move it
  $OCX_BIN p add personal --global
  $OCX_BIN p mv personal home --global
  ```
- [ ] **Expected:** Renames profile (same as `profile move`)
- [ ] **Verify:**
  ```bash
  $OCX_BIN p ls --global  # Should show home, NOT personal
  ls $XDG_CONFIG_HOME/opencode/profiles/  # home/ exists, personal/ gone
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.16 `ocx profile show` (Current Profile)

- [ ] **Setup:** Profile active via environment or flag
- [ ] **Commands:**
  ```bash
  $OCX_BIN profile add work --global  # Ensure work profile exists
  OCX_PROFILE=work $OCX_BIN profile show --global
  ```
- [ ] **Expected:** Shows currently resolved profile details
- [ ] **Verify:** Output displays work profile info
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.17 `ocx profile show work`

- [ ] **Setup:** Profile "work" exists
- [ ] **Commands:**
  ```bash
  # Idempotent: remove if exists, then add to ensure clean state
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile add work --global
  $OCX_BIN profile show work --global
  ```
- [ ] **Expected:** Shows work profile config and files
- [ ] **Verify:**
  ```bash
  # Output should list files and configuration
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.18 `ocx p show` (Alias)

- [ ] **Setup:** Profile "work" exists (from Section 10.17)
- [ ] **Commands:**
  ```bash
  $OCX_BIN p show work --global
  ```
- [ ] **Expected:** Same output as `profile show work`
- [ ] **Verify:** Profile details displayed
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 10.19 `ocx profile show --json`

- [ ] **Setup:** Profile "work" exists (from Section 10.17)
- [ ] **Commands:**
  ```bash
  $OCX_BIN profile show work --global --json
  ```
- [ ] **Expected:** Machine-readable JSON with profile details
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 11. CLI Reference: ocx config

All subcommands from CLI.md lines 1276-1381.

### 11.1 `ocx config show` (Current Scope)

- [ ] **Setup:** Local config initialized
- [ ] **Command:** `$OCX_BIN config show`
- [ ] **Expected:** Shows merged config from current scope
- [ ] **Verify:**
  ```bash
  # Output should display registries, settings
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.2 `ocx config show --origin`

- [ ] **Setup:** Local config with profile active
- [ ] **Command:** `$OCX_BIN config show --origin`
- [ ] **Expected:** Shows config with source annotations
- [ ] **Verify:**
  ```bash
  # Output should indicate source (local, profile, global)
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.3 `ocx config show -p work`

- [ ] **Setup:** Profile "work" exists
- [ ] **Command:** `$OCX_BIN config show -p work`
- [ ] **Expected:** Shows config from work profile scope
- [ ] **Verify:** Output shows work profile settings
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.4 `ocx config show --json`

- [ ] **Setup:** Config exists
- [ ] **Command:** `$OCX_BIN config show --json`
- [ ] **Expected:** Machine-readable JSON config
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.5 `ocx config edit` (Local)

- [ ] **Setup:** Local config exists, `$EDITOR` set
- [ ] **Command:** `EDITOR=cat $OCX_BIN config edit`
- [ ] **Expected:** Opens `.opencode/ocx.jsonc` in editor
- [ ] **Verify:**
  ```bash
  # Editor should open local config file
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.6 `ocx config edit --global`

- [ ] **Setup:** Global config exists, `$EDITOR` set
- [ ] **Command:** `EDITOR=cat $OCX_BIN config edit --global`
- [ ] **Expected:** Opens `~/.config/opencode/ocx.jsonc` in editor
- [ ] **Verify:** Editor opens global config
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 11.7 `ocx config edit -p work`

- [ ] **Setup:** Profile "work" exists, `$EDITOR` set
- [ ] **Command:** `EDITOR=cat $OCX_BIN config edit -p work`
- [ ] **Expected:** Opens work profile's `ocx.jsonc` in editor
- [ ] **Verify:** Editor opens profile config
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 12. CLI Reference: ocx opencode

All variations from CLI.md lines 1383-1509.

### 12.1 `ocx opencode` (Default Profile)

- [ ] **Setup:** Default profile exists, test project directory
- [ ] **Command:** `cd /tmp/ocx-v2-test-project && $OCX_BIN oc run "echo hello"`
- [ ] **Expected:** Launches OpenCode with default profile
- [ ] **Verify:** Output shows "hello"
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.2 `ocx opencode -p work`

- [ ] **Setup:** Work profile exists
- [ ] **Command:** `$OCX_BIN oc -p work run "echo hello"`
- [ ] **Expected:** Launches with work profile explicitly
- [ ] **Verify:** Command executes successfully
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.3 `ocx opencode` with `OCX_PROFILE` Environment

- [ ] **Setup:** Profile exists
- [ ] **Commands:**
  ```bash
  export OCX_PROFILE=work
  $OCX_BIN oc run "echo hello"
  ```
- [ ] **Expected:** Uses profile from environment variable
- [ ] **Verify:** Command executes with work profile
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.4 `ocx oc` (Alias)

- [ ] **Setup:** Profile exists
- [ ] **Command:** `$OCX_BIN oc run "echo hello"`
- [ ] **Expected:** Same behavior as `ocx opencode`
- [ ] **Verify:** Command executes
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.5 `ocx opencode --no-rename`

- [ ] **Setup:** Profile exists, in terminal with window support
- [ ] **Command:** `$OCX_BIN oc --no-rename run "echo hello"`
- [ ] **Expected:** Skips automatic window renaming
- [ ] **Verify:** Terminal window name unchanged
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.6 `ocx oc -- --help` (Pass-Through to OpenCode)

- [ ] **Setup:** OpenCode installed
- [ ] **Command:** `$OCX_BIN oc -- --help`
- [ ] **Expected:** Shows OpenCode's help, not OCX help
- [ ] **Verify:** Help output is from OpenCode
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.7 Profile Resolution Priority: Flag Wins

- [ ] **Setup:** Multiple profiles, `OCX_PROFILE` set
- [ ] **Commands:**
  ```bash
  unset OCX_PROFILE
  export OCX_PROFILE=default
  $OCX_BIN oc -p work run "echo hello"
  unset OCX_PROFILE
  ```
- [ ] **Expected:** Uses work profile (flag overrides env)
- [ ] **Verify:** Work profile used
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.8 Profile Resolution: Environment Variable

- [ ] **Setup:** Profile exists, no local config
- [ ] **Commands:**
  ```bash
  unset OCX_PROFILE
  export OCX_PROFILE=work
  $OCX_BIN oc run "echo hello"
  unset OCX_PROFILE
  ```
- [ ] **Expected:** Uses profile from environment variable
- [ ] **Verify:** Work profile used
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.9 Profile Resolution: Local Config Field

- [ ] **Setup:** Local config with `profile: "work"` field, work profile exists globally with model pins
- [ ] **Commands:**
  ```bash
  unset OCX_PROFILE
  cd /tmp/ocx-v2-test-project
  # Ensure work profile exists globally with model pins
  $OCX_BIN profile add work --global 2>/dev/null || true
  echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle"}' > $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc
  # Initialize local config with profile field (skip if already exists)
  test -f .opencode/ocx.jsonc || $OCX_BIN init
  echo '{"profile": "work"}' > .opencode/ocx.jsonc
  # Verify model pins before running
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc | grep -q "opencode/big-pickle" && echo "OK: Model pins verified" || echo "FAIL: Model pins missing"
  $OCX_BIN oc run "echo hello"
  ```
- [ ] **Expected:** Uses profile specified in local config with free Zen model
- [ ] **Verify:**
  ```bash
  cat .opencode/ocx.jsonc  # Should have "profile": "work"
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc  # Should contain model pins
  # oc run output should indicate work profile is being used
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.10 Profile Resolution: Default Profile Fallback

- [ ] **Setup:** Default profile exists, no explicit selection (clear local profile override from Section 12.9)
- [ ] **Commands:**
  ```bash
  unset OCX_PROFILE
  # Clear local profile override to test true default fallback
  echo '{}' > .opencode/ocx.jsonc
  $OCX_BIN oc run "echo hello"
  unset OCX_PROFILE
  ```
- [ ] **Expected:** Falls back to default profile when no higher-priority source is set
- [ ] **Verify:**
  ```bash
  cat .opencode/ocx.jsonc  # Should NOT contain "profile" field
  # Command executes successfully using default profile
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.11 Custom Binary via Profile Config

- [ ] **Setup:** Profile with `bin` field set to an available OpenCode binary
- [ ] **Commands:**
  ```bash
  # Ensure work profile exists (idempotent)
  $OCX_BIN profile add work --global 2>/dev/null || true
  # Set bin field to the actual available binary path
  OPENCODE_BIN_PATH=$(command -v oc || command -v opencode || echo "")
  if [ -n "$OPENCODE_BIN_PATH" ]; then
    echo "{\"bin\": \"$OPENCODE_BIN_PATH\"}" > $XDG_CONFIG_HOME/opencode/profiles/work/ocx.jsonc
  else
    echo "WARNING: No OpenCode binary found in PATH"
  fi
  ```
- [ ] **Command:** `$OCX_BIN oc -p work run "echo hello"`
- [ ] **Expected:** Uses custom binary from profile config
- [ ] **Verify:**
  ```bash
  # Check bin field is present and non-empty
  cat $XDG_CONFIG_HOME/opencode/profiles/work/ocx.jsonc | grep -q '"bin"' && echo "OK: bin field present" || echo "FAIL: bin field missing"
  cat $XDG_CONFIG_HOME/opencode/profiles/work/ocx.jsonc | grep '"bin"' | grep -v '""' && echo "OK: bin field non-empty" || echo "FAIL: bin field empty"
  ```
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 12.12 Custom Binary via `OPENCODE_BIN` Environment

- [ ] **Setup:** OpenCode available at custom path
- [ ] **Commands:**
  ```bash
  export OPENCODE_BIN=/custom/path/opencode
  $OCX_BIN oc run "echo hello"
  ```
- [ ] **Expected:** Uses binary from environment variable
- [ ] **Verify:** Custom binary executed
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 13. Profile System Tests

From PROFILES.md - advanced profile behaviors.

### 13.1 Profile Layering: Global Base + Local Overlay

- [ ] **Setup:** Global profile "work" exists, local config specifies profile
- [ ] **Commands:**
  ```bash
  $OCX_BIN init --global
  # Idempotent: remove work profile if it exists from prior runs
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile add work --global
  # Add registry to work profile non-interactively (preserve model pins for sequential-run safety)
  echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle", "registries": {"kit": {"url": "http://localhost:8788"}}}' > $XDG_CONFIG_HOME/opencode/profiles/work/ocx.jsonc
  cd /tmp/ocx-v2-test-project
  # Idempotent: init only if local config does not exist (sequential runs)
  test -f .opencode/ocx.jsonc || $OCX_BIN init
  # Set profile in local config non-interactively
  echo '{"profile": "work"}' > .opencode/ocx.jsonc
  $OCX_BIN config show --origin
  ```
- [ ] **Expected:** Local overlay takes precedence over global base
- [ ] **Verify:** `--origin` shows layering sources (global profile + local overlay)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.2 Exclude/Include Pattern Behavior

- [ ] **Setup:** Profile with exclude patterns
- [ ] **Commands:**
  ```bash
  # Deterministic pre-check: ensure work profile still has model pins before running
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc 2>/dev/null | grep -q "opencode/big-pickle" || echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle"}' > $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc | grep -q "opencode/big-pickle" && echo "OK: Model pins verified" || echo "FAIL: Model pins missing"
  # Create profile with exclude: ["**/AGENTS.md"]
  echo "# Test" > AGENTS.md
  $OCX_BIN oc -p work run "echo hello"
  ```
- [ ] **Expected:** AGENTS.md excluded from OpenCode context
- [ ] **Verify:** File not visible to OpenCode
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.3 Include Overrides Exclude

- [ ] **Setup:** Profile with exclude and include patterns
- [ ] **Commands:**
  ```bash
  # Idempotent: ensure work profile exists with model pins before running
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile add work --global
  echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle"}' > $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc
  # Profile config:
  # "exclude": ["**/AGENTS.md"]
  # "include": ["./AGENTS.md"]
  echo "# Test" > AGENTS.md
  # Verify model pins before running
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc | grep -q "opencode/big-pickle" && echo "OK: Model pins verified" || echo "FAIL: Model pins missing"
  $OCX_BIN oc -p work run "echo hello"
  ```
- [ ] **Expected:** Root AGENTS.md included despite exclude pattern
- [ ] **Verify:** Include overrides exclude
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.4 Registry Isolation: Profile Registries Only

- [ ] **Setup:** Global registry configured, profile with different registry
- [ ] **Commands:**
  ```bash
  # Idempotent: remove registry 'kdco' if it exists from prior runs
   $OCX_BIN registry remove kdco --global 2>/dev/null || true
  $OCX_BIN registry add http://localhost:8787 --name kdco --global
  # Idempotent: remove work profile if it exists from prior runs
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile add work --global
  # Add kit registry to work profile config (non-interactive)
  echo '{"registries": {"kit": {"url": "http://localhost:8788"}}}' > $XDG_CONFIG_HOME/opencode/profiles/work/ocx.jsonc
  $OCX_BIN search -p work
  ```
- [ ] **Expected:** Only profile's registries visible, NOT global
- [ ] **Verify:** Search shows only kit components (from port 8788), NOT kdco components (from port 8787)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.5 Registry Isolation: Local Registries Only

- [ ] **Setup:** Local config with registries, no profile
- [ ] **Commands:**
  ```bash
  # Idempotent: init only if local config does not exist (sequential runs)
  test -f .opencode/ocx.jsonc || $OCX_BIN init
  $OCX_BIN registry add http://localhost:8787 --name kdco
  $OCX_BIN search
  ```
- [ ] **Expected:** Only local registries visible
- [ ] **Verify:** Search shows only kdco components (from local config registry)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.6 OpenCode Config Merging

- [ ] **Setup:** Profile with `opencode.jsonc`, local with different settings
- [ ] **Commands:**
  ```bash
  # Idempotent: ensure work profile exists with opencode.jsonc
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile add work --global
  echo '{"agents": ["coder"]}' > $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc
  # Idempotent: init only if local config does not exist (sequential runs)
  test -f .opencode/ocx.jsonc || $OCX_BIN init
  echo '{"agents": ["researcher"]}' > .opencode/opencode.jsonc
  $OCX_BIN config show -p work
  ```
- [ ] **Expected:** Non-special arrays (like `agents`) follow mergeDeep default: local replaces profile (source wins). Only `plugin` and `instructions` arrays are concatenated and deduped per OpenCode semantics.
- [ ] **Verify:** `agents` shows `["researcher"]` (local wins), not both arrays merged
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.7 Instruction File Discovery (Deepest-First)

- [ ] **Setup:** Multi-level project with instruction files
- [ ] **Commands:**
  ```bash
  # Idempotent: ensure work profile exists with model pins before running
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile add work --global
  echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle"}' > $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc
  mkdir -p /tmp/ocx-v2-test-project/subdir
  cd /tmp/ocx-v2-test-project
  git init
  echo "# Root" > AGENTS.md
  echo "# Subdir" > subdir/AGENTS.md
  cd subdir
  # Verify model pins before running
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc | grep -q "opencode/big-pickle" && echo "OK: Model pins verified" || echo "FAIL: Model pins missing"
  $OCX_BIN oc run "echo hello"
  ```
- [ ] **Expected:** Files discovered from subdir up to git root (AGENTS → CLAUDE → CONTEXT priority; first type wins)
- [ ] **Verify:**
  - Model pins verified before oc run (prevents paid-provider fallback)
  - Both AGENTS.md files considered (deepest first)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.8 First Type Wins

- [ ] **Setup:** Project directory with multiple instruction file types
- [ ] **Commands:**
  ```bash
  cd /tmp/ocx-v2-test-project
  git init
  # Idempotent: init only if local config does not exist (sequential runs)
  test -f .opencode/ocx.jsonc || $OCX_BIN init
  # Pin to free Zen model for manual testing
  echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle"}' > .opencode/opencode.jsonc
  echo "# Agents" > AGENTS.md
  echo "# Claude" > CLAUDE.md
  echo "# Context" > CONTEXT.md
  # Verify model pins before running
  cat .opencode/opencode.jsonc | grep -q "opencode/big-pickle" && echo "OK: Model pins verified" || echo "FAIL: Model pins missing"
  $OCX_BIN oc run "echo hello"
  ```
- [ ] **Expected:** Only AGENTS.md is loaded; CLAUDE.md and CONTEXT.md are ignored (AGENTS → CLAUDE → CONTEXT priority)
- [ ] **Verify:** First type wins behavior enforced
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.9 CONTEXT.md Deprecated

- [ ] **Setup:** Project with only CONTEXT.md
- [ ] **Commands:**
  ```bash
  cd /tmp/ocx-v2-test-project
  git init
  # Idempotent: init only if local config does not exist (sequential runs)
  test -f .opencode/ocx.jsonc || $OCX_BIN init
  # Pin to free Zen model for manual testing
  echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle"}' > .opencode/opencode.jsonc
  rm -f AGENTS.md CLAUDE.md
  echo "# Context" > CONTEXT.md
  # Verify model pins before running
  cat .opencode/opencode.jsonc | grep -q "opencode/big-pickle" && echo "OK: Model pins verified" || echo "FAIL: Model pins missing"
  $OCX_BIN oc run "echo hello"
  ```
- [ ] **Expected:** CONTEXT.md loads, but document that it is deprecated (AGENTS.md or CLAUDE.md preferred)
- [ ] **Verify:** CONTEXT.md loaded successfully
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.10 Profile Instructions Have Highest Priority

- [ ] **Setup:** Profile with AGENTS.md, project with AGENTS.md
- [ ] **Commands:**
  ```bash
  # Idempotent: ensure work profile exists with model pins before running
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile add work --global
  echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle"}' > $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc
  echo "# Profile instructions" > $XDG_CONFIG_HOME/opencode/profiles/work/AGENTS.md
  echo "# Project instructions" > /tmp/ocx-v2-test-project/AGENTS.md
  # Verify model pins before running
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc | grep -q "opencode/big-pickle" && echo "OK: Model pins verified" || echo "FAIL: Model pins missing"
  $OCX_BIN oc -p work run "echo hello"
  ```
- [ ] **Expected:** Profile instructions loaded last (highest priority)
- [ ] **Verify:** Profile AGENTS.md overrides project
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 13.11 Local vs Global Profile Distinction

#### Test: Default creates local profile
- [ ] **Setup:** In a project directory with `.opencode/` initialized
- [ ] **Commands:**
  ```bash
  # Cleanup: remove test-local profile from prior runs to avoid collisions
  rm -rf .opencode/profiles/test-local $XDG_CONFIG_HOME/opencode/profiles/test-local
  $OCX_BIN profile add test-local
  ```
- [ ] **Expected:** Creates local profile at `.opencode/profiles/test-local/`
- [ ] **Verify:**
  ```bash
  ls .opencode/profiles/test-local/  # Should exist
  ls $XDG_CONFIG_HOME/opencode/profiles/test-local/  # Should NOT exist
  ```

#### Test: --global creates global profile
- [ ] **Setup:** Global config initialized
- [ ] **Commands:**
  ```bash
  # Cleanup: remove test-global profile from prior runs to avoid collisions
  rm -rf .opencode/profiles/test-global $XDG_CONFIG_HOME/opencode/profiles/test-global
  $OCX_BIN profile add test-global --global
  ```
- [ ] **Expected:** Creates global profile at `$XDG_CONFIG_HOME/opencode/profiles/test-global/`
- [ ] **Verify:**
  ```bash
  ls $XDG_CONFIG_HOME/opencode/profiles/test-global/  # Should exist
  ls .opencode/profiles/test-global/  # Should NOT exist
  ```

#### Test: ocx profile list shows only global profiles
- [ ] **Setup:** Both local and global profiles exist
- [ ] **Command:** `$OCX_BIN profile list --global`
- [ ] **Expected:** Shows only global profiles, not local ones
- [ ] **Verify:** Local profile name should NOT appear in list

#### Test: Profile merging when both global and local exist
- [ ] **Setup:** Create both global and local profiles with same name
- [ ] **Commands:**
  ```bash
  # Cleanup: remove test profile from prior runs to avoid collisions
  rm -rf .opencode/profiles/test $XDG_CONFIG_HOME/opencode/profiles/test
  $OCX_BIN init --global
  $OCX_BIN profile add test --global
  # Add to global profile ocx.jsonc: {"registries": {"global-reg": {"url": "https://global.com"}}}
  echo '{"registries": {"global-reg": {"url": "https://global.com"}}}' > $XDG_CONFIG_HOME/opencode/profiles/test/ocx.jsonc

  cd /tmp/ocx-v2-test-project
  # Idempotent: init only if local config does not exist (sequential runs)
  test -f .opencode/ocx.jsonc || $OCX_BIN init
  # Clear any lingering local profile override from earlier sections (local config wins over -p)
  echo '{}' > .opencode/ocx.jsonc
  $OCX_BIN profile add test  # Local with same name (local is default)
  # Verify local profile directory exists before writing
  test -d .opencode/profiles/test && echo "OK: Local profile directory exists" || echo "FAIL: Local profile directory missing"
  # Add to local profile ocx.jsonc: {"registries": {"local-reg": {"url": "https://local.com"}}}
  echo '{"registries": {"local-reg": {"url": "https://local.com"}}}' > .opencode/profiles/test/ocx.jsonc

  $OCX_BIN config show -p test
  ```
- [ ] **Expected:** Both registries appear in merged config
- [ ] **Verify:**
  - Config contains both `global-reg` and `local-reg`
  - Deep merge occurred (not simple replacement)

---

## 14. Error Path Tests

Common errors from CLI.md error tables.

### 14.1 Error: No ocx.jsonc Found (Init)

- [ ] **Setup:** Empty directory, no config
- [ ] **Command:** `$OCX_BIN add kdco/researcher`
- [ ] **Expected:** Error: "No ocx.jsonc found"
- [ ] **Verify:** Exit code 78 (CONFIG error)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.2 Error: Registry Not Found

- [ ] **Setup:** Config initialized, registry not configured
- [ ] **Command:** `$OCX_BIN add unknown/component`
- [ ] **Expected:** Error: "Registry not found"
- [ ] **Verify:** Exit code 66 (NOT_FOUND)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.3 Error: Component Not Installed (Update)

- [ ] **Setup:** Config initialized, component not installed
- [ ] **Command:** `$OCX_BIN update kdco/researcher`
- [ ] **Expected:** Error: "Component 'kdco/researcher' is not installed"
- [ ] **Verify:** Exit code 66 (NOT_FOUND)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.4 Error: File Conflict (Add)

- [ ] **Setup:** Fresh environment, local config initialized, kdco registry added, component installed once
- [ ] **Commands:**
  ```bash
  # Idempotent: init only if local config does not exist (sequential runs)
  test -f .opencode/ocx.jsonc || $OCX_BIN init
  # Idempotent: add registry only if not already configured
  $OCX_BIN registry list | grep -q "kdco" || $OCX_BIN registry add http://localhost:8787 --name kdco
  # Idempotent: install component only if not already installed
  $OCX_BIN search --installed | grep -q "kdco/researcher" || $OCX_BIN add kdco/researcher
  # Modify installed file to create conflict
  echo "// modified" >> .opencode/agents/researcher.md
  # Attempt to re-add to trigger conflict error
  $OCX_BIN add kdco/researcher
  ```
- [ ] **Expected:** Error: "File conflicts detected"
- [ ] **Verify:** Exit code 6 (CONFLICT)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.5 Error: Registry Already Exists (Add Registry)

- [ ] **Setup:** Registry configured (ensure kdco exists before conflict test)
- [ ] **Commands:**
  ```bash
  # Idempotent: ensure kdco registry exists first
  $OCX_BIN registry list | grep -q "kdco" || $OCX_BIN registry add http://localhost:8787 --name kdco
  # Attempt to add conflicting registry with same alias
  $OCX_BIN registry add http://localhost:8788 --name kdco
  ```
- [ ] **Expected:** Error: "Registry 'kdco' already exists"
- [ ] **Verify:** Exit code 6 (CONFLICT)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.6 Error: Invalid Version Specifier (Update)

- [ ] **Setup:** Component installed
- [ ] **Command:** `$OCX_BIN update kdco/researcher@`
- [ ] **Expected:** Error: "Invalid version specifier"
- [ ] **Verify:** Exit code 78 (CONFIG)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.7 Error: Mutually Exclusive Options (Update)

- [ ] **Setup:** Components installed
- [ ] **Command:** `$OCX_BIN update --all --registry kdco`
- [ ] **Expected:** Error: "Cannot use --all with --registry"
- [ ] **Verify:** Exit code 1 (GENERAL)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.8 Error: Profile Not Found (Move)

- [ ] **Setup:** Profiles initialized
- [ ] **Command:** `$OCX_BIN profile move nonexistent new-name`
- [ ] **Expected:** Error: "Profile 'nonexistent' not found"
- [ ] **Verify:** Exit code 66 (NOT_FOUND)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.9 Error: Profile Already Exists (Move)

- [ ] **Setup:** Multiple global profiles exist
- [ ] **Commands:**
  ```bash
  $OCX_BIN profile add work --global
  $OCX_BIN profile add client --global
  $OCX_BIN profile move work client --global
  ```
- [ ] **Expected:** Error: "Cannot move: profile 'client' already exists"
- [ ] **Verify:** Exit code 6 (CONFLICT)
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

### 14.10 Error: Integrity Check Failed

- [ ] **Setup:** Component installed with mismatched hash
- [ ] **Commands:**
  ```bash
  # Manually corrupt hash in receipt, then verify
  $OCX_BIN verify kdco/researcher
  ```
- [ ] **Expected:** Error: "Integrity check failed"
- [ ] **Verify:**
  - Command fails with integrity check error
  - Exit code 6 (CONFLICT)
- [ ] **Note:** `ocx update` behavior is separate from integrity verification; use `verify` to explicitly check component integrity
- [ ] **Last tested:** _vX.X.X on YYYY-MM-DD_

---

## 15. Verification Checklist

Master summary for full test sessions.

### 15.1 All README Commands Verified

- [ ] Quick Start Profiles (Section 2): 6 test cases
- [ ] Quick Start Components (Section 3): 4 test cases

### 15.2 All CLI.md Commands Verified

- [ ] ocx init (Section 4): 8 test cases
- [ ] ocx add (Section 5): 11 test cases
- [ ] ocx update (Section 6): 9 test cases
- [ ] ocx search (Section 7): 7 test cases
- [ ] ocx registry (Section 8): 11 test cases
- [ ] ocx build (Section 9): 4 test cases
- [ ] ocx profile (Section 10): 17 test cases
- [ ] ocx config (Section 11): 7 test cases
- [ ] ocx opencode (Section 12): 12 test cases

### 15.3 Profile System Verified

- [ ] Profile Layering (Section 13): 8 test cases

### 15.4 Error Paths Verified

- [ ] Common Errors (Section 14): 10 test cases

### 15.5 Documentation Sync

- [ ] All README examples tested
- [ ] All CLI.md examples tested
- [ ] All PROFILES.md examples tested
- [ ] Error exit codes verified
- [ ] JSON output formats verified

---

## 16. Sync Checklist

For maintainability when commands change.

### 16.1 When to Update This Document

- [ ] New command added to CLI
- [ ] New option added to existing command
- [ ] Command behavior changes
- [ ] Error handling changes
- [ ] Before major releases
- [ ] After significant refactoring

### 16.2 Cross-Reference Links

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
| Section 10 | [CLI.md](./CLI.md) | 1024-1273 |
| Section 11 | [CLI.md](./CLI.md) | 1276-1381 |
| Section 12 | [CLI.md](./CLI.md) | 1383-1509 |
| Section 13 | [PROFILES.md](./PROFILES.md) | Full document |
| Section 14 | [CLI.md](./CLI.md) | Error tables throughout |

### 16.3 Version Tracking

- [ ] Update `ocx_version` in metadata after testing
- [ ] Update `last_full_test` date when complete session finishes
- [ ] Note platform tested (macOS, Linux)
- [ ] Track any skipped tests and reasons

### 16.4 Automated Test Coverage

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
5. Update Section 15 verification checklist
6. Update Section 16 sync checklist with cross-references

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
