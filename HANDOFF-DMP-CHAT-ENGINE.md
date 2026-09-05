# HANDOFF — DMP Chat Engine (Agentic Chat Engine contract, ported to DMP)

> **To:** the DMP agent (DemiourgosMotionPictures).
> **From:** Claudstermind.
> **Purpose:** give DMP's chat the same **immortal, non-stalling, observable** behavior the Claudstermind
> Agentic Chat Engine defines — without shipping Claudstermind code. This is a **contract**, not a code drop.
> DMP's AI is **per-request** (`site/ai/agent.mjs runTurn`), not sessiond, so DMP implements the same
> responsibilities against its own DB + SSE. Source of truth: `docs/AGENTIC-CHAT-ENGINE.md` in Claudstermind
> (read it once; this doc is the DMP-specific translation of it).

---

## 0. The problem, in DMP's terms

Claudstermind's pain was a 164 MB append-only session log that `--resume` cold-loaded whole → minutes-long
"thinking…" stalls. DMP has **no session file** — but it has the *structural equivalent*:

> `runTurn` calls `listAiMessages(threadId)` and rebuilds the **entire thread** into `messages` on **every single
> turn**, then sends all of it to the model. One `ai_threads` row per movie (`UNIQUE(movie_id)`), one shared,
> ever-growing thread across all tabs. So cost — DB read, token count, $, latency, and the odds of a context-limit
> rejection — grows **unbounded with every message, forever.** That is DMP's "164 MB thread."

Everything below bounds that active window and makes the healing visible over the SSE channel DMP already has.

**Core principle (unchanged):** a conversation runs **indefinitely** with a **bounded ACTIVE window**, and
auto-heals so it never becomes a problem. Recent = hot (in the model context + the active thread rows). Old = cold
(archived in the DB, retrieved on demand). Nobody retires a thread; you just keep talking, and it rolls underneath.

---

## 1. Lifetime — bounded + auto-healing, with three visible states

DMP already has the status channel: `broadcastAiStatus(threadId, tab, status)` writes an `event: status` SSE frame
to every subscriber of that movie+tab (`site/server.mjs`), fed by `runTurn`'s `onStatus({state, note})` callback.
Today it emits `thinking` / `working` / `queued` / rate-limit notes. **Add three transient states over this same
channel** — a compact status line under the compose bar, exactly like the existing "Working — reading the script":

| Trigger | Action | `onStatus` state to broadcast |
|---|---|---|
| Context being sent to the model would exceed budget | **auto-compact** — build `messages` from `[summary of old turns] + [recent turns verbatim]` instead of every row | `{ state: "compacting" }` → "⟳ Compacting context…" |
| Active thread crosses **400 turns OR 25 MB** | **auto-roll / segment** — archive the head, keep the active thread small | `{ state: "rolling" }` → "⟳ Rolling to a fresh window…" |
| Agent references an OLD turn now archived out of context | **recall** — look it up from the archive (§5) | `{ state: "looking-up" }` → "🔍 Looking up historical turns…" |

**1a. Auto-compact — bound the CONTEXT (what goes to the model).**
There is no SDK autocompact here; DMP sends the history itself, so DMP owns this. In `runTurn`, replace the
"load every row" build with a bounded builder:
- Keep the **last 40 turns verbatim** (locked K, §"Locked decisions").
- Everything older → a **rolling summary** (one synthesized assistant/system-role note prepended to `messages`),
  regenerated when the head grows past the last summarized point.
- Estimate the budget from a char→token heuristic (`~len/4`) across system prompt + manifest + tools + messages;
  compact when the estimate crosses the model's context ceiling minus a safety buffer. Broadcast `compacting`
  around the summarize step. This bounds tokens/$/latency **and** removes the context-limit-rejection failure mode.

**1b. Auto-roll / segment — bound the DB-stored ACTIVE thread (what cold-reads cost).**
Compaction shrinks what's *sent*, but `listAiMessages(threadId)` still reads every row from SQLite. Roll to keep
the **active thread** itself bounded:
- **Threshold:** the active thread reaches **400 turns OR 25 MB of `body`+`meta`**, whichever first.
- **Archive the head:** move all-but-the-last-40 turns out of the hot query. Two clean options — pick one:
  - a `segment_id` column on `ai_messages` + an `active INTEGER` flag (mirror the `movie_files.active` convention
    already in the schema), so the hot query is `WHERE thread_id=? AND active=1`; or
  - a sibling `ai_messages_archive` table with the identical column shape, INSERT…SELECT the head then DELETE.
- **Carry forward:** the new active window = **last 40 turns verbatim** + one **segment-summary** row covering the
  archived head (same summary produced in 1a — reuse it).
- **Index the segments:** a new `ai_thread_segments` row per roll — `{ thread_id, seg_no, first_seq, last_seq,
  summary, created_at }` — so any `author_seq` is addressable back to its segment for recall (§5). Keep the
  absolute `author_seq` per author as the coordinate system (it already numbers each author 1,2,3…; do not renumber
  on roll).
- Broadcast `rolling` around the archive step.

