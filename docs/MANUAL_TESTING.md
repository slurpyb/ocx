---
last_full_test: 2026-02-12
ocx_version: 2.0.0
platform: macOS
---

# Manual Testing Guide

Comprehensive manual testing checklist for all documented OCX functionality.

> **Pre-Release Testing:** This guide uses locally built registries served via
> `wrangler dev` (`localhost:8787`, `localhost:8788`) for tests that depend on
> live component/profile registry responses. Sections **4.5–4.8** are scaffold-only
> `ocx init --registry` tests and do **not** require the local registries to be
> running. After release, you can optionally verify registry-dependent sections
> against production URLs.
>
> **Pre-Release Registry Scaffolding Mapping:** For unreleased versions,
> `ocx init --registry` validation should use:
> - Sections **4.5–4.7**: `--local "$OCX_REPO/examples/registry-starter"`
> - Section **4.8**: `--canary`

## Overview

This document provides a complete testing checklist for OCX. Use it to verify functionality before releases or when making significant changes.

### Purpose

- **QA Sessions**: Step through tests systematically
- **Regression Testing**: Verify changes don't break existing functionality
- **Release Validation**: Complete smoke test before shipping
- **Documentation Sync**: Ensure documented behavior matches implementation

### How to Use

1. Set up the sandbox environment (see Section 1)
2. Work through sections sequentially by default; if a section is marked as an
   alternative/reset point, follow that note and then continue in order
3. Check off boxes as you complete tests
4. Note failures or unexpected behavior
5. Update `last_full_test` metadata when complete
6. Reset checkboxes between test sessions

> **Testing Coverage**: For automated coverage details, see `packages/cli/tests/`.

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

**REQUIRED FOR REGISTRY-DEPENDENT TESTS:** Both registries MUST be running before
sections that resolve/install components or profiles from local registries
(for example Sections 2, 3, and 5+). **Exception:** scaffold-only init tests in
Sections 4.5–4.8 can run without live local registries.

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

**CRITICAL:** Keep both terminals running while executing registry-dependent
sections (for example Sections 2, 3, and 5+). Sections 4.5–4.8 are scaffold-only
exceptions and do not require running registries. If a required server dies,
restart it before continuing registry-dependent tests.

**Verify registries are accessible:**
```bash
curl http://localhost:8787/index.json | head -5
curl http://localhost:8788/index.json | head -5
```

Both curl commands must return JSON output. If either fails, the corresponding
registry server is not running—start it before proceeding.

- [x] **Run result (2026-02-23):** PASS — `curl http://localhost:8787/index.json | head -5` and `curl http://localhost:8788/index.json | head -5` both returned JSON after restarting local registries.

### 1.1 Create Isolated Environment

- [x] **Setup:** Clean slate for testing
- [x] **Commands:**
  ```bash
  export XDG_CONFIG_HOME=/tmp/ocx-v2-test
  mkdir -p /tmp/ocx-v2-test-project
  cd /tmp/ocx-v2-test-project
  git init
  ```
- [x] **Expected:** Environment variables set, test project directory created

### Preflight Checklist

Run these **core checks** before each major section to verify your environment:

```bash
echo $XDG_CONFIG_HOME           # Should show /tmp/ocx-v2-test
test -f "$OCX_BIN" && echo "OK: Binary exists" || echo "FAIL: Binary not found"
$OCX_BIN --version              # Should show current dev version
$OCX_BIN profile rm --help | grep -q '\-\-global' && echo "OK: Help works" || echo "FAIL: Help error"
```

**Registry Health Check (registry-dependent sections only):**
```bash
curl -sf http://localhost:8787/index.json > /dev/null && echo "OK: KDCO registry (8787)" || echo "FAIL: KDCO registry not running"
curl -sf http://localhost:8788/index.json > /dev/null && echo "OK: Kit registry (8788)" || echo "FAIL: Kit registry not running"
```

Core checks must pass before proceeding.

Run the registry health check only before sections that depend on live registry
responses (for example Sections 2, 3, and 5+). For scaffold-only tests in
Sections 4.5–4.8, you may skip the registry health check.

If a required registry check fails, restart the corresponding server now before
continuing registry-dependent tests.

> **REMINDER:** If a registry server died during testing, restart it with `bun run dev`
> (port 8787 for KDCO, port 8788 for Kit) before resuming tests.

### Verify Dev Build

Confirm the dev build is being used:

```bash
$OCX_BIN --version
# Should match package.json version (e.g., 0.5.0)
```

If the version does not match the current codebase, verify `$OCX_BIN` points to the correct path.

- [x] **Verify:**
  ```bash
  echo $XDG_CONFIG_HOME           # Should show /tmp/ocx-v2-test
  test -f "$OCX_BIN" && echo "OK: Binary exists"
  $OCX_BIN --version              # Should show current dev version
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 1.2 Cleanup Between Test Sections

- [x] **Setup:** Reset state between sections
- [x] **Commands:**
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
- [x] **Expected:** Fresh environment for next test section
- [x] **Verify:** Directories recreated, git initialized, XDG isolation active
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 1.3 Complete Teardown

- [ ] **Setup:** After all tests complete
- [ ] **Commands:**
  ```bash
  unset XDG_CONFIG_HOME
  rm -rf /tmp/ocx-v2-test /tmp/ocx-v2-test-project
  ```
- [ ] **Expected:** Environment cleaned up
- [ ] **Verify:** No leftover test artifacts
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 1.4 Stop Local Registry Servers

- [x] **Setup:** When done testing
- [x] **Action:** Stop the wrangler dev servers
- [x] **Commands:**
  1. Go to each terminal running `wrangler dev`
  2. Press `Ctrl+C` to stop the server
- [ ] **Verify:** Servers no longer accessible
- [x] **Run result (2026-02-23):** FAIL — stop sequence was attempted, but at least
  one registry endpoint remained reachable during verification; rerun stop+verify
  before closing the session.
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

---

## 2. README: Quick Start Profiles

Test cases from README.md lines 34-53.

### 2.1 `ocx init --global`

- [x] **Setup:** Fresh sandbox (Section 1.1)
- [x] **Command:** `$OCX_BIN init --global`
- [x] **Expected:** Creates `~/.config/opencode/` with global config and default profile
- [x] **Verify:**
  ```bash
  ls -la $XDG_CONFIG_HOME/opencode/
  ls -la $XDG_CONFIG_HOME/opencode/profiles/default/
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc
  cat $XDG_CONFIG_HOME/opencode/profiles/default/ocx.jsonc
  cat $XDG_CONFIG_HOME/opencode/profiles/default/opencode.jsonc
  cat $XDG_CONFIG_HOME/opencode/profiles/default/AGENTS.md
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 2.2 `ocx profile add work` (Manual Creation)

> **Note:** Sections 2.2 and 2.4 are **alternative paths**. Choose ONE:
> - **2.2**: Create profile manually from template
> - **2.4**: Install profile from registry
>
> If running both sequentially, remove the profile first:
> ```bash
> $OCX_BIN profile rm work --global
> ```

- [x] **Setup:** Global profiles initialized (Section 2.1)
- [x] **Commands:**
  ```bash
  $OCX_BIN profile add work --global
  # Pin to free Zen model for manual testing
  echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle"}' > $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc
  ```
