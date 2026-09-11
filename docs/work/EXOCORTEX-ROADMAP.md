# Claudstermind — Exocortex roadmap (2.x → beyond)

The long-arc plan: from "my personal coding cockpit" to "a publishable exocortex whose brain
grows with use." Companion to `ROADMAP-2.0.md`, which covers only the immediate 2.0 release.

**Status:** shaping. Nothing here is started. Chapters 0–1 are the only ones with a firm shape;
everything past Chapter 4 is direction, not commitment.

---

## ⏸ RESUME HERE (checkpoint 2026-09-06) — session paused mid-mobile, picking back up at home

The user asked to turn this roadmap into one big executable nectar plan (phases/sub-phases/waves,
parallelizable). Before doing that, a review surfaced a real gating problem and confirmed the
roadmap's own four open questions are genuine, not just hedging. **Nothing below has been decided
without the user — this section is the handoff, not a decision made in their absence.**

### The gating fact that changes "plan it all now"
**Ch. 0 ("Finish 2.0") is not actually done**, and Ch. 1 is explicitly *"THE GATE FOR EVERYTHING
BELOW."* Checked `docs/work/ROADMAP-2.0.md` directly:
- **Phase 4** (infrastructure/hygiene): ~9 items still unchecked, including 4.11 (error rows never
  persisted), 4.12 (compaction boundaries never persisted), 4.13 (images never garbage-collected) —
  the same three items already flagged and deliberately deferred as "Wave 5, blocked" during the
  chat-shell-migration work (see `docs/work/chat-shell-migration/design.md`).
- **Phase 5** (2.0 release): entirely unchecked — no full review pass, no merge to `main`, no tag,
  no `2.0.0` version bump.
So a real top-to-bottom plan has to start with **finishing 2.0**, not with Ch. 1.

### The four open questions below — proposed resolutions, awaiting confirmation
### ✅ Q1 ANSWERED (2026-09-11) — research pass done, both upstream repos read on disk

**Neither "ports". Both are Python. Verdict (b) for both — the shape is reusable, it is a
reimplementation — but for opposite reasons, and at wildly different cost.**

**Hermes — cheap, and the asset is SQL, which is portable by definition.** Its value is the
content-external FTS5 pattern: `messages_fts(content='messages', content_rowid='id')` kept in sync by
INSERT/DELETE/UPDATE triggers, `bm25()` ranking, `snippet()` projection. The Python around it is a
17,370-line `SessionDB` bound to Hermes's own session/compaction/lineage model and is worth nothing to
us. **Verified on this machine, Node v22.22.1: `node:sqlite` ships SQLite 3.46.1 with FTS5 —
external-content tables, triggers, `snippet()`, `bm25()`, boolean MATCH all work with zero
dependencies and zero native build step.** (Caveat: `node:sqlite` emits an ExperimentalWarning on
Node 22; stable from Node 24. A version-policy call, not a blocker.) Estimated Node equivalent:
~300–500 lines of `.mjs`. Days, not weeks.

Worth copying exactly: the incremental-rebuild guard — two `state_meta` keys (`fts_rebuild_high_water`
H, `fts_rebuild_progress` P), a row indexed iff `id <= P OR id > H`, and **every trigger carrying that
same predicate** so a mid-rebuild write cannot corrupt the external-content index. Also the runtime
FTS5 capability probe and the durable staleness breadcrumbs, so a degraded index never silently serves
reads. Deliberately NOT needed: the trigram/CJK table (~2.6× the text size, for a case we do not have).

**Graphify — the Python IS the product.** The pipeline shape is free and worth taking
(`detect → extract → build → cluster → analyze → report → export`, the `{nodes, edges}` schema, the
`EXTRACTED`/`INFERRED`/`AMBIGUOUS` confidence tag, validate-before-build). The graph layer is thin —
the entire NetworkX surface is a container plus five algorithms (~14 distinct calls), and
`graphology` + `graphology-communities-louvain` + `graphology-metrics` covers essentially all of it
(Leiden has no Node equivalent; graphify already ships Louvain as its own documented fallback). The
viz is free: `graph.html` loads `vis-network@9.1.6` from a CDN and reads a JSON file — it does not care
what wrote it. **But `extract.py` is 7,377 lines plus 32 per-language extractor modules, and it is not
translatable.** Those are accumulated scars: e.g. `extractors/go.py` carries a `_GO_PREDECLARED_FUNCS`
blocklist that exists because one unexported method named `append` absorbed 330 phantom inbound
`calls` edges and invented twelve false layering violations on a real 8.9k-node Go codebase. A Node
version realistically starts at JS/TS only and will be worse than graphify for a long time.

