# Claudstermind

> A cluster of Claude knowledge bases across related projects, so one Claude session can reason across the whole product suite instead of one repo at a time.

## What this repo is

Each project on the owner's dev box (AncientHoldings hub, StoaChain node, OuronetCore Pact module, OuronetUI, etc.) is its own git repository with its own lifecycle. Every project also has a **knowledge base** — the non-obvious facts, conventions, current state, and architectural context that a fresh Claude session needs in order to be immediately useful.

Instead of duplicating that knowledge base inside every project's repo, Claudstermind holds all of them in one place:

- **`projects/<name>/`** — one folder per linked project, containing that project's onboarding + state + architecture + conventions
- **`meta/`** — facts and conventions that are *cluster-wide* (true across multiple projects), so they live once, not N times
- **`skills/`** — step-by-step recipes a Claude agent follows for cluster operations (load the cluster, add a project, close a session)
- **`MANIFEST.md`** — the registry that tells any agent which projects are in the cluster, where they live on disk, and how they relate

## Who this is for

- **The owner (Mihai)** — maintains the cluster, opens Claude sessions in whichever project he's working on
- **Claude (claude.ai/code, CLI, or agent SDK)** — reads the relevant files at the start of each session to come up to speed; writes updates back continuously, in-turn, without being asked

## Operating mode — continuous write-back (mandatory)

**This is the most important rule in Claudstermind and supersedes any "I'll batch this at session end" instinct.**

A Claude agent working in a linked project **must** update Claudstermind continuously, as part of the same response where the triggering event happens. Not at session close. Not when the owner asks. Automatically.

**Triggers that require an immediate write:**

| Trigger in the conversation | What Claude writes, same turn |
| --------------------------- | ----------------------------- |
| Owner shares a non-obvious fact, preference, constraint, or correction | Append a new entry to `projects/<ThisProject>/LEARNINGS.md` |
| A piece of work lands (feature, fix, refactor, successful typecheck + commit) | Refresh `projects/<ThisProject>/STATE.md` (overwrite the relevant sections, not append) |
| Owner corrects Claude's approach ("no, don't do X", "always do Y") | Append to LEARNINGS **and** — if the correction applies beyond this project — promote to `meta/shared-conventions.md` or `meta/shared-facts.md` |
| A cross-project fact surfaces (affects ≥2 linked projects) | Add to `meta/shared-facts.md` immediately; link from the project's LEARNINGS |
| Owner says "stop / done / pick this up later" or the conversation is clearly ending | Append a LOG.md entry summarising the session; re-verify STATE.md reflects reality |
| A project's status changes (active → paused, path moves, etc.) | Edit `MANIFEST.md` in the same turn and bump `Last updated:` |

**Claude does not ask permission to update Claudstermind.** Updates are part of normal work, not a separate review step. The only thing Claude does **not** do automatically is `git commit` / `git push` — that stays owner-driven, triggered explicitly via `::cmpush` (see [`skills/push.md`](skills/push.md)).

**Claude does not announce every Claudstermind write.** One short line at the end of the relevant response is enough: *"LEARNING captured: <one-line>"* or *"STATE refreshed: version 0.7.6p-dev, 3 outstanding items."* The owner doesn't need a narration.

**If the owner has to say *"update Claudstermind"* or *"write that down"*, the agent violated this rule.** Correct immediately by doing the write, then continue.

## How to use it — three canonical flows

### Flow 1 — Fresh Claude session in a linked project (most common)

You open a new conversation inside any linked project (e.g. AncientHoldings). You tell Claude:

> Read `../Claudstermind/README.md` and the onboarding for this project.

Claude then follows [`skills/load-cluster.md`](skills/load-cluster.md): reads the MANIFEST, identifies which project it's in, reads that project's `ONBOARDING.md` + `STATE.md`, pulls in `meta/shared-facts.md` and `meta/glossary.md`, then reports *"I've loaded context for <project>. Current version X, open plan Y, last session status Z. What are we doing?"*

Takes ~30 seconds. No re-briefing needed.

### Flow 2 — Adding a new project to the cluster

You're working in a project that isn't in Claudstermind yet. You tell Claude:

> Read `../Claudstermind/README.md` and add this project to Claudstermind.

