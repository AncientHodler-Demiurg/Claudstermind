# Agentic Chat Engine — FROZEN SERVER CONTRACT (Phase 1 → Phase 2)

**Status: FROZEN as of v1.5.94.** Everything marked **GUARANTEED** below is shipped, covered by tests,
and will not change shape under a Phase-2 client task. Everything marked **PROVISIONAL** may still move —
do not hard-depend on it without re-reading this file.

Phase 2 (`docs/work/ROADMAP-2.0.md` §2) builds five client tasks IN PARALLEL against this document.
Ambiguity here costs rework there, so this file states the exact key names, the exact types, what is
emitted when, and what is *not* provided.

Design rationale lives in `docs/AGENTIC-CHAT-ENGINE.md`. This file is the wire format only.

---

## 0. Transport — how any of this reaches the client

Two frame kinds matter to Phase 2. Both fan out through `WorkspaceManager.send(kind, sessionKey, data)`
to every registered sink (local SSE, the relay tunnel, …).

| Frame | Shape | Meaning |
|---|---|---|
| `event` | `send("event", sessionKey, { kind, … })` | something happened on ONE conversation |
| `state` | `send("state", sessionKey \| null, { … })` | a snapshot: `{ session }` (one) or `{ sessions }` (all) |
| `transcript` | `send("transcript", sessionKey, { … })` | a full/windowed transcript payload (reply to `open`) |

Client-side today these land in `app.js` as `data.kind === …` for events and `data.session` /
`data.sessions` for state.

**Routing key:** the frame's `sessionKey` ARGUMENT is authoritative — always route on that. Events that
originate inside `ClaudeSession` (`assistant`, `result`, `status`, `background`, `taskStarted`,
`taskDone`, `compacted`, `error`, `mode`, `model`, …) ALSO carry `sessionKey` inline, stamped by
`_emit`. Events the manager sends directly (`contextUsage`, `rolling`, `lookingUp`, `recall`,
`loadingHistory`, `loadingHistoryDone`, `user`, `busy`, `stopping`, `resync`) do **not** repeat it in the
body. Never depend on the inline copy being present.

**Requests** go the other way as one control frame:

```js
handleIn("control", null, { action: "<name>", args: { … } })
```

`action` must be a member of `WS_CONTROL_ACTIONS` (`lib/protocol.mjs`) or the frame is silently dropped.

---

## 1. Context usage — the breakdown that drives the popover  **GUARANTEED**

### Request

```json
{ "action": "contextUsage", "args": { "sessionKey": "Repo@main" } }
```

Per-conversation. There is deliberately **no fallback to another session** — a null answer means
"nothing to show for THIS conversation yet", never "borrow someone else's numbers".

### Response event

```json
{
  "kind": "contextUsage",
  "usage": { "...": "the RAW SDK SDKControlGetContextUsageResponse, or null" },
  "contextBreakdown": {
    "ok": true,
    "totalTokens": 316000,
    "maxTokens": 1000000,
    "percentage": 31.6,
    "model": "claude-opus-4-6",
    "categories": [
      { "name": "Messages",          "tokens": 210000, "color": "#7aa2f7", "pct": 21,   "isDeferred": false },
      { "name": "System tools",      "tokens": 42000,  "color": "#9ece6a", "pct": 4.2,  "isDeferred": false },
      { "name": "MCP tools",         "tokens": 18000,  "color": "#e0af68", "pct": 1.8,  "isDeferred": false },
      { "name": "Memory files",      "tokens": 26000,  "color": "#bb9af7", "pct": 2.6,  "isDeferred": false },
      { "name": "Autocompact buffer","tokens": 20000,  "color": "#565f89", "pct": 2,    "isDeferred": true }
    ],
    "grid": [
      [ { "color": "#7aa2f7", "isFilled": true, "tokens": 10000, "pct": 1 } ]
    ],
    "free": { "tokens": 684000, "pct": 68.4 },
    "memoryFiles": [ { "path": "CLAUDE.md", "type": "project", "tokens": 12000 } ],
    "mcpTools":    [ { "name": "search", "serverName": "brain", "tokens": 900, "isLoaded": true } ],
    "systemTools": [ { "name": "Bash", "tokens": 1400 } ],
    "systemPromptSections": [ { "name": "identity", "tokens": 800 } ]
  }
}
```

