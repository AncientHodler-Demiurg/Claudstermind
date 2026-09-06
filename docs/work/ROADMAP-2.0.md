# Roadmap to 2.0

The single source of truth for what's left. Everything currently in flight or planned is here — if it
isn't on this list, it isn't committed work. Tick boxes as things land.

**Current:** v1.5.95 (`a09158b`) — suite fully green, 1316/1316. Phases 0–2 done.
**Checkpoint:** `86c45a2` (v1.5.84) — 39 versions of work committed + pushed to
`origin/feat-pact-changed-review`. Everything below builds on top of that restore point.

**Release rule:** we stay on `1.5.x` while working. The `2.0.0` bump happens only when Phase 5 is
green — 2.0 is the *label for a finished state*, not a milestone we work toward incrementally.

**Legend:** `[ ]` todo · `[~]` partially done (module exists, not wired) · `[x]` done
**⇉** = parallelizable with its siblings · **→** = must be serial (touches a contended file)

> **Contended files.** `dashboard/public/app.js` (the browser monolith) and `lib/workspace.mjs` are edited
> by nearly every task. Only ONE agent may hold each at a time. Everything else (new `lib/*.mjs` modules,
> docs, tests) is freely parallel. This constraint is what shapes the wave boundaries below.

---

## Phase 0 — Checkpoint & unblock  *(in progress)*

Goal: stop the bleeding (uncommitted work) and get the user able to use the Pact workspace again.

- [x] **0.1** Commit + push the 39-version pile as a restore point — `86c45a2`
- [x] **0.2** Gitignore `dashboard/data/routing.json` (per-install runtime state, was being tracked)
- [~] **0.3** ⇉ **Pact auto-continue actually works** — v1.5.87 — *code shipped, AWAITING USER CONFIRMATION*
      - The user's stated blocker: ticking auto-continue does not reliably continue turns.
      - Has had 4 rounds of patches (1.5.47/48/49, 1.5.80) and is still broken → this pass must make the
        state machine *structurally* correct, not add a 5th band-aid.
      - Decision logic extracted to a pure, unit-tested helper; regression test for the actual stuck state.
- [x] **0.4** ⇉ **Master pinned first + OmniRoute test chat box** — v1.5.86 ✅
      - [x] **0.4a** Pin the prime/Master conversation first in the desktop tab bar AND the mobile
        Conversations sheet, via a *display-order wrapper* (must not mutate `PACT_CHAT.tabs`, because
        `pactChatCloseTab` falls back to `tabs[0]`).
      - [x] **0.4b** OmniRoute test chat box — manual mode (one model, one prompt, raw result/error) and
        sweep mode (one prompt at every exposed model → pass/fail table). Bounded concurrency;
        a fresh pinned session per model, since switching a live session's model does not re-route.

**Exit criteria:** user confirms auto-continue works and can resume Pact work. Phases 1+ do not start
until 0.3 is confirmed *by the user*, not just by tests.

---

## Phase 1 — Exocortex: finish the server  ✅ DONE (v1.5.91-94)

Goal: close out the three half-wired server integrations so the client has a complete contract to build
against. Detail lives in `docs/work/agentic-chat-engine/plan.md`; this is the roll-up.

All three touch `lib/workspace.mjs` / `claudeSession.mjs` → **serial, one agent**.

