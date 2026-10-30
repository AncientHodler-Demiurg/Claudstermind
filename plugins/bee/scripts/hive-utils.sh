#!/usr/bin/env bash
# hive-utils.sh — Sourceable shell library for the Bee Hive dashboard.
#
# Exposes two functions that other scripts (hive-start.sh, hive-stop.sh) and
# the `/bee:hive` command may consume:
#
#   check_running [bee_dir]
#     Inspects the hive PID file at ${bee_dir}/.hive-pid (defaults to
#     ${BEE_DIR:-$PWD/.bee}) and reports the server state as a JSON
#     object on stdout:
#
#       {"status": "not_running"}                                — no PID file, or PID is dead
#       {"status": "unresponsive", "pid": N}                     — PID is alive but HTTP probe failed
#       {"status": "running", "pid": N, "url": "http://..."}     — PID is alive and /api/snapshot returned 200
#
#     When the PID file points at a dead process, the stale PID file is
#     removed but the log file (.hive.log) is PRESERVED so that crash
#     diagnostics survive the cleanup.
#
#   open_browser URL
#     Opens the given URL in the default browser. Platform detection uses
#     `uname -s`:
#       Darwin  -> `open "$URL"`
#       Linux   -> `xdg-open "$URL"`
#       other   -> prints a warning on stderr and returns 0
#     The open invocation is backgrounded (`&`) and disowned so the
#     caller does not wait. Failure is non-fatal: stderr is suppressed
#     and the function always returns 0.
#
# This file is a library. It defines functions but does NOT invoke them
# at load time, so it is safe to `source plugins/bee/scripts/hive-utils.sh`.
# No top-level `set -e` — that would leak into the sourcing shell and
# surprise callers.

# --- check_running ------------------------------------------------------------

check_running() {
  local bee_dir="${1:-${BEE_DIR:-$PWD/.bee}}"
  local pid_file="${bee_dir}/.hive-pid"
  local port="${HIVE_PORT:-3333}"
  local url="http://localhost:${port}"

  # No PID file → not running.
  if [[ ! -f "$pid_file" ]]; then
    echo '{"status": "not_running"}'
    return 0
  fi

  local pid
  pid=$(cat "$pid_file" 2>/dev/null)

  # PID file empty or unreadable → treat as stale, clean up, report not running.
  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo '{"status": "not_running"}'
    return 0
  fi

  # Liveness probe via signal 0 (does not actually send a signal).
  if ! kill -0 "$pid" 2>/dev/null; then
    # Process is dead. Remove the stale PID file but PRESERVE the log
    # file (.hive.log) so crash diagnostics survive.
    rm -f "$pid_file"
    echo '{"status": "not_running"}'
    return 0
  fi

  # Process is alive. Probe HTTP /api/snapshot with `node -e` and the
  # built-in http module — NOT curl/nc, which may be missing on minimal
  # systems. Node.js is guaranteed because the hive server itself runs on Node.
  if node -e "require('http').get('http://127.0.0.1:${port}/api/snapshot', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" 2>/dev/null; then
    printf '{"status": "running", "pid": %s, "url": "%s"}\n' "$pid" "$url"
  else
    printf '{"status": "unresponsive", "pid": %s}\n' "$pid"
  fi
  return 0
}

# --- open_browser -------------------------------------------------------------

open_browser() {
  local url="${1:-}"
  if [[ -z "$url" ]]; then
    echo "hive-utils: open_browser called without a URL" >&2
    return 0
  fi

  local platform
  platform=$(uname -s 2>/dev/null || echo "unknown")

  case "$platform" in
    Darwin)
      # macOS: backgrounded + disowned so the caller does not block.
      # Failure is non-fatal (stderr suppressed, always return 0).
      ( open "$url" >/dev/null 2>&1 & disown ) || true
      ;;
    Linux)
      ( xdg-open "$url" >/dev/null 2>&1 & disown ) || true
      ;;
    *)
      echo "hive-utils: warning: unknown platform '${platform}', cannot open browser for ${url}" >&2
      ;;
  esac
  return 0
}
