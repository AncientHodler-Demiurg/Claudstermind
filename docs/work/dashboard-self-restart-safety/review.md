# Review — dashboard self-restart safety

This was the highest-stakes topic in the project — a mechanism that restarts the very process
serving the live site — so it got a dedicated correctness/concurrency/safety lens on top of the
normal build discipline, in addition to two mid-build gaps the implementers themselves caught.

## Gaps caught during build (not review findings — engineering discipline working as intended)

- Task 2.1 confirmed the restart route was local-dashboard-only; task 2.2 mirrored `/api/deploy`'s
  exact relay-forwarding mechanism (an ad-hoc `WS_IN kind:"restart"` frame, not a `WS_CONTROL_ACTIONS`
  entry) so the live site can trigger it too.
- Task 2.2 in turn surfaced that `createBridge(...)`'s `restart:` wiring didn't exist yet — the
  relay/tunnel plumbing was fully built and tested against mocks but had nothing to call in
  production. Task 2.3 closed that one-line-but-critical gap with a real (not mocked) end-to-end
  test through an actual bridge connection.

## Round 1 — correctness/concurrency/safety lens

| # | Sev | File | Finding | Fix |
|---|-----|------|---------|-----|
| 1 | HIGH | `relay/relay-core.mjs`, `relay/server.mjs`, `dashboard/public/app.js` | A remote-triggered restart's tunnel drop is fanned out by the relay as a `bridgeDisconnected` state frame, but the restart-stream route only forwards `restart-log`/`restart-done` kinds — the drop is silently discarded. Worse: the browser's SSE connection to the *relay* (not the work machine) stays open and healthy, so `onerror` never fires either. Net: the live-site restart button got stuck on "Restarting…" forever, on **every** real remote-triggered restart — not an edge case, the primary documented use case. | A generous **timeout-based** client-side fallback (40s — pre-flight's own 15s budget plus realistic `systemctl restart` round-trip headroom), independent of whether the stream ever errors: if no terminal sentinel arrives in time, the UI shows "no confirmation received — checking if it's back up…" and falls into the existing back-up-polling mechanism. An `onerror`-triggered fallback was added alongside it for the local case, which resolves faster since the connection genuinely does drop there. |
| 2 | MEDIUM | `dashboard/server.mjs` | The local restart's `"__DONE_OK__"` sentinel write and the process's own SIGTERM-triggered `process.exit(0)` (no drain) have no code-level ordering guarantee — only a timing accident (a `systemctl` round-trip is far slower than a local buffered write, so this is low-probability, not zero). | Covered by the same timeout/onerror fallback above — the local case's `onerror` fires reliably when the connection actually drops, so this is functionally closed without needing to restructure the shutdown sequence itself. |
| 3 | MEDIUM | `dashboard/server.mjs` | `CM_PREFLIGHT=1` only gated the real bridge connection — the LocalHost aggregator and backup-scheduler timers had no such gate, so a pre-flight candidate could (in the narrow case the real aggregator wasn't already up) spawn a real aggregator child and kill it again a few seconds later — a side effect on shared infrastructure from what's supposed to be a pure, isolated health check. | Extracted the boot logic into an injectable `bootLocalSubsystems(...)` gated behind the same `bridgeEnabled()` check the bridge itself uses — a preflight candidate now touches nothing shared: no bridge, no aggregator, no scheduler. |
| 4 | MEDIUM | `dashboard/server.mjs`, `lib/selfRestart.mjs` | The pre-flight candidate's random scratch port (20000-39999) had no check against the real dashboard's own port. A collision (not possible under today's `PORT=3001` config, but not structurally prevented either) would make the health check hit the *already-healthy real process* instead of the candidate, producing a false "pre-flight passed" that proved nothing. | The scratch port now re-rolls until it provably differs from the resolved real port. As defense in depth, `/api/version` now also echoes whether it's answering *as* a preflight instance, and the pre-flight poll requires that marker before accepting a response as healthy — a stray 200 from some other process can no longer be mistaken for the candidate. |
| 5 | MEDIUM | `lib/selfRestart.mjs` | The pre-flight candidate had no lifecycle tie to its parent — if the main process died abruptly (bypassing graceful shutdown) while a candidate was mid-poll, nothing would reap it, leaking a Node process holding the scratch port. Mitigated only by an undocumented reliance on systemd's default `KillMode`, with no mitigation at all in the handoff doc's own documented manual-run path. | The current in-flight candidate is now tracked and force-killed from the same coordinated shutdown path the process already uses for its other cleanup (`AGG.stop()`), rather than depending on an external default. |

All five: **CONFIRMED** by adversarial validation. Two severities were adjusted during validation from the lens's own read: finding 2 from HIGH to MEDIUM (the local case's `onerror` does fire reliably, unlike the remote case), and the validator confirmed the suggested "just add an onerror fallback" fix was insufficient for finding 1 on its own — a timeout-based guard was required since `onerror` provably never fires in that scenario.

No findings on: the `RESTART.running` guard (verified atomic and correctly shared across the local route, the relay-forwarded path, and the watchdog script — no double-restart or double-candidate scenario is reachable through any supported trigger); the systemd unit's actual deployed configuration (no `KillMode=` override, default `control-group` applies, confirmed against the real handoff doc).

## Evidence

```
node --test (repo root, run fresh after all fixes):
# tests 356
# suites 0
# pass 355
# fail 1
# duration_ms 4310.31
```
The one failure, `orchestrator/backup.test.mjs`'s "listing an unreachable backup root reports unavailable, not a crash," is the same pre-existing, unrelated failure tracked since before this project's first topic — confirmed unchanged in count and identity across every checkpoint of all four topics.

`node --check` clean on `dashboard/server.mjs`, `dashboard/public/app.js`, `lib/selfRestart.mjs`.

No jsdom/browser harness exists for `dashboard/public/app.js` (consistent with every prior topic) — the restart button's UI states (streaming, refusal-with-reason, success-then-reconnect, and now the timeout/error fallback paths) were verified via written, quoted, step-by-step traces against scripted mock event sequences, run through the actual shipped source (not a reimplementation) via a sandboxed extraction, the most rigorous version of this project's established substitute.

## Deferred (not defects) — requires a human with root, by design

- **The one-time sudoers/polkit grant.** The dashboard process needs permission to run `systemctl restart claudstermind` without a password prompt. This was deliberately never applied automatically — per this topic's own design constraint and this project's existing convention (see `docs/MIGRATION-LINUX-HANDOFF.md`'s manual `sudo systemctl enable --now` step), editing system security configuration is a human-with-root action, not something an autonomous run does silently. **Add this line via `sudo visudo`** (adjust the user if not `ancientbox`):
  ```
  ancientbox ALL=(root) NOPASSWD: /usr/bin/systemctl restart claudstermind
  ```
- **The watchdog timer is shipped, not installed.** `ops/claudstermind-watchdog.mjs` + `.service` + `.timer` exist in the repo as installable artifacts, documented in `docs/MIGRATION-LINUX-HANDOFF.md` §13, following the exact same "copy the unit, `daemon-reload`, `enable --now`" convention already used for `claudstermind.service` itself. Nothing in this build applied them.
- **No heartbeat/uptime endpoint exists yet.** The watchdog script derives disconnect duration from its own small state file and process uptime from `systemctl show`, rather than a dedicated dashboard API field, since adding one was outside this topic's file scope. Documented as a real gap, not silently papered over — a future task should add a proper status field if the workaround proves fragile.

## Final state

The local dashboard already had crash-only supervision (systemd, `Restart=on-failure`). This topic adds: detection for the failure mode systemd can't see (alive but disconnected); a restart control reachable identically from the local dashboard and the live site, gated the same way the existing Deploy button is; and — the actual point of the whole topic — a restart that never touches the live process unless a fully-isolated, unmarked-response-proof, self-cleaning sandboxed candidate proves the code on disk would actually come back up, with the UI now guaranteed to reach a final answer (success, explicit refusal-with-reason, or a bounded "presumed restarting" fallback) rather than silence, on every trigger path.

Clean pass.
