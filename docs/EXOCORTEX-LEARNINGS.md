# Exocortex — Learnings from Reference Repos

**Status:** research note. Feeds the Exocortex initiative (`docs/EXOCORTEX-VISION.md`), which builds the brain
(code-graph + conversation-FTS + skills + user-model) ON TOP of the new Agentic Chat Engine
(`docs/AGENTIC-CHAT-ENGINE.md`).

**Scope of this pass:** READ + CLONE + WRITE-ONE-DOC only. No Claudstermind source was modified.

Repos studied in place at `/home/ancientbox/ClaudeWS/_upstream/` (already fully cloned there) and re-cloned shallow
for this study at `/home/ancientbox/ClaudeWS/_exocortex-study/` (hermes-agent, code-review-graph, graphify,
understand-anything).

---

## 1. Repos studied

| Repo | URL | License | What it does | Core technique | Adoptable for Claudstermind |
|---|---|---|---|---|---|
| **hermes-agent** | github.com/nousresearch/hermes-agent | MIT | Full agent harness (agent loop, skills, memory, cron, subagents). | **Memory = SQLite FTS5 over verbatim messages**, content-external FTS (`content='messages'`) kept in sync by INSERT/DELETE/UPDATE triggers, high-water/progress gating for incremental rebuild, trigram + CJK `LIKE` fallback, BM25 ranking, snippet projection. No embeddings, no LLM summarization in core. | The **exact schema+trigger pattern** for the conversation-FTS brain; the recall query shape (fields, snippet, session/turn context); the learning loop (nudge → background review subagent → skill create/patch + age curator + audit ledger); skills as markdown dirs with a mechanical index. |
| **code-review-graph** (crg) | github.com/tirth8205/code-review-graph | MIT | Tree-sitter code graph exposed to any AI via an **MCP server**, tuned for review/blast-radius with token savings (~71x vs reading the corpus). | Tree-sitter → SQLite graph (nodes/edges). **Hybrid retrieval: FTS5 BM25 + vector embeddings fused with Reciprocal Rank Fusion (RRF)**, with kind/context boosting. **Incremental** update via `git diff` + content hash, re-parse only changed + impacted files. **16 named query patterns** (`callers_of`, `callees_of`, `references_to`, `imports_of`/`importers_of`, `children_of`, `tests_for`, `inheritors_of`, `impact_radius`, event/endpoint variants…). Q&A **memory feedback loop** (results saved as markdown, re-ingested). | **Best retrieval-tool API design** — the 16 query patterns are the menu of graph tools the agent should get. `get_impact_radius` = the blast-radius tool. The MCP-tool framing (every platform consumes it) and the token-benchmark proof. Incremental (git-diff + hash) is directly portable. |
| **graphify** | github.com/Graphify-Labs/graphify | Apache-2.0 (+MIT) | Local-first "map your project into a knowledge graph you query instead of grepping." | Clean staged pipeline `detect → extract → build → cluster → analyze → report → export`. Tree-sitter AST → NetworkX graph, **no embeddings**. Confidence tag on every edge (`EXTRACTED`/`INFERRED`/`AMBIGUOUS`). Leiden **communities** + "god nodes" (degree centrality), LLM-free labels. Exports `graph.json` + interactive force-directed `graph.html` + `GRAPH_REPORT.md`. `serve()` = MCP; `watch()` = debounced rebuild. ~40 languages, per-language extractor modules with a documented "add a language" recipe. | **Best skeleton to build the extractor on** — the pipeline stages, the strict extraction schema (`{nodes:[{id,label,source_file,source_location}], edges:[{source,target,relation,confidence}]}`), the confidence tags, the per-language extractor pattern, and the **force-graph `graph.html`** as the base for the Phase-5 live viz. |
| **understand-anything** | github.com/labolado/understand-anything (a.k.a. Lum1104/Understand-Anything) | MIT | Claude Code plugin: multi-agent LLM+static pipeline → knowledge graph → interactive dashboard + guided tours. | LLM-enriched graph (plain-English summaries per node). **18-edge taxonomy in 5 categories**, Zod-validated. Node types `file|function|class|module|concept`; nodes carry a **Bloom's-taxonomy cognitive level** and teaching hints. | Borrow **only the edge taxonomy** (below) and the node-typing incl. a `concept` node (lets brain/doc nodes join the code graph). Its dashboard pivoted to teaching, not reusable as viz. |

### understand-anything edge taxonomy (the one thing to adopt from it)
```
Structural   : imports, exports, contains, inherits, implements
Behavioral   : calls, subscribes, publishes, middleware
Data flow    : reads_from, writes_to, transforms, validates
Dependencies : depends_on, tested_by, configures
Semantic     : related, similar_to
```
Node types: `file | function | class | module | concept`. The `concept` type is what lets brain notes / ADRs / doc
refs live in the SAME graph as code (graphify does this too, via `# NOTE:`/`# WHY:` → first-class nodes).

---

## 2. Synthesis — the best approach for Claudstermind's brain

The four repos triangulate cleanly, and none of them individually is the target — the target is the **fusion**:

- **Conversation memory** → copy **hermes** almost verbatim in shape: **SQLite FTS5 over verbatim turns, no
  embeddings, no summarization in the hot path.** The content-external FTS + trigger-sync + high-water incremental
  pattern is battle-tested and is exactly what an append-only transcript needs. BM25 ranking + snippet is the recall
  result. This is the North-Star (Vision §Phase 1) and the cheapest, highest-ROI build.
- **Code graph** → **graphify's pipeline + schema** as the extractor skeleton, **crg's 16 query patterns + hybrid
  retrieval + incremental** as the query/serve layer, **understand-anything's 18-edge taxonomy + node types** as the
  schema vocabulary. Build it **Node-native** (per Vision §3) so it lives in the same runtime as the engine, but the
  algorithms are all proven upstream.
