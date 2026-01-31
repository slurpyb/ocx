# V2 Receipt Implementation Summary

## Status: PARTIAL - Schema and utilities complete, command integration needed

## Completed Work

### 1. Schema Updates (`packages/cli/src/schemas/config.ts`)

✅ **Updated `installedComponentSchema`** to V2 format:
- Changed from simple registry string to full `registryUrl`, `namespace`, `name`, `revision` fields
- Added per-file hashing (array of `{path, hash}` instead of just paths)
- Kept ownership tracking (`owner` field)
- Store resolved version/revision, not tags

✅ **Updated `receiptSchema`**:
- Changed key format from `qualifiedComponentSchema` to plain `string` for canonical IDs
- Format: `registryUrl::namespace/component@resolvedRevision`

✅ **Added Canonical ID utilities**:
- `createCanonicalId(registryUrl, namespace, name, revision)` - Creates V2 canonical IDs
- `parseCanonicalId(canonicalId)` - Parses V2 canonical IDs with validation
- Both follow fail-fast principles

### 2. New Utility Module (`packages/cli/src/utils/receipt.ts`)

✅ **Created receipt utilities**:
- `hashContent(content)` - SHA-256 hashing (reuses existing crypto infrastructure)
- `hashBundle(files)` - Deterministic bundle hashing (sorted by path)
- `checkFileIntegrity(installRoot, entry)` - Detects manual edits by comparing hashes
  - Returns `{intact, modified[], missing[], details[]}`
  - Per-file status: "intact" | "modified" | "missing"
- `findComponentById(receipt, canonicalId)` - Find by canonical ID
- `findComponentByFile(receipt, filePath)` - Find which component owns a file
- `findComponentsByRegistry(receipt, registryUrl)` - Filter by registry URL
- Re-exports `createCanonicalId` and `parseCanonicalId`

## Remaining Work

### 3. Update `add.ts` Command

**Location:** `packages/cli/src/commands/add.ts`

**Changes needed:**

1. **Import V2 utilities:**
   ```typescript
   import {
     createCanonicalId,
     findReceipt,
     type Receipt,
     readReceipt,
     writeReceipt,
   } from "../schemas/config"
   import {
     checkFileIntegrity,
     findComponentByFile as findComponentByFileInReceipt,
     hashBundle,
     hashFileContent,
   } from "../utils/receipt"
   ```

2. **Replace ocx.lock with receipt** (line ~351-359):
   ```typescript
   // BEFORE:
   const { path: lockPath } = findOcxLock(cwd, { isFlattened })
   let lock: OcxLock = { lockVersion: 1, installed: {} }
   const existingLock = await readOcxLock(cwd, { isFlattened })
   if (existingLock) {
     lock = existingLock
   }

   // AFTER:
   let receipt: Receipt = { version: 2, root: cwd, installed: {} }
   const existingReceipt = await readReceipt(cwd)
   if (existingReceipt) {
     receipt = existingReceipt
   }
   ```

3. **Remove duplicate hash functions** (lines ~685-702):
   - Delete `hashContent()` function (now imported from utils/receipt)
   - Delete `hashBundle()` function (now imported from utils/receipt)

4. **Update component fetching** (line ~424-445):
   - Compute individual file hashes during fetch
   - Build canonical ID using `createCanonicalId(baseUrl, namespace, name, resolvedVersion)`
   - Check receipt using canonical ID instead of `qualifiedName`

5. **Update conflict detection** (line ~448-465):
   - Use `findComponentByFileInReceipt(receipt, resolvedTarget)` instead of legacy function
   - Update error messages to use canonical IDs

6. **Update file conflict checks** (line ~476-507):
   - Before overwriting, check if file hash differs from receipt baseline
   - If `--force` not set and hash differs, prompt user about manual edits
   - Show which files were modified: `logger.warn(\`File ${path} was manually edited\`)`

7. **Update receipt writing** (line ~543-551):
   ```typescript
   // BEFORE:
   lock.installed[component.qualifiedName] = {
     registry: component.registryName,
     version: "1.0.0",
     hash: computedHash,
     files: component.files.map((f) => resolveTargetPath(f.target, isFlattened)),
     installedAt: new Date().toISOString(),
   }

   // AFTER:
   const canonicalId = createCanonicalId(
     component.baseUrl,
     component.namespace,
     component.name,
     resolvedVersion, // from fetchComponentVersion result
   )
   const fileHashes = await Promise.all(
     files.map(async (file) => ({
       path: resolveTargetPath(file.target, isFlattened),
       hash: hashFileContent(file.content),
     }))
   )
   receipt.installed[canonicalId] = {
     registryUrl: component.baseUrl,
     namespace: component.namespace,
     name: component.name,
     revision: resolvedVersion,
     hash: computedHash,
     files: fileHashes,
     installedAt: new Date().toISOString(),
     owner: options.profile
       ? { type: "profile", id: options.profile }
       : options.global
         ? { type: "system" }
         : { type: "user" },
   }
   ```

