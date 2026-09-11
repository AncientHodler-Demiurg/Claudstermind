#!/usr/bin/env bash
# hive-start.sh — Launch the Bee Hive dashboard server in the background.
#
# Responsibilities:
#   1. Discover .bee/ (via --bee-dir or by walking up from pwd).
#   2. Probe any existing .bee/.hive-pid — if the PID is alive, emit
#      {"status":"already_running","pid":N} and exit non-zero. DO NOT kill
#      live instances (hive-stop.sh is the only script allowed to terminate).
#      If the PID is dead, remove the stale file and proceed.
#   3. Resolve the owner PID (grandparent of this script — the Claude session
#      shell). $PPID is the ephemeral shell that ran us; the session is its
#      parent. Fall back to $PPID if the grandparent lookup returns empty or
#      PID 1 (init).
#   4. Launch `node hive-server.js` in the background via nohup + disown,
#      redirecting stdout/stderr to .bee/.hive.log and passing HIVE_OWNER_PID
#      so the server can tie its lifetime to the owning session.
#   5. Poll .hive.log for the anchored JSON marker '"type":"server-started"'
#      up to 20 iterations at 0.1s each (2 seconds total). On detection,
#      verify the PID is still alive via `kill -0` (reaper environments kill
#      detached processes shortly after backgrounding).
#   6. Print the server-started JSON line and exit 0 on success, or emit a
#      {"status":"failed",...} JSON and exit non-zero on timeout.
#
# Zero dependencies beyond standard bash + ps + grep + node.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---------- Argument parsing ----------
BEE_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bee-dir)
      BEE_DIR="$2"
      shift 2
      ;;
    *)
      printf '{"status":"failed","error":"Unknown argument: %s"}\n' "$1"
      exit 1
      ;;
  esac
done

# ---------- Discover .bee/ directory ----------
# Default: walk up from pwd looking for a .bee/ sibling. Stop at filesystem
# root. This lets the script be invoked from any subdirectory of a
# bee-managed project without requiring the caller to pass --bee-dir.
if [[ -z "$BEE_DIR" ]]; then
  DIR="$(pwd)"
  for _ in $(seq 1 50); do
    if [[ -d "$DIR/.bee" ]]; then
      BEE_DIR="$DIR/.bee"
      break
    fi
    parent="$(dirname "$DIR")"
    if [[ "$parent" == "$DIR" ]]; then
      break
    fi
    DIR="$parent"
  done
fi

if [[ -z "$BEE_DIR" || ! -d "$BEE_DIR" ]]; then
  printf '{"status":"failed","error":"Could not discover .bee/ directory. Pass --bee-dir <path> or run from inside a bee-managed project."}\n'
  exit 1
fi

PID_FILE="$BEE_DIR/.hive-pid"
LOG_FILE="$BEE_DIR/.hive.log"

# ---------- Stale PID handling ----------
# If .hive-pid exists, probe with `kill -0`. If the process is alive, refuse
# to start a second instance. If the process is dead, remove the stale file
# and proceed.
if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    printf '{"status":"already_running","pid":%s}\n' "$existing_pid"
    exit 1
  fi
  # Dead PID or unreadable file → clean up and continue.
  rm -f "$PID_FILE"
fi

# ---------- Resolve owner PID (grandparent of this script) ----------
# $PPID is the ephemeral shell the Claude session spawned to run us — it
# dies when this script exits. The Claude session itself is $PPID's parent.
OWNER_PID="$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')"
if [[ -z "$OWNER_PID" || "$OWNER_PID" == "1" ]]; then
  OWNER_PID="$PPID"
fi

# ---------- Launch server in background ----------
# nohup: survive shell exit. disown: remove from job table. `&`: background.
# env: pass HIVE_OWNER_PID and HIVE_BEE_DIR through to the node process.
# HIVE_BEE_DIR is required because hive-server.js often runs from the plugin
# cache (~/.claude/plugins/cache/...) where walking up from __dirname finds
# no .bee/ ancestor — without this env var, resolveBeeDir() returns null and
# the snapshot handler stays on its empty stub, leaving the dashboard blank.
# Redirect both stdout and stderr to the log file so we can grep for the
# server-started marker.
nohup env HIVE_OWNER_PID="$OWNER_PID" HIVE_BEE_DIR="$BEE_DIR" node "$SCRIPT_DIR/hive-server.js" > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null || true
echo "$SERVER_PID" > "$PID_FILE"

# ---------- Wait for server-started marker ----------
# Poll up to 20 iterations at 0.1s each (2 seconds total). The grep pattern
# is anchored to the JSON field '"type":"server-started"' so we don't match
# incidental log lines that happen to contain the phrase.
for i in {1..20}; do
  if grep -q '"type":"server-started"' "$LOG_FILE" 2>/dev/null; then
    # Verify the server PID is still alive. Reaper environments (Codex CI,
    # Git Bash) kill detached processes shortly after nohup returns — we
    # need to catch that and report it as a failure rather than claim
    # success for a dead process.
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      rm -f "$PID_FILE"
      printf '{"status":"failed","error":"Server started but was killed by the environment (process reaper). Retry in a persistent terminal."}\n'
      exit 1
    fi
    # Print the server-started JSON line for the caller to parse.
    grep '"type":"server-started"' "$LOG_FILE" | head -1
    exit 0
  fi
  sleep 0.1
done

# ---------- Timeout ----------
# Server did not emit the server-started marker within 2 seconds. Kill the
# orphaned server process BEFORE removing the PID file, otherwise the node
# process keeps running and holds the port — making the next start fail with
# EADDRINUSE and no way to recover without manually hunting the PID.
kill "$SERVER_PID" 2>/dev/null
sleep 0.2
kill -0 "$SERVER_PID" 2>/dev/null && kill -9 "$SERVER_PID" 2>/dev/null
rm -f "$PID_FILE"
printf '{"status":"failed","error":"Server did not emit server-started within 2 seconds"}\n'
exit 1
