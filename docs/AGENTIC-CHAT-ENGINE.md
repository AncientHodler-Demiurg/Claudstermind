# Agentic Chat Engine — standardized design

> Status: DESIGN (for owner feedback). Once locked, this is the single source of truth that Core workspace,
> Pact workspace, and DMP all implement — so a fix lands ONCE, not three times.

## Why this exists
We keep hitting the same class of problems and patching them per-surface:
- **Two diverged renderers** — Core (`paintPane`) and Pact (`pactChatPaint`) are separate implementations, so every
  fix (stall cue, turn clock, sync cue, paging, restore) has to be written twice, and DMP is a third. This is the
  "one fix here, one fix there, not getting anywhere" problem.
- **Conversations grow unbounded** → a 164 MB / 47k-row transcript → `--resume` cold-loads the whole file → the
  engine grinds for minutes → the "thinking… 13:33" stall.
- **No large-conversation navigation** → revealing/jumping loads everything → the UI freezes.
- **No visibility** — no Claude-GUI-style context breakdown, no threshold indicators.

The fix is ONE standardized engine with a clear contract, consumed by all three surfaces.

## Core principle
**A conversation runs INDEFINITELY with a bounded ACTIVE window, and auto-heals so it never becomes a problem.**
- **Recent = hot**: in the model context AND in a small active session file.
- **Old = cold**: archived on disk + indexed in the brain (FTS/graph), retrieved on demand.
- You never manually retire a conversation. You just keep talking. The system rolls underneath you.

Owner's insight that drives this: *you only ever need recent context (today/yesterday); older you need RETRIEVABLE,
not resident.* So bound the active window; offload the rest to disk+brain.

---

## Responsibilities (the contract every surface implements)

### 1. Lifetime management — bounded + auto-healing, with visible thresholds
Three automatic states, each surfaced with an indicator:

| Trigger | Action | Indicator |
|---|---|---|
| Context window fills | **auto-compact** (SDK/CLI native) — summarize older turns, keep recent | `⟳ Compacting context…` |
| Active segment file crosses a size/turn threshold | **auto-roll / segment** — start a fresh session seeded with `[summary of old] + [last K turns verbatim]`; archive the old segment | `⟳ Rolling to a fresh window…` |
| Agent references an OLD turn (e.g. "re: your answer #1237" while at #54332) | **recall** — read that turn from the archive/brain (it's no longer resident) | `🔍 Looking up historical turns…` |

- **Auto-compact** bounds the CONTEXT (tokens to the model). SDK default; we surface the `compact_boundary` event
  (already distilled in `claudeSession.toEvent`).
- **Auto-roll** bounds the DISK/RESUME cost — the thing compaction does NOT fix (the on-disk log is append-only and
  cold-resume reads it whole). Rolling keeps the ACTIVE file small, so cold-resume is fast **forever**, no matter how
  long the overall conversation gets.
- **Recall** = an agent tool/skill `recall(turn|query)` that searches archived segments (brain FTS) so the agent can
  answer "what did you say at #1237" without that turn being in context.

### 2. Storage model
- **Text transcript** grows slowly (append-only, but small per turn).
- **Images externalized** — uploaded images are stored as separate blobs keyed by `(conversationId, turn#)` and
  referenced from the transcript, NOT inlined as base64. The conversation then grows only from text (far slower). The
  164 MB thread is mostly inline images; this alone would have kept it an order of magnitude smaller.
- **Segments** — a conversation is a CHAIN of bounded segments. An archive index maps `turn# → segment`, so any turn
  is addressable/retrievable.

### 3. Navigation — large conversations must never stall the UI
- **Windowed / virtualized transcript** — only a band of turns lives in the DOM at once (bounded regardless of the
  conversation's total length).
- **Jump-to-#N** — type/click "jump to #3547" → fetch a band `[N-W, N+W]` from disk, render just that, scroll to N.
  No full load.
- **Scroll cache (LRU)** — keep the last few visited bands mounted; evict far ones. Scrolling across a huge span loads
  bands progressively and vacates behind, so the DOM stays bounded and scrolling stays smooth.
- **"Show earlier"** (already built, incremental) = the tail-ward special case of this same windowing.
- **Addressing** — the existing absolute `P#/R#` numbering is the coordinate system for jump/recall/bookmarks.

### 4. Context telemetry — Claude-GUI parity (both workspaces)
- `getContextUsage()` **already returns the full breakdown** (verified in the SDK types): `categories[]`
  (name/tokens/**color**), `gridRows[][]` (the colored squares), `memoryFiles`, `mcpTools`, `systemTools`,
  `systemPromptSections`, `totalTokens`, `maxTokens`, `percentage`. We currently discard everything but two numbers.
- Render:
  - **Compact header gauge** — `316k / 1M (32%)` (we have a version of this).
  - **Expandable popover** — the Claude-GUI layout: colored usage bar + per-category legend (Messages, System tools,
    MCP tools, Skills, Memory files, System prompt, Custom agents, **Autocompact buffer**, Free space), driven straight
    from `categories`/`gridRows`.
  - **Plan usage limits** (5-hour / weekly) — we already fetch these (`_usageLimits`).

### 4b. Background-agent telemetry — visibility into the fleet the agent spawned
When the agent spawns background subagents/workflows (Task/Agent tool), the operator currently sees only a faint
pulse — no idea how many are running, how hard, or at what cost. The engine already captures the live set
(`background_tasks_changed` → `{id, taskType, subagentType, workflowName, description}`; `task_started` /
`task_notification` enrich it; completion carries the subagent's token count). Surface it as a real panel:
- **Count + list** — "▶ N agents working", each row: type/subagent name + description + elapsed.
- **Intensity** — running vs settling; a per-agent token count (live where the SDK's `task_progress`/`task_updated`
  events carry it, else on settle) and a fleet total, so "how intense / how many tokens" is answerable at a glance.
- **Placement** — a header badge that expands to the panel (sibling of the context popover), so the chat NEVER reads
  as "free/idle" while a background fleet is grinding.
Same data path for Core + Pact (shared engine); DMP inherits the contract.

### 5. Multi-window efficiency
- Per-window **virtualization** → DOM bounded no matter how many/how big.
- **Idle windows parked** — a backgrounded conversation unmounts its transcript DOM (keeps the session resumable), so
  many open windows don't compound the machine load.
- Bounded memory per session.

---

## Architecture — the package (two shared layers + a portable contract)

### A. Server engine — `lib/` (shared by Core + Pact via sessiond today)
- `claudeSession` (exists) + a new **`ConversationManager`**:
  - autocompact policy + `compact_boundary` surfacing,
  - **roll/segment** (threshold → summarize → new seeded session → archive + index),
  - **externalized-image store** (blob-by-turn), 
  - **windowed transcript API** — `getWindow({ around, before, after })` (generalizes the `limit` param already added),
  - **`recall(turn|query)`** over the archive/brain.
- Because Core + Pact both drive `WorkspaceManager`/`claudeSession`, this layer covers **both at once**.

### B. Client chat-kit — one shared module (replaces the two renderers)
- ONE virtualized transcript renderer + controller: windowed render, jump-to-#, scroll-cache, show-earlier, the
  context gauge + popover, the threshold indicators, compose/stop/queue.
- Core and Pact mount the SAME kit through a thin adapter (repo/worktree binding, Pact's editor split, etc.). This is
  what kills "apply the fix twice."

### C. DMP — a portable contract, not a code handoff
- DMP's AI is per-request (`ai/agent.mjs`), not sessiond — so it can't share the server engine module directly. But
  the **contract** (lifetime thresholds, storage/segment model, telemetry shape, navigation API, indicator states) is
  portable. DMP implements the same contract against its own AI. We hand the DMP agent this doc's contract section,
  once locked — not a "I did X here, do it there" ad-hoc handoff.

---

## Feasibility (grounded, not hand-wavy)
- **Context breakdown popover** — ✅ SDK `getContextUsage()` returns the exact GUI data (categories + gridRows +
  memory/mcp/system + totals). Pure forward-and-render.
- **Auto-compact** — ✅ SDK/CLI default; we already see `compact_boundary`.
- **Auto-roll** — ✅ we control session creation; seed a new session with a summary + verbatim tail.
- **Externalized images** — ✅ we own the store (`workspaceStore`); swap inline base64 for a blob reference.
- **Windowed nav / jump-#** — ✅ builds on the `limit`/window transcript API + client virtualization.
- **Recall by #** — ✅ needs an agent tool + archive index; ties into the exocortex brain (FTS over archived turns).

---

## Build phases (do it right, incrementally)
- **Phase 0** — this design doc; lock the contract + owner decisions below.
- **Phase 1 (server, biggest win — stops the stalls):** ConversationManager = externalized images + windowed
  transcript API + roll/segment + archive index. Fixes the 164 MB cold-resume class permanently.
- **Phase 2 (client kit):** extract the shared virtualized chat-kit; migrate Core, then Pact, onto it; ship the full
  context popover + threshold indicators + jump-to-#.
- **Phase 3 (DMP):** hand the DMP agent the locked contract to implement against its AI.

## Locked decisions (owner-approved 2026-09-05)
1. **Roll threshold** — roll when the ACTIVE segment reaches **400 turns OR 25 MB**, whichever comes first. Turns is
   the natural unit; the MB cap is the safety valve for image/tool-heavy stretches.
2. **Verbatim tail K** — carry the **last 40 turns verbatim** into the new segment; everything older is summarized.
3. **Auto-compact threshold** — **SDK default** (don't override).
4. **Image externalization** — **migrate existing + new**. New uploads stored as blobs by turn#; a one-time backfill
   rewrites inline base64 in existing transcripts to references (originals archived).
5. **Indicators** — a compact **status line under the compose bar** for the transient states
   (`⟳ Compacting context…` / `⟳ Rolling to a fresh window…` / `🔍 Looking up historical turns…`), PLUS the header
   **context gauge** with an expandable Claude-GUI-style popover.
6. **Recall** — **visible** (`🔍 Looking up historical turns…` / "recalling #N") — transparency over silent magic.

## Build order (locked)
Phase 1 (server engine) → Phase 2 (client chat-kit) → Phase 3 (DMP contract) → then the **Exocortex** initiative
(Hermes + code-graphs + brain/FTS) builds ON this engine to supercharge capability. This engine is the foundation
the exocortex needs.
