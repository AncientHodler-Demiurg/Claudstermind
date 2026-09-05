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
- [~] T2.1 (FINDING: store already externalizes images; refocused onto the roll seed) Wire `imageStore` into the transcript persist path (externalize on save) + a one-time backfill on load.
- [x] T2.2 Forward the FULL context breakdown (shape via `contextUsage`) in the `contextUsage` event.
- [~] T2.3 (module built + tested; fold into sessionSummary = follow pass) Background-task telemetry: fold `backgroundTasks` shaping into `sessionSummary` + the `background` event.
- [x] T2.4 Auto-roll lifetime hook (`conversationRoll` + `conversationArchive`): detect `shouldRoll` after a turn →
      summarize head → create fresh SDK session seeded via `buildSeedText` → archive head + index → switch. Emit
      the `⟳ rolling` indicator state.
- [~] T2.5 (recall lookup built in conversationArchive; control action/agent-tool = follow pass) `recall` control action (+ `🔍 looking up` state) and confirm the `around` jump action end-to-end.

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