Guarantees:

- `contextBreakdown` is **always present and always an object** — never null, never absent. When the
  session can't answer (no live session, an old CLI, a test mock), it is the zeroed shape with
  `ok: false`, `categories: []`, `grid: []`, `free: { tokens: 0, pct: 0 }`, and every list empty.
  **Render `ok === false` as "unavailable", never as "0% used".**
- `usage` is the untouched SDK response and MAY be `null`. It exists only for the compact header badge
  and for debugging. **New client code should read `contextBreakdown` exclusively.**
- `pct` values are percentages of `maxTokens`, rounded to one decimal. `percentage` is the SDK's own
  when present, else derived.
- `categories[].color` is the SDK's own colour — use it directly; do not re-map it into a local palette,
  because the whole point is Claude-GUI parity.
- `grid` is `gridRows` — an array of ROWS, each an array of squares. Row length is not fixed.
- `free` is computed (`maxTokens - totalTokens`, floored at 0), not an SDK field.
- Shaper: `lib/contextUsage.mjs` `shapeContextUsage()`; label helper `contextSummaryLabel(shaped)` →
  `"316k / 1M (32%)"`. Both are pure and directly importable by a client-side helper module.

**Not provided:** there is no push/streaming of context usage. It is poll-only — the client asks. There
is no "warn me at 80%" event; a threshold warning is a CLIENT decision made from `percentage`.

---

## 2. Background agents — the fleet panel  **GUARANTEED**

### 2a. The panel model

One shape, produced by `lib/backgroundTasks.mjs` `shapeBackground(state, now)`:

```json
{
  "count": 2,
  "running": 1,
  "done": 1,
  "totalTokens": 4200,
  "agents": [
    { "id": "t1", "label": "Explore", "description": "audit the roll path", "elapsedMs": 91000, "tokens": 0,    "status": "running" },
    { "id": "t2", "label": "local_workflow", "description": "phase 2",      "elapsedMs": 40000, "tokens": 4200, "status": "done" }
  ]
}
```

- `label` = `subagentType || taskType || "agent"`.
- `status` ∈ `"running" | "done" | "error"`. Tasks that left the authoritative live set are marked
  `"removed"` internally and **excluded** from `agents`, so `count === agents.length` always.
- Sort order is stable and server-decided: running first, then by start time. Do not re-sort.
- `elapsedMs` is computed server-side at emit time against the server clock. Treat it as a snapshot and
  extrapolate locally if you want a live ticking clock.
- `tokens` is 0 until the SDK reports one (usually at settle). `totalTokens` is the sum over `agents`.

### 2b. Where the panel arrives

**On events** — every background event carries it as `panel`:

```json
{ "kind": "background",   "sessionKey": "…", "tasks": [ { "id": "t1", "taskType": "agent", "description": "…", "subagentType": null, "workflowName": null, "tokens": 0 } ], "panel": { "…": "as above" } }
{ "kind": "taskStarted",  "sessionKey": "…", "id": "t1", "taskType": "agent", "subagentType": null, "workflowName": null, "description": "…", "skipTranscript": false, "panel": { "…": "" } }
{ "kind": "taskDone",     "sessionKey": "…", "id": "t2", "status": "completed", "summary": "…", "tokens": 4200, "skipTranscript": false, "panel": { "…": "" } }
```

**On state** — `sessionSummary` carries it as `backgroundPanel`, so a client that reconnects gets the
fleet state without replaying events it missed:

```json
{
  "sessionKey": "Repo@main", "cwd": "/…", "repo": "Repo", "status": "idle",
  "worktree": "main", "workspaceId": "Repo@main", "sessionId": "6f08…", "mode": "default",
  "trusted": false, "usage": { "turns": 12, "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheCreationTokens": 0, "costUsd": 0 },
  "turnStartedAt": null, "lastActivityAt": 1784801237739,
  "backgroundCount": 2,
  "background": [ { "id": "t1", "taskType": "agent", "description": "…" } ],
  "backgroundPanel": { "…": "the panel model, or null" }
}
```

Guarantees:

- `background` **stays an ARRAY** and `event.tasks` **stays an array**. Both current renderers index
  them directly; the panel is strictly ADDITIVE. This will not be changed out from under Phase 2.
