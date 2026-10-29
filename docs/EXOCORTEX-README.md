# The exocortex — what it does, today

**Status:** branch `exocortex`, not yet merged to `main`. Everything below exists, is tested
(`node --test lib/*.test.mjs relay/*.test.mjs` — 2191/2191 green as of this writing), and in most
cases is already wired into the live chat engine (`lib/workspace.mjs`) — but the branch itself
has not merged, so none of it is running in production yet. See
`docs/work/exocortex/HANDOFF.md` for the branch's own ground rules and
`docs/work/exocortex/plan.md` for the full task-by-task build log this doc summarizes.

**One-line:** Claudstermind is becoming a **coding exocortex** — persistent memory, code
perception, and procedural knowledge that any AI model plugs into to work on your whole
multi-repo workspace. See `docs/EXOCORTEX-VISION.md` for the full design rationale; this doc is
just "what can I actually do with it right now."

---

## 1. Total recall — every conversation is instantly searchable

`lib/conversationFts.mjs` replays each workspace's archived `_segments/*.jsonl` into a SQLite
FTS5 index (BM25-ranked, not a linear scan). `lib/conversationArchive.mjs#recallByQuery` is the
entry point — already wired to `scripts/recall.mjs`'s `#N`/query recall commands and to the
dashboard's `recall` control action.

**Where it lives:** `<workspace-dir>/_segments/_fts.sqlite3`, rebuildable at any time from the raw
JSONL (which stays the source of truth — the index is disposable).

## 2. "You already solved this" — a live prior-art check at the start of every new conversation

The moment you start a genuinely NEW conversation in a workspace (not a resume), the engine
silently checks that workspace's own history — both past conversations (recall) and anything
already recorded in the knowledge store — for anything relevant to your first message, and emits
a `priorArt` event with what it found.

**Built:** `lib/priorArt.mjs`, wired into `lib/workspace.mjs#_prompt`. **Not yet built:** nothing
in the chat UI renders that event yet (`dashboard/public/app.js` is untouched) — today it's real,
tested, server-side data with no visible surface. A future small UI pass is all that's needed to
actually show it to you.

## 3. A durable knowledge store — facts, decisions, with provenance on every entry

`lib/knowledgeStore.mjs`: `facts` (conventions, discriminated by `kind`) and `decisions`
(title/rationale/alternatives, with a real `supersedes` foreign key — a new decision that
contradicts an old one formally supersedes it, same transaction, no window where both read as
active). Every entry is stamped with exactly which conversation/turn it came from and when
(`lib/provenance.mjs`), and `resolveText()` can recover the original turn's text from that stamp.

Facts carry a `confidence` (nullable, 0–1) and a `scope` (`project`|`global`) — this is what
Ch.2.3's ranking (below) sorts by. A fact or decision can be demoted/refreshed or superseded —
nothing durable is ever silently deleted, only marked.

**Where it lives:** `<workspace-dir>/knowledge.sqlite3`.

## 4. Skills (and agents) that propose themselves from repeated work

`lib/skillStore.mjs` + `lib/skillNudge.mjs`: when the same repeated pattern is observed twice
(`SKILL_CLUSTER_THRESHOLD`), `nudgeSkill` proposes a candidate skill — always landing in `pending`,
never auto-adopted. A real `approve`/`reject` verb exists (one-way from `pending`, a reject
requires a reason) — something ECC, the upstream this was studied from, never built. Every
promotion/rollback is an append-only ledger row, not a mutation in place.

The same machinery, with a stricter gate (≥3 "instincts" at ≥0.75 average confidence), proposes
**agent** candidates too — sharing the exact same approve/reject/version/decay state machine via a
`kind` column, not a second implementation.

Skills decay from measured outcomes (`skill_runs` — a window of recent runs below a success
threshold flags a skill `stale`, and it recovers on its own if it starts succeeding again) —
independent of its editorial approval status.

**The draft-content hookup** (Hermes's "nudge → background subagent drafts → human approves"
shape) exists as an injectable async callback on `nudgeSkill`/`nudgeAgent` — called only when a
proposal/amendment is actually about to happen. **Not yet built:** nothing calls this from a live
conversation yet — the detector exists and is fully tested, but what counts as "the same repeated
work" in a real session, and which subagent drafts the content, is still an open integration
decision for whenever that's needed.

## 5. Retrieval into the agent's context — ranked, budgeted knowledge injection

`lib/retrieval.mjs` ports ECC's relevance model: a 0.7 confidence floor, a cap of 6 items, an
8000-character hard budget (whichever binds first), a `+0.25` project-scope boost and `+0.20`
stack-match boost (the latter currently never fires live — no project-stack detector exists yet).
`retrieveForContext(db, opts)` is the composed pipeline a SessionStart-style hook would call — and
is exactly what §2's prior-art check already calls, live.

## 6. AI-drafted handoffs, generated ahead of time, never blocking a roll

When a long conversation rolls onto a fresh window, what the new window gets today is a
mechanical summary (first line of each prompt). `lib/wrapHandoff.mjs` + `lib/oneShotQuery.mjs` +
`lib/workspace.mjs#_prepareHandoff` can draft the REAL thing instead — decisions made, current
state, open threads, where to recall from — using a disposable, tool-free call to the same model
session already running (no new auth surface, no on-disk session file for the draft itself).