8. **Save receipt** (line ~600-601):
   ```typescript
   // BEFORE:
   await writeOcxLock(cwd, lock, lockPath)

   // AFTER:
   await writeReceipt(cwd, receipt)
   ```

### 4. Update `update.ts` Command

**Location:** `packages/cli/src/commands/update.ts`

**Changes needed:**

1. **Import V2 utilities:**
   ```typescript
   import {
     createCanonicalId,
     findReceipt,
     parseCanonicalId,
     type Receipt,
     readReceipt,
     writeReceipt,
   } from "../schemas/config"
   import { checkFileIntegrity, hashBundle, hashFileContent } from "../utils/receipt"
   ```

2. **Replace lock with receipt** (line ~102-105):
   ```typescript
   // BEFORE:
   const lock = await readOcxLock(provider.cwd)
   if (!lock || Object.keys(lock.installed).length === 0) {
     throw new ValidationError("Nothing installed yet...")
   }

   // AFTER:
   const receipt = await readReceipt(provider.cwd)
   if (!receipt || Object.keys(receipt.installed).length === 0) {
     throw new ValidationError("Nothing installed yet...")
   }
   ```

3. **Update component lookup** (line ~194-209):
   - Parse user input to get namespace/component
   - Find matching canonical IDs in receipt (may be multiple if different registries)
   - If multiple matches, ask user to specify registry URL

4. **Check for manual edits before update** (NEW - after line ~227):
   ```typescript
   // Check if files were manually edited
   const integrity = await checkFileIntegrity(provider.cwd, existingEntry)
   if (!integrity.intact && !options.force) {
     logger.warn(`Component '${qualifiedName}' has been manually edited:`)
     for (const modified of integrity.modified) {
       logger.warn(`  - ${modified}`)
     }
     for (const missing of integrity.missing) {
       logger.warn(`  - ${missing} (missing)`)
     }
     throw new ValidationError(
       "Manual edits detected. Use --force to overwrite or commit your changes first."
     )
   }
   ```

5. **Update receipt entries** (line ~316-323):
   ```typescript
   // BEFORE:
   lock.installed[update.qualifiedName] = {
     registry: existingEntry.registry,
     version: update.newVersion,
     hash: update.newHash,
     files: existingEntry.files,
     installedAt: existingEntry.installedAt,
     updatedAt: new Date().toISOString(),
   }

   // AFTER:
   const fileHashes = await Promise.all(
     update.files.map(async (file) => ({
       path: resolveTargetPath(file.target, isFlattened),
       hash: hashFileContent(file.content),
     }))
   )
   receipt.installed[update.canonicalId] = {
     ...existingEntry,
     revision: update.newVersion,
     hash: update.newHash,
     files: fileHashes,
     updatedAt: new Date().toISOString(),
   }
   ```

6. **Save receipt** (line ~329):
   ```typescript
   // BEFORE:
   await writeOcxLock(provider.cwd, lock, lockPath)

   // AFTER:
   await writeReceipt(provider.cwd, receipt)
   ```

7. **Remove duplicate hash functions** (lines ~495-513):
   - Delete `hashContent()` and `hashBundle()` (now imported)

### 5. Update `diff.ts` Command

**Location:** `packages/cli/src/commands/diff.ts`

**Changes needed:**

1. **Import V2 utilities:**
   ```typescript
   import { findReceipt, parseCanonicalId, readReceipt } from "../schemas/config"
   ```

2. **Replace lock with receipt** (line ~31-42):
   ```typescript
   // BEFORE:
   const lock = await readOcxLock(options.cwd)
   if (!lock) {
     // error handling
   }

   // AFTER:
   const receipt = await readReceipt(options.cwd)
   if (!receipt) {
     if (options.json) {
       outputJson({
         success: false,
         error: { code: "NOT_FOUND", message: "No receipt found" },
       })
     } else {
       logger.warn("No receipt found. Run 'ocx add' first.")
     }
     return
   }
   ```

