# Exocortex — handoff into the `exocortex` worktree

You are in a **separate git worktree** at `.worktrees/Claudstermind/exocortex`, branch `exocortex`,
branched from `main` at **v1.20.0**. The main checkout stays on `feat-pact-changed-review` for daily
bug-fixing; the two run in parallel and merge at the end as **2.0.0**.

**Do not bump `package.json` here.** It stays at `1.20.0` for the whole of this work. Accumulate
everything under `## [Unreleased]` in CHANGELOG.md — the version test reads the first `## [x.y.z]`
heading and `[Unreleased]` does not match that pattern, so it falls through to `[1.20.0]` and stays
green. One bump, to `2.0.0`, at the merge.

---

## Read these first, in this order

1. `docs/work/EXOCORTEX-ROADMAP.md` — chapters, and **DECISION LOG D1–D7**. D4–D7 were settled on
   2026-09-12 and are not open questions any more.
2. `docs/EXOCORTEX-LEARNINGS.md` — what was mined from the upstream repos.
3. `docs/work/ROADMAP-2.0.md` — Phase 4/5 remnants. 4.11 and 4.12 are **done** (reconciled
   2026-09-12, verified at the call sites); 4.13 (image GC) is genuinely open.

## Settled — do not re-litigate, do not re-ask the user

- **D4 — SELF-HOST ONLY.** One install, one user. Hosted is possible *later*, so Ch.1's storage
  abstraction must not make a tenant boundary impossible — but do **not** build multi-tenancy now.
- **D5 — the commons (Ch.6) is deferred.** Vision only. No tasks.
- **D6 — skill crystallisation is PROPOSE-ONLY.** Answered from the upstreams rather than guessed:
  Hermes does nudge → background review subagent → create/patch, with an age curator and an audit
  ledger. ECC does observe → instincts → `pending/` → human promote → 30-day TTL prune, with usable
  starting thresholds: **cluster ≥2** observations for a skill candidate, **≥3 instincts and ≥0.75
  average confidence** for an agent candidate. Start there, tune from what it actually proposes.
  **Build the verb ECC omitted**: it has no `approve` command and its `trust` field is a one-valued
  enum (`unreviewed`) its own docs admit is never set. Approval is our quality gate.
- **D7 — tree-sitter ships prebuilt WASM.** Verified by install and a real parse: `web-tree-sitter` +
  `tree-sitter-javascript.wasm` (404 KB) / `tree-sitter-typescript.wasm` (1.4 MB), a
  `(function_declaration name: (identifier) @fn)` query returned both function names. **No compiler,
  no node-gyp.** Ch.3 keeps the zero-build-step install. `@vscode/tree-sitter-wasm` is the fallback
  bundle. (`binding.gyp` files exist for the *native* path — we do not use it.)
- **`node:sqlite` is the store.** Verified here: **SQLite 3.46.1 with FTS5** — external-content
  tables, triggers, `snippet()`, `bm25()`, boolean `MATCH` — zero dependencies, zero build step.
  Emits an ExperimentalWarning on Node 22; stable from Node 24. There is **no SQLite anywhere in
  Claudstermind today**; this work introduces the first.
- **Raw JSONL stays the source of truth.** Any database is a disposable, rebuildable index. This is
  already how `_segments/*.jsonl` works — we are adding search, not moving ownership.

## The upstreams — verdicts already reached, with evidence

- **Hermes** (`/home/ancientbox/ClaudeWS/_upstream/hermes-agent`) — Python. **Nothing ports.** The
  asset is ~120 lines of *SQL*: content-external FTS5 (`content='messages', content_rowid='id'`),
  trigger-synced, `bm25()` + `snippet()`. Copy the **incremental-rebuild guard** exactly: two
  `state_meta` keys (`fts_rebuild_high_water` H, `fts_rebuild_progress` P), a row indexed iff
  `id <= P OR id > H`, and **every trigger carries that same predicate** so a mid-rebuild write cannot
  corrupt the external-content index. Also worth taking: the runtime FTS5 capability probe and the
  durable staleness breadcrumbs, so a degraded index never silently serves reads. **Skip** the
  trigram/CJK table (~2.6× the text size, for a case we do not have).
