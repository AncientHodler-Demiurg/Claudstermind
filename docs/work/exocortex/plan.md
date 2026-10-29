# Exocortex — plan

One nectar plan, Wave 0 → Wave 3, in dependency order. Wave 4 (publish) exists in
`EXOCORTEX-ROADMAP.md` but is out of scope here — self-host only (D4), and it has its own
blocker (the LICENSE permission-in-writing item) that isn't ready to plan around yet.

Read `docs/work/exocortex/HANDOFF.md` first — D4–D7, the three upstream verdicts, and the house
rules below are already decided and are not re-litigated by this plan.

**Versioning:** `package.json` stays `1.20.0` for the whole branch. Every change lands under
`## [Unreleased]` in `CHANGELOG.md`. The single bump to `2.0.0` happens at the merge to `main`,
not inside any wave here.

**Wave numbering vs. dependency:** the four waves below are numbered to match the roadmap's
chapters, but **Wave 1 does not gate Wave 2/3 code**. Ch.1 ("split code from data") is the gate
for *publishing* — it has to be true before this repo can be cloned by anyone else. It is not a
prerequisite for *writing* Ch.2/Ch.3 features, which run against the same disentangled-but-not-
yet-audited storage that already exists. So Wave 1 and Wave 2 are parallel tracks in practice;
Wave 3 depends only on Wave 2's shape (the `concept` node / provenance pattern), not its full
completion. Sequence them together if more than one line of work is running at once.

**Contended files** (serial, one agent/session at a time): `lib/workspace.mjs`,
`dashboard/public/app.js`. Everything else — new `lib/*.mjs` modules, tests, docs — is free to
parallelize.

**House rules that apply to every task below** (full text in HANDOFF.md): red before green: a
failing test observed against the unfixed code before any fix; reproduce with a real run before
believing a fix worked; never deploy from this branch (`sessiond` restart would interrupt the
daily chat on the main tree); `plugins/` is vendored, never hand-edited.

---

## Wave 0 — finish 2.0 *(small; do not let it expand)*

Two items only, per HANDOFF. Everything else still open in `ROADMAP-2.0.md` Phase 4 (4.1 CLI
auto-updater, 4.3 branch-merge hygiene, 4.5 Kimi exposing 0 models, 4.6 OmniRoute bench
local-only, 4.8 `contextUsage ok:false` payload trap, 4.9 `recallCue` string-matching, 4.10
mobile-browser verification, 4.14 document-attachment upload UI) is **explicitly parked**, not
forgotten — pulling any of it in here is exactly the scope creep HANDOFF warns against.

