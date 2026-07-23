# Review — local ↔ remote unification

## Round 1 — two lenses (correctness, security/permissions)

| # | Sev | File | Finding | Fix |
|---|-----|------|---------|-----|
| 1 | HIGH | `agent/agent.mjs` | Sharing one `WorkspaceManager` between the dashboard and the bridge meant **every** session's events — including ones started purely on the local machine, with no remote party ever attaching — fanned out unconditionally to the outbound tunnel sink the moment the bridge was connected (the normal operating state). The relay then broadcast any such frame to every currently-connected `ancient`-role subscriber with no per-workspace filtering. This was a real gap in this topic's own design.md (acceptance criterion 3 signed off on the mechanism without weighing the consequence): before this topic, purely-local sessions never reached the tunnel at all. | A session's events now only cross the tunnel once that session has genuinely been touched by a real inbound `WS_IN` prompt (unambiguous proof of remote interest), re-evaluated on every send — a session that starts local-only and later gets a real remote prompt starts flowing from that point on. Workspace-wide read actions (history/search/tree/etc.) and direct replies to an explicit remote "open" request are left ungated, since gating those would break remote history browsing without closing any real leak. The local SSE sink is completely unaffected either way. |
| 2 | MEDIUM | `agent/agent.mjs` | The bridge's `stop()` never removed the sink it registered via `addSink` at construction. Every relay-config save (or process restart) re-registered a fresh sink onto the same long-lived, shared `WorkspaceManager` with nothing ever evicting the previous, now-permanently-dead-socket one — an unbounded reference leak for the life of the dashboard process (confirmed non-crashing: the stale closure's own socket-state guard makes it a silent no-op, but still a real leak introduced by moving to instance-sharing). | `stop()` now calls `removeSink` on the exact sink reference it registered, symmetric with the `addSink` call — verified across repeated restart cycles that `_sinks` returns to its baseline size each time, no accumulation. |
| 3 | MEDIUM | `lib/workspace.mjs` | `WorkspaceManager.send`'s fan-out loop had no per-sink exception isolation, unlike the dashboard's own analogous `wsBroadcast`. A throw in one sink (a realistic path — both real sink implementations do an unguarded `JSON.stringify`) would abort delivery to every sink registered after it, and — since `_prompt` calls `send()` before dispatching the turn to the SDK — could silently drop the user's prompt entirely. | Each sink call is now individually wrapped in try/catch, matching `wsBroadcast`'s existing precedent — one misbehaving sink can no longer block another or abort the caller. |

All three: **CONFIRMED** by adversarial validation (independent read + active attempt to refute), no REFUTED, no STYLISTIC. Finding 1 was the most heavily scrutinized given its severity; the validator specifically checked for any existing gate (role check, attach-based filter, per-session origin flag) before confirming none existed.

No findings for: sink double-registration on reconnect (reconnects reuse the same `createBridge()` closures — no re-registration occurs mid-connection, only on an explicit relay-config save or restart); the turn-lock (keys strictly on `sessionKey`, not connection/origin, so a prompt from either attachment point is treated identically); any new gating bypass (every route reaching the shared instance still evaluates `who.canExecute`/`who.localActionsAvailable` first, unchanged).

## Evidence

```
node --test (repo root, run fresh after all three fixes):
# tests 311
# suites 0
# pass 310
# fail 1
# duration_ms 1896.16
```
The one failure, `orchestrator/backup.test.mjs`'s "listing an unreachable backup root reports unavailable, not a crash," is the same pre-existing, unrelated failure tracked since before this topic began — confirmed unchanged in count and identity.

Real cross-surface proof (`lib/localRemoteUnification.integration.test.mjs`, unmodified by the fix round, still green): a genuine inbound `WS_IN` prompt and a genuine local `handleIn` call on the same `sessionKey` hit the identical in-memory session object; a concurrent local prompt during the WS_IN turn correctly receives exactly one `busy`; the resulting `result` event reaches both a fake local SSE sink and a fake tunnel capture with byte-identical content.

## Deferred (not defects)

- Full per-subscriber, per-workspace filtering on the relay side (`relay/relay-core.mjs`'s `_fanWsOut`) was considered for Finding 1 and rejected as unnecessarily invasive and race-prone (the browser's `attach` round-trip and the prompt's `WS_IN` frame have no ordering guarantee relative to each other) in favor of the simpler, race-free "touched by a real remote prompt" gate, which closes the actual leak without new cross-module plumbing.

## Final state

`lib/workspace.mjs` and `agent/agent.mjs` now share one live `WorkspaceManager` per the design's intent — local and relay-forwarded prompts on the same workspace are provably the same session, the turn-lock applies across both, and sink delivery is resilient to a single bad sink — while purely-local sessions no longer cross the tunnel by default, closing the privacy gap the design itself had introduced.

Clean pass.