3. **Update component iteration** (line ~57, ~70-77):
   ```typescript
   // BEFORE:
   const componentNames = component ? [component] : Object.keys(lock.installed)
   for (const name of componentNames) {
     const installed = lock.installed[name]

   // AFTER:
   // If user provides namespace/component, find matching canonical ID(s)
   let canonicalIds: string[]
   if (component) {
     // Parse user input and find matching canonical IDs
     canonicalIds = Object.keys(receipt.installed).filter(id => {
       const parsed = parseCanonicalId(id)
       return `${parsed.namespace}/${parsed.name}` === component
     })
     if (canonicalIds.length === 0) {
       logger.warn(`Component '${component}' not found in receipt.`)
       return
     }
     if (canonicalIds.length > 1) {
       logger.info(`Multiple versions of '${component}' found:`)
       for (const id of canonicalIds) {
         const parsed = parseCanonicalId(id)
         logger.info(`  - ${parsed.registryUrl} @ ${parsed.revision}`)
       }
       logger.warn("Please specify the registry URL to diff a specific version.")
       return
     }
   } else {
     canonicalIds = Object.keys(receipt.installed)
   }

   for (const canonicalId of canonicalIds) {
     const installed = receipt.installed[canonicalId]
     const parsed = parseCanonicalId(canonicalId)
   ```

4. **Update file path lookups** (line ~86, ~95):
   - Use canonical ID parsed fields instead of qualified name
   - Registry lookup uses `installed.registryUrl` instead of `installed.registry`

### 6. Create `verify.ts` Command (NEW)

**Location:** `packages/cli/src/commands/verify.ts`

**Purpose:** Check installed component integrity against receipt baselines

```typescript
/**
 * Verify Command
 *
 * Check installed components against receipt baselines to detect manual edits.
 */

import type { Command } from "commander"
import { parseCanonicalId, readReceipt } from "../schemas/config"
import { checkFileIntegrity } from "../utils/receipt"
import { handleError, logger, outputJson } from "../utils/index"

interface VerifyOptions {
  cwd: string
  json: boolean
  quiet: boolean
  fix?: boolean
}

export function registerVerifyCommand(program: Command): void {
  program
    .command("verify")
    .description("Verify installed components against receipt baselines")
    .argument("[component]", "Component to verify (optional, verifies all if omitted)")
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--json", "Output as JSON", false)
    .option("-q, --quiet", "Suppress output", false)
    .option("--fix", "Re-hash files to update baselines (use with caution)", false)
    .action(async (component: string | undefined, options: VerifyOptions) => {
      try {
        const receipt = await readReceipt(options.cwd)
        if (!receipt) {
          if (options.json) {
            outputJson({
              success: false,
              error: { code: "NOT_FOUND", message: "No receipt found" },
            })
          } else {
            logger.warn("No receipt found. Run 'ocx add' first.")
          }
          return
        }

        // Determine which components to verify
        let canonicalIds: string[]
        if (component) {
          // Find matching canonical IDs
          canonicalIds = Object.keys(receipt.installed).filter((id) => {
            const parsed = parseCanonicalId(id)
            return `${parsed.namespace}/${parsed.name}` === component
          })
          if (canonicalIds.length === 0) {
            logger.warn(`Component '${component}' not found in receipt.`)
            return
          }
        } else {
          canonicalIds = Object.keys(receipt.installed)
        }

        const results: Array<{
          canonicalId: string
          status: "intact" | "modified" | "missing"
          details: Array<{ path: string; status: "intact" | "modified" | "missing" }>
        }> = []

        for (const canonicalId of canonicalIds) {
          const entry = receipt.installed[canonicalId]
          const integrity = await checkFileIntegrity(options.cwd, entry)

          results.push({
            canonicalId,
            status: integrity.intact ? "intact" : integrity.missing.length > 0 ? "missing" : "modified",
            details: integrity.details,
          })
        }

        // Output results
        if (options.json) {
          outputJson({ success: true, data: { verifications: results } })
        } else {
          let hasIssues = false
          for (const result of results) {
            const parsed = parseCanonicalId(result.canonicalId)
            const displayName = `${parsed.namespace}/${parsed.name}@${parsed.revision}`

            if (result.status === "intact") {
              if (!options.quiet) {
                logger.success(`${displayName}: All files intact`)
              }
            } else {
              hasIssues = true
              logger.warn(`\\n${displayName}: Issues detected`)
              for (const detail of result.details) {
                if (detail.status !== "intact") {
                  const icon = detail.status === "modified" ? "~" : "✗"
                  logger.info(`  ${icon} ${detail.path} (${detail.status})`)
                }
              }
            }
          }

          if (hasIssues) {
            logger.info("")
            logger.info("Files have been modified or are missing.")
            logger.info("To restore: ocx update <component> --force")
            logger.info("To update baselines: ocx verify --fix (use with caution)")
          } else if (!options.quiet) {
            logger.info("")
            logger.success("All components verified successfully.")
          }
        }
      } catch (error) {
        handleError(error, { json: options.json })
      }
    })
}
```

**Register command** in `packages/cli/src/index.ts`:
```typescript
import { registerVerifyCommand } from "./commands/verify"

// ... existing commands
registerVerifyCommand(program)
```