- `backgroundPanel` is `null` only for a session object that predates this (a stub engine). Treat null
  as "no data", not as "no agents".
- `panel` appears ONLY on the three background event kinds. It never rides an `assistant`, `result`,
  `init` or `status` event — a test asserts this, so `if (ev.panel)` is a safe discriminator.

**Not provided:** no live per-agent token stream. `tokens` moves only when the SDK reports it. There is
no separate "fleet finished" event — infer it from `panel.running === 0`.

---

## 3. Indicator states — the status line under the compose bar

Three transient states from `docs/AGENTIC-CHAT-ENGINE.md` §1. **Their support levels differ. Read this
section before building the indicator component.**

| Indicator | Server signal | Level |
|---|---|---|
| `⟳ Rolling to a fresh window…` | `kind: "rolling"` | **GUARANTEED** |
| `🔍 Looking up historical turns…` | `kind: "lookingUp"` … `kind: "recall"` | **GUARANTEED** |
| `⟳ Compacting context…` | `kind: "compacted"` (AFTER the fact only) | **PARTIAL — see 3c** |

### 3a. Rolling  **GUARANTEED**

```json
{ "kind": "rolling", "segment": 2, "sourceRef": "Repo@main#seg2" }
```

Emitted once, immediately before the session is rolled onto a fresh seeded SDK session. **There is no
paired "rolled" event.** A roll is fast and the very next turn proceeds normally, so the client should
show this as a self-expiring cue (a few seconds), not as a state waiting to be cleared.

`sourceRef` is the stable archive id of the segment that was just retired; it is also the id printed in
the seed text's footer, so it is what an agent will quote when it references archived history.

### 3b. Looking up (recall)  **GUARANTEED**

A strict ON/OFF pair, always balanced:

```json
{ "kind": "lookingUp", "mode": "number", "kindOf": "response", "number": 1237, "query": "",            "at": 1784801237739 }
{ "kind": "recall",    "mode": "number", "kindOf": "response", "number": 1237, "ok": true, "hit": {…}, "at": 1784801237800 }
```

Guarantees:

- Exactly one `lookingUp` and exactly one terminal `recall` per accepted request — **including on the
  not-found path, the unknown-conversation path and the internal-error path**. The cue can never be
  left stuck on.
- A request with neither a number nor a query is refused outright: **no `lookingUp` at all**, one
  `recall` with `ok: false`. So: `lookingUp` turns the cue on, `recall` turns it off; never key the cue
  off anything else.

### 3c. Compacting  **PARTIAL — do not promise a live "compacting" cue**

The SDK exposes only a *boundary* message, which arrives when the compaction is already **done**:

```json
{ "kind": "compacted", "sessionKey": "Repo@main", "trigger": "auto", "preTokens": 812000, "postTokens": 190000 }
```

`trigger` is `"auto" | "manual"`. `preTokens`/`postTokens` may be `null`.

There is **no pre-compaction event**, because the SDK does not emit one. A client MUST NOT render
"⟳ Compacting context…" as a live in-progress state driven by the server; render `compacted` as an
after-the-fact confirmation ("🗜 compacted 812k → 190k"). If a live cue is wanted, the only honest
source is the client's own `contextUsage.percentage` crossing a local threshold — that is a client
heuristic and must be labelled as such, not presented as server truth.

### 3d. Cold load (bonus, already shipped)  **GUARANTEED**

```json
{ "kind": "loadingHistory",     "bytes": 61000000 }
{ "kind": "loadingHistoryDone", "ms": 42000, "bytes": 61000000 }
```

Emitted only when resuming an SDK session log larger than 25 MB. Also a strict ON/OFF pair.

---

## 4. Navigation — windowed transcript + the `around` jump  **GUARANTEED**

### Request

```json
{ "action": "open",   "args": { "sessionKey": "Repo@main", "around": 600, "scoped": false } }
{ "action": "resync", "args": { "sessionKey": "Repo@main", "around": 600, "scoped": false } }
```

`args` accepts exactly three windowing options, in this precedence:

1. `full: true` → the entire transcript, no window (expensive; "Show earlier" all the way).
2. `around: <row index>` → a BAND centred there. **This is jump-to-#N.**
3. `limit: <n>` → the last `n` rows (the growing tail). Default 250.