- [x] **1.1** → **T2.1** — v1.5.91. **The image half was a non-issue and is closed as such:** the store has
      externalized images since `saveImage()` existed (live install: 55 MB of blobs vs 4.1 MB of JSONL, zero
      inline base64), and `lib/imageStore.mjs` is an unused duplicate. The real defects were in the ROLL
      ARCHIVE around it — overlapping absolute P#/R# ranges across segments (recall answered with the WRONG
      turn), numbering that restarted after a process restart and overwrote a segment file, no `workspaceId`
      on the archive (so a recalled turn's image could not be resolved), `_segments` enumerated as a bogus
      workspace, and a missing `statSync` import that silently disabled the cold-load cue. Plus the one-time
      load backfill, which relocates the 6206-row archive already on disk into its owning workspace.
- [x] **1.2** → **T2.3** — v1.5.92. `panel` on every background event, `backgroundPanel` on `sessionSummary`
      (so a reconnecting client sees the fleet without replaying events). Additive: `background`/`tasks` stay
      arrays. `toEvent` now forwards `subagentType`/`workflowName`/settle `tokens`.
- [x] **1.3** → **T2.5** — v1.5.93. `recall` action (by absolute P#/R# or substring), a strictly balanced
      `lookingUp`→`recall` cue pair that can never stick on, and `around` confirmed end-to-end on `open` +
      `resync`. **Still missing: the agent-side recall TOOL** — the model cannot call recall itself yet.
- [x] **1.4** Contract freeze — `docs/work/agentic-chat-engine/CONTRACT.md` (v1.5.94). Exact shapes + JSON
      examples for the context breakdown, the background panel, every indicator state, the `around` window and
      the `recall` action, with GUARANTEED vs PARTIAL marked per item and the two known holes stated plainly.

**Why this is first:** every Phase 2 item consumes these events. Building the UI first means building
against a moving target.

---

## Phase 2 — Exocortex: the client  ✅ DONE (v1.5.95)

Goal: the user's repeated ask — *see how full the context is, get warned before it's a problem, and
navigate a long conversation without deleting it*. **Shipped in v1.5.95** — but see 4.10: not yet
verified in a real browser, mobile especially.

Each of T3.1–T3.5 edits `dashboard/public/app.js` → **serial with each other**. But each one's *pure
helper* is a separate new `lib/*.mjs` file → those CAN be built in parallel, then mounted serially.
That split is the main speedup available here:

- [x] **2.0** ⇉ Build the five pure helpers as standalone tested modules (parallel agents, new files only)
- [x] **2.1** → **T3.1** Shared **context popover** — the breakdown of what's eating the window. Mount in
      Core + Pact.
- [x] **2.2** → **T3.3** **Threshold indicators** — compacting / rolling / looking-up, reusing the
      `pact-sync-cue` pattern. *This is the "indicator of thresholds" ask.*
- [x] **2.3** → **T3.4** **Jump-to-#N** + windowed render + LRU scroll cache (uses the server `around`
      action). *This is what makes a very long conversation usable without deleting it.*
- [x] **2.4** → **T3.2** Shared **background-agents panel** — what subagents are running, and their token
      spend. *Also fixes the "you said work was happening in the background and I couldn't tell" complaint.*
- [x] **2.5** → **T3.5** **Recall cue** surfaced inline in the transcript.

**Exit criteria:** the user can open a very long conversation, see exactly how full it is, get warned
before hitting a wall, jump to any turn, and recall archived content — without losing history.

---

## Phase 3 — DMP reconciliation  *(ANSWERED 2026-09-05 — see below)*

The DMP agent replied to `HANDOFF-DMP-EXOCORTEX-PHASE3.md` in full, with grepped/live-run evidence
rather than recollection. **The architecture split we feared does not exist.** Recording the answers
here so 3.1/3.2/3.3/3.5 stop being re-litigated.

- [x] **3.1** ⇉ **Nothing is deployed anywhere — verified live, and this is CORRECT, not a failure.**
      No `dmp-main`/`dmp-remote` systemd units installed; nothing listening on the frozen port; the git
      remote has never been pushed to; only `deploy/systemd/*.service` unit *files* exist (drafted, not
      installed). In-repo version marker `1.0.0`. DMP has been **local-only the whole time by the boss's
      own standing instruction** — so "is the DMP tunnel done?" was the wrong question: nothing is live
      to be done. Our previous inability to assert this was correct caution.
- [x] **3.2** ⇉ **The TUNNEL won, cleanly. The proxy is gone.** `grep DMP_MAIN_URL` across every `.mjs`
      on the DMP side: **zero hits**. It survives only as prose in one early planning draft; the shipped
      `deploy/README.md` and `dmp-remote.service` state outright "There is NO DMP_MAIN_URL / http proxy /
      open port anymore." Our `lib/reverseTunnel.mjs` is vendored there **byte-exact (sha256 confirmed)**
      and attaches at boot on the remote role; `/healthz.mode` derives from `isBridgeConnected()`.
      **Our records were stale, not their implementation.** No reconciliation work needed.
      ⚠ **Name collision that helped cause this scare, now fixed on our side:** our
      `dmpControlPlane.DMP_MAIN_URL` was a *local loopback probe URL* (`http://127.0.0.1:4002`), nothing
      to do with the rejected proxy env var of the same name. Renamed `DMP_MAIN_LOCAL_URL` (v1.5.99).
- [x] **3.3** ⇉ **Level-7 gate verified by a LIVE RUN**, not a code reading: real `http.createServer`
      on a real socket, 690 assertions, exit 0. Observed refusals: read-only tier-6 → `POST /ai/send`
      403, `POST /movies/new` 403, `POST /script/save` 403; `ai.view-only` tier-4 → `/ai/send` 403;
      missing `versions.promote` → promote 403; unassigned tier-3 → real deny page with slate/movie
      titles confirmed absent from the body.
      **Honest caveat they volunteered:** sessions are built by the test harness, not driven through a
      real AncientHub OIDC browser login (no live Hub reachable from their sandbox). The permission gate
      is proven; the **OIDC login leg is proven separately but never chained end-to-end**. Residual risk
      is the join between the two, and it is small but real. Do not upgrade this to "fully verified".
- [ ] **3.4** ⇉ Liveness surfacing in the Linux control app. **STILL OURS, and now known to be worse than
      "not built" — see the two-layer finding below.** Their D5 confirms the interface
      (`/healthz` → `{role, ok, version, readOnly, aiEnabled, dbOk, mode, snapshotAt, mainReachable}`;
      units `dmp-main.service`, `dmp-tunnel.service`, `dmp-snapshot.service`/`.timer`).
      ⚠ **Their most valuable answer, which changes what we must build:** `ok`/`dbOk` only reflect
      **whether SQLite opened** — not whether AI is reachable or configured. `aiEnabled` is a
      *config-presence* check (a key file exists), **not a live probe**: it can read `true` while every
      real AI call fails. So **`/healthz: 200` can coexist with a completely broken chat feature.**
      Their own recommendation: treat green `/healthz` as *"process + DB alive"* only, **never** as
      *"the product works."* The tab must render those as two separate signals or it becomes exactly the
      meaningless green light we said we did not want.
- [x] **3.5** ⇉ **Itemized answer delivered.** Classified as asked:
      *not built, no blocker* — turn numbering/jump-to-#N, recall+`reason`, elapsed/stuck timer;
      *not built, different architecture* — background subagents (DMP's AI turn is synchronous
      request/response per movie thread; no persistent agent runtime);
      *not applicable to their stack* — SDK context-usage API (they never run an Agent SDK session at
      all; `ai/anthropic.mjs` is a raw HTTPS SSE client against `api.anthropic.com`);
      *blocked on us / a real deploy* — a genuine bridge-UP `/healthz` (`mode:"relay"`) capture;
      *blocked on infra* — real AncientHub OIDC end-to-end login;
      *blocked on the boss* — git push / VPS install (standing local-only instruction);
      *self-imposed rule* — they do not commit unless told to.

### Also settled by their reply
- **Parts A1–A6 are "not applicable", and for a good reason, not a dodge:** DMP never built jump-to-#N,
  windowing, turn pairing, or recall/archive at all. `ai_messages` is one flat row-per-message table and
  the only DELETE against it is a full-movie cascade (grep-confirmed) — so **A6's retention guarantee is
  true by construction**: nothing can make an old turn unaddressable. They agreed to adopt our contract
  rules (server-side resolve, exclusive window end, typed `reason`, `null` elapsed) *if and when* they
  build those features. **We did not hand them our bugs.**
- **Part C does not apply either, verified by grep:** no `.interrupt()`/`.abort()`/live query-session
  object exists in DMP; `@anthropic-ai/claude-agent-sdk` is a `package.json` dependency **imported
  nowhere in production code**. Every bare `try{}catch{}` around a control call wraps *synchronous*
  `net.Socket`/`ws` methods, so it is structurally not our async-rejection trap. Their one
  message-content walker already guards with `Array.isArray(m.content)` rather than `|| []` — i.e. they
  never had our 1.5.97 bug either.

### 🔴 Live finding from their Part B5 — the DMP Start/Stop buttons, root-caused HERE
They flagged a boss complaint that a Start/Stop control for the DMP process "was not working", and
correctly bounced it to our side. It is real, and it fails at **two independent layers**:
1. **`lib/dmpControlPlane.mjs` is dead code.** It is complete, documented and unit-tested — and imported
   by **nothing but its own test**. No server route, no UI, no `control/cli.mjs` verb. The buttons could
   not have worked because nothing was ever wired to them.
2. **Even once wired, systemd would have refused.** `control/polkit/49-claudstermind.rules` allowlisted
   only `claudstermind.service`, `claudstermind-sessiond.service` and `omniroute.service` — **no DMP
   units at all**. Fixed in v1.5.99 (dmp-main / dmp-tunnel / dmp-snapshot.service / .timer added;
   `dmp-remote.service` deliberately excluded — it is on the VPS and cannot be systemctl'd from here).
   ⚠ **Requires a re-install to take effect** — the rule is a repo file, not a live one:
   `sudo cp control/polkit/49-claudstermind.rules /etc/polkit-1/rules.d/ && sudo systemctl restart polkit`
This is the "tested module that was never mounted" failure class — the suite was green the whole time,
because tests prove a module works, never that anything *calls* it. Wiring it is item **3.4**.

---

## Phase 4 — Infrastructure & hygiene  *(mostly parallel, low risk)*

- [ ] **4.1** ⇉ Claude CLI auto-updater service on AncientIntel — poll for the latest CLI and update.
      **Not in this repo** (no systemd unit or install script exists anywhere) → this is host-level work
      that has to be written from scratch.
- [x] **4.2** ⇉ Fixed all 3 pre-existing test failures — suite is fully green (static diff highlighter,
      model-catalog control-models cache, tunnel restart-trigger). They've been waved through as
      "unrelated" for many versions; before a 2.0 they get fixed or explicitly quarantined with a reason.
- [ ] **4.3** ⇉ Branch hygiene — decide whether `feat-pact-changed-review` merges to `main` before the
      2.0 bump. Right now `main` does not contain any of this work.
- [x] **4.7** ⇉ **`deepwork` deadlock — INVESTIGATED, NOT REAL. Do not re-litigate.** (v1.5.94.) Post-result
      events genuinely occur (that is why the branch exists), but deepwork is not terminal: the query loop has
      exactly four exits and every one rewrites `status` — `result`→idle, generator ends→ended, generator
      throws→error, respawn→thinking — and `interrupt()` accepts deepwork while `_stop` force-idles after its
      6s race. All six paths are locked down by the `4.7:` tests in `lib/claudeSession.test.mjs`, and the
      verdict is recorded at the branch itself plus CONTRACT.md §6. What remains is a genuinely HUNG SDK turn,
      where reporting busy is honest and `_stop`'s timeout is the existing remedy. **No silence-based
      self-heal was added on purpose**: legitimate deep work is silent for minutes, so one would un-busy live
      sessions and let a prompt interleave into a running turn. If "Deep Work… with no visible turn" recurs,
      capture the event sequence after the last `result` rather than patching again.
- [ ] **4.5** ⇉ **Kimi exposes 0 models** — 1.5.84 restored Cursor, but the live gateway returns no Kimi
      models at all (`omniProviderOf`'s `kimi|moonshot|km` prefixes match nothing). Either the account is
      disconnected or its ids use an unrecognized prefix. The new sweep bench (0.4b) is the tool to confirm.
- [ ] **4.8** ⇉ **contextUsage `ok:false` payload trap** — the "unavailable" object is `ok:false` WITH
      `percentage: 0` / `totalTokens: 0`, so any code reading `percentage` without also checking `ok`
      recreates the "unavailable renders as 0%" bug. Needs `null` numerics, owned together with
      `lib/contextUsage.mjs` + `lib/contextPopover.mjs`. Documented in CONTRACT.md §1 meanwhile.
- [ ] **4.9** ⇉ `lib/recallCue.mjs` still classifies misses by string-matching; switch it to the new
      machine-readable `reason` field now that the server emits one.
- [ ] **4.10** ⇉ Phase 2 UI is **unverified in a real browser** — mobile layout is reasoned + CSS-only,
      not tested on a phone. Needs a real pass.
- [ ] **4.6** ⇉ **OmniRoute bench is local-only** — `/api/omni/*` returns 404 `local-only` in OIDC/relay
      mode. Wiring a long-running SSE sweep through the tunnel needs new `agent/agent.mjs` command handlers.
- [ ] **4.11** ⇉ **Error rows are never persisted.** `workspace.mjs` pushes `kind:"assistant"` into the
      transcript and flushes to disk, but `kind:"error"` rows are live-only — a red error exists in the
      browser tab and nowhere else, so a reload destroys it forever. Found while trying to diagnose the
      1.5.97 `parts.filter` error and being unable to recover the text. The one class of message you most
      want to inspect afterwards is the only one we throw away. Decide: persist error rows (changes what
      appears in transcripts) or keep a separate error journal.
- [ ] **4.12** ⇉ **Compaction boundaries are never persisted.** The SDK emits
      `SDKCompactBoundaryMessage { trigger, pre_tokens, post_tokens }` and `lib/claudeSession.mjs`
      already translates it to `{ kind:"compacted", … }` — but `lib/workspace.mjs` contains **zero**
      references to `"compacted"`, and only `assistant` rows are pushed into the transcript. So a
      compaction is visible live and **gone on reload**: the same class as 4.11 (error rows). This blocks
      drawing "compacted here" markers in the transcript at all, since a line can only be rendered where
      a record says the event happened. Needed for the chat-shell design; prototyped in the lab.
- [ ] **4.4** ⇉ Commit cadence: stop accumulating 39-version piles. Checkpoint commit per phase.

---

## Phase 5 — 2.0 release

- [ ] **5.1** Full review pass (lenses + adversarial validation) across everything since 1.5.45
- [ ] **5.2** Full suite green, zero known failures (depends on 4.2)
- [ ] **5.3** User acceptance on the Phase 0 + Phase 2 items — the things they actually feel day to day
- [ ] **5.4** Merge to `main` (4.3), bump to **2.0.0**, write the 2.0 CHANGELOG entry
- [ ] **5.5** Tag + push

---

## Explicitly NOT in 2.0

Parked deliberately so they stop reappearing as ambient guilt:

- **Exocortex broader vision** (code graph, brain revival, skills unification) — `docs/EXOCORTEX-VISION.md`,
  Phase 0 not started. Sequenced *after* the chat-engine work by design; not blocking.
- **User-defined OmniRoute combos** — only the built-in curated combos exist in code today. New feature,
  not a bug, nobody has asked for it as a requirement.

---

## Confirmed done (do not re-litigate)

Audited with evidence; these are closed:

| Item | Where |
|---|---|
| Pact PDF export | **Took THREE passes — do not assume "done" again without printing a long file.** 1.5.56 added it; 1.5.58 fixed the "generating preview" hang (a hidden 1px-wide iframe forcing infinite line-wrap, not a permission prompt); **1.5.95 fixed it emitting only the FIRST PAGE** (`body.ws-full{height:100vh;overflow:hidden}` + `html{overflow-x:hidden}` made the body a one-page clipping box at print time — the content past page 1 was never laid out). Verified in real headless Chromium: 400-line file 1 → 8 pages. |
| Admin panel tabs clipped on mobile | 1.5.66 — nav pills wrap |
| Mobile chat boxes capped at 2 | 1.5.60 — reload re-clamped panes to the desktop cap and dropped box 3+ |
| Reload → engine-restart prompt | 1.5.78 (opt-in tick) + 1.5.64 (detect uncommitted engine changes) |
| Rate-limit accounting | key-exhaustion detection + failover + Pact usage badge |
| Stop/Send contradiction | 1.5.82 — self-heal tick re-enabled Stop on idle panes every 4s |
| Pact view completely dead | 1.5.81 — TDZ crash from the header/model-bar split |
| OmniRoute dropping Cursor/Kimi | 1.5.84 — `keepOmniId` had no branch for them; a data bug, not a display bug |