This is the DMP analogue of Claudstermind's roll: cold-read cost (`listAiMessages`) stays flat **forever**, no
matter how long the overall conversation runs. Serialize it under the existing `withThreadLock` so a roll never
races a turn.

---

## 2. Storage — externalize images to blobs keyed by (thread, turn#)

**Good news: DMP already does the hard part.** Uploaded images/documents are **not** inlined as base64 into
`ai_messages.body`. They live in `movie_files` (a real blob store: `path`, `sha256`, `mime`, `size`, `text_ref`,
`summary`) and are inlined into the outgoing message **only at turn time** by `inlineAttachments` /
`buildContentBlock` from stored ids. The persisted `body` is plain text. So DMP's rows grow only from text — the
exact property Claudstermind's externalization was fighting for.

**What to add to close the contract:**
- **Key blobs by (thread, turn#) too.** `movie_files` is keyed by movie, not by the turn that referenced it. Record
  the referencing `(thread_id, author_seq)` (e.g. an `ai_message_attachments` link row, or an `attachmentIds` list
  persisted into the message's `meta`) so an archived turn stays reconstructable and a recalled turn can re-surface
  its exact images by reference — never re-inlined into the transcript body.
- **Assert the invariant in review:** nothing may write base64 image data into `ai_messages.body`. Attachments are
  always references resolved at send time. (This keeps the roll thresholds in §1 measuring real conversational text,
  not megabytes of image payload.)

---

## 3. Navigation — windowed history reads, jump-to-#N

DMP's read path **already supports windowing** — don't rebuild it, extend it:
- `GET /:slug/ai/history` accepts `before` (exclusive `id<` cursor) + `limit` (clamped `[1,200]`, default 50), and
  `listAiMessages(threadId, { tab, before, limit })` returns "newest N older than cursor, ascending for display."
  This backs the existing "Show earlier" control — the tail-ward special case of windowing.
- **Add a band read (`around`):** `getWindow({ threadId, around: seq, before: W, after: W })` returning turns
  `[seq-W, seq+W]`. Fetch across the active thread **and** archived segments transparently, so a 40k-turn thread
  never loads whole into the DOM or the response.
- **Jump-to-#N:** UI accepts "jump to #N" → server resolves N (an `author_seq`, via `ai_thread_segments` if
  archived) → returns just that band → client renders it and scrolls to N. No full load.
- **Client virtualization:** only a band of turns lives in the DOM; keep an LRU of the last few visited bands
  mounted and evict far ones so scrolling a huge span stays smooth and the DOM stays bounded.
- **Addressing:** the absolute `author_seq` (already stable, already survives rolls) is the coordinate system for
  jump / recall / bookmarks.

---

## 4. Telemetry — context breakdown + background-work indicator

DMP has **no SDK `getContextUsage()`** — the served model is read from `message_start.message.model` and that's
about all the API hands back. So DMP renders a **computed** breakdown, not a forwarded one:
- **Compute a per-category token estimate** (`~chars/4`) for what `runTurn` actually assembles each turn: System
  prompt, Active-files manifest (`buildManifestText`), Tool definitions (`TOOLS`), Messages (recent verbatim),
  Rolling summary. Sum → `totalTokens`; show against the model's context ceiling as a header gauge
  (`~120k / 200k (60%)`) with an expandable popover listing the categories. Same visual shape as the Claudstermind
  context popover; the numbers are DMP estimates rather than SDK-exact — state that in the UI tooltip so the
  estimate is never mistaken for a billed figure.
- Surface the current served model id and, when a turn is mid-loop, **hop progress** (`hop k / maxToolHops`, default
  16) — DMP's honest analogue of "how hard is it working."
- **Background-work indicator:** DMP does **not** currently spawn background subagents (its loop is a synchronous
  per-turn tool loop, bounded by `maxToolHops`). So this panel is **reserved/N-A today**. Define the shape now so
  it's a drop-in later: a header badge "▶ N working" expanding to rows of `{type, description, elapsed, tokens}`. If
  DMP ever spawns async work, feed it through `broadcastAiStatus` with a `background` state on the same SSE channel.

---

## 5. Recall — an agent tool to look up an archived turn/query

DMP already has an agent-tool mechanism (`site/ai/tools.mjs` `TOOLS` + `runTool`, dispatched inside the `runTurn`
hop loop) and a notes store (`ai_brain` + `read_brain`/`write_brain`). Add one tool:
- **`recall({ turn?, query? })`** — resolve `turn` (an `author_seq`) via `ai_thread_segments` to its segment and
  return that turn (+ a small band) even when archived out of context; or full-text search archived `body` for
  `query`. Back it with a `LIKE` scan initially; graduate to SQLite FTS over archived `body` if volume warrants.
- **Wire it into the loop like every other tool:** register in `TOOLS`, handle in `runTool`, and give it a
  `TOOL_NOTES` entry so the hop broadcasts the **visible** `looking-up` state ("🔍 Looking up historical turns…" /
  "recalling #N") — transparency over silent magic (locked decision #6). This lets the agent answer "what did you
  say at #1237" while at #54332 without #1237 being resident.

---

## Locked decisions (owner-approved — identical to Claudstermind, do not renegotiate)

1. **Roll threshold** — **400 turns OR 25 MB**, whichever first. Turns is the natural unit; MB is the safety valve
   for image/tool-heavy stretches. (For DMP, measure MB as `body`+`meta` bytes of the active thread.)
2. **Verbatim tail K** — carry the **last 40 turns verbatim** into the new window; everything older is summarized.
3. **Auto-compact threshold** — Claudstermind uses the **SDK default**. DMP has no SDK autocompact, so DMP's
   equivalent is: compact when the estimated context would exceed the model ceiling minus a safety buffer. Keep the
   *intent* (don't micro-manage; bound near the ceiling), not a hand-tuned number.
4. **Image externalization** — **migrate existing + new.** New attachments already externalized (`movie_files`);
   add the (thread, turn#) reference link, and assert no base64 ever lands in `body`.
5. **Indicators** — a compact **status line under the compose bar** for the three transient states
   (`compacting` / `rolling` / `looking-up`) over `broadcastAiStatus`, **plus** the header context gauge with an
   expandable popover.
6. **Recall — visible.** Always surface `looking-up` / "recalling #N"; never silent.

---

## Portable vs DMP-specific

| Portable (same everywhere) | DMP-specific (how DMP realizes it) |
|---|---|
| 400/25MB roll threshold; K=40 verbatim tail | Thresholds measured over `ai_messages` rows / bytes, not a session file |
| Three visible states + status line + context gauge | Emitted via existing `broadcastAiStatus` SSE (`event: status`), not sessiond events |
| Bound the ACTIVE window; archive + index the head | Archive is DB rows (`segment_id`/`active` flag or archive table) + `ai_thread_segments`, not on-disk segment files |
| Externalize images by reference | Already done via `movie_files`; add the (thread, turn#) link |
| Windowed reads + jump-to-#N | Extend the existing `before`/`limit` `/ai/history` cursor with an `around` band |
| Recall as an agent tool | New `recall` entry in `TOOLS`/`runTool`, over the DB archive (LIKE→FTS) |
| Context telemetry popover | **Computed** estimate (no `getContextUsage`); label it an estimate |
| Background-fleet panel | **Reserved / N-A** — DMP has no background subagents today; define the shape |
| Auto-compact | DMP owns it explicitly (rebuilds history itself); "SDK default" has no direct analogue |

---

## Security posture — preserve DMP's exactly (do not weaken)

- **Clearance model is unchanged.** Full access is tier **≥ 7** (`isFull = isAncient || tier >= 7`). AI is gated by
  two permission blocks: **`ai.view`** (read transcripts) and **`ai.use`** (send). A tier that has `ai.view` but not
  `ai.use` (e.g. an L6 reader) gets the transcript **and no compose box** ("read-only access to this chat"); a tier
  with neither (**≤ L5**) gets **no AI Chat tab at all**. Every new route/tool below **must** re-check `can(identity,
  "ai.use")` for writes and `can(identity, "ai.view")` for reads — recall, jump/band reads, telemetry, and any roll
  trigger endpoint included. No new gating logic, no bypasses.
- **Enforced in the relay AND read-only.** On the `remote` (VPS) role, DMP relays to `main` when it's up and serves a
  **read-only replica when main is down — no writes, no AI.** Every lifetime/recall/roll operation is a
  main-side action; on the read-only replica they must be **inert** (the offline banner already says "writes and AI
  are disabled"). Do not add a code path that lets a roll, a compact, or a recall write from the VPS replica.
- **No AI secrets on the VPS.** The OmniRoute/Anthropic key deliberately does **not** live in `ai_config` (so it
  never rides a sync to the replica). Keep it that way: none of the new machinery may persist or transport a model
  key. Archived turns/segments are conversation data, not credentials.

---

## What to send back (checklist)

- [ ] Schema diff: `ai_thread_segments` (+ `segment_id`/`active` on `ai_messages` **or** `ai_messages_archive`), and
      the (thread, turn#) attachment link — with the migration for existing threads.
- [ ] `runTurn` change: bounded context build (summary + last 40 verbatim) replacing "load every row", plus the
      `compacting` broadcast.
- [ ] Roll/segment routine (archive head at 400/25MB, keep last 40 + segment summary, index it), serialized under
      `withThreadLock`, with the `rolling` broadcast.
- [ ] `getWindow({around,before,after})` + jump-to-#N on `/:slug/ai/history`; client virtualization/LRU note.
- [ ] `recall` tool in `TOOLS`/`runTool` with its `TOOL_NOTES` entry and the `looking-up` broadcast.
- [ ] Computed context-telemetry breakdown (labeled an estimate) + header gauge; background panel stub.
- [ ] Confirmation that `ai.view`/`ai.use` gating, the read-only-replica inertness, and the no-key-on-VPS invariant
      all still hold — ideally a test asserting each.
- [ ] Any threshold/behavior that had to diverge from this contract, and why (so Claudstermind can reconcile the
      shared spec).