`around` is a **ROW INDEX into the transcript array**, not a P#/R# number. Convert first: the client
knows the mapping because every rendered row already carries its absolute P#/R# derived from
`promptOffset`/`responseOffset`.

### Response

`open` answers on the `transcript` frame; `resync` answers as an event with `kind: "resync"`. The
windowing fields are identical on both:

```json
{
  "sessionKey": "Repo@main", "sessionId": "6f08…", "repo": "Repo", "worktree": "main",
  "workspaceId": "Repo@main", "usage": { "…": "" }, "status": "idle",
  "turnStartedAt": null, "lastActivityAt": 1784801237739,
  "transcript": [ { "role": "user", "text": "row 350", "at": 350 } ],
  "transcriptTotal": 1200,
  "transcriptTruncated": true,
  "promptOffset": 175,
  "responseOffset": 175,
  "windowStart": 350,
  "windowEnd": 851
}
```

Guarantees:

- Band width is `250` before + `250` after (`WS_RESYNC_MSG_CAP`), so an `around` window is at most 501
  rows. This constant is server-owned; do not hardcode 501 client-side — derive it from
  `windowStart`/`windowEnd`.
- `windowStart` / `windowEnd` are **present only on an `around` request** (absent for tail/full). Use
  their presence to detect "this is a band, not the tail".
- `promptOffset` / `responseOffset` are how many user / assistant rows precede `windowStart`. The first
  prompt in the returned band is `P(promptOffset + 1)`. On a full/tail-from-zero window both are 0.
- `transcriptTruncated` is true when anything was withheld on EITHER side.
- The window is clamped to the array; an out-of-range `around` yields a valid clamped band, never an
  error.

**Not provided:** no server-side LRU / band caching, and no "give me rows N..M" absolute-range action —
`around` is the only random-access primitive. The scroll cache is entirely a client concern.

---

## 5. `recall` — reading a rolled-off turn back  **GUARANTEED**

### Request

```json
{ "action": "recall", "args": { "sessionKey": "Repo@main", "kind": "response", "number": 1237 } }
{ "action": "recall", "args": { "sessionKey": "Repo@main", "query": "kadena pact", "limit": 10 } }
```

- `kind` ∈ `"prompt" | "response"`, defaulting to `"prompt"`.
- `number` is an **absolute P#/R#**, 1-based — the same coordinate system the transcript already labels
  rows with. A valid `number` takes precedence over `query`.
- `limit` defaults to 10 (query mode only).

### Response — by number

```json
{
  "kind": "recall",
  "mode": "number", "kindOf": "prompt", "number": 1, "ok": true, "error": null,
  "hit": {
    "segmentRef": "Repo@main#seg1",
    "workspaceId": "Repo@main",
    "kind": "prompt",
    "number": 1,
    "text": "the very first question about kadena pact",
    "images": [ { "path": "images/bbbbbbbbbbbbbbbbbbbbbbbb.png", "hash": "bbbb…", "mediaType": "image/png" } ],
    "row": { "…": "the raw archived row, verbatim" }
  },
  "at": 1784801237800
}
```

### Response — by query

```json
{
  "kind": "recall",
  "mode": "query", "query": "kadena pact", "ok": true, "error": null,
  "hits": [
    { "segmentRef": "Repo@main#seg1", "workspaceId": "Repo@main", "kind": "prompt", "number": 1, "snippet": "…about kadena pact…", "images": 1 }
  ],
  "at": 1784801237800
}
```

Guarantees:

- `mode` is `"number"` or `"query"` and tells you which of `hit` / `hits` is populated. On a miss,
  `ok: false` with `hit: null` / `hits: []` and a human-readable `error` string.
- `images` differs by mode ON PURPOSE: an ARRAY of refs in `hit` (you are rendering that one turn), a
  COUNT in a query hit (you are rendering a result list). Do not treat them as the same field.
- **`workspaceId` is the field that makes a recalled image renderable.** An image ref's `path` is
  relative to the workspace's own directory, so the existing image route needs both:
  `GET …/image?workspaceId=<workspaceId>&path=<path>`. Never construct an image URL from a recall hit
  without it.
- `segmentRef` is stable (`"<conversationId>#seg<n>"`) and is what the roll seed's footer points at, so
  it is a valid deep-link/bookmark target.
