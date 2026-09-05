# Agentic Chat Engine — plan

Waves: parallel where files don't conflict (new modules/docs); the two giant files (`lib/workspace.mjs`,
`dashboard/public/app.js`) are edited SERIALLY. Each shipped increment = version bump + CHANGELOG + green tests.

## Wave 0 — DONE (prior)
- [x] `lib/conversationWindow.mjs` (+ integrated into `capTranscript` w/ `around`) — 15 tests
- [x] `lib/imageStore.mjs` — 9 tests
- [x] `lib/conversationRoll.mjs` — 14 tests
- [x] `lib/contextUsage.mjs` — 11 tests

## Wave 1 — new modules (PARALLEL agents; new files only)
- [x] T1.1 `lib/conversationArchive.mjs` + test — archive a rolled head segment to disk under `segmentRef`, an
      index (turn#→segment + segment metadata), and `recallTurn(index, n)` / `recall(index, query)` (substring/
      keyword scan; no embeddings). Pure IO to an archive dir.
- [x] T1.2 `lib/backgroundTasks.mjs` + test — pure shaping of the SDK task set (`background_tasks_changed` /
      `task_started` / `task_notification`) into `{ count, agents:[{id,type,subagentType,description,startedAt,
      tokens,status}], totalTokens }` for the panel.

## Wave 2 — server integration (SERIAL, me: workspace.mjs / claudeSession.mjs / workspaceStore.mjs)
- [x] T2.1 **CLOSED — the original task was not needed.** Images have ALWAYS been externalized by
      `workspaceStore.saveImage` (live install: 55 MB of `images/` blobs vs 4.1 MB of JSONL text, zero inline
      base64 image blocks); `lib/imageStore.mjs` is an unused second implementation. The REAL gaps, all fixed
      in 1.5.91: chained segments claimed overlapping absolute P#/R# ranges (so recall answered with the wrong
      turn) and restarted numbering after a process restart (overwriting an existing segment file); the archive
      recorded no `workspaceId`, so a recalled turn's image path resolved to nothing; `_segments` was enumerated
      as a bogus workspace and was one row-order coincidence from being merged back into the pane; and a
      one-time backfill (`migrateLegacyRootSegments`) now relocates the archive an earlier build left at the
      transcript root. Also: `statSync` was never imported into workspace.mjs, so the cold-load cue never fired.
- [x] T2.2 Forward the FULL context breakdown (shape via `contextUsage`) in the `contextUsage` event.
- [x] T2.3 Background-task telemetry wired (1.5.92): `ClaudeSession.backgroundPanel()`, `panel` on every
      background/taskStarted/taskDone event, `backgroundPanel` on `sessionSummary` (so a RECONNECTING client
      gets the fleet state). `background`/`tasks` stay arrays — additive only. `toEvent` now also forwards
      `subagentType`/`workflowName`/settle-time `tokens`, read defensively.
- [x] T2.4 Auto-roll lifetime hook (`conversationRoll` + `conversationArchive`): detect `shouldRoll` after a turn →
      summarize head → create fresh SDK session seeded via `buildSeedText` → archive head + index → switch. Emit
      the `⟳ rolling` indicator state.
- [x] T2.5 `recall` control action + the `lookingUp`/`recall` ON/OFF cue pair (1.5.93); `around` jump confirmed
      end-to-end on both `open` and `resync`. NOT done: the agent-side recall TOOL (the model still cannot call
      recall itself) — tracked as a follow-up, see CONTRACT.md §5.

## Contract freeze
- [x] `docs/work/agentic-chat-engine/CONTRACT.md` — the frozen event/action shapes Wave 3 builds against.

## Wave 3 — client (SERIAL, me: dashboard/public/app.js + styles.css)
- [ ] T3.1 Shared **context popover** helper (from the forwarded breakdown) → mount in Core + Pact.
- [ ] T3.2 Shared **background-agents panel** helper → mount in Core + Pact.
- [ ] T3.3 **Threshold indicators** (compacting / rolling / looking-up) — reuse the pact-sync-cue pattern, shared.
- [ ] T3.4 **Jump-to-#N** + windowed render + LRU scroll-cache (uses server `around`) — Core + Pact.
- [ ] T3.5 **Recall cue** surfaced in the transcript.

## Wave 4 — DMP contract (PARALLEL agent; doc only)
- [x] T4.1 `Claudstermind/HANDOFF-DMP-CHAT-ENGINE.md` — the locked contract for the DMP agent to implement against
      its per-request `ai/agent.mjs` (lifetime thresholds, storage/segment model, telemetry shape, nav API,
      indicator states) — a spec, not code.

## Review
- [ ] `node --test` across touched suites green (except the 1 known pre-existing cache failure); `node --check` all.
- [ ] Review pass (lenses + adversarial validate) → clean.
