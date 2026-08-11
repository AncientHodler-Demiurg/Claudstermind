# Deploy-survivable agents — plan

Mode: Autonomous run confirmed 2026-08-12. Waves are sequential (each depends on the prior). Every
task ends tests-green (`node --test --test-concurrency=1`) + `node --check`, one commit, version bump,
CHANGELOG top entry, push to main. Never restart the live service.

## Wave 1 — Foundation (daemon + IPC, no web change)
- [x] T1.1 `lib/sessionIpc.mjs` — newline-delimited JSON framing (encode/decode, partial-buffer safe) + a
      tiny unix-socket server/client helper. Unit test: framing round-trips, split/coalesced chunks.
- [x] T1.2 `sessiond` entrypoint (`sessiond/sessiond.mjs` or `agent/sessiond.mjs`) — build a
      WorkspaceManager, expose prompt/control/subscribe/snapshot over the IPC server; `send` fans out to
      subscribers. Injectable for tests (stub engine + stub socket). Test: prompt→event round-trip.
- [x] T1.3 `deploy/claudstermind-sessiond.service` unit file + `HANDOFF-SESSIOND.md` with the one-time
      install/enable steps and the socket path convention.

## Wave 2 — Web as client (behind fallback flag)
- [x] T2.1 `lib/sessiondClient.mjs` — implements the engine surface the web + bridge use (handleIn →
      prompt/permission/stop/control, the `send` sink, addSink/removeSink, transcriptDir) over IPC;
      auto-reconnect + resubscribe + snapshot catch-up. Also extended `sessiond` to handle the
      permission/stop request frames. Tests against a stub socket (reconnect, event relay, snapshot).
- [x] T2.2 Wire `dashboard/server.mjs`: when `SESSIOND_SOCK` is set+reachable use SessiondClient, else
      in-process WorkspaceManager (today). Browser endpoints unchanged. Test the selection + fallback.
      Selection is `selectWorkspace` (exported, injectable seams); flag-unset path is byte-identical
      (no await, no client constructed) so the live app is unaffected until the daemon is installed.

## Wave 3 — Deploy plan + guard logic (pure)
- [x] T3.1 `lib/deployPlan.mjs` — from changed files + unit defs → `{restarts:[...], daemonAffected}`.
      Tests: web-only vs daemon-inclusive classification.
- [x] T3.2 Busy-state query — "are any sessions mid-turn/unsettled?" from live session summaries. Tests.

## Wave 4 — Deploy panel UX
- [x] T4.1 Running-process list + "what this deploy restarts" banner in the deploy admin section (server
      endpoint listing web/sessiond/localhost-apps + client render).
- [x] T4.2 StoaExplorer-style streamed progress view (study ~/ClaudeWS/StoaChain/seers/StoaExplorer,
      read-only) in Claudstermind's deploy panel.
- [x] T4.3 Replace window.confirm/alert/prompt in the deploy flow with custom in-app modals.
- [x] T4.4 Wire the guard: daemon-affecting deploy + agents busy → custom warn/confirm or block.

## Wave 5 — Bridge parity + review
- [ ] T5.1 Hand the SessiondClient to `createBridge({ workspace })` when the flag is on; remote parity.
- [ ] T5.2 Full review pass (lenses + adversarial validation + fix loop to clean).