- [x] **Expected:** Creates new profile `work` with template files and model pins
- [x] **Verify:**
  ```bash
   $OCX_BIN profile list --global  # Should show: default, work
  ls -la $XDG_CONFIG_HOME/opencode/profiles/work/
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc  # Should contain model pins
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 2.3 Add Global Registry

- [x] **Setup:** Profiles initialized (Section 2.1)
- [x] **Command:** `$OCX_BIN registry add http://localhost:8788 --name kit --global`
- [x] **Expected:** Adds registry to global config
- [x] **Verify:**
  ```bash
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc  # Should contain kit registry
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 2.5 Launch OpenCode with Profile

- [x] **Setup:** Work profile exists with model pins (Section 2.2 OR 2.4 — complete one of them first)
- [x] **Commands:**
  ```bash
  cd /tmp/ocx-v2-test-project
  # Verify model pins are set before running
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc | grep -q "opencode/big-pickle" && echo "OK: Model pins verified" || echo "FAIL: Model pins missing"
  $OCX_BIN oc -p work run "echo hello"
  ```
- [x] **Expected:** OpenCode runs with work profile and free Zen model, executes command
- [x] **Verify:** Command output shows "hello"
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 2.6 Set Default Profile via Environment

- [x] **Setup:** Work profile exists with model pins (Section 2.2 OR 2.4 — complete one of them first)
- [x] **Commands:**
  ```bash
  # Verify model pins are set before running
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc | grep -q "opencode/big-pickle" && echo "OK: Model pins verified" || echo "FAIL: Model pins missing"
  export OCX_PROFILE=work
  $OCX_BIN oc run "echo hello"
  ```
- [x] **Expected:** Uses work profile automatically without `-p` flag
- [x] **Verify:** Command executes successfully
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

---

## 3. README: Quick Start Components

Test cases from README.md lines 79-96.

### 3.1 `ocx init` (Local)

- [x] **Setup:** Fresh test project directory
- [x] **Command:** `$OCX_BIN init`
- [x] **Expected:** Creates `.opencode/` directory with config files
- [x] **Verify:**
  ```bash
  ls -la .opencode/
  cat .opencode/ocx.jsonc
  cat .opencode/opencode.jsonc
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

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

- [x] **Setup:** Local config initialized (Section 3.1)
- [x] **Command:** `$OCX_BIN add kdco/workspace --from http://localhost:8787`
- [x] **Expected:** Installs component without saving registry
- [x] **Verify:**
  ```bash
  ls .opencode/  # Should contain workspace files
  cat .ocx/receipt.jsonc  # Should list kdco/workspace
  cat .opencode/ocx.jsonc  # Should NOT contain registry.kdco.dev
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 3.4 Add Registry Permanently (Local)

- [x] **Setup:** Local config initialized (Section 3.1)
- [x] **Commands:**
  ```bash
  $OCX_BIN registry add http://localhost:8787 --name kdco
  $OCX_BIN add kdco/workspace
  ```
- [x] **Expected:** Registry saved to config, component installed
- [x] **Verify:**
  ```bash
  cat .opencode/ocx.jsonc  # Should contain kdco registry
  $OCX_BIN registry list  # Should show kdco
  ls .opencode/  # Should contain workspace files
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

---

## 4. CLI Reference: ocx init

All variations from CLI.md lines 53-91.

### 4.1 `ocx init` (Default Local)

- [x] **Setup:** Fresh test project directory
- [x] **Command:** `$OCX_BIN init`
- [x] **Expected:** Creates `.opencode/` with default config
- [x] **Verify:**
  ```bash
  ls .opencode/
  cat .opencode/ocx.jsonc
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 4.2 `ocx init --global`

- [x] **Setup:** Fresh sandbox
- [x] **Command:** `$OCX_BIN init --global`
- [x] **Expected:** Creates `~/.config/opencode/` and default profile
- [x] **Verify:**
  ```bash
  ls $XDG_CONFIG_HOME/opencode/
  ls $XDG_CONFIG_HOME/opencode/profiles/default/
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 4.3 `ocx init` (Default Behavior)

- [x] **Setup:** Test project directory
- [x] **Command:** `$OCX_BIN init`
- [x] **Expected:** Creates config with defaults, no prompts required
- [x] **Verify:** `.opencode/` created with defaults
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 4.4 `ocx init` (Error on Existing Local Config)

- [x] **Setup:** Local config already exists (run Section 4.1 or 4.3 first)
- [x] **Command:** `$OCX_BIN init`
- [x] **Expected:** Fails with error (config already exists)
- [x] **Verify:** Error message indicates `ocx.jsonc` already exists
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 4.5 `ocx init --registry <path>` (Registry Scaffold Only, Local Template)

- [x] **Setup:** Parent directory and local template path available
- [x] **Commands:**
  ```bash
  cd /tmp
  $OCX_BIN init --registry ./ocx-test-registry --namespace my-org --local "$OCX_REPO/examples/registry-starter"
  ```
- [x] **Expected:** Creates registry project at specified path using local template scaffold
- [x] **Verify:**
  ```bash
  ls ./ocx-test-registry/
  cat ./ocx-test-registry/registry.jsonc
  rm -rf ./ocx-test-registry
  cd /tmp/ocx-v2-test-project
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 4.6 `ocx init --registry` (Scaffold Registry)

- [x] **Setup:** Empty directory for registry
- [x] **Command:** `$OCX_BIN init --registry my-registry --namespace my-org --local "$OCX_REPO/examples/registry-starter"`
- [x] **Expected:** Scaffolds complete registry project from local template
- [x] **Verify:**
  ```bash
  ls my-registry/
  cat my-registry/registry.jsonc
  rm -rf my-registry
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 4.7 `ocx init --registry` with Author

- [x] **Setup:** Empty directory
- [x] **Command:** `$OCX_BIN init --registry my-registry --namespace acme --author "Acme Corp" --local "$OCX_REPO/examples/registry-starter"`
- [x] **Expected:** Scaffolds registry with custom author from local template
- [x] **Verify:**
  ```bash
  cat my-registry/registry.jsonc  # Should contain author field
  rm -rf my-registry
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 4.8 `ocx init --registry --canary`

- [x] **Setup:** Empty directory
- [x] **Command:** `$OCX_BIN init --registry my-registry --canary --namespace test --verbose 2>&1 | tee /tmp/ocx-4.8-canary-verbose.log`
- [x] **Expected:** Uses canary template fetched from remote main-branch source
- [x] **Verify:**
  ```bash
  # Verbose output must include the exact canary fetch URL from GitHub main
  ls my-registry/
  rg -n 'https://github\.com/kdcokenny/ocx/archive/refs/heads/main\.tar\.gz' /tmp/ocx-4.8-canary-verbose.log
  rm -rf my-registry
  ```
- [x] **Run result (2026-02-23):** PASS — verbose output included `https://github.com/kdcokenny/ocx/archive/refs/heads/main.tar.gz`, confirming remote canary fetch path.
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

---

## 5. CLI Reference: ocx add

All variations from CLI.md lines 94-147.

> **Section Setup:** Run cleanup (Section 1.2) before starting this section to ensure
> no existing local config or cwd state interferes with `init` commands.

### 5.1 Add Registry Component (Fully Qualified)

- [x] **Setup:** Local config with registry configured
- [x] **Commands:**
  ```bash
  $OCX_BIN init
  $OCX_BIN registry add http://localhost:8787 --name kdco
  $OCX_BIN add kdco/researcher
  ```