- **Graphify** (`/home/ancientbox/ClaudeWS/_upstream/graphify`) — Python. The **pipeline shape is
  free** (`detect → extract → build → cluster → analyze → report → export`, the `{nodes, edges}`
  schema, the `EXTRACTED`/`INFERRED`/`AMBIGUOUS` confidence tag, validate-before-build). The graph
  layer is thin — the whole NetworkX surface is a container plus five algorithms (~14 calls);
  `graphology` + `graphology-communities-louvain` + `graphology-metrics` covers it. Viz is free:
  `graph.html` loads `vis-network@9.1.6` from a CDN and reads a JSON file in NetworkX **node-link**
  shape (`json_graph.node_link_data(G, edges="links")`) — emit that shape deliberately.
  **But `extract.py` is 7,377 lines plus 32 per-language extractors and is NOT translatable.** Those
  are scars: `extractors/go.py` carries a `_GO_PREDECLARED_FUNCS` blocklist because one unexported
  method named `append` absorbed **330 phantom inbound `calls` edges and invented twelve false
  layering violations** on a real 8.9k-node Go codebase. A Node version starts at **JS/TS only** and
  will be worse than graphify for a long time. Accept that.
  **Ch.3.1's task name is wrong** — Hermes has no graph at all. Hermes work is Ch.2; Ch.3 is a
  ground-up Node extractor borrowing Graphify's shape.
- **ECC** (`/home/ancientbox/ClaudeWS/_exocortex-study/ecc`) — a multi-harness *config distribution*,
  MIT, not a brain. **Nothing for FTS (zero `fts5` hits) and nothing for the graph (zero
  `tree-sitter`/`networkx` hits).** Its 291 skills are mostly generic framework tutorials, vertical
  filler and docs about itself — **ignore them all**. Take exactly:
  - `scripts/lib/state-store/migrations.js:26-77` — **the single best artifact**.
    `skill_versions(skill_id, version, content_hash, amendment_reason, promoted_at, rolled_back_at)`
    is a crystallisation audit ledger with rollback in six columns (→ Ch.2.2);
    `skill_runs(..., outcome, failure_reason, tokens_used, duration_ms, user_feedback)` is a *measured*
    decay signal (→ Ch.2.4); `decisions(title, rationale, alternatives CHECK(json_valid),
    supersedes FK → decisions(id), status)` is conflict handling as a foreign key (→ Ch.2.4).
  - `ecc.memory.v1` frontmatter field list + its enums — `kind` has 8 values;
    `scope ∈ {project, team, user}` maps onto Ch.1.3's three-zone model.
  - `SECRET_PATTERNS` (`memory-vault-format.js:48-60`) — 10 regexes (provider/Stripe/npm/HF/GitHub/
    Google/Slack/AWS keys, PEM blocks) → Ch.1.3 redaction.
  - The two handoff templates: the prose checklist in `skills/unified-memory/SKILL.md` §3 and the
    five-section prompt in `llm-summary.js:118-150`.
  - **Reimplement** `instinct-relevance.js` + the SessionStart budgeting constants (~170 lines
    CommonJS → `.mjs`): confidence floor 0.7, cap 6 items, 8000-char budget, **+0.25** project-scope,
    **+0.20** stack-match, degrade to confidence-only when nothing matches. This answers Ch.2.3.
  - All of the above are root-MIT, ECC-origin files. (18 of its *skills* carry their own licence, 8
    Apache-2.0 — irrelevant, since we take no skill bodies.)
  - **Ignore** its markdown linear-scan retrieval — strictly worse than the FTS5 plan already chosen.

## The work, in order

**Wave 0 — finish 2.0** *(small; do not let it expand)*
- 4.13 image garbage collection (genuinely open)
- Phase 5: review pass, 2.0 CHANGELOG entry. The **merge and the 2.0.0 bump happen at the very end**,
  from this branch.

**Wave 1 — Ch.1, split code from data** ⟵ *the stated gate*
- 1.1 storage abstraction — one interface, no direct disk paths
- 1.2 prove a clean clone starts empty — **mostly already true**: conversation data lives in
  `ClaudeWS/.claude/workspace/` (266 MB, 18 stores) and secrets in `ClaudeWS/.secrets/`, both the
  repo's **parent**. `dashboard/data/{relay,routing,tokens}.json` are already gitignored (verified
  with `git check-ignore`). The only in-repo `.claude/` is a 192-byte `launch.json`.
- 1.3 three-zone model: public shell · private user data · shared brain
- 1.4 migration for this install