### 7. Remove `remove.ts` Command (if exists)

Component removal should use receipt for tracking. If a remove command exists, update it to:
- Read receipt instead of lock
- Check file ownership using canonical IDs
- Prompt if files were manually edited (using `checkFileIntegrity`)
- Remove entries from receipt after deleting files

## Testing Requirements

### Unit Tests

1. **`schemas/config.test.ts`**:
   - Test `createCanonicalId()` with various inputs
   - Test `parseCanonicalId()` with valid/invalid formats
   - Test canonical ID normalization (trailing slashes)

2. **`utils/receipt.test.ts`**:
   - Test `hashContent()` and `hashBundle()` determinism
   - Test `checkFileIntegrity()` with intact/modified/missing files
   - Test `findComponentByFile()` and `findComponentById()`
   - Test `findComponentsByRegistry()` filtering

### Integration Tests

1. **`commands/add.test.ts`**:
   - Test receipt creation on fresh install
   - Test receipt update on re-install
   - Test conflict detection with different registries
   - Test manual edit detection during install

2. **`commands/update.test.ts`**:
   - Test update with clean files (should succeed)
   - Test update with manual edits (should prompt without --force)
   - Test `--force` overwriting manual edits
   - Test canonical ID matching across registries

3. **`commands/verify.test.ts`** (NEW):
   - Test verification of intact components
   - Test detection of modified files
   - Test detection of missing files
   - Test JSON output format

## Migration Notes

### Backward Compatibility

**ocx.lock → receipt migration:**
- If `ocx.lock` exists but `.ocx/receipt.jsonc` doesn't:
  - Read old lock format
  - For each entry, create canonical ID using current registry URL
  - Fetch component to get resolved version
  - Write new receipt
  - Rename `ocx.lock` to `ocx.lock.backup`

**Implementation location:** `schemas/config.ts` - add `migrateOcxLockToReceipt(cwd)` function

### Registry Version Handling

Per requirements: **"Registry is treated as latest-only"**
- Do NOT store top-level registry version in receipt
- Only store component revision (resolved version)
- When updating, always fetch latest from registry

## Philosophy Compliance Checklist

✅ **Early Exit**: Guard clauses in `parseCanonicalId()`, `checkFileIntegrity()`
✅ **Parse Don't Validate**: Canonical IDs validated at boundary, trusted internally
✅ **Atomic Predictability**: All hash functions are pure (same input = same output)
✅ **Fail Fast**: Invalid canonical IDs throw immediately with descriptive errors
✅ **Intentional Naming**: `createCanonicalId`, `checkFileIntegrity`, `findComponentByFile`

## Blockers / Open Questions

1. **Resolved version retrieval**: 
   - Need to ensure `fetchComponentVersion()` returns resolved version string
   - Check if registry manifests include version metadata
   - If not, may need to infer from registry index

2. **Profile ownership tracking**:
   - Owner field is optional - should it be required?
   - How to determine owner when receipt is created/migrated?

3. **Manual edit prompts**:
   - Should we show diffs of changed files?
   - Interactive mode to accept/reject file-by-file?
   - Or just fail-fast with list of modified files?

## Files Modified

- ✅ `packages/cli/src/schemas/config.ts` - Receipt schema and canonical ID utilities
- ✅ `packages/cli/src/utils/receipt.ts` - Receipt operations and integrity checking
- ⏸️ `packages/cli/src/commands/add.ts` - Use receipt instead of lock (NEEDS WORK)
- ⏸️ `packages/cli/src/commands/update.ts` - Use receipt, check manual edits (NEEDS WORK)
- ⏸️ `packages/cli/src/commands/diff.ts` - Use receipt for lookups (NEEDS WORK)
- ⏸️ `packages/cli/src/commands/verify.ts` - New command for integrity checks (NEW FILE)
- ⏸️ `packages/cli/src/index.ts` - Register verify command (NEEDS UPDATE)

## Next Steps

1. Complete `add.ts` integration (highest priority - core install flow)
2. Complete `update.ts` integration (second priority - update flow)
3. Implement `verify.ts` command (nice to have)
4. Update `diff.ts` (lower priority - diagnostic tool)
5. Add migration path from ocx.lock to receipt
6. Write integration tests
7. Update documentation

## Time Estimate

- **add.ts integration**: 2-3 hours (complex, many touch points)
- **update.ts integration**: 1-2 hours (similar patterns to add.ts)
- **verify.ts command**: 1 hour (straightforward, mostly UI)
- **diff.ts integration**: 30 minutes (simple lookup changes)
- **Migration path**: 1 hour
- **Testing**: 2-3 hours
- **Total**: ~8-10 hours for complete V2 receipt implementation
