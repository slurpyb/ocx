#!/usr/bin/env bash

set -u -o pipefail
IFS=$'\n\t'

usage() {
	cat <<'EOF'
Usage:
  OCX_REPO=/path/to/ocx scripts/manual-test-runner.sh preflight
  OCX_REPO=/path/to/ocx scripts/manual-test-runner.sh resume-2-4

Modes:
  preflight   Validate environment and registry prerequisites.
  resume-2-4 Run docs/MANUAL_TESTING.md sections 2.4 -> 2.6, stopping on first failure.
EOF
}

fail() {
	printf 'ERROR: %s\n' "$1" >&2
	exit 1
}

format_command() {
	local formatted=""
	local token
	for token in "$@"; do
		printf -v formatted '%s%q ' "$formatted" "$token"
	done
	printf '%s' "${formatted% }"
}

declare -a OCX_RUNNER=()
STEP_INDEX=0
LAST_COMMAND=""
LAST_EXIT_CODE=0
LAST_STDOUT_FILE=""
LAST_STDERR_FILE=""

ensure_env_defaults() {
	if [[ -z "${OCX_REPO:-}" ]]; then
		fail "OCX_REPO is required (example: export OCX_REPO=/Users/kenny/workspace/kdcokenny/ocx)"
	fi

	export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-/tmp/ocx-v2-test}"
	export OCX_BIN="${OCX_BIN:-$OCX_REPO/packages/cli/dist/index.js}"

	LOG_ROOT="${OCX_MANUAL_TEST_LOG_ROOT:-/tmp/ocx-manual-test-logs}"
	RUN_ID="$(date +"%Y%m%d-%H%M%S")"
	LOG_DIR="$LOG_ROOT/$MODE-$RUN_ID"
	mkdir -p "$LOG_DIR"

	printf 'Mode: %s\n' "$MODE"
	printf 'OCX_REPO: %s\n' "$OCX_REPO"
	printf 'OCX_BIN: %s\n' "$OCX_BIN"
	printf 'XDG_CONFIG_HOME: %s\n' "$XDG_CONFIG_HOME"
	printf 'Logs: %s\n' "$LOG_DIR"
}

resolve_ocx_runner() {
	if [[ ! -f "$OCX_BIN" ]]; then
		fail "OCX_BIN does not exist: $OCX_BIN"
	fi

	if [[ -x "$OCX_BIN" ]]; then
		OCX_RUNNER=("$OCX_BIN")
		return
	fi

	local first_line=""
	IFS= read -r first_line <"$OCX_BIN" || true

	if [[ "$first_line" == *"bun"* ]]; then
		command -v bun >/dev/null 2>&1 || fail "OCX_BIN uses a bun shebang, but bun is not installed"
		OCX_RUNNER=("bun" "$OCX_BIN")
		return
	fi

	if [[ "$first_line" == *"node"* ]]; then
		command -v node >/dev/null 2>&1 || fail "OCX_BIN uses a node shebang, but node is not installed"
		OCX_RUNNER=("node" "$OCX_BIN")
		return
	fi

	fail "OCX_BIN is not executable and does not have a bun/node shebang: $OCX_BIN"
}

check_registry() {
	local port="$1"
	local url="http://127.0.0.1:${port}/index.json"

	if ! curl --silent --show-error --fail --max-time 3 "$url" >/dev/null; then
		fail "Registry check failed for port ${port}. Start local wrangler dev server and retry. URL: ${url}"
	fi

	printf 'OK: registry reachable on port %s\n' "$port"
}

run_logged() {
	local section="$1"
	shift
	local -a cmd=("$@")

	STEP_INDEX=$((STEP_INDEX + 1))
	local step_label
	printf -v step_label '%02d' "$STEP_INDEX"

	local stdout_file="$LOG_DIR/${step_label}.stdout.log"
	local stderr_file="$LOG_DIR/${step_label}.stderr.log"
	local meta_file="$LOG_DIR/${step_label}.meta.log"
	local command_string
	command_string="$(format_command "${cmd[@]}")"

	printf 'SECTION: %s\n' "$section" >"$meta_file"
	printf 'COMMAND: %s\n' "$command_string" >>"$meta_file"

	"${cmd[@]}" >"$stdout_file" 2>"$stderr_file"
	local exit_code=$?

	printf 'EXIT_CODE: %s\n' "$exit_code" >>"$meta_file"
	printf 'STDOUT_LOG: %s\n' "$stdout_file" >>"$meta_file"
	printf 'STDERR_LOG: %s\n' "$stderr_file" >>"$meta_file"

	LAST_COMMAND="$command_string"
	LAST_EXIT_CODE="$exit_code"
	LAST_STDOUT_FILE="$stdout_file"
	LAST_STDERR_FILE="$stderr_file"

	printf '\n[%s]\n' "$section"
	printf 'command: %s\n' "$command_string"
	printf 'exit: %s\n' "$exit_code"

	if [[ -s "$stdout_file" ]]; then
		printf '%s\n' '--- stdout ---'
		cat "$stdout_file"
	fi

	if [[ -s "$stderr_file" ]]; then
		printf '%s\n' '--- stderr ---'
		cat "$stderr_file"
	fi

	return "$exit_code"
}