- **Storage** → all of it is **small rebuildable SQLite** in the root `.exocortex/` store (Vision §2): raw JSONL as
  source of truth, FTS DB derived from it, graph DB derived from code. Tagged per-repo for cross-repo recall.
- **Embeddings are optional, later.** hermes and graphify prove FTS/graph-only works; crg shows embeddings buy
  recall *on top of* BM25 via RRF. Ship deterministic FTS+graph first; add an embedding lane behind RRF only if
  keyword recall proves insufficient.
- **Everything is an agent tool.** crg's MCP framing is the model: `recall(query|#turn)` and the graph queries are
  tools the model chooses, with progressive disclosure (hermes skills index). The differentiator stays "the mind
  presiding over the graph-of-graphs," not any single index.

### How this rides on the Agentic Chat Engine (the key coupling)
The Agentic Chat Engine already delivers the brain's inputs — the brain is what its `recall()` calls into:
- The engine **rolls** a conversation into a chain of bounded **archived segments** (400 turns / 25 MB; last 40
  turns carried verbatim) and maintains an **archive index** `turn# → segment`.
- The engine defines `recall(turn|query)` and a **visible** indicator (`🔍 Looking up historical turns…`).
- **So the brain's job is: index those archived segments and answer recall.** `recall(#N)` = archive index → segment
  → verbatim turn. `recall(query)` = FTS5 BM25 over all archived segments (cross-repo, per-repo tagged) → ranked
  snippets. The "prior-art check at task start" (Vision §Phase 1) is a `recall(query)` fired automatically on the
  first turn.
- Segment archival is the natural **index trigger**: when the engine archives a segment, the brain ingests it
  (JSONL → FTS rows). No separate capture path to keep alive for archived content; hot turns stay resident in the
  engine, cold turns become brain-searchable. (Vision §Phase 0's "revive capture" still matters for *live* turns
  before they roll.)

---

## 3. Phased build plan (assuming the Agentic Chat Engine exists)

**Phase B0 — Root store + ingest hook (foundations).**
Create `.exocortex/` at the workspace root (SQLite: `conversations` FTS DB, `graph` DB; raw JSONL append-only).
Wire the engine's **segment-archival event** to a brain ingester: on archive, append the segment's turns to the
per-repo JSONL and insert rows into the `messages`/`turns` table. Keep raw JSONL as source of truth (DB always
rebuildable). *Prereq — nothing recalls until segments flow in.*

**Phase B1 — Conversation FTS + recall (NORTH STAR).**
Port the hermes FTS5 shape into the Node store: a `turns` table + content-external `turns_fts` (BM25,
`porter unicode61`), trigger-synced, high-water incremental. Implement the two recall paths the engine calls:
- `recall(#N)` → archive index → segment → verbatim turn (exact, cheap).
- `recall(query)` → BM25 top-k snippets across all archived segments, per-repo tagged for cross-repo hits.
Fire an automatic `recall(query=task)` at task start → the "you already solved this in repo Y" prompt. Ship the
visible `🔍` indicator the engine contract already specifies.

**Phase B2 — Code graph (use-to-learn, then build-to-own).**
(a) Plug in **crg (MCP)** on the JS/TS/Python repos to learn which queries pay off (zero build).
(b) Build the Node extractor on **graphify's pipeline + schema**, emit into the `graph` SQLite DB using
**understand-anything's 18-edge taxonomy** + node types incl. `concept`. Expose crg's **16 query patterns** as
agent tools, `get_impact_radius` = blast-radius. Incremental via git-diff + content-hash (crg). Add the
**graph-of-graphs** (workspace→org→repo→module→function). *Caveat: Pact/Ouronet has no tree-sitter grammar → those
repos lean on B1 conversation-FTS until a custom grammar exists.*

**Phase B3 — Fuse graph ↔ brain, RRF retrieval.**
Let `concept` nodes link code to brain notes/ADRs (graphify `# NOTE:`/`# WHY:` pattern). Introduce hybrid
retrieval **only if needed**: crg-style RRF fusing FTS BM25 with an optional embedding lane. This is the
"differentiating layer" — the mind querying one fused knowledge surface.

**Phase B4 — Skills + learning loop.**
Unify wasp/bee/nectar into agentskills.io markdown dirs with a mechanical prompt index (hermes). Add the
self-improvement loop: turn-counter **nudge → background review subagent** creates/patches a skill → **age curator**
(active→stale→archived) + **audit ledger** for rollback (all straight from hermes).

**Phase B5 — User model + live viz.**
`MEMORY.md`/`USER.md` distilled periodically from recall. Live workspace/knowledge graph on the Linux app built on
**graphify's force-directed `graph.html`** reading the `graph` DB / `graph.json`.

**Phase B6 — Package & publish empty.** Generic-ize paths; migrate personal data out of the Claudstermind repo into
`.exocortex/`; ship engine + starter skills only.

---

## 4. Couldn't-clone / notes
- **No 404s.** `nousresearch/hermes-agent` resolved and cloned cleanly (the Vision doc's URL is correct).
- All three code-graph candidates resolved: **graphify** = `Graphify-Labs/graphify`, **code-review-graph** =
  `tirth8205/code-review-graph`, **understand-anything** = `labolado/understand-anything` (mirror of
  `Lum1104/Understand-Anything`).
- Disk note: shallow re-clones in `_exocortex-study/` total ~300 MB — **hermes-agent alone is ~254 MB** even at
  `--depth 1` (large `assets/`, `web/`, `website/`, locales). The code-graph repos are 8–22 MB each. The same repos
  already existed fully cloned at `/home/ancientbox/ClaudeWS/_upstream/`, which is what was actually studied.