- [x] **Expected:** Component installed to `.opencode/`
- [x] **Verify:**
  ```bash
  ls .opencode/
  cat .ocx/receipt.jsonc  # Should list kdco/researcher
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

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

- [x] **Setup:** Fresh local config (NO registry configured)
  ```bash
  $OCX_BIN init
  # Do NOT run registry add - the --from flag provides ephemeral access
  ```
- [x] **Command:** `$OCX_BIN add kdco/workspace --from http://localhost:8787`
- [x] **Expected:** Installs component without saving registry to config
- [x] **Verify:**
  ```bash
  cat .opencode/ocx.jsonc  # Should NOT contain kdco registry
  cat .ocx/receipt.jsonc  # Should list kdco/workspace component
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 5.3 Add with Specific Profile

- [x] **Setup:** Create `work` profile and configure `kdco` registry at profile scope
  ```bash
  # Ensure global profiles are initialized
  $OCX_BIN init --global 2>/dev/null || true
  # Idempotent: remove work profile if it exists from prior runs
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile add work --global
  # Write kdco registry into the profile's ocx.jsonc (profile-scoped)
  echo '{"registries": {"kdco": {"url": "http://localhost:8787"}}}' > $XDG_CONFIG_HOME/opencode/profiles/work/ocx.jsonc
  ```
- [x] **Verify setup:** Profile has kdco registry at profile scope
  ```bash
  cat $XDG_CONFIG_HOME/opencode/profiles/work/ocx.jsonc | grep -q '"kdco"' && echo "OK: kdco registry in profile" || echo "FAIL: kdco registry missing from profile"
  ```
- [x] **Command:** `$OCX_BIN add kdco/researcher --profile work`
- [x] **Expected:** Uses profile's registry for resolution; component installed to profile directory
- [x] **Verify:**
  ```bash
  ls $XDG_CONFIG_HOME/opencode/profiles/work/  # Should contain installed component files
  cat $XDG_CONFIG_HOME/opencode/profiles/work/.ocx/receipt.jsonc  # V1 receipt: Should list kdco/researcher
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 5.4 Add npm Plugin (Unscoped)

- [x] **Setup:** Local config initialized
- [x] **Command:** `$OCX_BIN add npm:chalk`
- [x] **Expected:** Plugin entry added to `.opencode/opencode.jsonc` plugin array; runtime installation handled by OpenCode
- [x] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain "chalk" in "plugin" array
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 5.5 Add npm Plugin (`opencode-pty`)

- [x] **Setup:** Local config initialized
- [x] **Command:** `$OCX_BIN add npm:opencode-pty`
- [x] **Expected:** Plugin entry for `opencode-pty` added to `.opencode/opencode.jsonc` plugin array; runtime installation handled by OpenCode
- [x] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain "opencode-pty" in "plugin" array
  ```
- [x] **Run result (2026-02-23):** PASS — `$OCX_BIN add npm:opencode-pty` succeeded and `.opencode/opencode.jsonc` contains `opencode-pty` in the `plugin` array.
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 5.6 Add npm Plugin with Version

> **Note:** This test is independent of Section 5.5 and can run sequentially.
> If this exact versioned plugin entry already exists from a prior run, reset with
> Section 1.2 before re-running 5.6.

- [x] **Setup:** Local config initialized
- [x] **Command:** `$OCX_BIN add npm:@franlol/opencode-md-table-formatter@0.0.3`
- [x] **Expected:** Plugin entry added to `.opencode/opencode.jsonc`; runtime installation handled by OpenCode
- [x] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain "@franlol/opencode-md-table-formatter@0.0.3" in "plugin" array
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 5.7 Add Multiple Components

- [x] **Setup:** Registry configured
- [x] **Command:** `$OCX_BIN add kdco/researcher kdco/code-philosophy kdco/notify`
- [x] **Expected:** Installs all three components
- [x] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Should list all three
  ls .opencode/
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 5.8 Add with `--dry-run`

> **Note:** Uses `kdco/workspace` (not installed in Section 5.7) to ensure
> deterministic behavior in sequential test runs.

- [x] **Setup:** Registry configured
- [x] **Command:** `$OCX_BIN add kdco/workspace --dry-run`
- [x] **Expected:** Shows what would be installed without making changes
- [x] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Should NOT list kdco/workspace (dry-run makes no changes)
  ls .opencode/  # Should NOT contain workspace component files
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 5.9 Add with `--trust` (Bypass Plugin Validation)

- [x] **Setup:** Local config initialized
- [x] **Command:** `$OCX_BIN add npm:lodash --trust`
- [x] **Expected:** Skips ESM plugin validation and adds package entry anyway
- [x] **Verify:**
  ```bash
  cat .opencode/opencode.jsonc  # Should contain "lodash" in "plugin" array
  ```
- [x] **Note:** This specifically tests trust-bypass behavior for non-ESM packages.
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 5.10 Add with `--json` Output

- [x] **Setup:** Registry configured
- [x] **Command:** `$OCX_BIN add kdco/researcher --json`
- [x] **Expected:** Outputs machine-readable JSON
- [x] **Verify:** Output is valid JSON
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 5.11 Add with `--verbose`

- [x] **Setup:** Registry configured
- [x] **Command:** `$OCX_BIN add kdco/researcher --verbose`
- [x] **Expected:** Shows detailed file operations
- [x] **Verify:** Verbose output includes file paths
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

---

## 6. CLI Reference: ocx update

All variations from CLI.md lines 195-244.

### 6.1 Update Specific Component

> **Note:** Component must be installed first. Complete Section 5.1, or run:
> ```bash
> $OCX_BIN init
> $OCX_BIN registry add http://localhost:8787 --name kdco
> $OCX_BIN add kdco/researcher
> ```

- [x] **Setup:** Component installed (Section 5.1)
- [x] **Command:** `$OCX_BIN update kdco/researcher`
- [x] **Expected:** Updates to latest version
- [x] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Version should update
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 6.2 Update Multiple Components

- [x] **Setup:** Multiple components installed
- [x] **Command:** `$OCX_BIN update kdco/researcher kdco/notify`
- [x] **Expected:** Updates both components
- [x] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Both versions updated
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 6.3 Update All Components (`--all`)

- [x] **Setup:** Multiple components installed
- [x] **Command:** `$OCX_BIN update --all`
- [x] **Expected:** Updates all installed components
- [x] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # All versions updated
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 6.4 Update All with `--dry-run`

- [x] **Setup:** Components installed
- [x] **Command:** `$OCX_BIN update --all --dry-run`
- [x] **Expected:** Shows what would be updated without applying
- [x] **Verify:**
  ```bash
  # Output should list pending updates
  cat .ocx/receipt.jsonc  # Versions should NOT change
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 6.5 Update by Registry (`--registry`)

- [x] **Setup:** Components from multiple registries installed
- [x] **Command:** `$OCX_BIN update --registry kdco`
- [x] **Expected:** Updates only kdco components
- [x] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Only kdco components updated
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 6.6 Update with `--json` Output

- [x] **Setup:** Component installed
- [x] **Command:** `$OCX_BIN update kdco/researcher --json`
- [x] **Expected:** Machine-readable JSON output
- [x] **Verify:** Output is valid JSON
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 6.7 Update with `--verbose`

- [x] **Setup:** Component installed
- [x] **Command:** `$OCX_BIN update kdco/researcher --verbose`
- [x] **Expected:** Detailed file change information
- [x] **Verify:** Verbose output shows file operations
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

---

## 7. CLI Reference: ocx search

All variations from CLI.md lines 247-320.

### 7.1 Search All Available Components

- [x] **Setup:** Registry configured
- [x] **Command:** `$OCX_BIN search`
- [x] **Expected:** Lists all components from configured registries
- [x] **Verify:** Output shows component list
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 7.2 Search with Query

- [x] **Setup:** Registry configured
- [x] **Command:** `$OCX_BIN search agent`
- [x] **Expected:** Lists components matching "agent"
- [x] **Verify:** Results filtered by query
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 7.3 Search with Higher Limit

- [x] **Setup:** Registry configured
- [x] **Command:** `$OCX_BIN search agents --limit 50`
- [x] **Expected:** Shows up to 50 results
- [x] **Verify:** Limit respected in output
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 7.4 List Installed Components Only

