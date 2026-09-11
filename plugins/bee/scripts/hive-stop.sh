#!/usr/bin/env bash
# hive-stop.sh -- Stop the Hive Dashboard server with graceful-then-force shutdown.
#
# Behavior:
#   - Reads the server PID from .bee/.hive-pid.
#   - If the PID file is missing: output {"status": "not_running"} and exit 0.
#   - Early liveness check (kill -0): if the recorded PID is already dead,
#     the PID file is stale -- remove it, output {"status": "not_running"},
#     and exit 0. The .bee/.hive.log file is PRESERVED in this case so the
#     user can diagnose why the server died on its own.
#   - If the process is alive: send SIGTERM, poll up to 2s (20 * 0.1s) for
#     graceful exit, then escalate to SIGKILL if still alive.
#   - On successful stop: remove .bee/.hive-pid and output
#     {"status": "stopped"}. The .bee/.hive.log file is preserved so users
#     can inspect the last run -- it will be overwritten by the next start.
#   - On failure to kill: output
#     {"status": "failed", "error": "process still running"} and exit 1.
#
# Usage:
#   hive-stop.sh [--bee-dir <path>]

set -uo pipefail

# -------------------------------------------------------------------
# Locate the .bee directory
# -------------------------------------------------------------------
BEE_DIR=""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bee-dir)
      BEE_DIR="$2"
      shift 2
      ;;
    --bee-dir=*)
      BEE_DIR="${1#--bee-dir=}"
      shift
      ;;
    *)
      # Unknown argument -- ignore for forward compatibility.
      shift
      ;;
  esac
done

# Default: discover .bee by walking up from the current working directory.
if [[ -z "$BEE_DIR" ]]; then
  search_dir="$PWD"
  while [[ "$search_dir" != "/" && "$search_dir" != "" ]]; do
    if [[ -d "$search_dir/.bee" ]]; then
      BEE_DIR="$search_dir/.bee"
      break
    fi
    search_dir="$(dirname "$search_dir")"
  done
fi

# Final fallback: assume .bee lives next to the plugin's parent project root.
if [[ -z "$BEE_DIR" ]]; then
  BEE_DIR="$PWD/.bee"
fi

PID_FILE="$BEE_DIR/.hive-pid"
LOG_FILE="$BEE_DIR/.hive.log"

# -------------------------------------------------------------------
# No PID file -- nothing to stop
# -------------------------------------------------------------------
if [[ ! -f "$PID_FILE" ]]; then
  echo '{"status": "not_running"}'
  exit 0
fi

pid=$(cat "$PID_FILE")

# PID file exists but is empty or non-numeric -- treat as stale.
if [[ -z "$pid" || ! "$pid" =~ ^[0-9]+$ ]]; then
  rm -f "$PID_FILE"
  echo '{"status": "not_running"}'
  exit 0
fi

# -------------------------------------------------------------------
# Early liveness probe: detect stale PID file BEFORE sending any signal.
# If the recorded PID is already dead, clean up the PID file and report
# not_running. PRESERVE the log file so the user can inspect any crash
# output. The log is intentionally kept until the next start overwrites it.
# -------------------------------------------------------------------
if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo '{"status": "not_running"}'
  exit 0
fi

# -------------------------------------------------------------------
# Graceful shutdown: send SIGTERM and poll for exit.
# -------------------------------------------------------------------
kill "$pid" 2>/dev/null || true

# Wait for graceful shutdown (up to ~2s: 20 iterations of 0.1s).
for i in {1..20}; do
  if ! kill -0 "$pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

# -------------------------------------------------------------------
# Escalate to SIGKILL if the process is still alive after the grace period.
# -------------------------------------------------------------------
if kill -0 "$pid" 2>/dev/null; then
  kill -9 "$pid" 2>/dev/null || true
  # Give the kernel a moment to reap the process.
  sleep 0.1
fi

# -------------------------------------------------------------------
# Final verification: if the process is still alive, report failure.
# -------------------------------------------------------------------
if kill -0 "$pid" 2>/dev/null; then
  echo '{"status": "failed", "error": "process still running"}'
  exit 1
fi

# -------------------------------------------------------------------
# Clean stop: remove the PID file but PRESERVE the log file so the user
# can inspect the last session. The next start will overwrite .hive.log.
# -------------------------------------------------------------------
rm -f "$PID_FILE"
echo '{"status": "stopped"}'
exit 0
