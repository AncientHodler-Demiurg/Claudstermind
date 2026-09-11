#!/bin/bash
# Fast gate for emit-event.js — only boot node when an event consumer is active.
#
# emit-event.js fires on the hot path (every tool call, every subagent stop). It
# already no-ops internally when neither consumer marker is present, but that
# check happens AFTER a node cold-start. This wrapper does the same check in bash
# (~half the cold-start cost) and skips node entirely when nobody is reading
# events — the common case (dashboard closed, no autonomous run). When a consumer
# IS active, it execs node so behaviour is byte-for-byte identical.
#
# Consumers (mirrors emit-event.js's own gate exactly):
#   .bee/.hive-pid              — the hive dashboard is running.
#   .bee/.autonomous-run-active — an autonomous run needs SubagentStop telemetry.
#
# Always exits 0 — a non-zero PreToolUse/PostToolUse hook can block the tool call.
ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
if [ -f "$ROOT/.bee/.hive-pid" ] || [ -f "$ROOT/.bee/.autonomous-run-active" ]; then
  exec node "$(dirname "$0")/emit-event.js" "$1"
fi
exit 0