- [x] **Setup:** Components installed
- [x] **Command:** `$OCX_BIN search --installed`
- [x] **Expected:** Shows only installed components with versions
- [x] **Verify:**
  ```bash
  # Output should match receipt.jsonc contents
  cat .ocx/receipt.jsonc
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 7.5 Search with `--json` Output

- [x] **Setup:** Registry configured
- [x] **Command:** `$OCX_BIN search --json`
- [x] **Expected:** Machine-readable JSON component list
- [x] **Verify:** Output is valid JSON
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 7.6 Search with `--verbose`

- [x] **Setup:** Registry configured
- [x] **Command:** `$OCX_BIN search agents --verbose`
- [x] **Expected:** Detailed component information including registry details
- [x] **Verify:** Verbose output shows extended metadata
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 7.7 Search Alias: `ocx list`

- [x] **Setup:** Registry configured
- [x] **Command:** `$OCX_BIN list`
- [x] **Expected:** Same output as `ocx search`
- [x] **Verify:** Lists all components
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

---

## 8. CLI Reference: ocx registry

All subcommands from CLI.md lines 362-556.

> **Section Setup:** Run cleanup (Section 1.2) before starting this section to ensure
> no existing `kdco` registry from earlier sections interferes with these tests.

### 8.1 `ocx registry add` (Local)

> **Note:** If you ran Sections 3.4 or 5.1 earlier, the `kdco` registry already exists.
> Either run Section 1.2 cleanup first, or remove the existing registry:
> ```bash
> $OCX_BIN registry remove kdco
> ```

- [x] **Setup:** Local config initialized, `kdco` registry does NOT exist
- [x] **Command:** `$OCX_BIN registry add http://localhost:8787 --name kdco`
- [x] **Expected:** Registry added with name "kdco"
- [x] **Verify:**
  ```bash
  $OCX_BIN registry list  # Should show kdco
  cat .opencode/ocx.jsonc  # Should contain registry
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 8.2 `ocx registry add --global`

- [x] **Setup:** Global profiles initialized
- [x] **Command:** `$OCX_BIN registry add http://localhost:8787 --name kdco --global`
- [x] **Expected:** Registry added to global config
- [x] **Verify:**
  ```bash
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc  # Should contain kdco
  $OCX_BIN registry list --global  # Should show kdco
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 8.3 `ocx registry add` Duplicate URL Rejection

- [x] **Setup:** Registry already configured (run Section 8.1 first to add `kdco` registry)
- [x] **Command:** `$OCX_BIN registry add http://localhost:8787 --name kdco2`
- [x] **Expected:** Fails with error (same URL cannot be added under a different name)
- [x] **Verify:**
  ```bash
  # Error message should indicate URL is already configured
  $OCX_BIN registry list  # Should show only 'kdco', not 'kdco2'
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 8.4 `ocx registry add` After Explicit Remove (Update Workflow)

- [x] **Setup:** Registry already configured (run Section 8.1 first to add `kdco` registry)
- [x] **Commands:**
  ```bash
  $OCX_BIN registry remove kdco
  $OCX_BIN registry add http://localhost:8787 --name kdco-new
  ```
- [x] **Expected:** Remove then add succeeds; registry now available under new name
- [x] **Verify:**
  ```bash
  $OCX_BIN registry list  # Should show 'kdco-new', not 'kdco'
  cat .opencode/ocx.jsonc  # Should contain kdco-new registry
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 8.5 `ocx registry add` with `--json` Output

> **Note:** Alternative to Section 8.1. If that already ran, `kdco` registry
> already exists. Either skip this test, remove the registry first
> (`$OCX_BIN registry remove kdco`), or use a different name.

- [x] **Setup:** Local config initialized
- [x] **Command:** `$OCX_BIN registry add http://localhost:8787 --name kdco --json`
- [x] **Expected:** Machine-readable JSON confirmation
- [x] **Verify:** Output is valid JSON
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 8.6 `ocx registry remove` (Local)

- [x] **Setup:** Registry configured locally
- [x] **Command:** `$OCX_BIN registry remove kdco`
- [x] **Expected:** Registry removed from local config
- [x] **Verify:**
  ```bash
  $OCX_BIN registry list  # Should NOT show kdco
  cat .opencode/ocx.jsonc  # Should NOT contain kdco
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 8.7 `ocx registry remove --global`

- [x] **Setup:** Registry configured globally
- [x] **Command:** `$OCX_BIN registry remove kdco --global`
- [x] **Expected:** Registry removed from global config
- [x] **Verify:**
  ```bash
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc  # Should NOT contain kdco
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 8.8 `ocx registry list` (Local)

- [x] **Setup:** Registries configured locally
- [x] **Command:** `$OCX_BIN registry list`
- [x] **Expected:** Lists local registries
- [x] **Verify:** Output matches `.opencode/ocx.jsonc` content
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 8.9 `ocx registry list --global`

- [x] **Setup:** Registries configured globally
- [x] **Command:** `$OCX_BIN registry list --global`
- [x] **Expected:** Lists global registries
- [x] **Verify:** Output matches global config
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 8.10 `ocx registry list --json`

- [x] **Setup:** Registries configured
- [x] **Command:** `$OCX_BIN registry list --json`
- [x] **Expected:** Machine-readable JSON with registry list
- [x] **Verify:** Output is valid JSON
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

---

## 9. CLI Reference: ocx build

All variations from CLI.md lines 559-645.

### 9.1 Build Registry in Current Directory

- [x] **Setup:** Registry source directory with `registry.jsonc`
- [x] **Commands:**
  ```bash
  # Create test registry structure
  mkdir -p /tmp/test-registry/files/agent
  echo '{"name": "test-registry", "version": "1.0.0", "namespace": "test", "author": "Test Author", "components": []}' > /tmp/test-registry/registry.jsonc
  cd /tmp/test-registry
  $OCX_BIN build
  ```
- [x] **Expected:** Builds to `./dist/`
- [x] **Verify:**
  ```bash
  ls ./dist/
  rm -rf /tmp/test-registry
  cd /tmp  # Return to safe directory after deleting cwd
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 9.2 Build from Specific Directory

> **Note:** Section 9.1 deletes `/tmp/test-registry` and changes to `/tmp`. Ensure you are in a safe directory and recreate:
> ```bash
> cd /tmp
> mkdir -p /tmp/test-registry/files/agent
> echo '{"name": "test-registry", "version": "1.0.0", "namespace": "test", "author": "Test Author", "components": []}' > /tmp/test-registry/registry.jsonc
> ```

- [x] **Setup:** Registry source directory (recreate if needed)
- [x] **Command:** `$OCX_BIN build /tmp/test-registry`
- [x] **Expected:** Builds registry from specified path to `./dist/` in current working directory
- [x] **Verify:**
  ```bash
  ls ./dist/  # Output is relative to cwd, not the source directory
  rm -rf ./dist
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 9.3 Build with Custom Output Directory

> **Note:** Section 9.1 deletes `/tmp/test-registry` and changes to `/tmp`. Ensure you are in a safe directory and recreate:
> ```bash
> cd /tmp
> mkdir -p /tmp/test-registry/files/agent
> echo '{"name": "test-registry", "version": "1.0.0", "namespace": "test", "author": "Test Author", "components": []}' > /tmp/test-registry/registry.jsonc
> ```

- [x] **Setup:** Registry source directory (recreate if needed)
- [x] **Command:** `$OCX_BIN build /tmp/test-registry --out ./public`
- [x] **Expected:** Builds to `./public/` instead of `./dist/`
- [x] **Verify:**
  ```bash
  ls ./public/
  rm -rf ./public
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 9.4 Build with `--json` Output

- [x] **Setup:** Registry source directory
- [x] **Command:** `$OCX_BIN build /tmp/test-registry --json`
- [x] **Expected:** Machine-readable JSON build summary
- [x] **Verify:** Output is valid JSON with component count
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

---

## 10. CLI Reference: ocx profile

All subcommands from CLI.md lines 933-1207.

### 10.1 `ocx profile list`

- [x] **Setup:** Global profiles initialized
- [x] **Command:** `$OCX_BIN profile list --global`
- [x] **Expected:** Lists all profiles (no active indicator)
- [x] **Verify:**
  ```bash
  # Output should show at least "default"
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.2 `ocx p ls` (Alias)

