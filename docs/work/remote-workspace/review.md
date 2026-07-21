# Remote Claude Workspace — review

Three parallel lenses (security, correctness, regression) → adversarial validation of the
fixes. Converged clean.

## Round 1 — findings (all addressed)

| # | Sev | Where | Finding | Resolution |
|---|-----|-------|---------|-----------|
| 1 | MED | claudeSession.mjs | `cleanClaudeEnv` copied the whole env → `AGENT_DEVICE_SECRET` (+ any GitHub PAT) inherited by the remotely-driven agent; a prompt-injection could exfiltrate the tunnel credential | Now strips host secrets (SECRETISH regex + AGENT_DEVICE_SECRET/RELAY_URL), keeps only `CLAUDE_CODE_OAUTH_TOKEN`. Test asserts the leak is closed. |
| 2 | LOW | workspace.mjs | `SAFE_NAME` admits `..`; `_create` didn't re-check the joined path under root | Reject `.`/`..`; re-assert `abs` under root before mkdir/git init. |
| 3 | MED | claudeSession.mjs | Multi-turn: status stuck at "idle" from turn 2 (blinker showed idle while working) | `_input` sets "thinking" + emits on each dequeued prompt. |
| 4 | MED | app.js | Sessionless `created`/error notices pushed to `st.transcripts[null]` → silently dropped | Route them to the notice bar; refresh repo list on create. |
| 5 | LOW | workspace.mjs | Permission resolver leaked when a session stopped/deleted mid-prompt | `_resolvePendingFor(deny)` on stop/delete/errored-reprompt. |
| 6 | LOW | relay-core / app.js | Stale "disconnected" note persisted after the bridge reconnected (SSE stays open) | `_attach` fans `bridgeReconnected`; client clears the note. |
| 7 | LOW | app.js | Client "New session" wiped by any `state` refresh before its first prompt | Merge session state by key; preserve local-only sessions. |
| 8 | MED | agent.mjs | Bridge used global `WebSocket` (Node 22+) with no fallback → breaks on stock-Node Ubuntu (the migration target) | `connect()` falls back to the `ws` dependency; reconnect on resolve failure. |
| 9 | LOW | server.mjs | `canWorkspace` computed, unused by the client | Kept as an informative field (tab intentionally shows for ancient even when the bridge is down, with a "not connected" note). Reported as a choice, not fixed. |
| 10 | LOW | app.js | Deep-linking `#workspace` on the LOCAL dashboard opened a doomed SSE (no backend there) | `viewWorkspace` returns an "online-only" notice when `mode !== "live"`. |
| 11 | LOW | workspace.mjs | An errored session couldn't be re-prompted (input silently queued to a dead query) | `_prompt` drops a finished/errored session and starts fresh under the same key. |

**Deadlock caught + fixed while fixing #5:** `_stop` awaited `s.stop()` (blocked inside
`canUseTool`) before settling the permission that would unblock it — reordered to resolve
pending permissions first. New tests lock in #2, #5, #11 and this ordering.

## Round 2 — adversarial validation
Validator verdict: fixes 1–5 groups **CONFIRMED-CORRECT**, **no new defects**. Confirmed:
`AGENT_DEVICE_SECRET` stripped while `PATH`/`HOME`/`CLAUDE_CODE_OAUTH_TOKEN` survive (Linux
sessions won't break); `_stop` deadlock-free with exactly-once permission settle; async
`connect()` prevents a zombie socket on stop-during-resolve and `ws` supports the
`addEventListener` API used; frontend merges/notices reference no undefined vars.

## Final state
- **172 tests, 0 fail** (lib, orchestrator, dashboard/auth, relay, agent).
- **Real end-to-end** (twice): a WorkspaceManager drove a real Claude session (`WORKSPACE-OK`);
  a full-tunnel run (relay→bridge→real Claude) streamed `TUNNEL-OK` back over SSE with usage.
- Relay↔bridge workspace round-trip (mock) green post-fix; bridge reconnected to the live relay.

Clean pass.
