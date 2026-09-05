# Claudstermind → the Coding Exocortex — Vision, Architecture & Plan

**Status:** living design doc. Captures a long design discussion so it survives outside any single chat.
**One-line:** *Claudstermind is a **coding exocortex** — the persistent memory, code-perception (graphs),
skills, and tools that any AI model plugs into to become an expert on your entire multi-repo workspace.*

> Why this doc exists: a design this big should not live in an ephemeral chat (context windows compact and
> lose fidelity as they grow). This is the durable source of truth — resume from here, not the chat.

---

## 0. What it is (naming)

If the **AI is the mind** (reasoning/will), **Claudstermind is the body** — the external cognitive layer the
mind plugs into. The precise word is **exocortex**.

| Faculty | Provided by Claudstermind | Provided by the AI |
|---|---|---|
| Reasoning / will | — | ✅ the model |
| Long-term memory | brain + FTS recall over conversations | |
| Perception (how it "sees" code) | the code **graph** | |
| Procedural memory (how-to) | **skills** (wasp/bee/nectar, unified) | |
| Effectors (hands) | the **tools** | |
| Executive (orchestration) | the orchestrator | |

Same *category* as Hermes ("agent harness"/"agentic coding substrate"), but the differentiator is
**graph-precise knowledge of a whole multi-repo workspace + your accumulated work**. Public framing:
*"Bring your own AI. Claudstermind is the exocortex it works through."*

---

## 1. Tech primer (shared vocabulary)

- **AST (Abstract Syntax Tree):** code parsed into a tree of its structure (function `foo` takes `a`, calls
  `bar`, imports `baz`) instead of flat text — how you know *what calls what*.
- **Tree-sitter:** a fast parser producing ASTs for ~50 languages, **deterministically, no AI, zero tokens**.
  "Tree-sitter AST extraction" = parse files → walk trees → emit graph **nodes** (functions/classes/files) and
  **edges** (calls/imports/tested-by). This builds the **code graph**.
- **FTS / FTS5 (Full-Text Search):** a SQLite feature that indexes text for instant keyword/phrase search,
  ranked by relevance (a tiny search engine in a DB file), **no AI**. An "FTS call" queries that index (e.g.
  "past turns mentioning `Chainweb storageKeys`") and returns the matching text, best-first. This powers
  **"you already solved this"** recall over conversations.
- Summary: **tree-sitter builds the *code* map; FTS makes *conversations* searchable.** Two cheap,
  deterministic indexes.

---

## 2. Data architecture — THREE homes (the key decision)

Three separate concerns, three separate homes. This is what makes it publishable + private + non-invasive.

| Thing | Where it lives | Published? |
|---|---|---|
| **Your code** | in the workspace repos, **as files, untouched** (git + tools + AI-editing need real files) | your repos |
| **The engine** (Claudstermind) | **its own repo, shipped EMPTY** — code + starter skills only, no personal data | ✅ public, empty |
| **The mind's memory** | ONE dedicated store at the workspace **root** (working name `.exocortex/`) | ❌ private, gitignored |

**The root store (`.exocortex/`) holds:** raw conversations (append-only JSONL, tagged per-repo) + a SQLite
**FTS index** built from them + the **code graph** SQLite DB(s) + the **brain** (curated knowledge) + **learned
skills** + the **user model**.

Decisions baked in:
- **Conversations as data:** keep **raw JSONL as the append-only source of truth** (durable, replayable), and
  build a **SQLite FTS index from it** for fast recall. The DB is always rebuildable from the logs. The code
  graph is also SQLite. So "the database" = a few small, rebuildable SQLite files.
- **Central at the root, tagged per-repo** — NOT inside each repo (that pollutes each repo's git and blocks
  cross-repo search). One store = cross-repo recall + the graph-of-graphs + one backup/sync/gitignore unit.
  (This formalizes an existing pattern: transcripts already live under `.claude/workspace/<repo>/…` at root.)
- **Files never move.** The graph indexes code in place; publishing the engine empty means *relocating the
  personal data out of the Claudstermind repo into the root store* — a one-time data migration, **not** a
  workspace/repo restructure.

**OPEN DECISION:** root store name → `.exocortex/` (recommended), `.claudstermind/`, or keep `.claude/`.

---

## 3. Code graph — use vs build (settled direction)

Split into layers:
- **Commodity-hard layer** (tree-sitter extraction, incremental indexing, blast-radius traversal): **don't
  reinvent — vendor it.** Best base = **Graphify** (Apache-2.0, deterministic tree-sitter, no embeddings, clean
  NetworkX `graph.json`, working force-graph viz, `--watch`).
- **Differentiating layer** (graph fused with brain/skills, the graph-of-graphs, the "mind presiding"):
  **build it ourselves, Node-native, unified.**

Recommended sequence: **use-to-learn, then build-to-own** — plug in **code-review-graph (MCP)** first (zero
build, real value, teaches us which queries help), then build the unified Node engine informed by real usage.

Reference repos (cloned at `/home/ancientbox/ClaudeWS/_upstream/`):
- **code-review-graph** (MIT, MCP server, blast-radius) — best *retrieval tool design* + the "use now" option.
- **graphify** (Apache-2.0) — best *skeleton to build on* (extractor + viz + schema).
- **understand-anything** (MIT) — borrow only its richer **edge taxonomy** (18 types); its dashboard pivoted
  away from graph viz and isn't reusable.