- [x] **Setup:** Global profiles initialized
- [x] **Command:** `$OCX_BIN p ls --global`
- [x] **Expected:** Same output as `ocx profile list`
- [x] **Verify:** Lists profiles
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.3 `ocx profile list --json`

- [x] **Setup:** Global profiles initialized
- [x] **Command:** `$OCX_BIN profile list --global --json`
- [x] **Expected:** Machine-readable JSON with profile list
- [x] **Verify:** Output is valid JSON
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.4 `ocx profile add work` (Empty Profile)

- [x] **Setup:** Global profiles initialized
- [x] **Commands:**
  ```bash
  $OCX_BIN profile add work --global
  # Pin to free Zen model for manual testing
  echo '{"model": "opencode/big-pickle", "small_model": "opencode/big-pickle"}' > $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc
  ```
- [x] **Expected:** Creates new global profile with template files and model pins
- [x] **Verify:**
  ```bash
  $OCX_BIN p ls --global  # Should show work
  ls $XDG_CONFIG_HOME/opencode/profiles/work/
  cat $XDG_CONFIG_HOME/opencode/profiles/work/opencode.jsonc  # Should contain model pins
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.5 `ocx profile add` Clone from Existing

- [x] **Setup:** Global profile "work" exists
- [x] **Command:** `$OCX_BIN profile add client-x --clone work --global`
- [x] **Expected:** Clones work profile to client-x
- [x] **Verify:**
  ```bash
  $OCX_BIN p ls --global  # Should show both work and client-x
  diff $XDG_CONFIG_HOME/opencode/profiles/work/ocx.jsonc \
       $XDG_CONFIG_HOME/opencode/profiles/client-x/ocx.jsonc
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.6 `ocx profile add` Install from Registry (Shorthand)

- [x] **Setup:** Local registry configured
- [x] **Command:** `$OCX_BIN profile add ws --source kit/ws --global`
- [x] **Expected:** Downloads profile from kit registry
- [x] **Verify:**
  ```bash
  $OCX_BIN p show ws --global
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.7 `ocx profile add` Install from URL

> **Note:** Uses a different profile name (`ws-alt`) than Section 10.6 (`ws`) so both
> tests can run sequentially without conflict.

- [x] **Setup:** None required
- [x] **Command:** `$OCX_BIN profile add ws-alt --source kit/ws --from http://localhost:8788 --global`
- [x] **Expected:** Downloads profile from ephemeral registry URL
- [x] **Verify:**
  ```bash
  $OCX_BIN p show ws-alt --global
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.8 `ocx profile add` (Remove and Add to Overwrite)

- [x] **Setup:** Profile "ws" already exists
- [x] **Commands:**
  ```bash
  $OCX_BIN profile remove ws --global
  $OCX_BIN profile add ws --source kit/ws --global
  ```
- [x] **Expected:** Removes and reinstalls profile
- [x] **Verify:**
  ```bash
  $OCX_BIN p show ws --global  # Should show fresh content
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.9 `ocx p add` (Alias)

- [x] **Setup:** Global profiles initialized
- [x] **Command:** `$OCX_BIN p add personal --global`
- [x] **Expected:** Creates new global profile (same as `profile add --global`)
- [x] **Verify:**
  ```bash
  $OCX_BIN p ls --global  # Should show personal
  ls $XDG_CONFIG_HOME/opencode/profiles/personal/
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.10 `ocx profile remove work` (Global)

- [x] **Setup:** Global profile "work" exists
- [x] **Commands:**
  ```bash
  # Idempotent: remove stale profile first to avoid sequential-run conflicts
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile add work --global  # Create global profile first
  $OCX_BIN profile remove work --global
  ```
- [x] **Expected:** Deletes global profile immediately (no confirmation)
- [x] **Verify:**
  ```bash
  ls $XDG_CONFIG_HOME/opencode/profiles/  # work/ should be gone
  ```
- [x] **Run result (2026-02-23):** PASS — idempotent pre-clean (`profile rm ... || true`) removed stale state, and `profile add` + `profile remove` completed successfully.
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.11 `ocx profile remove --global`

- [x] **Setup:** Global profiles initialized
- [x] **Commands:**
  ```bash
  $OCX_BIN profile add old-profile --global  # Create profile first
  $OCX_BIN profile remove old-profile --global
  ```
- [x] **Expected:** Deletes global profile (no confirmation)
- [x] **Verify:**
  ```bash
  $OCX_BIN p ls --global  # Should NOT show old-profile
  ls $XDG_CONFIG_HOME/opencode/profiles/  # old-profile/ should be gone
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.12 `ocx p rm` (Alias)

- [x] **Setup:** Global profiles initialized
- [x] **Commands:**
  ```bash
  $OCX_BIN p add temp-profile --global  # Create profile first
  $OCX_BIN p rm temp-profile --global
  ```
- [x] **Expected:** Deletes profile (same as `profile remove`)
- [x] **Verify:**
  ```bash
  $OCX_BIN p ls --global  # Should NOT show temp-profile
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.13 `ocx profile move work client-work` (Global)

- [x] **Setup:** Global profile "work" exists
- [x] **Commands:**
  ```bash
  $OCX_BIN profile add work --global  # Ensure global work profile exists
  $OCX_BIN profile move work client-work --global
  ```
- [x] **Expected:** Renames global profile from work to client-work
- [x] **Verify:**
  ```bash
  ls $XDG_CONFIG_HOME/opencode/profiles/  # client-work/ exists, work/ gone
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.14 `ocx profile move --global`

- [x] **Setup:** Global profiles initialized
- [x] **Commands:**
  ```bash
  # Clean up any conflicting profiles first for deterministic test
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile rm client-work --global 2>/dev/null || true
  # Create source profile and move it
  $OCX_BIN profile add work --global
  $OCX_BIN profile move work client-work --global
  ```
- [x] **Expected:** Renames global profile from work to client-work
- [x] **Verify:**
  ```bash
  $OCX_BIN p ls --global  # Should show client-work, NOT work
  ls $XDG_CONFIG_HOME/opencode/profiles/  # client-work/ exists, work/ gone
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.15 `ocx p mv` (Alias)

- [x] **Setup:** Profile exists
- [x] **Commands:**
  ```bash
  # Clean up any conflicting profiles first for deterministic test
  $OCX_BIN profile rm personal --global 2>/dev/null || true
  $OCX_BIN profile rm home --global 2>/dev/null || true
  # Create source profile and move it
  $OCX_BIN p add personal --global
  $OCX_BIN p mv personal home --global
  ```
- [x] **Expected:** Renames profile (same as `profile move`)
- [x] **Verify:**
  ```bash
  $OCX_BIN p ls --global  # Should show home, NOT personal
  ls $XDG_CONFIG_HOME/opencode/profiles/  # home/ exists, personal/ gone
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.16 `ocx profile show` (Current Profile)

- [x] **Setup:** Profile active via environment or flag
- [x] **Commands:**
  ```bash
  $OCX_BIN profile add work --global  # Ensure work profile exists
  OCX_PROFILE=work $OCX_BIN profile show --global
  ```
- [x] **Expected:** Shows currently resolved profile details
- [x] **Verify:** Output displays work profile info
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.17 `ocx profile show work`

- [x] **Setup:** Profile "work" exists
- [x] **Commands:**
  ```bash
  # Idempotent: remove if exists, then add to ensure clean state
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile add work --global
  $OCX_BIN profile show work --global
  ```