- Query search is a case-insensitive **substring scan**, newest segment first. No embeddings, no
  stemming, no ranking beyond segment order.
- Only ARCHIVED (rolled-off) turns are searched. A turn still in the active window is not found by
  recall — that is not an error, and the miss message says so.

**Not provided:** there is **no agent-side recall tool**. The agent cannot call `recall` itself yet; this
is an operator/UI action only. (Roadmap follow-up.)

---

## 6. Session status vocabulary  **GUARANTEED**

`status` ∈ `"idle" | "thinking" | "awaiting-permission" | "deepwork" | "error" | "ended"`.

- Busy (refuses a new prompt with a `busy` event) = `thinking | awaiting-permission | deepwork`.
- `deepwork` means "the visible turn ended but the SDK query is still producing reply content" — render
  it distinctly from `thinking` (the current client uses a red "Deep Work" indicator vs. orange
  "Working…").
- `turnStartedAt` / `lastActivityAt` are the SERVER's authoritative clock. A reconnecting client must
  use them rather than restarting a local timer, or the elapsed time visibly resets on every reload.

### Roadmap item 4.7 — the `deepwork` "deadlock": INVESTIGATED, **NOT REAL**

Recorded here so it stops being re-litigated. The concern was that `lib/claudeSession.mjs` flips
`idle → "deepwork"` on any non-background, non-`result` event while deepwork clears only on the next
`result` — so a stray post-result event would pin the session busy forever, gating auto-continue.

Post-result events genuinely do occur (that is why the branch exists). But deepwork is **not terminal**:
the event loop has exactly four exits and every one rewrites `status`:

| Exit | Resulting status |
|---|---|
| a following `result` | `idle` |
| the generator ends | `ended` |
| the generator throws | `error` |
| a respawn (roll / lane switch) | `thinking` |

`interrupt()` explicitly accepts `deepwork`, and `_stop` force-idles after a 6s race. All six paths are
locked down by the `4.7:` tests in `lib/claudeSession.test.mjs`.

What remains is a genuinely **hung SDK turn** — the stream stays open and silent mid-turn. There,
reporting busy is the honest answer, and it is the separate hung-turn class `_stop`'s timeout already
covers. **No silence-based self-heal was added, deliberately**: it would have to fire on silence, and
legitimate deep work is silent for minutes, so it would un-busy live sessions and let a prompt interleave
into a running turn — exactly what the single-writer turn lock exists to prevent.

If the "Deep Work… with no visible turn running" symptom is ever reproduced with a transcript, the thing
to capture is the event sequence after the last `result` — not another speculative patch here.

---

## 7. Storage / archive model (background you may need, not a client API)  **GUARANTEED**

- A conversation is a chain of bounded **segments**. Rolling retires a head segment to
  `<transcriptDir>/<workspace-slug>/_segments/<sanitized segmentRef>.jsonl` plus an `_index.json`.
- Index entries carry `{ segmentRef, conversationId, workspaceId, n, path, file, rows, images,
  promptStart, promptEnd, responseStart, responseEnd, summary, at? }`. The P#/R# ranges are ABSOLUTE and
  chain across segments, so a number resolves to exactly one segment.
- **Images are already externalized and always have been.** Uploaded images are content-addressed blobs
  under `<workspace-slug>/images/<hash>.<ext>` and the transcript stores only
  `{ path, hash, mediaType }`. Verified on the live install: 55 MB of blobs against 4.1 MB of JSONL
  text, with zero inline base64 image blocks. There is nothing for a client to un-inline.
- `lib/imageStore.mjs` exists but is **not wired to anything** — it is a second, unused implementation
  of the same job (an `imgref:` scheme under `_images/`). Do not build against it.

---

## 8. Change policy

- **GUARANTEED** items: additive changes only (new fields). No renames, no type changes, no removals,
  without updating this file first and telling every in-flight Phase-2 task.
- **PARTIAL / PROVISIONAL** items (§3c "compacting"): may gain a real pre-event if the SDK ever exposes
  one. Build the indicator component so a third state can be added without restructuring.
- The two known holes, stated plainly so nobody assumes otherwise: **no agent-side recall tool**, and
  **no server-pushed context-usage updates** (poll-only).
