#!/bin/bash
# Fast gate for the SubagentStop validator dispatcher (validators/dispatch.js).
#
# Every per-agent validator opens with `if (!autoModeActive(payload)) return
# emitVerdict(true)` — i.e. in manual (non-autonomous) mode the validators boot
# node, check one marker file, emit a pass verdict, and exit. This wrapper does
# that same marker check in bash (~half a node cold-start) and skips node
# entirely when no autonomous run is active — the common case. When an autonomous
# run IS active, it execs the dispatcher so behaviour is byte-for-byte identical.
#
# Marker: .bee/.autonomous-run-active (mirrors autoModeActive in validators-lib.js;
# the validators do NOT gate on the dashboard's .hive-pid).
#
# Root resolution: the validators resolve root via payload.cwd FIRST, then
# CLAUDE_PROJECT_DIR, then cwd (validators-lib.js resolveRoot). The gate cannot read
# payload.cwd without booting node, so it checks BOTH CLAUDE_PROJECT_DIR and $PWD (the
# hook's cwd, which tracks the agent's cwd ≈ payload.cwd). Checking both is fail-open:
# in a worktree / multi-root run the gate still boots node whenever either root has the
# marker, so it NEVER skips validation while an autonomous run is active. In the common
# single-root case the two roots coincide and the manual-mode skip is unchanged.
#
# Always exits 0 — a non-zero SubagentStop hook can disrupt the agent lifecycle.
for _root in "${CLAUDE_PROJECT_DIR:-$PWD}" "$PWD"; do
  if [ -f "$_root/.bee/.autonomous-run-active" ]; then
    exec node "$(dirname "$0")/validators/dispatch.js"
  fi
done
exit 0