- [x] **Expected:** Shows work profile config and files
- [x] **Verify:**
  ```bash
  # Output should list files and configuration
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.18 `ocx p show` (Alias)

- [x] **Setup:** Profile "work" exists (from Section 10.17)
- [x] **Commands:**
  ```bash
  $OCX_BIN p show work --global
  ```
- [x] **Expected:** Same output as `profile show work`
- [x] **Verify:** Profile details displayed
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 10.19 `ocx profile show --json`

- [x] **Setup:** Profile "work" exists (from Section 10.17)
- [x] **Commands:**
  ```bash
  $OCX_BIN profile show work --global --json
  ```
- [x] **Expected:** Machine-readable JSON with profile details
- [x] **Verify:** Output is valid JSON
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

---

## 11. CLI Reference: ocx config

All subcommands from CLI.md lines 1209-1314.

### 11.1 `ocx config show` (Current Scope)

- [x] **Setup:** Local config initialized
- [x] **Command:** `$OCX_BIN config show`
- [ ] **Expected:** Shows merged config from current scope
- [ ] **Verify:**
  ```bash
  # Output should display registries, settings
  ```
- [x] **Run result (2026-02-23):** FAIL — command returned `error Profile "oc" not found` in `/tmp/ocx-v2-test-project`.
- [x] **Last tested:** _v2.0.0 on 2026-02-23_

### 11.2 `ocx config show --origin`

- [ ] **Setup:** Local config with profile active
- [ ] **Command:** `$OCX_BIN config show --origin`
- [ ] **Expected:** Shows config with source annotations
- [ ] **Verify:**
  ```bash
  # Output should indicate source (local, profile, global)
  ```
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 11.3 `ocx config show -p work`

- [ ] **Setup:** Profile "work" exists
- [ ] **Command:** `$OCX_BIN config show -p work`
- [ ] **Expected:** Shows config from work profile scope
- [ ] **Verify:** Output shows work profile settings
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 11.4 `ocx config show --json`

- [ ] **Setup:** Config exists
- [ ] **Command:** `$OCX_BIN config show --json`
- [ ] **Expected:** Machine-readable JSON config
- [ ] **Verify:** Output is valid JSON
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 11.5 `ocx config edit` (Local)

- [ ] **Setup:** Local config exists, `$EDITOR` set
- [ ] **Command:** `EDITOR=cat $OCX_BIN config edit`
- [ ] **Expected:** Opens `.opencode/ocx.jsonc` in editor
- [ ] **Verify:**
  ```bash
  # Editor should open local config file
  ```
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 11.6 `ocx config edit --global`

- [ ] **Setup:** Global config exists, `$EDITOR` set
- [ ] **Command:** `EDITOR=cat $OCX_BIN config edit --global`
- [ ] **Expected:** Opens `~/.config/opencode/ocx.jsonc` in editor
- [ ] **Verify:** Editor opens global config
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 11.7 `ocx config edit -p work`

- [ ] **Setup:** Profile "work" exists, `$EDITOR` set
- [ ] **Command:** `EDITOR=cat $OCX_BIN config edit -p work`
- [ ] **Expected:** Opens work profile's `ocx.jsonc` in editor
- [ ] **Verify:** Editor opens profile config
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

---

## 12. CLI Reference: ocx opencode

All variations from CLI.md lines 1316-1448.

### 12.1 `ocx opencode` (Default Profile)

- [ ] **Setup:** Default profile exists, test project directory
- [ ] **Command:** `cd /tmp/ocx-v2-test-project && $OCX_BIN oc run "echo hello"`
- [ ] **Expected:** Launches OpenCode with default profile
- [ ] **Verify:** Output shows "hello"
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 12.2 `ocx opencode -p work`

- [ ] **Setup:** Work profile exists
- [ ] **Command:** `$OCX_BIN oc -p work run "echo hello"`
- [ ] **Expected:** Launches with work profile explicitly
- [ ] **Verify:** Command executes successfully
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 12.3 `ocx opencode` with `OCX_PROFILE` Environment

- [ ] **Setup:** Profile exists
- [ ] **Commands:**
  ```bash
  export OCX_PROFILE=work
  $OCX_BIN oc run "echo hello"
  ```
- [ ] **Expected:** Uses profile from environment variable
- [ ] **Verify:** Command executes with work profile
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 12.4 `ocx oc` (Alias)

- [ ] **Setup:** Profile exists
- [ ] **Command:** `$OCX_BIN oc run "echo hello"`
- [ ] **Expected:** Same behavior as `ocx opencode`
- [ ] **Verify:** Command executes
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 12.5 `ocx opencode --no-rename`

- [ ] **Setup:** Profile exists, in terminal with window support
- [ ] **Command:** `$OCX_BIN oc --no-rename run "echo hello"`
- [ ] **Expected:** Skips automatic window renaming
- [ ] **Verify:** Terminal window name unchanged
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 12.6 `ocx oc -- --help` (Pass-Through to OpenCode)

- [ ] **Setup:** OpenCode installed
- [ ] **Command:** `$OCX_BIN oc -- --help`
- [ ] **Expected:** Shows OpenCode's help, not OCX help
- [ ] **Verify:** Help output is from OpenCode
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 12.12 Custom Binary via `OPENCODE_BIN` Environment

- [ ] **Setup:** OpenCode available at custom path
- [ ] **Commands:**
  ```bash
  export OPENCODE_BIN=/custom/path/opencode
  $OCX_BIN oc run "echo hello"
  ```
- [ ] **Expected:** Uses binary from environment variable
- [ ] **Verify:** Custom binary executed
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 13.11 Global-Only Profile Model

Profiles are global-only. All profile commands require the `--global` flag. Local profile directories (`.opencode/profiles/*`) are not supported.

#### Test: Profile add requires --global flag
- [ ] **Setup:** In a project directory without global initialization
- [ ] **Command:** `$OCX_BIN profile add test-local`
- [ ] **Expected:** Fails with error requiring `--global` flag
- [ ] **Verify:** Error message indicates profiles are global-only and `--global` is required

#### Test: Profile list requires --global flag
- [ ] **Setup:** No global profiles initialized
- [ ] **Command:** `$OCX_BIN profile list`
- [ ] **Expected:** Fails with error requiring `--global` flag
- [ ] **Verify:** Error message indicates `--global` is required

#### Test: Creates global profile with --global flag
- [ ] **Setup:** Global config initialized
- [ ] **Commands:**
  ```bash
  # Cleanup: remove test-global profile from prior runs to avoid collisions
  rm -rf $XDG_CONFIG_HOME/opencode/profiles/test-global
  $OCX_BIN profile add test-global --global
  ```
- [ ] **Expected:** Creates global profile at `$XDG_CONFIG_HOME/opencode/profiles/test-global/`
- [ ] **Verify:**
  ```bash
  ls $XDG_CONFIG_HOME/opencode/profiles/test-global/  # Should exist
  ```

#### Test: ocx profile list --global shows global profiles
- [ ] **Setup:** Global profiles exist
- [ ] **Command:** `$OCX_BIN profile list --global`
- [ ] **Expected:** Shows all global profiles
- [ ] **Verify:** Output contains expected profile names

### 13.12 Negative Tests: Local Profile Hard-Fail

These tests verify that local profile usage produces hard errors.

#### Test: profile add without --global fails
- [ ] **Setup:** Fresh environment, no global init
- [ ] **Command:** `$OCX_BIN profile add local-profile`
- [ ] **Expected:** Hard error with message indicating `--global` flag is required
- [ ] **Verify:**
  - Exit code is non-zero
  - Error message mentions `--global` flag requirement
  - No `.opencode/profiles/` directory is created

#### Test: profile list without --global fails
- [ ] **Setup:** Fresh environment
- [ ] **Command:** `$OCX_BIN profile list`
- [ ] **Expected:** Hard error requiring `--global` flag
- [ ] **Verify:**
  - Exit code is non-zero
  - Error message indicates profiles are global-only

#### Test: profile remove without --global fails
- [ ] **Setup:** Fresh environment
- [ ] **Command:** `$OCX_BIN profile remove some-profile`
- [ ] **Expected:** Hard error requiring `--global` flag
- [ ] **Verify:**
  - Exit code is non-zero
  - Error message indicates `--global` is required

#### Test: profile move without --global fails
- [ ] **Setup:** Fresh environment
- [ ] **Command:** `$OCX_BIN profile move old new`
- [ ] **Expected:** Hard error requiring `--global` flag
- [ ] **Verify:**
  - Exit code is non-zero
  - Error message indicates `--global` is required

#### Test: profile show without --global fails (when no local profile exists)
- [ ] **Setup:** Fresh environment
- [ ] **Command:** `$OCX_BIN profile show some-profile`
- [ ] **Expected:** Hard error requiring `--global` flag
- [ ] **Verify:**
  - Exit code is non-zero
  - Error message indicates `--global` is required

#### Test: No local profiles directory is created
- [ ] **Setup:** Run any profile command without --global in a project
- [ ] **Commands:**
  ```bash
  cd /tmp/ocx-v2-test-project
  test -f .opencode/ocx.jsonc || $OCX_BIN init
  $OCX_BIN profile add test 2>/dev/null || true
  ```
- [ ] **Expected:** Command fails and no `.opencode/profiles/` directory exists
- [ ] **Verify:**
  ```bash
  test -d .opencode/profiles && echo "FAIL: profiles dir exists" || echo "OK: No local profiles"
  ```

---

## 14. Error Path Tests

Common errors from CLI.md error tables.

### 14.1 Error: No ocx.jsonc Found (Init)

- [ ] **Setup:** Empty directory, no config
- [ ] **Command:** `$OCX_BIN add kdco/researcher`
- [ ] **Expected:** Error: "No ocx.jsonc found"
- [ ] **Verify:** Exit code 78 (CONFIG error)
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 14.2 Error: Registry Not Found

- [ ] **Setup:** Config initialized, registry not configured
- [ ] **Command:** `$OCX_BIN add unknown/component`
- [ ] **Expected:** Error: "Registry not found"
- [ ] **Verify:** Exit code 66 (NOT_FOUND)
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 14.3 Error: Component Not Installed (Update)

- [ ] **Setup:** Config initialized, component not installed
- [ ] **Command:** `$OCX_BIN update kdco/researcher`
- [ ] **Expected:** Error: "Component 'kdco/researcher' is not installed"
- [ ] **Verify:** Exit code 66 (NOT_FOUND)
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 14.5 Error: Registry Already Exists (Add Registry)

- [ ] **Setup:** Registry configured (ensure kdco exists before conflict test)
- [ ] **Commands:**
  ```bash
  # Idempotent: ensure kdco registry exists first
  $OCX_BIN registry list | grep -q "kdco" || $OCX_BIN registry add http://localhost:8787 --name kdco
  # Attempt to add conflicting registry with same name
  $OCX_BIN registry add http://localhost:8788 --name kdco
  ```
- [ ] **Expected:** Error: "Registry 'kdco' already exists"
- [ ] **Verify:** Exit code 6 (CONFLICT)
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 14.6 Error: Invalid Version Specifier (Update)

- [ ] **Setup:** Component installed
- [ ] **Command:** `$OCX_BIN update kdco/researcher@`
- [ ] **Expected:** Error: "Invalid version specifier"
- [ ] **Verify:** Exit code 78 (CONFIG)
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 14.7 Error: Mutually Exclusive Options (Update)

- [ ] **Setup:** Components installed
- [ ] **Command:** `$OCX_BIN update --all --registry kdco`
- [ ] **Expected:** Error: "Cannot use --all with --registry"
- [ ] **Verify:** Exit code 1 (GENERAL)
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

### 14.8 Error: Profile Not Found (Move)

- [ ] **Setup:** Global profiles initialized
- [ ] **Command:** `$OCX_BIN profile move nonexistent new-name --global`
- [ ] **Expected:** Error: "Profile 'nonexistent' not found"
- [ ] **Verify:** Exit code 66 (NOT_FOUND)
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

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
- [ ] **Last tested:** _v2.0.0 on 2026-02-12_

---

## 15. CLI Reference: ocx migrate

Smoke tests for the v1.4.6 → v2 receipt migration command.

### 15.1 Preview Mode (No Writes)

- [x] **Setup:** Project with legacy `ocx.lock` (at `.opencode/ocx.lock` or root `ocx.lock`; install a component with an older OCX version, or create a minimal v1 lock file manually)
- [x] **Command:** `$OCX_BIN migrate`
- [x] **Expected:** Prints migration plan without modifying any files
- [x] **Verify:**
  ```bash
  # Files must be unchanged after preview
  md5sum .opencode/ocx.lock  # Same hash as before command
  test ! -f .ocx/receipt.jsonc && echo "OK: No receipt created" || echo "FAIL: receipt.jsonc should not exist yet"
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-12_

### 15.2 Apply Migration

- [x] **Setup:** Same v1 project as 15.1 (re-create if needed)
- [x] **Command:** `$OCX_BIN migrate --apply`
- [x] **Expected:** Creates `.ocx/receipt.jsonc` and backs up lock file to `.bak` (or `.bak.N` if `.bak` already exists)
- [x] **Verify:**
  ```bash
  test -f .ocx/receipt.jsonc && echo "OK: receipt.jsonc created" || echo "FAIL: receipt.jsonc missing"
  ls .opencode/ocx.lock.bak* 2>/dev/null && echo "OK: lock backup exists" || echo "FAIL: lock backup missing"
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-12_

### 15.3 Rerun Is Safe (Already Migrated)

- [x] **Setup:** Project already migrated (Section 15.2 completed)
- [x] **Command:** `$OCX_BIN migrate --apply`
- [x] **Expected:** Prints "Already migrated to receipt format (.ocx/receipt.jsonc)." and exits 0 without modifying files
- [x] **Verify:**
  ```bash
  cat .ocx/receipt.jsonc  # Should be unchanged from 15.2
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-12_

### 15.4 Global Preview Mode (No Writes)

- [x] **Setup:** Global config with legacy `ocx.lock` and at least one profile with its own legacy `ocx.lock`
  ```bash
  $OCX_BIN init --global 2>/dev/null || true
  # Global root legacy lock
  cat > $XDG_CONFIG_HOME/opencode/ocx.lock << 'EOF'
  {"lockVersion":1,"installed":{"kdco/researcher":{"registry":"kdco","version":"1.0.0","hash":"abc123","files":[".opencode/agents/researcher.md"],"installedAt":"2025-06-01T00:00:00.000Z"}}}
  EOF
  echo '{"registries":{"kdco":{"url":"http://localhost:8787"}}}' > $XDG_CONFIG_HOME/opencode/ocx.jsonc
  # Profile legacy lock (work profile)
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile add work --global
  cat > $XDG_CONFIG_HOME/opencode/profiles/work/ocx.lock << 'EOF'
  {"lockVersion":1,"installed":{"kdco/notify":{"registry":"kdco","version":"0.5.0","hash":"def456","files":[".opencode/skills/notify/SKILL.md"],"installedAt":"2025-07-01T00:00:00.000Z"}}}
  EOF
  ```
- [x] **Command:** `$OCX_BIN migrate --global`
- [x] **Expected:** Prints migration plan for global root AND work profile without modifying any files. Global root is listed first, then profiles in sorted order.
- [x] **Verify:**
  ```bash
  test -f $XDG_CONFIG_HOME/opencode/ocx.lock && echo "OK: global lock unchanged" || echo "FAIL: lock file missing"
  test ! -f $XDG_CONFIG_HOME/opencode/.ocx/receipt.jsonc && echo "OK: No global receipt created" || echo "FAIL: receipt.jsonc should not exist yet"
  test -f $XDG_CONFIG_HOME/opencode/profiles/work/ocx.lock && echo "OK: profile lock unchanged" || echo "FAIL: profile lock missing"
  test ! -f $XDG_CONFIG_HOME/opencode/profiles/work/.ocx/receipt.jsonc && echo "OK: No profile receipt created" || echo "FAIL: profile receipt should not exist yet"
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-13_

### 15.5 Global Apply Migration (Root + Profile Fan-Out)

- [x] **Setup:** Global config with legacy `ocx.lock`, a registry entry containing deprecated `version` field, and one profile with its own legacy lock
  ```bash
  $OCX_BIN init --global 2>/dev/null || true
  # Global root legacy lock
  cat > $XDG_CONFIG_HOME/opencode/ocx.lock << 'EOF'
  {"lockVersion":1,"installed":{"kdco/researcher":{"registry":"kdco","version":"1.0.0","hash":"abc123","files":[".opencode/agents/researcher.md"],"installedAt":"2025-06-01T00:00:00.000Z"}}}
  EOF
  # Add deprecated registries.*.version field to trigger normalization
  echo '{"registries":{"kdco":{"url":"http://localhost:8787","version":"latest"}}}' > $XDG_CONFIG_HOME/opencode/ocx.jsonc
  # Profile legacy lock (work profile)
  $OCX_BIN profile rm work --global 2>/dev/null || true
  $OCX_BIN profile add work --global
  cat > $XDG_CONFIG_HOME/opencode/profiles/work/ocx.lock << 'EOF'
  {"lockVersion":1,"installed":{"kdco/notify":{"registry":"kdco","version":"0.5.0","hash":"def456","files":[".opencode/skills/notify/SKILL.md"],"installedAt":"2025-07-01T00:00:00.000Z"}}}
  EOF
  echo '{"registries":{"kdco":{"url":"http://localhost:8787","version":"latest"}}}' > $XDG_CONFIG_HOME/opencode/profiles/work/ocx.jsonc
  ```
- [x] **Command:** `$OCX_BIN migrate --global --apply`
- [x] **Expected:** Migrates global root first, then work profile. For each target: creates `.ocx/receipt.jsonc`, backs up lock to `.bak` (or `.bak.N`), and removes deprecated `registries.*.version` fields. Per-target summary printed.
- [x] **Verify:**
  ```bash
  # Global root
  test -f $XDG_CONFIG_HOME/opencode/.ocx/receipt.jsonc && echo "OK: global receipt created" || echo "FAIL: global receipt missing"
  ls $XDG_CONFIG_HOME/opencode/ocx.lock.bak* 2>/dev/null && echo "OK: global lock backup exists" || echo "FAIL: global lock backup missing"
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc | grep -q '"version"' && echo "FAIL: deprecated version field still present" || echo "OK: version field removed"
  # Work profile
  test -f $XDG_CONFIG_HOME/opencode/profiles/work/.ocx/receipt.jsonc && echo "OK: profile receipt created" || echo "FAIL: profile receipt missing"
  ls $XDG_CONFIG_HOME/opencode/profiles/work/ocx.lock.bak* 2>/dev/null && echo "OK: profile lock backup exists" || echo "FAIL: profile lock backup missing"
  cat $XDG_CONFIG_HOME/opencode/profiles/work/ocx.jsonc | grep -q '"version"' && echo "FAIL: profile version field still present" || echo "OK: profile version field removed"
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-13_

### 15.6 Global Rerun Is Safe (Already Migrated)

- [x] **Setup:** Global config and profile already migrated (Section 15.5 completed)
- [x] **Command:** `$OCX_BIN migrate --global --apply`
- [x] **Expected:** Prints already-migrated message for each target (global root and work profile) and exits 0 without modifying files
- [x] **Verify:**
  ```bash
  cat $XDG_CONFIG_HOME/opencode/.ocx/receipt.jsonc  # Should be unchanged from 15.5
  cat $XDG_CONFIG_HOME/opencode/ocx.jsonc  # Should be unchanged from 15.5
  cat $XDG_CONFIG_HOME/opencode/profiles/work/.ocx/receipt.jsonc  # Should be unchanged from 15.5
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-13_

### 15.7 Global Apply Continues on Partial Failure

- [x] **Setup:** Global root already migrated, but one profile has a legacy lock
  ```bash
  # Ensure global root is already migrated (receipt exists, no legacy lock)
  # Profile with legacy lock
  $OCX_BIN profile rm failing --global 2>/dev/null || true
  $OCX_BIN profile add failing --global
  cat > $XDG_CONFIG_HOME/opencode/profiles/failing/ocx.lock << 'EOF'
  {"lockVersion":1,"installed":{"kdco/workspace":{"registry":"kdco","version":"1.0.0","hash":"bad789","files":[".opencode/workspace.md"],"installedAt":"2025-08-01T00:00:00.000Z"}}}
  EOF
  ```
- [x] **Command:** `$OCX_BIN migrate --global --apply`
- [x] **Expected:** Global root reports already migrated, failing profile is migrated successfully. Per-target summaries printed for both.
- [x] **Verify:**
  ```bash
  test -f $XDG_CONFIG_HOME/opencode/profiles/failing/.ocx/receipt.jsonc && echo "OK: failing profile receipt created" || echo "FAIL: failing profile receipt missing"
  ls $XDG_CONFIG_HOME/opencode/profiles/failing/ocx.lock.bak* 2>/dev/null && echo "OK: profile lock backup exists" || echo "FAIL: profile lock backup missing"
  ```
- [x] **Last tested:** _v2.0.0 on 2026-02-13_

---

## 16. Verification Checklist

Master summary for full test sessions.

### 16.1 All README Commands Verified

- [ ] Quick Start Profiles (Section 2): 6 test cases
- [ ] Quick Start Components (Section 3): 4 test cases

### 16.2 All CLI.md Commands Verified

- [ ] ocx init (Section 4): 8 test cases
- [ ] ocx add (Section 5): 11 test cases
- [ ] ocx update (Section 6): 7 test cases
- [ ] ocx search (Section 7): 7 test cases
- [ ] ocx registry (Section 8): 10 test cases
- [ ] ocx build (Section 9): 4 test cases
- [ ] ocx profile (Section 10): 15 test cases (revised for global-only model)
- [ ] ocx config (Section 11): 7 test cases
- [ ] ocx opencode (Section 12): 12 test cases

### 16.3 Profile System Verified

- [ ] Profile Layering (Section 13): 6 test cases (revised for global-only model)

### 16.4 Error Paths Verified

- [ ] Common Errors (Section 14): 10 test cases
- [ ] Negative Profile Tests (Section 13.12): 6 test cases

### 16.5 Migration Verified

- [x] ocx migrate (Section 15): 7 test cases (3 local, 4 global including profile fan-out)

### 16.6 Documentation Sync

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
| Section 2 | [README.md](../README.md) | 34-53 |
| Section 3 | [README.md](../README.md) | 79-96 |
| Section 4 | [CLI.md](./CLI.md) | 53-91 |
| Section 5 | [CLI.md](./CLI.md) | 94-147 |
| Section 6 | [CLI.md](./CLI.md) | 195-244 |
| Section 7 | [CLI.md](./CLI.md) | 247-320 |
| Section 8 | [CLI.md](./CLI.md) | 362-556 |
| Section 9 | [CLI.md](./CLI.md) | 559-645 |
| Section 10 | [CLI.md](./CLI.md) | 933-1207 |
| Section 11 | [CLI.md](./CLI.md) | 1209-1314 |
| Section 12 | [CLI.md](./CLI.md) | 1316-1448 |
| Section 13 | [PROFILES.md](./PROFILES.md) | Full document |
| Section 14 | [CLI.md](./CLI.md) | Error tables throughout |
| Section 15 | [README.md](../README.md), [CLI.md](./CLI.md) | 98-113, 649-701 |

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
| `packages/cli/tests/profile-commands.test.ts` | Profile management |
| `packages/cli/tests/config/config-resolver.test.ts` | Config resolution |

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
5. Update Section 16 verification checklist
6. Update Section 17 sync checklist with cross-references

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

_Last updated: 2026-02-12_
_Document version: 1.0_