**Therefore Ch.3.1's task name is wrong.** "Port the graph engine from Graphify + Hermes" conflates
two unrelated things — **Hermes has no graph at all**. Split it:
- the Hermes work is **Ch.2** (conversation FTS / retrieval), not Ch.3;
- **Ch.3** is a ground-up Node extractor that borrows Graphify's *shape*, scoped to JS/TS first.

**Smallest useful first slice (do this before any full port):** `lib/conversationArchive.mjs`'s
`recallByQuery` is currently a linear `text.toLowerCase().includes(...)` scan over every row of every
segment — no ranking, no snippets, O(corpus) per query. Replace its body with an FTS5 index over the
`_segments/*.jsonl` already on disk, rebuilt by replaying that JSONL (so the DB stays disposable and
the raw JSONL remains the source of truth). Same function signature. Zero new dependencies, testable
under `node --test` with an in-memory DB. It delivers the North Star's retrieval half without blocking
on the Agentic Chat Engine's ingest hook.

**Not determined:** whether the npm tree-sitter grammar packages ship prebuilt `.wasm` usable by
`web-tree-sitter` without a compiler (needs an install to confirm — `@vscode/tree-sitter-wasm` is the
usual prebuilt bundle); and `node:sqlite` FTS5 performance at corpus size (the roadmap's own figure is
4.1 MB of conversation text, almost certainly a non-issue, but unbenchmarked).

1. ~~**Ch.3 — how much of Graphify/Hermes survives the port vs. gets rewritten?**~~ *(answered above)* THE one that
   actually blocks planning Ch. 3 in task-level detail. `docs/EXOCORTEX-LEARNINGS.md` names the
   patterns worth copying (Hermes's SQLite FTS5 memory; Graphify's tree-sitter→NetworkX→viz
   pipeline) but neither has been checked against Claudstermind's actual stack (Node/ESM, no
   Python, no NetworkX). **Needs one more research pass — open both repos, answer "does this port
   cleanly to Node, or does 'port' mean reimplement the shape" — before Ch.3 gets real tasks.**
   Not yet done; do this first when resuming, as step zero of planning Ch.3.