**Wave 2 — Ch.2, the brain. START HERE IF YOU WANT CODE ON DAY ONE.**
- **2.0 — the first slice, and it is deliberately small.** `lib/conversationArchive.mjs`'s
  `recallByQuery` (~line 280) is a **linear `text.toLowerCase().includes(needle)` scan** over every
  row of every segment (line ~312) — no ranking, no snippets, O(corpus) per query. Replace its body
  with an FTS5 index over the `_segments/*.jsonl` already on disk, built by replaying that JSONL.
  **Keep the function signature.** Zero new dependencies. Test with an in-memory DB under
  `node --test`, matching the existing convention. `scripts/recall.mjs` already resolves
  `Khronoton#R949` addresses, so the `recall(#N)` half is done.
- 2.1 durable knowledge store, provenance on every entry
- 2.2 skill crystallisation (D6) — **with a real `approve` verb**
- 2.3 retrieval into the agent's context — port ECC's budgeting
- 2.4 decay + conflict handling — the `skill_runs` outcomes and the `decisions.supersedes` FK
- **2.5 wrap handoff.** Today `buildSeedText` carries a *mechanical* summary: the first line of each
  archived user prompt (≤80, 140 chars each) plus the verbatim tail. Deliberate — *"no extra model
  turn → a roll can't stall on summary quality"*. It carries what was **asked**, never what was
  **decided**. That was tolerable when a human watched every wrap; auto-continue now runs unattended
  server-side, so a wrap mid-sweep hands a list of prompt titles to a fresh window with nobody there.
  Fix without losing the no-stall property: **generate the handoff at the 60% manual-wrap threshold,
  cache it, use it at wrap time if fresh, else fall back to the mechanical summary.** Content =
  decisions, current state, open threads, and where to recall from — not a retelling. Show it; it
  should be readable and editable.

**Wave 3 — Ch.3, the code graph**
- JS/TS only. tree-sitter WASM (D7), `graphology`, `vis-network` reading node-link JSON.
- 3.1 pipeline + schema + confidence tags (design, free) · 3.2 extractor · 3.3 graph · 3.4 viz ·
  3.5 incremental re-index (git-diff + content hash)

**Wave 4 — Ch.4 publish** *(self-host only, per D4)*
- Barebone shell · licence · onboarding · threat model
- **Blocker to clear before this ships:** `nectar` had no LICENSE file when vendored, and neither did
  the `wasp-dev` root. `bee` is MIT; `wasp` is ours. Permission came directly from nectar's author —
  the problem is not consent, it is that redistributing unlicensed code leaves everyone who clones
  Claudstermind in the same ambiguity with no author to ask. **Get it in writing.**

## House rules for this tree

- **Reproduce before fixing.** Measure with a CDP probe or a real run; do not reason from a screenshot
  or from the code alone. Several bugs this session survived two "fixes" because I inferred the
  mechanism instead of reading the state.
- **Red before green.** Every test must fail against the unfixed code, and you must have *seen* it
  fail. A test that passes either way pins nothing.
- **Tests read code, not prose.** Strip comments before pattern-matching source — an assertion that
  greps the whole file will flag its own explanatory comment as the bug. This happened three times.
- **Never write a measurement you could not take.** `scrollHeight`/`offsetWidth` are `0` on an
  unlaid-out element, and writing that value collapses the thing you were sizing — *and* do not record
  a failed attempt as done, or the collapse outlives its cause.
- `node --test lib/*.test.mjs relay/*.test.mjs` + `node scripts/mobile-smoke.mjs` after any `app.js`
  change. `node --check` and the unit suites cannot see a `ReferenceError` on page load.
- **Deploying restarts `sessiond` and interrupts in-flight turns** (`lib/controlPlane.mjs` says so).
  The deploy plan restarts `["web","sessiond"]` whenever a `lib/` file changed. Do not deploy from
  this branch during exocortex work — it is not what the daily chat is running.
- `plugins/` is vendored (bee 4.8.2, wasp 1.5.0, nectar 1.0.0 @ upstream `6e12838f`). Do not hand-edit;
  `node scripts/sync-plugins.mjs` re-vendors, `--check` reports drift.

## First action

Read the three roadmap docs, then **write the nectar plan** — one `docs/work/exocortex/plan.md`
covering Wave 0 → Wave 3 in dependency waves, with checkable acceptance criteria per task. Then start
at **2.0, the FTS slice**: it is the smallest thing that makes recall real, needs no new dependencies,
and does not block on anything in Wave 1.