This is deliberately **fire-and-forget and off the critical path**: drafting happens early (meant
to fire at the client's 60%-of-context mark), is cached, and the actual roll just reads whatever's
cached — falling back to the mechanical summary if nothing fresh is there. A roll can never stall
waiting on a model call.

**Built:** the full generation/caching/freshness/live-wiring pipeline, server-side, reachable via
a new `"prepareHandoff"` control action. **Not yet built:** nothing in the client calls that
action yet (the 60%-mark trigger is a `ChatShell.wrapReadiness`/`app.js` concern), and there's no
UI to show you the drafted handoff or let you edit it before it's used.

## 7. The code graph — "what calls what," across your whole JS/TS codebase

A from-scratch pipeline, JS/TS only for now:

- **`lib/codeGraphExtract.mjs`** — parses real source with `tree-sitter` (via `web-tree-sitter`,
  prebuilt WASM, zero compiler) and emits `file`/`function`/`class` nodes plus
  `contains`/`imports`/`calls` edges, each tagged `EXTRACTED`/`INFERRED`/`AMBIGUOUS` depending on
  how sure the extraction actually was. Handles re-exports, dynamic `import()`, `require()`, and
  avoids the classic "a method named `then` gets confused with an unrelated top-level function"
  bug class by construction (member-expression calls are never resolved at all — not by
  maintaining a blocklist of dangerous names). Verified against this repo's own 69 real `lib/`
  files: 774 nodes, 1467 edges, zero errors.
- **`lib/codeGraph.mjs`** — loads that into a real `graphology` graph, with Louvain community
  detection and degree centrality wired end-to-end; serializes to/from the exact NetworkX
  node-link JSON shape.
- **`lib/codeGraphIndex.mjs`** — incremental re-indexing: edit one file, and only that file plus
  whatever directly imports it gets re-extracted (not your whole codebase, not a transitive
  cascade). Skips re-extraction entirely when a file's content hash hasn't actually changed.
- **`dashboard/public/graph.html`** — a live viewer. Open it (served automatically alongside the
  rest of the dashboard — no setup) and feed it a `graph.json` file (the `toNodeLink` output of
  the above) to see your codebase as a real, explorable graph, with confidence visibly
  distinguishing a direct AST match from a guess.

**Not yet built:** nothing runs this pipeline automatically against your actual workspaces yet —
every piece above is a tested, working library/page; there's no "watch my repos and keep the
graph fresh" daemon, and no UI hooks the graph into chat answers (e.g. "what calls X" as an agent
tool). That's the natural next layer once this is in daily use.

## 8. A privacy/zone model for what's public vs. private

`lib/storage.mjs`'s `ZONE` enum + `assertZoneRoot` make "which zone is this data in" a checkable
property, not just a convention — see `docs/work/exocortex/three-zone-model.md`. An audit
(`docs/work/exocortex/secrets-audit.md`) found (and partially fixed) a real case of personal/org
data living at a public-shell path; the remaining remediation tiers are a deliberate owner
decision, not yet made (see plan.md 1.2b).

---

## Try it

- **Run the tests:** `node --test lib/*.test.mjs relay/*.test.mjs` from the repo root.
- **See the code graph:** open `dashboard/public/graph.html` against a running dashboard
  instance (or a scratch one — `PORT=<n> node dashboard/server.mjs` — never the live one), with a
  `graph.json` file built from `lib/codeGraphExtract.mjs` + `lib/codeGraph.mjs#toNodeLink`.
  `scripts/graph-smoke.mjs` shows exactly how to drive it end-to-end headlessly.
- **See the prior-art check fire for real:** start a brand-new conversation in a workspace that
  already has recorded facts or archived history — watch for a `priorArt` event (today only
  visible via the raw event stream; no UI renders it yet).

## What's deliberately NOT here

Multi-user/hosted mode, an opt-in "commons" for sharing knowledge across people, local-model
support, and a distillation/user-model layer are all vision-level and explicitly deferred (see
`docs/work/exocortex/HANDOFF.md`'s decision log D4/D5). Publishing this engine empty (so anyone
else could clone it) is blocked on a licensing loose end named in the same doc. None of that is
being built toward right now.

## Where to go deeper

- `docs/EXOCORTEX-VISION.md` — the full design rationale and the 10-point "what this achieves" list.
- `docs/EXOCORTEX-LEARNINGS.md` — what was mined from the upstream projects this was built from.
- `docs/work/exocortex/HANDOFF.md` — the branch's ground rules and decision log (D1–D7).
- `docs/work/exocortex/plan.md` — the complete, task-by-task build log (what's done, what's
  deferred, and why) that this doc is a summary of.
- `docs/work/exocortex/three-zone-model.md` / `secrets-audit.md` — the privacy model and the
  audit that informed it.
- `docs/work/exocortex/code-graph-schema.md` — the full node/edge schema and confidence-tag
  vocabulary for the code graph.