- [x] **0.1 — 4.13 image garbage collection.** *(this session)*
  `workspaceStore.saveImage` writes content-addressed blobs to `<workspace>/images/` and nothing
  ever deleted them; `deleteSession` removed only the JSONL. New `lib/imageGc.mjs`: a
  reference-counted sweep — an image is dead when no *live* transcript row and no *archived
  segment* row references its hash.
  - [x] Pure `computeImageGc({ liveRows, archivedRows, existingHashes })` — no disk access,
        unit-tested without a filesystem. Also added `conversationArchive.readAllArchivedRows`
        (new export — every row across every segment, no kind/number indexing) so the driver
        below doesn't need to duplicate the archive's private row-reading internals.
  - [x] Impure driver `sweepImages(wsDir)` — takes a WORKSPACE'S OWN directory (exactly what
        `saveImage`/`deleteSession` already resolve to), reads every live `.jsonl` session file
        + the full archive under it, and deletes whatever's unreferenced. **Wired directly into
        `workspaceStore.deleteSession`** (best-effort — a sweep failure never turns an already-
        successful delete into a reported one) rather than left as a separate manual command:
        `workspaceStore.mjs` isn't one of this branch's contended files (only `lib/workspace.mjs`
        and `dashboard/public/app.js` are), so this didn't need the 2.2/2.3/2.5-style
        build-then-defer-wiring split — it shipped whole.
  - [x] Test: an image referenced only by a since-deleted session is swept; one still referenced
        by an archived segment survives; one referenced by two live sessions sharing a workspace
        dir survives deleting one of them — plus an end-to-end `workspaceStore.test.mjs` case
        proving `deleteSession` itself triggers the sweep, re-derived from whichever sessions
        actually remain (not a snapshot taken before the delete).
  - [x] Caught two real bugs by actually running the tests, not trusting the code as written:
        `computeImageGc(null)` threw (the same `{ } = {}`-doesn't-guard-`null` class of bug as
        2.5a's `buildHandoffPrompt`, now fixed the same way), and a test itself used a
        23-character hash literal that silently never matched the 24-hex-char filename regex,
        making the very first version of the "mixed dead/live/archived" test pass for the wrong
        reason (`fileByHash` was empty, so there was nothing to get wrong).
  - [x] `node --test lib/imageGc.test.mjs` green — 13 tests. Full suite 2060/2060.

- [x] **0.2 — Phase 5: review pass + 2.0 CHANGELOG entry.** *(this session)*
  Not the merge itself — the merge/tag/`2.0.0` bump happen once, at the very end, from this
  branch, per HANDOFF. This task is the pre-merge readiness gate.
  - [x] `code-review` run across everything accumulated under `## [Unreleased]` so far —
        confirmed via `git log` that every uncommitted file IS everything accumulated (the last
        commit on this branch before this session was the HANDOFF doc alone, no code). The
        skill's own multi-agent pass plus deep per-file follow-ups surfaced real findings beyond
        its own top-level summary; validated each against the actual code before fixing anything:
        - **Fixed (correctness):** `openDatabaseFile`'s corrupt-file recovery leaked a
          `DatabaseSync` handle (verified empirically: the constructor succeeds even against a
          garbage file, only `exec()` throws, so the failed attempt must be `.close()`d before
          retrying). New `recreateOnCorruption` option + shared `openNonDisposableDb` helper —
          `knowledgeStore.mjs`/`skillStore.mjs` were reusing the FTS index's "wipe a corrupt file
          and start fresh" policy, correct for a disposable index but WRONG for the durable
          knowledge/skill stores, which have nothing to rebuild from: a corrupt file now returns
          `null` (a surfaced failure) and is left on disk for manual recovery, never silently
          wiped. The same helper also verifies `PRAGMA foreign_keys` actually took effect rather
          than trusting a `try{}catch{/* best effort */}` that could silently leave
          `decisions.supersedes`/`skill_versions`' FK unenforced with no signal.
        - **Fixed (correctness):** `retrieval.mjs` — `maxItems: 0` (a legitimate "give me
          nothing") silently fell back to the default cap of 6; `matchesStack` never lowercased
          caller-supplied `stackKeywords`, so a real stack detector's `"Go"`/`"TypeScript"` would
          never match; `computeRelevanceBoost`'s strict `scope === "project"` disagreed with
          `formatFactsForContext`'s "anything non-'global' displays as project" — a fact with a
          malformed/missing `scope` would show `[project ...]` while scoring zero project boost.
          New shared `scopeLabel()` ties the two together so they can't drift apart again.
        - **Fixed (correctness, latent):** `conversationFts.mjs`'s `upsertRow` silently defaulted
          a missing/non-finite `number` to `0`, which — combined with `UNIQUE(conversationId,
          kind, number)` + `INSERT OR REPLACE` — could make two malformed rows for the same
          `(conversationId, kind)` silently collide. Not reachable via the current sole caller,
          but the module is explicitly built for reuse; now rejects rather than corrupts.
        - **Recorded, not fixed (deliberate deferral — cleanup/efficiency, not correctness):**
          three independent JSONL-line-parsing loops (`imageGc.mjs`, `conversationArchive.mjs`,
          `workspaceStore.mjs`) that could drift on edge-case handling (only `workspaceStore.mjs`
          handles `\r\n`); `listFacts`/`listDecisions`/`listSkills` each rebuild the same
          WHERE-clause boilerplate, inconsistently validated; six near-identical
          `BEGIN`/`COMMIT`/`ROLLBACK` blocks with no shared `withTransaction` helper; the
          image-filename regex duplicated in `imageGc.mjs` and `workspaceStore.mjs`; no
          connection-pooling — `recallByQuery`/`knowledgeStore`/`skillStore` each open+exec the
          full schema DDL and close on every single call, and `deleteSession`'s image sweep
          re-reads a workspace's entire archive on every delete. All explicitly acceptable at
          today's scale per the code's own comments; worth a pass if either usage volume or the
          number of these stores grows. Not filed as separate plan tasks — noted here so they
          aren't silently lost, consistent with this branch's own "record deferrals, don't drop
          them" pattern (2.2b/2.2c/2.3b/2.5b).
        - 8 new regression tests pinning the four fixed bugs (2 `conversationFts.test.mjs`, 1
          each `knowledgeStore.test.mjs`/`skillStore.test.mjs`, 3 `retrieval.test.mjs`, 1 more
          `conversationFts.test.mjs` for the `upsertRow` reject-path).
  - [x] Full suite green: `node --test lib/*.test.mjs relay/*.test.mjs` — 2068/2068.
        `node scripts/mobile-smoke.mjs` **N/A this pass**: it drives a live dashboard + real
        Chromium against `dashboard/public/app.js`, which nothing in this session touched (only
        `lib/` backend modules) — the house rule ties it to an app.js change, which didn't happen.
  - [x] `## [Unreleased]` section in `CHANGELOG.md` reads as a coherent story of the whole
        branch, grouped by wave/chapter — confirmed by re-reading it top to bottom just now
        rather than assuming the incremental entries add up to one; they do.
  - [x] User acceptance evidence gathered, decision left to the user (never self-certified): ran
        a **read-only dry run** of `computeImageGc` (the pure half — `sweepImages`, the deleting
        half, was never invoked) against the real install's 13 workspaces that have any images:
        **781 images total, 21 (2.7%) would be swept, 760 would survive.** No workspace showed a
        implausible "everything would be deleted" result. This is evidence for the user's own
        acceptance call, not a substitute for it — the actual sweep only runs live via
        `deleteSession`, on a session the user actually deletes, going forward.

---

## Wave 1 — Ch.1: split code from data

- [x] **1.1 — Storage abstraction.** *(this session)*
  One interface for "where does conversation/workspace/skill/knowledge state live" — no direct
  `path.join(transcriptDir, ...)` calls above it. D4: design so a tenant boundary *could* be
  added later (no module-level globals assuming a single brain, no paths hard-coded above the
  interface) — but do not build multi-tenancy now.
  - [x] New `lib/storage.mjs` exporting the interface: the id↔slug primitives (moved from
        `workspaceStore.mjs`, which now re-exports them unchanged for backward compatibility) and
        the ONE new thing that didn't exist before — `workspaceDir(root, id)`, the single
        computation every other workspace-relative path is built from. Also
        `segmentsDir`/`imagesDir`/`documentsDir` + their subdir-name constants, so the literal
        strings `"_segments"`/`"images"`/`"documents"` each exist in exactly one place.
        Deliberately scoped to PURE PATH COMPUTATION only — no fs reads/writes — since every Ch.2
        store (`conversationFts`/`knowledgeStore`/`skillStore`) already receives an opaque
        `baseDir` from its caller and computes its OWN filename internally; that shape was
        already correct and untouched here. Migrated: `lib/workspaceStore.mjs` (6 call sites +
        the `"images"`/`"documents"` literals), `lib/workspace.mjs` (5 call sites — the contended
        file, edited carefully, one site at a time, tests run after each), `lib/pactIdeState.mjs`
        (2), `lib/imageGc.mjs` (1), `lib/conversationArchive.mjs`'s `SEG_DIR` (re-exports the same
        value from `storage.mjs`'s `SEGMENTS_SUBDIR` rather than a second `"_segments"` literal).
  - [x] Grep for raw `path.join(...slugFor(...))` outside `lib/storage.mjs` — the only remaining
        hits are `slugFor(sessionId)` calls building a session FILENAME inside an
        already-resolved `wsDir`/`workspaceDir(dir,id)`, a legitimate, different use of the same
        exported primitive, not a second root+id computation. The root+id computation itself is
        now singular.
  - [x] Existing test suites for every migrated module pass with **zero behavior changes** —
        confirmed both directions: full suite green *before* touching anything (2068/2068), and
        green *after* with only ADDED tests, no existing test file needed an edit
        (`workspaceStore.test.mjs` 44/44, `lib/workspace.test.mjs` 115/115 — including the
        roll/archive-specific cases that directly exercise the migrated call sites,
        `conversationArchive.test.mjs` 15/15, `pactIdeState.test.mjs` 10/10, `imageGc.test.mjs`
        13/13). Plus 7 new direct tests for `storage.mjs` itself, including one pinning the
        real on-disk literal values (`"_segments"`/`"images"`/`"documents"`) so a future edit to
        the constants can't silently orphan an existing install's files. Full suite 2075/2075.

- [x] **1.2a — Audit: does a clean clone start empty?** *(this session — audit complete; verdict
  is FAILS, remediation is 1.2b below, not actioned here)*
  HANDOFF's "mostly already true" was correct for `.claude/` specifically — the miss was scope:
  nobody had checked the repo ROOT. Full evidence in `docs/work/exocortex/secrets-audit.md`.
  - [x] Written audit listing every path Claudstermind reads/writes at runtime, in-repo vs
        outside — `transcriptDir`/`secretsDir`/`sdkProjectsDir` all correctly resolve OUTSIDE the
        repo (parent-of-repo or `$HOME`); `brainDir` does not — it resolves to `<repo>/brain/`.
  - [x] `git clone` into a scratch dir + fresh install — **verified by an actual clone-and-run,
        not by reasoning about `.gitignore`** (house rule: reproduce, don't infer): a real clone
        checks out `brain/` (99 files, 792KB — real per-project distilled knowledge: architecture
        decisions, commit hashes, treasury/bridge policy for a live cryptocurrency project) and
        `meta/` (10 files, 116KB — real org/infra docs) with **zero `.gitignore` coverage for
        either**. Also found, same pass: `dashboard/data/map.json` (tracked, same business
        content, not on the list that already covers its siblings `tokens.json`/`relay.json`/
        `routing.json`), `MANIFEST.md` (repo root, real infra/paths), and — a different class of
        finding — the ORGANIZATION'S REAL NAME hardcoded into shipped UI copy
        (`dashboard/public/app.js`'s login gate literally reads "Access is limited to Ancient
        Holdings admins"). **This predates the exocortex branch entirely** — confirmed reachable
        from `main` via `git merge-base` and `git log main -- brain/ meta/`; it is a long-standing
        condition of the whole repo, not something introduced by this work.
  - [x] `launch.json`'s 192 bytes reviewed line-by-line — confirmed clean, a generic VS Code
        debug-launch stanza, no paths/names/tokens. No fix needed.
  - [x] `git check-ignore` sweep of every path named above, output captured verbatim in the audit
        doc — `brain/`, `meta/`, and `dashboard/data/map.json` all come back "NOT ignored";
        everything already believed clean (`.secret/`, `scratch/`, `.env`, the other three
        `dashboard/data/*.json` files) checks out correctly ignored.
  - **No credential-shaped secret was found tracked anywhere in this repo** — everything above is
        business/strategic *content*, not API keys/tokens/passwords. Real privacy problem,
        different remediation path (redaction/untracking, not rotation).

- [x] **1.2b — Remediate: tier (a) only.** *(this session)* Tier (b)/(c) remain NOT started — a
  decision for the repo owner, not this pass.
  Three tiers named in the audit doc, escalating in irreversibility: **(a) `.gitignore` entries for
  `/brain/`/`/meta/`/`dashboard/data/map.json`** — done, see below; (b) `git rm --cached` those
  paths — removes from the next commit onward, still leaves ~524 commits of history untouched,
  NOT done; (c) a full history rewrite (`git filter-repo` or equivalent) — destructive, needs a
  verified backup and explicit owner sign-off before ever running, NOT done. The UI/product-identity
  strings (§6 of the audit) are a Ch.4 generalization task, not a `.gitignore` fix.
  - [x] `.gitignore` gained `/brain/`, `/meta/`, `dashboard/data/map.json`. Verified by probe: a
        *new* file under `brain/`/`meta/` is now correctly ignored (`git check-ignore -v` matches).
        **Confirmed limitation, not a bug:** the 110 files already tracked before this line
        existed are untouched by it — `.gitignore` has no retroactive effect on tracked paths.
        `git ls-files` still lists all 110; `git check-ignore` reports no match for `map.json`
        specifically because it's tracked (the other `dashboard/data/*.json` siblings it was
        modeled on were never tracked in the first place, which is why they show as ignored and
        this one doesn't).
  - Given D4 (self-host only, no publishing planned yet), there is no live urgency to go further —
        but Ch.1's own opening line ("the repo cannot be published without leaking data") is still
        not fully true after tier (a) alone; tiers (b)/(c) stay an explicit owner decision, not
        actioned here. Ch.4 cannot start until this line is checked off for real.

- [x] **1.3a — Three-zone model: the design note.** *(this session — 1.3b split off below,
  blocked on 1.1)*
  Public shell (code) · private user data (never leaves the disk) · shared brain (what Ch.2's
  knowledge store manages, still private by default — the "opt-in commons" of Ch.6 is deferred
  per D5, so "shared" here means *shared across this user's workspaces*, not multi-user). Written
  up in `docs/work/exocortex/three-zone-model.md`, directly informed by 1.2a's audit rather than
  designed in the abstract.
  - [x] A short design note naming which existing directories map to which zone, using ECC's
        `scope ∈ {project, team, user}` enum from HANDOFF as the vocabulary anchor for zone 2/3
        (`team` unused today, reserved — this schema's `facts.scope` only accepts
        `'project'|'global'`, `'global'` standing in for ECC's `'user'`).
  - **A real structural finding fell out of building this table, not just a documentation
        exercise:** every Ch.2 store (`conversationFts.mjs`/`knowledgeStore.mjs`/`skillStore.mjs`)
        correctly follows the `openDb(baseDir)` pattern — caller supplies an outside-the-repo
        root, nothing hard-codes a path — except `dashboard/server.mjs`'s `brainDir`
        (`resolve(__dir, "..", "brain")`), which is the ONE place that put Zone-3 content at a
        Zone-1 (repo) path. This is 1.2a's `brain/` finding, reframed as "wrong zone" rather than
        "missing `.gitignore` line" — and it's why 1.2b's remediation needs to actually MOVE
        `brainDir`, not just hide its current location from git. Feeds directly into 1.4.
- [x] **1.3b — Storage abstraction exposes zone as part of its interface.** *(this session)*
  `lib/storage.mjs` gains a real, importable `ZONE` enum (`SHELL`/`PRIVATE`/`BRAIN`) and
  `assertZoneRoot(zone, absPath, repoRoot)` — a call site establishing a Zone-2/3 root now states
  its zone explicitly, and a violation is a loud, immediate error, not a silent structural mistake
  an audit happens to notice months later. `isInsideRepo(absPath, repoRoot)` is the pure check
  underneath it, tested on its own (repo root itself, nested paths, a sibling repo whose name
  merely shares a string prefix — `path.relative`-based, not `startsWith`, is what makes that last
  one correct).
  - [x] The storage abstraction exposes zone as part of its interface: `assertZoneRoot` is the
        checkable form of "which zone is this" — `SHELL` is exempt by construction (Zone 1 is
        SUPPOSED to live in the repo), `PRIVATE`/`BRAIN` throw if their root resolves inside it.
  - [x] Test: **pinned to the EXACT real `brainDir` bug shape**, not a synthetic example — the
        test reconstructs `dashboard/server.mjs`'s actual anchors (`dashboardDir` one level under
        the repo root, `MASTER_ROOT` one level further up again, the repo's parent) and proves
        `assertZoneRoot` throws for the shipped formula (`resolve(__dir, "..", "brain")` — lands
        on the repo root) and passes for the fix (`resolve(MASTER_ROOT, "brain")` — the same
        anchor `transcriptDir`/`secretsDir` already use correctly). This is deliberately a
        pinned-invariant test rather than a live fresh-clone process test — importing
        `dashboard/server.mjs` directly in a unit test would pull in its real startup side effects
        (listeners, env reads) for no added coverage; reconstructing its real path arithmetic
        catches the exact same class of bug without that cost.
  - **Deliberately NOT wired into the live call sites yet** (`dashboard/server.mjs`'s
        `transcriptDir`/`secretsDir`/`brainDir`): calling `assertZoneRoot` on the real values, AND
        fixing `brainDir`'s formula so it stops throwing, is one coherent change — that's **1.4**,
        which already owns "move `brainDir` to follow the same pattern." Building the checkable
        interface here, applying it there.
  - [x] 5 new tests, full suite 2080/2080 green.

- [x] **1.4a — The `brainDir` fix + a guarded, tested migration capability.** *(this session — 1.4b,
  actually running it for real, deliberately NOT done — see below, a real operational finding,
  not just caution)*
  - [x] `dashboard/server.mjs`'s `BRAIN_DIR` fixed: was `resolve(__dir, "..", "brain")` (lands on
        the repo root — 1.2a/1.3a's finding), now `resolve(MASTER_ROOT, "brain")`, the same anchor
        `transcriptDir`/`secretsDir` already use. Wired through `assertZoneRoot(ZONE.BRAIN, ...)`
        at the point it's defined (1.3b's guardrail, now actually load-bearing, not just tested in
        isolation) — a future regression fails loudly at import time. All three call sites that
        used the old inline `resolve(__dir, "..", "brain")` (one of which — `/api/brain` — a
        second grep pass caught that the first one missed) now read the one constant.
  - [x] A migration script, guarded: new `lib/brainMigration.mjs` (`planBrainMigration` — pure
        read, classifies every file as would-copy / already-present / CONFLICT; `migrateBrain` —
        the same classification, plus `execute:true` to actually copy) + `scripts/migrate-brain.mjs`
        (dry-run by default, `--confirm` to apply, `--old`/`--new` overrides). **COPY-ONLY, never
        deletes the old (repo-tracked) location** — deleting it is a step toward 1.2b's
        still-open decision, deliberately left to that decision, not folded in here. A
        destination file that already exists with DIFFERENT content is a reported conflict,
        never auto-resolved either direction.
  - [x] Idempotent — a second `execute:true` run finds nothing left to copy (mirrors
        `migrateLegacyRootSegments`'s own idempotency test shape). 10 new tests
        (`lib/brainMigration.test.mjs`), full suite 2090/2090 green.
  - [x] Dry run against the real install, from this worktree — **and this is where a genuine
        operational finding surfaced, not just caution**: `MASTER_ROOT` is computed relative to
        `dashboard/server.mjs`'s OWN file location, which differs between this worktree
        (`.../worktrees/Claudstermind/exocortex/`) and the main checkout
        (`.../ClaudeWS/Claudstermind/`) — two physically different directories. Checked, not
        assumed: **the main checkout's `dashboard/server.mjs` and `sessiond` are actively running
        right now** (the live daily chat, PIDs confirmed via `ps aux`, started days ago, still
        up), and its `brain/` has BOTH commits this worktree's branch point predates AND
        currently-uncommitted live writes (`git status` showed 2 modified files at the moment of
        checking). Running the real migration from this worktree would (a) copy FROM this
        worktree's stale snapshot, missing the live system's newer/uncommitted content, and (b)
        write TO a location (`.../worktrees/Claudstermind/brain`) the merged, deployed code will
        never actually look at once `MASTER_ROOT` resolves relative to the real checkout.
  - **1.4b — run it for real: NOT done, and not from here.** The correct time/place is after this
        branch merges into `main` and the fix is what the live checkout is actually running,
        executed from that checkout, ideally with the live server quiesced rather than mid-write —
        not a "let me just try it" from a worktree the live system doesn't read from anyway. This
        is the same boundary the branch's own house rules already draw ("do not deploy from this
        branch — it is not what the daily chat is running"), just discovered by checking rather
        than assumed from the rule alone.

---

## Wave 2 — Ch.2: the brain

- [x] **2.0 — Conversation FTS slice.** *(this session — see below)*
  `lib/conversationArchive.mjs`'s `recallByQuery` replaced: SQLite FTS5 (`node:sqlite`) over the
  `_segments/*.jsonl` already on disk, replayed into a disposable, rebuildable index. Same
  function signature. Hermes's incremental-rebuild guard copied exactly (two `state_meta` keys,
  the `id <= P OR id > H` predicate on every sync trigger).
  - [x] Zero new dependencies; `node:sqlite` only.
  - [x] Old linear-scan behavior preserved as a fallback if the FTS5 capability probe fails.
  - [x] `node --test lib/conversationArchive.test.mjs` green, including the pre-existing recall
        tests (signature/shape unchanged) and new tests for the guard predicate itself (a
        partially-rebuilt index serves only already-covered rows; a new write during a pending
        rebuild is served immediately regardless).

- [x] **2.1 — Durable knowledge store, provenance on every entry.** *(this session)*
  Facts/conventions/decisions, each entry stamped with where it came from (which conversation,
  which turn, which tool run, **and when**). Reuses `lib/conversationFts.mjs` (built in 2.0) as
  the underlying engine (new `openDatabaseFile` export, FTS5-agnostic), not a second bespoke
  SQLite setup — new `lib/knowledgeStore.mjs`.
  - [x] Schema for `facts`/`decisions` at minimum, informed by ECC's
        `decisions(title, rationale, alternatives CHECK(json_valid), supersedes FK → decisions(id), status)`
        shape named in HANDOFF — conflict handling is a foreign key, not a runtime check. FK is
        REAL (`PRAGMA foreign_keys = ON` per connection): a bogus `supersedes` is rejected, not
        silently stored. Deliberately stops there — flipping the superseded row's own `status` is
        Ch.2.4's job, not this one's.
  - [x] Every write records provenance: `conversationId` + `turnKind` + `turnNumber` + `at` (epoch
        ms) — no entry can be created without `conversationId`/`turnKind`/`turnNumber` (validated
        in JS before touching SQL, NOT NULL in the schema too, defense in depth). `at` is sourced
        from the originating row's own timestamp (every transcript row has carried one since
        `c06dbad`, verified empirically against this real install: 13 archived segments + 25 live
        transcripts, zero rows missing `at`) — free to carry forward, not a new capture path.
        Column stays **nullable** anyway, matching this codebase's convention of never assuming a
        field is present (`archiveSegment`'s own `at` is optional for the same reason) —
        belt-and-suspenders, not a migration for a gap that doesn't exist.
  - [x] Provenance is queryable (`provenanceOf`): given a fact, recover the conversation/turn/`at`
        it came from and (if still resolvable) `resolveText()` → `recallByNumber` → the original
        text. Deliberately decoupled from workspace resolution — `resolveText` takes the archive
        `baseDir` as an explicit param rather than guessing where a conversationId's archive lives.
  - [x] `lib/conversationArchive.mjs`'s `recallByQuery` return shape gains `at` alongside the
        existing fields (it's already on every row; only `recallByNumber` currently exposed it,
        indirectly, via its raw `row` passthrough — now both expose it directly).
  - [x] `node --test` coverage for: insert with provenance, insert rejected without provenance
        (five distinct invalid shapes), insert with no `at` (nullable path) still succeeds,
        `at` round-trip through `recallByNumber`/`recallByQuery`, `resolveText` round-trip via a
        real `archiveSegment`, FK acceptance/rejection on `supersedes`. 13 new tests
        (`lib/knowledgeStore.test.mjs`) + 3 for the extracted `openDatabaseFile` engine + 2 for
        `at` in `conversationArchive.test.mjs`. Full suite 1974/1974 green.

- [x] **2.2a — Skill crystallisation STORAGE + a real `approve` verb.** *(this session — scoped
  down from the full 2.2, see 2.2b below)*
  Propose-only, per D6: nudge → background review subagent → skill create/patch, gated by human
  approval — the verb ECC never built. New `lib/skillStore.mjs`, reusing `openDatabaseFile` (2.0)
  and `lib/provenance.mjs` (extracted from 2.1's `knowledgeStore.mjs` — the same provenance
  contract now shared by both stores instead of duplicated).
  - [x] `skill_versions(skill_id, version, content_hash, amendment_reason, promoted_at, rolled_back_at)`
        audit ledger (ECC's shape, per HANDOFF) — every promotion and rollback is a row, not a
        mutation in place. `rollbackSkill` appends a new version copying the target's content
        rather than rewriting history.
  - [x] A real `approve`/`reject` verb with a state transition (`pending` → `approved` |
        `rejected`), distinct from ECC's one-valued `trust` enum that its own docs admit is never
        set. One-way FROM `pending` only — an already-decided skill cannot be silently re-decided.
  - [x] Nothing auto-adopts: `proposeSkill` only ever lands in `pending` — gated on the D6
        **skill**-candidate threshold (cluster ≥2 observations, exported as
        `SKILL_CLUSTER_THRESHOLD`, a tunable constant). `rejectSkill` REQUIRES a non-blank reason
        (feeds the audit ledger via `decisionReason`); `approveSkill`'s reason is optional.
  - [x] Test: a proposal below threshold is never created (14 tests total) — one at/above
        threshold lands in `pending`, not `approved`; `approve`/`reject` both write ledger rows
        (`decidedAt`, `decisionReason`, `promotedAt` on approve only); a rollback restores the
        previous `content_hash` while preserving every prior version in the ledger. Full suite
        1993/1993 green.
  - **Deliberately NOT built here, scope discipline over the plan's own "do not let it expand"
    warning:** the D6 **agent**-candidate threshold (≥3 instincts, ≥0.75 avg confidence) — that's
    a different candidate type than a skill, out of scope for a task literally named "skill
    crystallisation." Tracked as 2.2c below if/when it's needed.

- [x] **2.2b — The nudge/detector.** *(this session)*
  Built as a new layer, `lib/skillNudge.mjs`, sitting above `lib/skillStore.mjs` — same split as
  `lib/retrieval.mjs` above `lib/knowledgeStore.mjs`.
  - [x] "Observation" decided as its OWN table (`skill_observations` in `skillStore.mjs`, not
        `facts` + `kind:'observation'`): clustering needs a `clusterKey` column `facts` doesn't
        have, and overloading `text` with structured data would have broken `facts`' simple
        discriminated-by-`kind` shape. Documented in-code why.
  - [x] `nudgeSkill(db, opts, draft)`: records an observation every call (`recordObservation`),
        counts per `clusterKey` (`countObservations`), and once count `>= SKILL_CLUSTER_THRESHOLD`
        AND no skill exists yet for `skillId`, calls `proposeSkill`; every later nudge of the same
        cluster finds the skill already exists and calls `amendSkill` instead — structurally
        impossible to double-propose, since the branch is keyed off `getSkill` existing, not off a
        separate "already proposed" flag that could drift.
  - [x] Background-subagent hookup: an OPTIONAL injected async `draft(ctx)` callback, called ONLY
        when a propose/amend is actually about to happen (never on a below-threshold nudge) —
        same decoupling as `wrapHandoff.mjs`'s `generateHandoff(opts, generate)`. A rejecting or
        empty-returning draft degrades to `action: "no-content"`, never throws.
  - [x] Test: below-threshold → no proposal (`getSkill` still null); crossing → exactly one
        `"proposed"` even replayed across 5 nudges of the same cluster; a second observation of an
        already-proposed cluster → `"amended"`, one skills row with 2 versions, never a second
        row; draft called only on propose/amend, never below threshold; explicit `opts.content`
        bypasses `draft` entirely. 9 new tests (`lib/skillNudge.test.mjs`).

- [x] **2.2c — Agent-candidate crystallisation.** *(this session — built together with 2.2b in
  `lib/skillNudge.mjs`, since 2.2b's clustering shape turned out to generalize directly)*
  D6's other threshold: ≥3 instincts and ≥0.75 average confidence — a genuinely different gate
  (count AND average, not count alone), so `nudgeAgent` is a parallel, NOT unified, function
  rather than a forced generic abstraction over `nudgeSkill` (same judgment call as Ch.2.4's two
  distinct decay mechanisms for skills vs. facts).
  - [x] "Instinct" recorded in its own new table (`agent_instincts` in `skillStore.mjs`) — a
        `confidence REAL NOT NULL` column most `skill_observations` rows would leave null, so a
        second table over overloading the first.
  - [x] Agent candidates share the EXACT SAME `skills`/`skill_versions` state machine as skill
        candidates — new `skills.kind` column (`'skill'`|`'agent'`, default `'skill'`) distinguishes
        them, so approve/reject/version/decay are not duplicated for a "different candidate type."
  - [x] Test: below count → no proposal even at high confidence; at count but below average
        confidence → no proposal; crossing BOTH → exactly one `"proposed"`, `kind: "agent"`, next
        nudge of the same cluster `"amended"` not re-proposed; draft callback carries `count` +
        `avgConfidence` in its context. 5 new tests. Full suite (`lib/*.test.mjs relay/*.test.mjs`)
        2113/2113 green.

- [x] **2.3a — Retrieval into the agent's context: the ranking/budgeting module.** *(this session
  — 2.3b, wiring it to a live trigger, split off below, same pattern as 2.2a/2.2b)*
  Port (not translate 1:1 — "reimplement," per HANDOFF) ECC's `instinct-relevance.js` +
  SessionStart budgeting: confidence floor 0.7, cap 6 items, 8000-char budget, **+0.25**
  project-scope match, **+0.20** stack-match, degrade to confidence-only ranking when nothing
  matches. New `lib/retrieval.mjs`. Read ECC's actual source rather than working from the
  HANDOFF summary alone — worth doing, since it surfaced that "8000-char budget" is a single
  hard slice-truncation of the whole assembled block (`limitSessionStartContext`), not a
  per-item bin-packing algorithm; building the wrong one would have under-filled the budget on
  every call.
  - [x] `.mjs`, ESM (reimplemented from ECC's CommonJS, not translated 1:1 — `matchesStack`
        tokenizes `fact.text` directly since our facts are freeform, unlike ECC's structured
        `domain`/`trigger`/`stack` instinct frontmatter). Also reimplemented ECC's documented
        observation→confidence frequency table (`confidenceFromObservationCount`, from
        `observer.md`) as a standalone pure function, since something has to produce a
        `confidence` for 2.1's now-scoreable `facts` table to rank by.
  - [x] Budgeting is enforced as a hard cap (6 items AND 8000 chars, whichever binds first) —
        tested independently (`rankFacts` maxItems cap; `limitContextChars`/`retrieveForContext`
        char-budget truncation, including the exact-boundary non-truncation case).
  - [x] Degrade path tested explicitly, as a REAL code path via `retrieveForContext` over a real
        store, not a unit-level hypothetical: zero stack matches still returns a
        confidence(+project-boost)-ranked list, not an empty one, as long as something clears
        the 0.7 floor. A fact with NULL confidence (2.1's nullable column, nothing has scored it
        yet) never clears the floor — tested as its own case, distinct from "confidence too low."
  - **Folded in per this session's discussion:** `lib/knowledgeStore.mjs`'s `facts` table gained
        `confidence` (nullable REAL, out-of-range values degrade to null rather than being
        clamped) and `scope` (`project`|`global`, default `project` — ECC's own "safer to be
        project-specific and promote later" guidance) columns, so there is something for 2.3 to
        rank. `addFact` does NOT auto-compute confidence from an observation count itself (that
        stays in `lib/retrieval.mjs` as `confidenceFromObservationCount`, called BEFORE
        `addFact` by whoever has the count) — keeps storage and scoring layered without a
        knowledgeStore↔retrieval import cycle.
  - [x] 19 new tests (`lib/retrieval.test.mjs`) + 1 more in `lib/knowledgeStore.test.mjs` for the
        new columns. Full suite 2013/2013 green.

- [ ] **2.3b — Wire retrieval into a real trigger.** *(deferred follow-up, not forgotten — same
  split as 2.2a/2.2b)*
  `retrieveForContext` exists and is tested end-to-end against a real store, but nothing calls it
  yet from a live session. Wiring it means deciding things this slice deliberately didn't:
  - [ ] Fire automatically at task start (the "you already solved this" prior-art check named in
        EXOCORTEX-LEARNINGS.md), reusing 2.0's `recall(query)` for the conversational half and
        `retrieveForContext` for the durable-knowledge half.
  - [ ] Where does `stackKeywords` actually come from live — a real project-stack detector
        (ECC's `detectStackKeywords`/`project-detect` has no equivalent here yet; 2.3a takes it
        as a caller-supplied `Set`, deliberately not building a detector as part of ranking).
  - [ ] Where does the knowledge store's `baseDir` live for a real install — likely blocked on
        Wave 1's storage abstraction (1.1) settling this, rather than guessed at here.

- [x] **2.4 — Decay + conflict handling.** *(this session)*
  `skill_runs(..., outcome, failure_reason, tokens_used, duration_ms, user_feedback)` as the
  *measured* decay signal (ECC shape, per HANDOFF) and `decisions.supersedes` as the conflict
  mechanism — a new decision that contradicts an old one supersedes it via the FK, it doesn't
  silently coexist.
  - [x] A skill/fact with a run of outcomes trending negative is demotable — flagged stale, not
        silently kept authoritative. Two DISTINCT mechanisms, matched to what each thing is:
        - **Skills** get the measured signal named above: new `skill_runs` table +
          `recordSkillRun`, and a NEW `decayStatus` column on `skills` (`fresh`|`stale`) kept
          deliberately SEPARATE from the editorial `status` (pending/approved/rejected) — an
          approved skill can independently go stale from bad performance without touching its
          approval history. Constants (all tunable, "start simple" per the plan):
          `SKILL_DECAY_WINDOW=5` (most recent runs considered), `SKILL_DECAY_MIN_RUNS=3` (never
          judge off fewer — one bad run in a window of one would flag every skill stale on its
          first use), `SKILL_DECAY_SUCCESS_THRESHOLD=0.5`. `recordSkillRun` RECOMPUTES
          `decayStatus` after every run — not a one-way ratchet, a skill that recovers comes back
          to `fresh` on its own (tested explicitly).
        - **Facts** have no "run" concept (they're consulted, not executed), so they get an
          explicit, reversible verb pair instead of a measured signal: `demoteFact`/`refreshFact`
          (status `active`↔`stale`), mirroring `skills`' own approve/reject shape.
        - Both `listFacts` and `listSkills` exclude their respective stale state by default
          (`includeStale` opts in) — this is also what keeps a stale fact out of
          `lib/retrieval.mjs`'s `retrieveForContext` for free, since it lists through the same
          `listFacts`.
  - [x] Writing a decision that supersedes an existing one sets the old row's status
        (`'superseded'`, `supersededAt` stamped) and the new row's `supersedes` FK in the SAME
        transaction (`BEGIN`/`COMMIT`/`ROLLBACK` around both statements) — no window where both
        read as active. This is the exact spot 2.1 deliberately left stubbed.
  - [x] Test: a superseded decision is excluded from `listDecisions` by default but still
        reachable via `includeSuperseded: true` or plain `getDecision` (nothing is deleted) — 13
        new tests across `lib/knowledgeStore.test.mjs` (3) and `lib/skillStore.test.mjs` (10).
        Full suite 2026/2026 green.

- [x] **2.5a — Wrap handoff quality: generation/caching/freshness logic.** *(this session — 2.5b,
  live wiring + the show-and-edit UI, split off below, same pattern as 2.2/2.3)*
  Today `buildSeedText` is a mechanical summary (first line of each prompt, ≤80/140 chars, plus
  the verbatim tail) — deliberately no extra model turn, so a roll can't stall on summary
  quality. That tolerance broke when auto-continue started running unattended: a wrap mid-sweep
  now hands a fresh window a list of prompt *titles*, with nobody there to notice it's thin. New
  `lib/wrapHandoff.mjs`. Along the way, extracted `conversationRoll.mjs`'s row-rendering into an
  exported `renderRows()` so `buildSeedText` and the new `buildHandoffPrompt` share it instead of
  two copies drifting apart — the same DRY move as `provenance.mjs` in 2.1/2.2a.
  - [x] Generate the *real* handoff (decisions, current state, open threads, where to recall
        from — not a retelling) — `buildHandoffPrompt` feeds a model the actual transcript
        excerpt plus already-recorded `knowledgeStore` decisions/facts as structured context (so
        it doesn't have to re-derive them from prose), and asks for exactly those four sections.
        `generateHandoff` takes an INJECTED async `generate(prompt)` callback rather than calling
        any specific model — keeps this module testable with a fake generator and leaves "which
        model, which session" to 2.5b.
  - [x] At actual wrap time: `resolveHandoff` picks the cached handoff if `isHandoffFresh` (the
        conversation hasn't advanced more than `HANDOFF_STALE_AFTER_TURNS` — 50, tunable — turns
        past where it was generated), otherwise the mechanical summary — the no-stall property is
        structural here: the roll path never calls `generate` itself, only `resolveHandoff` over
        whatever was already cached (or wasn't).
  - [x] Test: fresh-cache path used verbatim; stale-cache path falls back to mechanical; a wrap
        that fires before 60% (`cached: null`, generation never ran) also falls back — three
        explicit tests, not one "and everything else" case. Plus: `generateHandoff` never throws
        on a rejecting/empty-returning generator (never caches garbage), and a real
        null-vs-undefined destructuring bug this pass introduced and then caught via
        `node --check`/tests (`buildHandoffPrompt(null)` threw before the guard was widened to
        match this codebase's `opts && typeof opts === "object" ? opts : {}` convention
        everywhere else). 19 new tests (18 `lib/wrapHandoff.test.mjs` + 1 `renderRows` in
        `lib/conversationRoll.test.mjs`). Full suite 2045/2045 green.
  - **Deliberately NOT built here:** the "shown to the user and editable" UI, and the actual
    live trigger (the client-side 60%-of-context `ChatShell.wrapReadiness` mark calling into a
    real model session, and `lib/workspace.mjs`'s `_performRoll` consulting the cache) — tracked
    as 2.5b.

- [ ] **2.5b — Wire the real handoff into a live roll.** *(deferred follow-up, not forgotten —
  same split as 2.2a/2.2b, 2.3a/2.3b)*
  - [ ] A cache slot on the session (or wherever `_archivedPrompts`/`_segmentCount` already live
        in `lib/workspace.mjs`) holding the last `generateHandoff` result.
  - [ ] The actual trigger at the 60%-of-context manual-wrap mark (today entirely client-side,
        `ChatShell.wrapReadiness`'s `manualAt`) calling `generateHandoff` with a real `generate`
        pointed at a cheap model/session — off the roll's critical path, per 2.5a's design.
  - [ ] `_performRoll` calls `resolveHandoff` instead of building the mechanical summary inline,
        feeding its `text` into `buildSeedText`'s `summary` field (or replacing that call
        entirely, TBD once this is actually wired).
  - [ ] The generated handoff shown to the user and editable before use (matches the "no
        auto-adoption" spirit running through D6/2.2 — a human can see and correct it) — a
        `dashboard/public/app.js` UI concern, contended file, own pass.

---

## Wave 3 — Ch.3: the code graph (JS/TS only)

Ground-up Node extractor borrowing Graphify's *shape* (Hermes has no graph — Ch.3.1's old name
was wrong, per HANDOFF). tree-sitter ships prebuilt WASM (D7): `web-tree-sitter` +
`tree-sitter-javascript.wasm` / `tree-sitter-typescript.wasm`, zero compiler, zero node-gyp.

- [ ] **3.1 — Pipeline + schema + confidence tags (design, free).**
  `detect → extract → build → cluster → analyze → report → export`, the `{nodes, edges}` schema,
  `EXTRACTED`/`INFERRED`/`AMBIGUOUS` confidence tags, validate-before-build. Borrow
  understand-anything's edge taxonomy (structural/behavioral/data-flow/dependency/semantic) and
  node types (`file | function | class | module | concept`) as the vocabulary — the `concept`
  type is what lets Ch.2's knowledge entries join the same graph as code, later.
  - [ ] Written schema doc (JSON Schema or equivalent) for a node and an edge, with the
        confidence tag as a required field on every edge, not optional.
  - [ ] "Validate before build" is a real function: a batch of extracted nodes/edges that fails
        validation never reaches the graph-build stage, with a test proving a malformed batch is
        rejected before any graph mutation.

- [ ] **3.2 — Extractor.**
  JS/TS only, first pass. tree-sitter WASM parse → the node/edge schema from 3.1. Accept upfront
  (per HANDOFF's Graphify verdict) that this starts narrower and rougher than Graphify's own
  32-language extractor — do not chase parity.
  - [ ] Parses a real multi-file JS/TS sample (this repo's own `lib/` is the obvious corpus) and
        emits nodes for file/function/class at minimum.
  - [ ] At least the `calls`, `imports`, `contains` edge kinds populated with correct
        confidence tags (`EXTRACTED` for a direct AST match, not guessed).
  - [ ] A known-tricky case is tested explicitly and passes: a re-exported name, a dynamic
        `import()`, a method name that collides with a global/builtin (the exact class of bug
        Graphify's `_GO_PREDECLARED_FUNCS` blocklist scar names, translated to the JS/TS
        equivalent risk — e.g. a method literally named `then` or `constructor`).
  - [ ] `node --test` on the extractor module, corpus-driven (fixture files in the test, not a
        dependency on this repo's live state so the test doesn't rot as `lib/` changes).

- [ ] **3.3 — Graph.**
  `graphology` + `graphology-communities-louvain` + `graphology-metrics` cover the ~14-call
  NetworkX surface Graphify actually uses (per HANDOFF's research). No custom graph engine.
  - [ ] Nodes/edges from 3.2 load into a `graphology` `Graph` instance without loss (round-trip
        test: build → serialize → reload → same node/edge count).
  - [ ] At least one algorithm wired end-to-end (Louvain community detection or a centrality
        metric) and produces a sane result on the 3.2 test corpus (not just "doesn't throw").
  - [ ] Emits `{nodes, edges}` in NetworkX **node-link** shape deliberately (per HANDOFF, this is
        what makes 3.4's viz free) — a snapshot test pins the exact shape.

- [ ] **3.4 — Viz.**
  `graph.html` loading `vis-network@9.1.6` from a CDN, reading the node-link JSON from 3.3 — the
  free part, per HANDOFF (graphify's own `graph.html` does exactly this and doesn't care what
  wrote the file).
  - [ ] A static HTML file that, given a 3.3-shaped `graph.json` file, renders nodes/edges in a
        browser (verified with a real run — `run` skill / headless load — not just "the file
        exists").
  - [ ] Confidence tag drives a visible style distinction (e.g. edge color/dash) so `EXTRACTED`
        vs `INFERRED` vs `AMBIGUOUS` is legible, not just present in the data.

- [ ] **3.5 — Incremental re-index.**
  git-diff + content hash (crg's pattern, per HANDOFF) — a full re-index per edit does not
  scale.
  - [ ] Given a git diff between two commits, only the changed files (+ files that import/are
        imported by a changed file, i.e. the impacted set) are re-extracted.
  - [ ] A content-hash check skips re-extraction entirely when a "changed" file's hash matches
        what's already indexed (e.g. a touch with no real diff, or two branches converging on
        identical content).
  - [ ] Test: a single-file edit in a fixture corpus triggers re-extraction of that file and its
        direct importers only — every other node/edge in the graph is untouched (identity-equal
        or explicitly asserted unchanged), proving the "impact radius" is bounded, not a full
        rebuild in disguise.

---

## What this plan deliberately leaves out

- Ch.4 (publish), Ch.5 (multi-user), Ch.6 (commons), Ch.7 (local models), Ch.8 (distillation) —
  all vision-level or explicitly deferred (D4/D5) in the roadmap; forcing them into tasks here
  would fabricate decisiveness the roadmap itself disclaims.
- Any embedding/vector-retrieval lane — FTS5 + graph is the committed plan; RRF fusion with
  embeddings is an explicit "only if keyword recall proves insufficient" per
  `EXOCORTEX-LEARNINGS.md`, not a task to schedule preemptively.
