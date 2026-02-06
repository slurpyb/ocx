#!/usr/bin/env bash

# VHS demo recording script with temporary noise filtering.
#
# This script records VHS demo tapes in an isolated environment with local workers.
# It includes a temporary filter to suppress repeated "Error: FileNotFound" lines
# that appear during demo recordings but don't affect functionality.
#
# IMPORTANT: The noise filter is DEMO-ONLY and controlled by OCX_DEMO_FILTER_NOISE=1.
# It does NOT modify OCX product code - filtering happens only in the shim wrapper
# used for VHS recordings. This keeps demos clean while preserving real CLI behavior.

set -euo pipefail
IFS=$'\n\t'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
RECOVERY_ROOT="$REPO_ROOT/.recovery"
RECOVERY_DIR="$RECOVERY_ROOT/$TIMESTAMP"
CLEANUP_HOLD_DIR="$RECOVERY_DIR/cleanup-hold"

GLOBAL_CONFIG_DIR="$HOME/.config/opencode"
REPO_CONFIG_DIR="$REPO_ROOT/.opencode"
GLOBAL_BACKUP_PATH="$RECOVERY_DIR/opencode-global.backup"
REPO_BACKUP_PATH="$RECOVERY_DIR/opencode-repo.backup"

KDCO_LOG="$RECOVERY_DIR/kdco-registry.log"
KIT_LOG="$RECOVERY_DIR/ocx-kit.log"
VHS_LOG="$RECOVERY_DIR/vhs.log"
SHIM_PATH="$RECOVERY_DIR/ocx"

KDCO_PID=""
KIT_PID=""

mkdir -p "$RECOVERY_DIR"
mkdir -p "$CLEANUP_HOLD_DIR"

safe_remove() {
	local target="$1"
	if [ ! -e "$target" ] && [ ! -L "$target" ]; then
		return 0
	fi

	if command -v trash >/dev/null 2>&1; then
		trash "$target"
		return 0
	fi

	local base
	base="$(basename "$target")"
	mv "$target" "$CLEANUP_HOLD_DIR/${base}.$(date +%s%N)"
}

restore_path() {
	local target="$1"
	local backup="$2"

	if [ -e "$backup" ] || [ -L "$backup" ]; then
		if [ -e "$target" ] || [ -L "$target" ]; then
			safe_remove "$target"
		fi
		mkdir -p "$(dirname "$target")"
		mv "$backup" "$target"
		return 0
	fi

	if [ -e "$target" ] || [ -L "$target" ]; then
		safe_remove "$target"
	fi
}

cleanup() {
	local exit_code=$?
	set +e

	if [ -n "$KDCO_PID" ] && kill -0 "$KDCO_PID" >/dev/null 2>&1; then
		kill "$KDCO_PID" >/dev/null 2>&1
		wait "$KDCO_PID" >/dev/null 2>&1
	fi

	if [ -n "$KIT_PID" ] && kill -0 "$KIT_PID" >/dev/null 2>&1; then
		kill "$KIT_PID" >/dev/null 2>&1
		wait "$KIT_PID" >/dev/null 2>&1
	fi

	restore_path "$GLOBAL_CONFIG_DIR" "$GLOBAL_BACKUP_PATH"
	restore_path "$REPO_CONFIG_DIR" "$REPO_BACKUP_PATH"

	if [ -e "$SHIM_PATH" ] || [ -L "$SHIM_PATH" ]; then
		safe_remove "$SHIM_PATH"
	fi

	printf '\nVHS recording workflow complete.\n'
	printf 'Recovery directory: %s\n' "$RECOVERY_DIR"
	printf 'Worker logs:\n'
	printf '  - %s\n' "$KDCO_LOG"
	printf '  - %s\n' "$KIT_LOG"
	printf 'VHS log: %s\n' "$VHS_LOG"

	exit "$exit_code"
}

trap cleanup EXIT INT TERM

printf 'Building local CLI...\n'
bun --cwd "$REPO_ROOT/packages/cli" run build

if [ -e "$GLOBAL_CONFIG_DIR" ] || [ -L "$GLOBAL_CONFIG_DIR" ]; then
	printf 'Backing up %s\n' "$GLOBAL_CONFIG_DIR"
	mv "$GLOBAL_CONFIG_DIR" "$GLOBAL_BACKUP_PATH"
fi

if [ -e "$REPO_CONFIG_DIR" ] || [ -L "$REPO_CONFIG_DIR" ]; then
	printf 'Backing up %s\n' "$REPO_CONFIG_DIR"
	mv "$REPO_CONFIG_DIR" "$REPO_BACKUP_PATH"
fi

cat >"$SHIM_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
IFS=\$'\\n\\t'

# Rewrite production registry URLs to local worker endpoints
args=()
for arg in "\$@"; do
	case "\$arg" in
		https://registry.kdco.dev)
			args+=("http://127.0.0.1:8787")
			;;
		https://ocx-kit.kdco.dev)
			args+=("http://127.0.0.1:8788")
			;;
		*)
			args+=("\$arg")
			;;
	esac
done

# Execute CLI with optional noise filtering for clean demo output.
# When OCX_DEMO_FILTER_NOISE=1, suppress exact "Error: FileNotFound" lines
# that appear in demos but don't affect functionality. Exit code is preserved.
if [ "\${OCX_DEMO_FILTER_NOISE:-}" = "1" ]; then
	bun "$REPO_ROOT/packages/cli/dist/index.js" "\${args[@]}" 2>&1 | grep -v "^Error: FileNotFound\$" || [ \${PIPESTATUS[0]} -eq 0 ] || exit \${PIPESTATUS[0]}
else
	exec bun "$REPO_ROOT/packages/cli/dist/index.js" "\${args[@]}"
fi
EOF
chmod +x "$SHIM_PATH"

printf 'Starting kdco-registry worker on port 8787...\n'
(cd "$REPO_ROOT/workers/kdco-registry" && bun run build && bunx wrangler dev --port 8787 --log-level warn 2>&1 | grep -v "Error: FileNotFound") >"$KDCO_LOG" 2>&1 &
KDCO_PID=$!

printf 'Starting ocx-kit worker on port 8788...\n'
(cd "$REPO_ROOT/workers/ocx-kit" && bun run build && bunx wrangler dev --port 8788 --log-level warn 2>&1 | grep -v "Error: FileNotFound") >"$KIT_LOG" 2>&1 &
KIT_PID=$!

wait_for_worker() {
	local url="$1"
	local label="$2"
	local attempts=0

	until curl --silent --fail --max-time 2 "$url" >/dev/null 2>&1; do
		attempts=$((attempts + 1))
		if [ "$attempts" -ge 60 ]; then
			printf 'Timed out waiting for %s at %s\n' "$label" "$url" >&2
			return 1
		fi
		sleep 1
	done
}

wait_for_worker "http://127.0.0.1:8787/.well-known/ocx.json" "kdco-registry"
wait_for_worker "http://127.0.0.1:8788/.well-known/ocx.json" "ocx-kit"

printf 'Running VHS tapes...\n'
export OCX_DEMO_FILTER_NOISE=1
PATH="$RECOVERY_DIR:$PATH" vhs "$REPO_ROOT/assets/profiles-demo.tape" >>"$VHS_LOG" 2>&1
PATH="$RECOVERY_DIR:$PATH" vhs "$REPO_ROOT/assets/components-demo.tape" >>"$VHS_LOG" 2>&1
PATH="$RECOVERY_DIR:$PATH" vhs "$REPO_ROOT/assets/demo.tape" >>"$VHS_LOG" 2>&1

