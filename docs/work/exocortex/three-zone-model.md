# The three-zone model — Ch.1.3

Public shell (code) · private user data (never leaves the disk) · shared brain (this user's
knowledge, spanning their workspaces — still private by default; the opt-in commons of Ch.6 is
deferred per D5, so "shared" here means *shared across this one user's workspaces*, never
multi-user). Per D4, the storage boundary must not make a future tenant boundary impossible, but
multi-tenancy is not being built now.

This doc is the design note half of 1.3 (**1.3a**). The other half — the storage abstraction (1.1)
exposing zone as part of its interface, and a test that nothing in the shipped shell hard-codes a
zone-2/3 path — is **1.3b**, deferred until 1.1 exists to expose it against (same split this
branch has used throughout: 2.2a/2.2b, 2.3a/2.3b, 2.5a/2.5b).

---

## The three zones

| Zone | What | Who sees it | Leaves the disk? |
|---|---|---|---|
| **1 — Public shell** | The application itself: engine, UI, scripts, docs-about-the-tool | Anyone who clones the repo | Yes — this is what gets published |
| **2 — Private user data** | Raw conversation history, secrets/tokens, per-install runtime state | This install only | Never |
| **3 — Shared brain** | Distilled knowledge (facts, decisions, skills, conventions) — Ch.2's stores | This user, across all their workspaces | Never (today) — opt-in export is Ch.6, deferred |

Zone 2 vs Zone 3 is not "more private" vs "less private" — both are equally private today (D4).
The distinction is **shape and scope**: Zone 2 is raw, per-workspace, immutable history (a
transcript, a token file). Zone 3 is derived, cross-workspace, and mutable (a fact can be
demoted, a decision can be superseded) — it's what Ch.2 exists to build. Zone 3 is *sourced from*
Zone 2 (every fact/decision carries provenance back to a Zone-2 conversation turn — Ch.2.1) but
is stored and queried independently.

## Where every existing path actually lives, by zone

Verified against the 1.2a audit (`secrets-audit.md`), not re-derived from memory.

### Zone 1 — public shell (ships with the repo, verified clean)
`lib/`, `dashboard/` (code — see the one exception below), `scripts/`, `relay/`, `agent/`,
`control/`, `orchestrator/`, `ops/`, `packages/`, `plugins/`, `sessiond/`, `skills/`, `deploy/`,
`docs/` (engineering docs about Claudstermind itself — HANDOFF/roadmap/CONTRACT docs are
*about the tool*, not personal data, and are fine to ship).

### Zone 2 — private user data (verified correctly OUTSIDE the repo)
| What | Path | Set by |
|---|---|---|
| Conversations | `<parent-of-repo>/.claude/workspace/` | `transcriptDir`, `lib/workspace.mjs:190` |
| Secrets/tokens | `<parent-of-repo>/.secrets/` | `SECRETS_DIR`, `dashboard/server.mjs:70` |
| Claude CLI's own sessions | `$HOME/.claude/projects/` | `sdkProjectsDir`, `lib/workspace.mjs:195` |
| Per-install runtime prefs | `dashboard/data/{tokens,relay,routing}.json` | individually gitignored — path is *inside* the repo tree but the files are never tracked |

Everything here checked out correctly during the 1.2a audit: real conversations/secrets never
land in git. `dashboard/data/{tokens,relay,routing}.json` are the one Zone-2 case where the
*directory* is inside the repo — acceptable because each file is individually gitignored and the
directory itself carries no data (empty on a clean clone).

### Zone 3 — shared brain (Ch.2's stores — correctly scoped, per-workspace on disk)
| What | Path | Module |
|---|---|---|
| Conversation recall index | `<workspace>/_segments/_fts.sqlite3` | `lib/conversationFts.mjs` |
| Facts / decisions | `<workspace>/knowledge.sqlite3` | `lib/knowledgeStore.mjs` |
| Skills / skill runs | `<workspace>/skills.sqlite3` | `lib/skillStore.mjs` |

All three live *inside* a workspace's own directory under `transcriptDir` (Zone 2's root) — so
they inherit Zone 2's "never leaves the disk" property automatically, by construction, without
their own separate audit. This is deliberate: Ch.2's stores were built to reuse the SAME
outside-the-repo root conversations already use (`openDb(baseDir)` takes a caller-supplied
directory — nothing in `lib/knowledgeStore.mjs`/`lib/skillStore.mjs` hard-codes a path of its
own). **This is the pattern Zone 3 should always follow, and it's the pattern one existing
feature does NOT follow** — see below.

### Zone 3, MISPLACED — the 1.2a finding, reframed through this model
| What | Path | Should be |
|---|---|---|
| Distilled per-project knowledge (`runClaudeDistill`/`runHeuristicDistill`) | `<repo>/brain/` — **Zone 1's location** | Zone 3 — outside the repo, alongside `transcriptDir` |
| Org/infra map (`dashboard/data/map.json`, `meta/`, `MANIFEST.md`) | `<repo>/` — **Zone 1's location** | Zone 3 (or arguably Zone 2, if it's closer to raw notes than distilled knowledge) |

This is the same 99+10+1 files the audit found untracked-but-shouldn't-be-tracked — restated here
as a *structural* problem, not just a missing `.gitignore` line: `brainDir` (`dashboard/server.mjs:1016`,
`resolve(__dir, "..", "brain")`) was given a Zone-1 path from the start. It is the ONE place in
the whole runtime-path inventory that doesn't follow the `openDb(baseDir)`-style "caller supplies
an outside-the-repo root" pattern every Ch.2 store already uses correctly. **This is exactly what
1.4 (migration) needs to fix**, and it's why 1.2b's remediation tiers include more than a
`.gitignore` line — the right fix moves `brainDir` to live beside `transcriptDir`, not just hides
its current location from git.

## ECC's scope vocabulary, and where it lives *inside* Zone 3

HANDOFF names ECC's `scope ∈ {project, team, user}` as the vocabulary anchor for zone 2/3. To be
precise about what that anchors: `scope` is not a mapping *between* zones — everything it
describes already lives in Zone 3. It's an axis *within* Zone 3, describing how far a piece of
knowledge applies:

- **`project`** — scoped to one workspace/repo. `lib/knowledgeStore.mjs`'s `facts.scope` default.
- **`user`** (ECC's term) ≙ this schema's **`global`** — applies across every workspace this user
  has. The `+0.25` project-scope boost in `lib/retrieval.mjs` only fires for `project`, exactly
  because `global`/`user`-scoped knowledge doesn't need a "you're currently here" boost — it's
  already relevant everywhere.
- **`team`** — reserved, unimplemented. No code path produces or consumes it today. Kept as a name
  so a future multi-user boundary (D4: "possible later, don't build it now, don't make it
  impossible") has a slot to land in without a schema migration.

`facts.scope` currently only accepts `'project'|'global'` (`lib/knowledgeStore.mjs`'s `addFact`)
— `'team'` isn't wired to anything yet, deliberately, matching D4.

## What this doc does NOT do
It does not change any code. 1.3b (storage abstraction exposing zone; the "nothing hardcodes a
personal path" test) is real follow-on work, blocked on 1.1 existing. The `brain/`/`meta/`
relocation this doc's Zone-3-MISPLACED table calls for is 1.4's job, informed by 1.2b's decision
on how (or whether) to also address git history — not actioned here.
