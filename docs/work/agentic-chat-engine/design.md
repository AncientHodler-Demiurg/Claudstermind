# Agentic Chat Engine — design

Full spec: `docs/AGENTIC-CHAT-ENGINE.md` (locked). This is the honey-run design/acceptance record.

## Acceptance criteria (the confirmed outcome — measured point-by-point at review)
1. **Indefinite conversations, no resume stall** — a conversation auto-rolls to a fresh bounded segment at
   400 turns / 25 MB (last 40 turns verbatim, older summarized); the archived head is kept + indexed; the active
   segment cold-resumes fast.
2. **Images externalized** — new uploads stored as content-addressed blobs by turn# (referenced, not inlined);
   a one-time backfill rewrites existing inline base64 → references. Conversations grow text-only.
3. **Claude-GUI context panel** — the "% ctx" gauge expands to the SDK's full breakdown (categories/colors/grid/
   memory/mcp/system/free), on Core AND Pact.
4. **Background-agents panel** — "▶ N agents working" with per-agent type/description/elapsed/tokens + fleet total,
   from the SDK task events. Chat never reads "idle" while a background fleet runs.
5. **Threshold indicators** — visible `⟳ Compacting… / ⟳ Rolling to a fresh window… / 🔍 Looking up history…`.
6. **Jump-to-#N** — loads a band around the turn (server `around`); scrolling a huge conversation stays smooth
   (windowed render + LRU scroll cache); no freeze.
7. **Recall** — the agent can look up an archived turn/query by number/text (visible "looking up #N").
8. **Shared engine** — Core + Pact drive the same server engine + shared client helpers (fixes land once);
   **DMP contract doc** written for the DMP agent to implement against its own AI.

## Non-goals (this run)
Exocortex brain build (Hermes/graphs/FTS) — next initiative. Deploying/restarting the engine — reported, not done.

## Decisions
Autonomous run confirmed 2026-09-05.
- Thresholds/tail/compact/images/indicators/recall — per `docs/AGENTIC-CHAT-ENGINE.md` Locked decisions.
- **Client standardization approach:** rather than a big-bang merge of `paintPane` (Core) and `pactChatPaint`
  (Pact) into one renderer (high blast-radius; a broken kit is worse than two working ones), extract the NEW
  capabilities (context popover, background panel, indicators, jump/window controller, recall cue) into **shared
  helper modules** that BOTH renderers mount. Incremental standardization; the two renderers converge onto shared
  pieces without a risky rewrite. Reason: safety + the user's "stop hitting one-off bugs" intent is met by shared
  logic, not necessarily a single render function.
- **Recall/FTS depth:** start with a substring/keyword scan over archived segments (no embeddings) — matches the
  exocortex-learnings synthesis (SQLite FTS5 later); enough for `recall(#N)` exact + `recall(query)` lite now.
- **Roll summary generation:** the head summary is produced by the engine asking the SAME session to emit a
  compact summary before seeding the new segment (a control turn), falling back to a mechanical extract (first
  line of each head prompt) if unavailable — so a roll never blocks on summary quality.