report_failure() {
	local section="$1"
	printf '\nFAILURE\n' >&2
	printf 'section: %s\n' "$section" >&2
	printf 'command: %s\n' "$LAST_COMMAND" >&2
	printf 'exit code: %s\n' "$LAST_EXIT_CODE" >&2
	printf 'stdout log: %s\n' "$LAST_STDOUT_FILE" >&2
	printf 'stderr log: %s\n' "$LAST_STDERR_FILE" >&2

	if [[ -s "$LAST_STDOUT_FILE" ]]; then
		printf '%s\n' '--- stdout ---' >&2
		cat "$LAST_STDOUT_FILE" >&2
	fi

	if [[ -s "$LAST_STDERR_FILE" ]]; then
		printf '%s\n' '--- stderr ---' >&2
		cat "$LAST_STDERR_FILE" >&2
	fi
}

run_or_stop() {
	local section="$1"
	shift
	if ! run_logged "$section" "$@"; then
		report_failure "$section"
		exit "$LAST_EXIT_CODE"
	fi
}

assert_last_output_contains() {
	local section="$1"
	local expected="$2"

	if grep -q -- "$expected" "$LAST_STDOUT_FILE" || grep -q -- "$expected" "$LAST_STDERR_FILE"; then
		printf 'assertion: output contains "%s"\n' "$expected"
		return 0
	fi

	printf 'assertion failed in %s: expected output to contain "%s"\n' "$section" "$expected" >&2
	return 1
}

run_preflight() {
	resolve_ocx_runner
	check_registry 8787
	check_registry 8788

	run_or_stop "preflight: OCX version" "${OCX_RUNNER[@]}" --version
	run_or_stop "preflight: profile rm help" "${OCX_RUNNER[@]}" profile rm --help

	if ! grep -q -- '--global' "$LAST_STDOUT_FILE"; then
		fail "Preflight check failed: 'profile rm --help' did not include --global"
	fi

	printf '\nPreflight passed.\n'
}

run_resume_2_4() {
	run_preflight

	if [[ ! -f "$XDG_CONFIG_HOME/opencode/ocx.jsonc" ]]; then
		fail "Missing global config at $XDG_CONFIG_HOME/opencode/ocx.jsonc (run manual test section 2.1 first)"
	fi

	if [[ ! -d /tmp/ocx-v2-test-project ]]; then
		fail "Missing /tmp/ocx-v2-test-project (run manual test section 1.1 first)"
	fi

	run_or_stop "2.4 install profile from registry" "${OCX_RUNNER[@]}" profile add work --source kit/omo --global
	run_or_stop "2.4 verify profile show" "${OCX_RUNNER[@]}" profile show work
	run_or_stop "2.4 verify profile directory" ls -la "$XDG_CONFIG_HOME/opencode/profiles/work/"

	pushd /tmp/ocx-v2-test-project >/dev/null || fail "Unable to enter /tmp/ocx-v2-test-project"

	run_or_stop "2.5 launch OpenCode with profile" "${OCX_RUNNER[@]}" oc -p work run "echo hello"
	if ! assert_last_output_contains "2.5 launch OpenCode with profile" "hello"; then
		report_failure "2.5 launch OpenCode with profile"
		popd >/dev/null || true
		exit 1
	fi

	export OCX_PROFILE=work
	printf '\n[2.6] export OCX_PROFILE=work\n'

	run_or_stop "2.6 launch OpenCode using OCX_PROFILE" "${OCX_RUNNER[@]}" oc run "echo hello"
	if ! assert_last_output_contains "2.6 launch OpenCode using OCX_PROFILE" "hello"; then
		report_failure "2.6 launch OpenCode using OCX_PROFILE"
		popd >/dev/null || true
		exit 1
	fi

	popd >/dev/null || true

	printf '\nresume-2-4 completed without failures.\n'
}

MODE="${1:-}"
if [[ -z "$MODE" ]]; then
	usage
	exit 1
fi

case "$MODE" in
	preflight|resume-2-4)
		;;
	*)
		usage
		exit 1
		;;
esac

ensure_env_defaults

case "$MODE" in
	preflight)
		run_preflight
		;;
	resume-2-4)
		run_resume_2_4
		;;
esac
