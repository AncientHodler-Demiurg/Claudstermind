# Skill — load-cluster

> **When:** the owner opens a fresh Claude session in a linked project (or anywhere) and says something like *"Read Claudstermind/README.md"* or *"Load the cluster"* or *"Read the onboarding and let's continue."*
>
> **Goal:** come up to speed on the current project (and optionally the wider cluster) in ~30 seconds, then report status and wait.

## Step-by-step

### 1. Identify where you are

- Use the current working directory. If you're inside `…/AncientHoldings/…`, the current project is **AncientHoldings**.
- If the owner explicitly named a project, trust that.
- If you can't tell, list the linked projects from [`MANIFEST.md`](../MANIFEST.md) and ask.

### 2. Read the cluster meta

Read in this order:

1. [`../README.md`](../README.md) — one-pass for the big picture (skip if you just read it)
2. [`../MANIFEST.md`](../MANIFEST.md) — confirm this project is actually linked
3. [`../meta/shared-facts.md`](../meta/shared-facts.md) — non-obvious invariants
4. [`../meta/shared-conventions.md`](../meta/shared-conventions.md) — cluster-wide norms
5. [`../meta/glossary.md`](../meta/glossary.md) — terms (skim; use as reference)
6. [`../meta/cluster-map.md`](../meta/cluster-map.md) — only if the owner signalled cross-project work

### 3. Read this project's knowledge base

Under `../brain/<ThisProject>/`:

1. **`ONBOARDING.md`** — the durable orientation (who / what / critical context)
2. **`STATE.md`** — **most recent** session-close snapshot; authoritative for current version + in-flight work + open questions
3. **`ARCHITECTURE.md`** — reread as needed; don't memorize upfront
4. **`CONVENTIONS.md`** — project-specific overrides on top of cluster-wide conventions
5. **`LEARNINGS.md`** — accumulated non-obvious facts from past sessions
6. **`LOG.md`** — read the last 3–5 entries for immediate context. Don't read the whole log unless the owner asks.

### 4. Also pull from the project repo itself

Claudstermind describes *intent + state*, but the project repo is *truth*.

- **`CLAUDE.md`** + any root-level `AGENTS.md` in the project — auto-loaded anyway; re-read if truncated
- `lib/version.ts` or equivalent — confirm STATE.md's version claim matches
- `plans/` folder if referenced in STATE.md
- `git log -10 --oneline` — sanity-check STATE.md's "last session" claim against reality

If `STATE.md` says the version is X but `lib/version.ts` says Y, trust Y and note the drift when you report in.

### 5. Report in

Emit exactly this shape as your first user-facing message:

```
Loaded. <project> @ <version from lib/version.ts>.
Open plan: <plan file name or "none">.
Last session: <one sentence from the top of LOG.md>.
Outstanding: <brief bullets from STATE.md's "Known outstanding">.
Drift: <note anything inconsistent between STATE.md and the repo — or "none">.
Ready.
```

Then wait for the owner's instruction. Do **not** start working until told.

## Boundary conditions

- **Project not in MANIFEST.md.** Don't fabricate onboarding. Tell the owner: *"This project isn't linked to Claudstermind yet. Want me to run the add-project skill?"*
- **STATE.md is empty or placeholder.** Say so. Don't guess the state.
- **Drift between STATE.md and repo reality > 10 commits.** Flag it hard — the last session's close was probably incomplete. Offer to rebuild STATE from git log before starting work.
- **Multiple projects open / cross-project task.** Load each project's ONBOARDING + STATE but skip per-project ARCHITECTURE unless the task actually touches it.

## What NOT to do

- Don't dump the full contents of every file you read back to the owner. They wrote them. Load silently; report only the short status line.
- Don't treat STATE.md as a todo list to execute. It's context, not instructions.
- Don't "helpfully" update STATE.md at load time. Updates happen at session close only ([`session-close.md`](session-close.md)).