Honest caveat: **Pact (Ouronet) isn't tree-sitter-supported** → the code graph pays off on JS/TS/Python/etc.
repos; Ouronet leans on the FTS knowledge layer (or a custom grammar later).

---

## 4. Reference material learned from Hermes (nousresearch/hermes-agent, cloned in `_upstream/`)

Port the *ideas*, not the Python process. Confirmed by scanning the code:
- **Memory = SQLite FTS5 over verbatim messages. No LLM summarization in core, no embeddings, no graph.**
  (Embeddings only in opt-in plugins.) → validates our FTS-first plan.
- **Skills:** markdown dirs (`SKILL.md`, agentskills.io), a *mechanical* index in the system prompt, the model
  chooses which to open (progressive disclosure).
- **Learning loop:** counter "nudges" (~10 turns/iters) fork a **background review agent** that creates/patches
  skills; an **age curator** (active→stale 30d→archived 90d); an **audit ledger** for per-edit rollback.
- **User model:** Honcho (external backend) — real but a dependency; we prefer our own `MEMORY.md`/`USER.md`.
- **Runtime:** in-process cron the agent can self-schedule; subagents; **PTC/`execute_code`** (model writes
  Python, tools cross back via RPC, only stdout returns → big context savings).
- **Visualization:** Hermes has **none** (a `learning_graph.py` *data model* exists, but no renderer). Our live
  viz is net-new, built on Graphify's force-graph.

---

## 5. The plan (phases)

- **Phase 0 — Foundations.** Create the `.exocortex/` root store + the three-home split. **Revive the brain**
  (fix the dormant capture so *every* workspace turn is logged). *Prerequisite — nothing learns until this
  works.* (Root cause of the dormant brain: the Agent-SDK workspace sessions don't fire the Claude Code
  Stop/SessionStart hooks the way interactive `claude` CLI sessions did — see the brain-diagnosis discussion.)
- **Phase 1 — Knowledge recall (NORTH STAR).** Raw conversations → SQLite **FTS5** index; inject a **"prior-art
  check" at task start** → *"you solved this in repo Y — same approach?"* Highest ROI, smallest build.
- **Phase 2 — Code graph.** Use code-review-graph (MCP) to learn; then build the unified Node engine
  (Graphify's extractor + our store) — the **graph-of-graphs** (workspace→org→repo→module→function) with
  blast-radius retrieval as an agent tool.
- **Phase 3 — Skills + learning loop.** Unify **wasp/bee/nectar** into the agentskills.io format + the
  self-improvement loop (nudge → background subagent → curator + rollback ledger).
- **Phase 4 — User model.** `MEMORY.md`/`USER.md` + periodic distill of your conventions/preferences.
- **Phase 5 — Live viz.** The workspace/knowledge graph on the Linux app, built on Graphify's force-graph.
- **Phase 6 — Package & publish.** Generic-ize (no hardcoded paths), first-class model setup (Claude sub /
  OmniRoute / any OpenAI-compatible endpoint), ship empty, docs.

Cross-cutting: **model-pluggability already exists** (SDK → Claude subscription; OmniRoute routing) — we harden
it for publishing, not build it. Autonomy = *autonomous execution of YOUR directives* only (it decides how to
achieve a goal you set: consult skills, search prior work, query the graph, then act) — not an unprompted
always-on assistant.

---

## 6. What it achieves once ready

1. **Total recall** — every prompt & answer across every repo, captured and instantly searchable.
2. **"You already solved this"** — proactive prior-art at task start; no re-deriving solved problems.
3. **Shared context across repos** — handoffs get short and rare instead of huge (the OuronetUI/Chainweb pain).
4. **Precise, token-cheap code navigation** — blast-radius / "what calls X" over a huge multi-repo workspace.
5. **Skills that self-improve from your work** — wasp/bee/nectar unified, learning as you go.
6. **A model of you** — conventions/preferences applied automatically.
7. **A live visual map** of the whole workspace + the mind's knowledge.
8. **Bring-your-own-AI** — Claude subscription, OmniRoute, or any endpoint.
9. **Private & local** — the mind lives on your machine; the engine publishes empty for anyone.
10. **One orchestrator** — the exocortex presiding over your entire coding workspace, driven by any AI.

---

## 7. Open decisions (to resolve before Phase 0 build)

1. **Root store name:** `.exocortex/` (rec) · `.claudstermind/` · keep `.claude/`.
2. **Build order:** default is Phase 0 → 1 (recall/north-star) → 2 (graph) → 3 → 4 → 5 → 6. Adjust?
3. **User model:** our own `MEMORY.md`/`USER.md` (rec) vs Honcho.
4. **Graph:** "use code-review-graph MCP now, build unified later" (rec) vs build unified immediately.
5. **Viz priority:** later (rec — recall + tokens are the prize) vs sooner.

**Next concrete step when ready:** a contract-first build handoff for **Phase 0 + Phase 1** (foundations +
north-star recall), same discipline as the DMP handoffs.