Claude follows [`skills/add-project.md`](skills/add-project.md): inspects the project (reads its CLAUDE.md, git log, package.json, key source files), copies `projects/_TEMPLATE/` into `projects/<name>/`, fills in the facts it gathered, asks clarifying questions only where it can't infer, updates MANIFEST.md, and adds a one-line pointer to the project's CLAUDE.md so future sessions know the cluster exists.

### Flow 3 — Cross-cluster reasoning

You want to work on something that spans projects (e.g. "the AncientHoldings hub needs to emit StoaChain transactions — what's in OuronetCore that affects the signing flow?"). Open a session anywhere and tell Claude:

> Read `Claudstermind/README.md` and load the full cluster.

Claude reads every linked project's ONBOARDING + STATE + ARCHITECTURE, plus `meta/cluster-map.md`, and can now reason about all of them together. Much bigger context load, but exactly what you need for cross-project design.

## Commands reference

Two kinds of triggers exist — **bootstrap phrases** (plain English, used once per session before Claudstermind is loaded) and **`::cm…` commands** (short prefixed commands, usable anytime after the agent has loaded the cluster).

### Bootstrap phrases

Used when Claudstermind hasn't been loaded yet — a fresh Claude session at conversation start, or the very first time a project is linked. These **are the entrypoints**; they work without any prior cluster context.

| Situation | Phrase |
| --------- | ------ |
| **Load cluster + this project's context** (most common — fresh session in a linked project) | *"Read `../Claudstermind/README.md` and the onboarding for this project."* |
| **Register a new project** (currently working in an unlinked project you want to add) | *"Read `../Claudstermind/README.md` and add this project to Claudstermind."* |
| **Load the full cluster** (cross-project reasoning across every linked project) | *"Read `Claudstermind/README.md` and load the full cluster."* |

If Claudstermind doesn't live at `../Claudstermind` relative to the project, substitute the absolute path (e.g. `D:/_Claude/Claudstermind/README.md`).

### `::cm…` commands

Usable from the moment the agent has loaded the cluster. Short, unambiguous (the `::` prefix doesn't collide with Claude Code's `/` slash-commands or `!` bash-mode), consistent namespace.

| Command | Keystrokes | Action | Skill | Accepted variants |
| ------- | ---------: | ------ | ----- | ----------------- |
| `::cmsync` | 8 | Re-read Claudstermind; report what changed since last sync. Two-phase: mtime scan first (~100 tokens if nothing new), then Read only the files that changed. | [`skills/sync.md`](skills/sync.md) | `::cmresync`, `::cmrefresh` |
| `::cmpush` | 8 | Commit + push Claudstermind to `github.com/StoaChain/Claudstermind`. Uses the token in `.secret/github-token.txt` inline (never persisted). Includes a safety scan that aborts if anything secret-shaped is staged. | [`skills/push.md`](skills/push.md) | — |
| `::cmcommit` | 10 | Same as `::cmpush` but **commits only, skips the push.** Useful for offline snapshots or when you want to review before pushing. | [`skills/push.md`](skills/push.md) §variants | — |

Also accepted (less preferred, slower to type): the prose forms *"sync Claudstermind"*, *"push Claudstermind"*, *"what's new in the cluster?"*, etc. The `::cm…` keywords are the canonical fast-path.

### What does NOT need a command