2. **Ch.2 — how much curation can be automated before quality falls off?** Proposed: this is not
   actually a blocker. Ch.2.2 already states the principle ("approval is the quality gate, not a
   UX nicety") — what's open is only *which* patterns get auto-*proposed*, an implementation detail
   of 2.2 itself. Proposed resolution: **decide by building, not before.** Awaiting confirmation.
3. **Ch.6 — commons incentive model (why contribute, what stops poisoning)?** Proposed: **defer
   entirely** — Ch.6 is self-admittedly "direction, not commitment," years out, and answering it
   now would be speculative with zero usage data. Awaiting confirmation.
4. **Ch.4 — hosted offering, or self-host only?** **Genuinely the user's call, not answered.** My
   guess (self-host-only, given stated discomfort with any of their data touching a shared server
   elsewhere) is a guess, not a decision — ask directly when resuming.

### What "resume" should look like, next session
1. Settle question 4 (and confirm/override 2 and 3) with the user.
2. Do the Ch.3 Graphify/Hermes-vs-Node-stack research (question 1) — this was offered to run in the
   background while the user was out; **not yet started**, since the instruction was to pause, not
   continue autonomously.
3. Once settled, build ONE nectar plan covering **remaining-2.0 → Ch.1 → Ch.2 → Ch.3 → Ch.4**, with
   real phases/waves, parallelized wherever tasks are independent. Ch.5–8 stay at vision-level —
   forcing them into committed tasks now would fabricate decisiveness the roadmap itself disclaims.

---

## The core distinction (read this before anything else)

"Brain" gets used for two very different things, with wildly different costs:

1. **Knowledge, skills, graph** — memory, conventions, crystallised skills, code structure.
   Lives in a database. **Buildable now. No GPUs. This is most of the value.**
2. **Model weights** — the neural network itself. Changing this means training.

Almost the whole vision ("my brain becomes a Pact expert, my wife's a Go expert") is **#1**.
Nothing needs to be trained for that to work.

### What is NOT achievable, stated plainly
- **Training a frontier model from scratch** — ~$100M+ and tens of thousands of GPUs. Out.
- **Fine-tuning as a growth mechanism** — a LoRA adapter is affordable (hundreds of dollars),
  but fine-tuning teaches *style and convention*, not intelligence, and causes catastrophic
  forgetting: teach it Pact, it gets worse elsewhere. A scalpel, not a growth path.
- **"Self-improving in perpetuity" from its own output** — this is the documented **model
  collapse** failure mode. The naive flywheel doesn't plateau, it actively rots.

### The reframe that keeps ~90% of the vision
**Put the intelligence in RETRIEVAL, not in weights.** The model stays pluggable; the brain is a
knowledge/skill store it consults. Gains: instant (write a fact, it's live), auditable (you can
see *why* it knew something), reversible (delete bad knowledge — bad training data is permanent),
no collapse, and **merging becomes a database union rather than a training run**.
"The more people use it, the smarter it gets" stays TRUE — the commons grows.

---

## DECISION LOG

### D4 — SELF-HOST ONLY, hosted left open for later. *(decided 2026-09-12, by the user)*
One install, one user. Their conversations, secrets and code never leave their disk; we ship software
and run nothing. **Consequence for Ch.1:** design the storage abstraction so a tenant boundary *could*
be added later — do not build multi-tenancy now, but do not make it impossible either (no globals that
assume a single brain, no paths hard-coded above the store interface).

### D5 — The commons (Ch.6) is DEFERRED. *(decided 2026-09-12, by the user)*
Stays vision. No tasks, no incentive model, no anti-poisoning design until there is usage data.

### D6 — Skill crystallisation: PROPOSE-ONLY, thresholds tuned from real proposals. *(2026-09-12)*
The user's instinct was right that this is a "look at how it is already done" question, not a design
call, so it was answered from the two upstreams rather than guessed:
- **Hermes** (per EXOCORTEX-LEARNINGS): nudge → background review subagent → skill create/patch,
  with an **age curator** and an **audit ledger**. Proposal + review, never auto-adoption.
- **ECC** (`skills/continuous-learning-v2/`): observe → `observations.jsonl` → cheap background model
  mints "instincts" → `pending/` → human promote → 30-day TTL prune. Concrete thresholds worth
  starting from: **cluster ≥2 observations** for a skill candidate; **≥3 instincts and ≥0.75 average
  confidence** for an agent candidate.
So: both propose, neither auto-adopts, and the numbers are tunable constants rather than architecture.
Start at ECC's numbers, tune from what it actually proposes.
**And build the verb ECC omitted:** its `pending/` directory has *no* `approve` command — promotion is
a manual file move, and its `trust` field is a one-valued enum (`unreviewed`) its own docs admit is
never set. Approval is our quality gate, so it gets a real verb and a real state transition.

### D7 — tree-sitter ships prebuilt WASM: Ch.3 stays zero-build-step. *(verified 2026-09-12)*
Measured, not assumed. `npm i web-tree-sitter tree-sitter-javascript tree-sitter-typescript` yields
`tree-sitter-javascript.wasm` (404 KB), `tree-sitter-typescript.wasm` / `-tsx.wasm` (1.4 MB each) and
`web-tree-sitter.wasm` — **no compiler, no node-gyp**. A real parse was run: `Parser.init()` →
`Language.load(...wasm)` → a `(function_declaration name: (identifier) @fn)` query correctly returned
both function names from a two-function source. (`binding.gyp` files exist for the *native* path; we
do not use it.) `@vscode/tree-sitter-wasm` is the fallback bundle if a grammar ever lacks its own.
**So Ch.3 keeps Claudstermind's no-build-step install.** ~6 MB of wasm for JS/TS.


### D1 — Claudstermind is MODEL-AGNOSTIC. Pluggable AI from any source. *(decided)*
Not local-first, not Anthropic-only. The brain is separate from the engine, so Claudstermind
inherits better models — hosted or local — the moment they exist, without a rewrite.
Consequence: the routing layer (`lib/routing.mjs`, `lib/omniRoute.mjs`) becomes a first-class
public interface, not an internal detail.

### D2 — Colibri: REJECTED as a dependency. *(decided, evidence-based)*
Investigated properly rather than dismissed. **Every factual noun in the claim checked out** —
Colibri is real (26.8k stars, Apache-2.0, pure C, actively maintained, Italian author), GLM-5
really did ship at 744B/40B-active with ~19,456 routed experts, and it really does run on 25 GB
of RAM with no GPU. The technique (MoE expert streaming from SSD) is legitimate published work.

**It fails on speed, by orders of magnitude, and this is physics not engineering:** a cold token
costs ~11.4 GB of expert reads, so at ~1 GB/s there is an ~11-SECOND floor per token before any
compute. Measured, from Colibri's own docs: **0.05–0.1 tok/s** on the celebrated 25 GB config
(one token every 10–20s), **1.83 tok/s** on a Ryzen AI Max+ 395, and **5.8–6.8 tok/s on SIX RTX
5090s**. Also: 372 GB download, and Python IS required. The repo is honest about all of this;
the viral posts promoting it are not.

**Revisit trigger is NOT a bigger model.** It is (a) prompt caching landing in local runtimes and
(b) prefill throughput moving from ~340 tok/s toward ~1500+. Without prompt caching, a local
agent re-prefills its whole history every turn: at 32K context that is **~94 seconds of dead time
per turn**, so a 20-turn task burns 30–60 minutes just re-reading itself. Prefill, not decode, is
the wall.

### D3 — Local models: scaffold now, adopt later. *(decided)*
Cheap, reversible: make routing accept an OpenAI-compatible base URL (llama.cpp / LM Studio /
Ollama). Costs ~nothing if local never pans out. Use local for **cheap high-volume, short-context
work** (commit messages, changelog drafts, log summarisation, file triage) where ~30 tok/s is
fine. Keep hosted for the agentic loop. Best current fits on 96–110 GB: `gpt-oss-120b Q4_K_M`
(~31 tok/s, best-documented tool-calling reliability that fits) and `Qwen3-Coder-30B-A3B`
(70–100 tok/s).

---

## Chapters

### Ch. 0 — Finish 2.0 *(in progress — see ROADMAP-2.0.md)*

### Ch. 1 — Split code from data ⟵ **THE GATE FOR EVERYTHING BELOW**
Today code and data are entangled; the repo cannot be published without leaking data.
- [ ] 1.1 Storage abstraction — all conversations/state behind one interface, no direct disk paths
- [ ] 1.2 Full secrets audit; prove a clean-clone install starts empty
- [ ] 1.3 Three-zone model: **public shell** · **private user data (never leaves the disk)** ·
      **opt-in commons (explicitly curated + redacted)**
- [ ] 1.4 Migration for existing installs (this one) without data loss
> Owner note: sensitive site databases must NEVER be committed, not even to a private repo.
> This is the constraint that forces the split — and the split is what makes multi-user possible
> anyway, so it is not throwaway work.

### Ch. 2 — The individual brain
- [ ] 2.1 Durable knowledge store (facts/conventions/decisions) with provenance on every entry
- [ ] 2.2 **Skill crystallisation, human-in-the-loop**: notice repeated work → *propose* a skill →
      user approves. Auto-learning without approval produces confident garbage; approval is the
      quality gate, not a UX nicety.
- [ ] 2.3 Retrieval into the agent's context (this is where "it got smarter" actually happens)
- [ ] 2.4 Decay/conflict handling — stale knowledge must be demotable, contradictions surfaced

### Ch. 3 — Code graph / workspace comprehension
- [ ] 3.1 Port the graph engine from **Graphify** + **Hermes**
- [ ] 3.2 Index a repo into a queryable structure (symbols, deps, call/type edges)
- [ ] 3.3 Incremental re-index on change (full re-index per edit will not scale)
- [ ] 3.4 Wire graph queries into planning — *this* is what makes it your workspace's expert

### Ch. 4 — Publish
- [ ] 4.1 Barebone shell: clean clone, empty brain, no personal data
- [ ] 4.2 License + contribution model
- [ ] 4.3 Onboarding (bring your own key / point at any model per D1)
- [ ] 4.4 Threat model — it executes code and holds secrets; publishing widens the blast radius

### Ch. 5 — Multi-user brains
- [ ] 5.1 Per-user brain isolation
- [ ] 5.2 Multiple workspaces per user, one brain
- [ ] 5.3 Export/import a brain (also the backup story)

### Ch. 6 — The commons (brain merge)
The federation step. **The hard problems here are trust and curation, not code.**
- [ ] 6.1 Export format: shareable knowledge/skills, provenance attached
- [ ] 6.2 **Redaction pipeline** — nothing leaves without explicit review. Hardest, most important.
- [ ] 6.3 Merge/conflict resolution across contributors
- [ ] 6.4 Quality gating — one confidently-wrong contributor must not poison the commons
- [ ] 6.5 Attribution + revocation ("delete my contribution" must actually work)
> Storage is NOT the constraint. Measured from this live install: 4.1 MB of conversation text vs
> 55 MB of images. A 100-user commons is **tens of GB** — one ordinary machine. The constraints
> are privacy, curation quality, and conflict resolution: human-judgment problems.

### Ch. 7 — Local model integration *(scaffold per D3; Colibri rejected per D2)*
- [ ] 7.1 OpenAI-compatible base-URL routing *(small, do early — it's cheap insurance)*
- [ ] 7.2 Route cheap high-volume jobs locally, agentic loop stays hosted
- [ ] 7.3 Watch the revisit trigger (prompt caching + prefill throughput)

### Ch. 8 — OPTIONAL, distant: distil the commons into an adapter
The honest version of "the master brain becomes a model": a LoRA so a local model natively speaks
your conventions. Real and affordable — but a **nice-to-have on top of retrieval, never the
mechanism.** Do not let this become the plan.

---

## Open questions
- Ch. 6 incentive model: why does anyone contribute, and what stops poisoning?
- Ch. 2: how much curation can be automated before quality falls off?
- Ch. 3: how much of Graphify/Hermes survives the port vs. gets rewritten?
- Ch. 4: hosted offering, or self-host only?
