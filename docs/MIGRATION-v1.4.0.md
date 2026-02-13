# Migration Guide: v1.3.x → v1.4.0

## ⚠️ Breaking Changes

OCX v1.4.0 introduces the **Unified Profile System**, replacing the legacy "ghost mode" configuration.

### What Changed

| Before (v1.3.x) | After (v1.4.0) |
|-----------------|----------------|
| `ghost.jsonc` | `ocx.jsonc` |
| `.ghost/` directory | `.opencode/` directory |
| Ghost mode | Profile system |

### Requirements

- **OpenCode v1.1.29 or later** is required for profile system support

### Manual Migration

There is no automatic migration command — v1.4.0 is a clean break from ghost mode. Follow the steps below to migrate manually.

1. Rename your config files:
   ```bash
   # For each profile directory
   for dir in ~/.config/opencode/profiles/*/; do
     if [ -f "${dir}ghost.jsonc" ]; then
       mv "${dir}ghost.jsonc" "${dir}ocx.jsonc"
     fi
   done
   ```

2. Rename local config directories:
   ```bash
   mv .ghost .opencode
   ```

3. Update any scripts or aliases that reference `ghost` commands

### Verify Migration

After migrating, verify your setup:

```bash
# List profiles
ocx profile list --global

# Show merged config
ocx config show

# Launch OpenCode with a profile
ocx opencode -p default
```

### Need Help?

If you encounter issues during migration, please [open an issue](https://github.com/kdcokenny/ocx/issues/new).