These happen automatically via [§Operating mode](#operating-mode--continuous-write-back-mandatory) — **no explicit trigger needed, ever**:

- Appending to `projects/<ThisProject>/LEARNINGS.md` when you share a non-obvious fact or correction
- Refreshing `projects/<ThisProject>/STATE.md` when work lands
- Appending to `LOG.md` when a session wraps
- Promoting cluster-relevant facts to `meta/shared-facts.md`
- Updating `MANIFEST.md` when a project's status changes

**If you ever have to type *"update Claudstermind"*, the agent violated [Rule zero](meta/shared-conventions.md). Correct it in the next response.**

## Where things live on disk

Expected convention: Claudstermind sits as a **sibling folder** to each linked project.

```
D:/_Claude/
├── AncientHoldings/           ← a linked project
├── StoaChain/                 ← a linked project
├── OuronetCore/               ← a linked project
├── OuronetUI/                 ← a linked project
├── Claudstermind/             ← this repo
│   ├── README.md              ← you are here
│   ├── MANIFEST.md
│   ├── meta/
│   ├── projects/
│   └── skills/
└── …
```

If Claudstermind lives somewhere else on your machine, update [`MANIFEST.md`](MANIFEST.md) with absolute paths — the skills handle both cases.

## What this is **not**

- **Not a build system.** No code runs here. It's text files describing other projects.
- **Not a git replacement.** Each project still owns its own git history. Claudstermind holds only the context a Claude session needs to be productive.
- **Not a secrets store.** SSH keys, API tokens, env vars stay in each project's local `.env` files. Claudstermind holds conventions, not credentials.
- **Not auto-synced.** If you rename a project or move it on disk, update MANIFEST.md yourself (or have Claude do it via the `add-project` skill re-run).

## Sync model — on-demand, not real-time

Each Claude session loads Claudstermind from disk at start ([`skills/load-cluster.md`](skills/load-cluster.md)), works against that view, and writes back via the continuous-write-back protocol above. Subsequent sessions load the accumulated state of every prior session. This is the mechanism that makes the cluster "aware of everything learned so far."

**What it does guarantee:** every session starts with the full state of every prior session. No re-briefing.

**What it doesn't guarantee:** within a **single long-running session**, the agent's view of Claudstermind is frozen from session start unless explicitly refreshed. If the owner spent the last day working in a parallel or intervening session on a sibling project, this session won't have seen those writes until it re-reads from disk.

**The solution — `::cmsync`, operator-triggered, cheap by default.** When the owner types **`::cmsync`** (or variants: `::cmresync`, `::cmrefresh`), the agent follows [`skills/sync.md`](skills/sync.md). The `::` prefix is unambiguous — it never appears in natural prose and does not collide with Claude Code's `/` slash-commands or `!` bash-mode prefix. Two phases:

1. **Cheap mtime scan (~100 tokens always).** Single bash command lists modification times of every Claudstermind `.md` file. Compare against the baseline from last sync.
2. **Read only what changed.** If nothing's newer than the baseline, emit `::cmsync → nothing new since last sync` and stop. If files changed, Read just those and emit a compact diff.

**No auto-sync.** The owner controls when syncs happen. Heuristic auto-triggers were considered and rejected — they either waste tokens on unnecessary refreshes or miss cases anyway. The cost of a missed sync is trivial (owner types `::cmsync` next turn); the cost of a spurious auto-sync compounds over a long conversation.

**The owner's workflow reality:** the same Claude conversation can span days or weeks (Claude's context window stretches that long). Across those days the owner may have touched other projects in separate sessions. **This is why sync matters:** a long-running conversation needs periodic re-grounding, and the owner controls when that happens.

For the narrower case where a session needs fresh data from one specific sibling project mid-flight, see [`skills/cross-project-refresh.md`](skills/cross-project-refresh.md).

## Starting points for a Claude agent reading this for the first time

1. [`MANIFEST.md`](MANIFEST.md) — the registry. What projects are in the cluster.
2. [`meta/shared-facts.md`](meta/shared-facts.md) — non-obvious facts that apply across projects (e.g. StoaChain ≠ Kadena).
3. [`meta/shared-conventions.md`](meta/shared-conventions.md) — cluster-wide norms; Rule zero is continuous write-back.
4. [`meta/glossary.md`](meta/glossary.md) — terms used across projects (Ouronet account, OAS, AQP, hub, etc.).
5. [`meta/cluster-map.md`](meta/cluster-map.md) — how the projects depend on and feed each other.
6. [`skills/load-cluster.md`](skills/load-cluster.md) — the step-by-step you follow when a user invokes you in a linked project.
7. [`skills/add-project.md`](skills/add-project.md) — the step-by-step for registering a new project.
8. [`skills/session-close.md`](skills/session-close.md) — continuous write-back (mid-session) + session-close sync protocol.
9. [`skills/cross-project-refresh.md`](skills/cross-project-refresh.md) — when one session's work touches a sibling project, read fresh from disk.
10. [`skills/sync.md`](skills/sync.md) — on-demand re-read of the whole cluster for long-running conversations (`::cmsync`).
11. [`skills/push.md`](skills/push.md) — operator-triggered commit + push of Claudstermind to its GitHub repo (`::cmpush`).

## Owner's note

The whole point of this is: **I should never have to re-brief Claude about my own infrastructure.** If I've told Claude something important once, it lives in Claudstermind and every future Claude session knows it automatically. That's the contract.
