# Skill — `::cmsync` (operator-triggered cluster refresh)

> **When:** the owner types `::cmsync` (or an equivalent phrase — see triggers below). **Never** auto-fired.
>
> **Goal:** re-read Claudstermind from disk cheaply, surface anything that changed since this session first loaded the cluster.

## Why this skill exists

Each Claude session reads Claudstermind at start ([`load-cluster.md`](load-cluster.md)). The owner typically stays in one long-running conversation for days or weeks. During that span, parallel sessions in other linked projects may have accumulated writes into Claudstermind that this session never saw.

The agent does not automatically re-scan — it has no file-watcher, no heartbeat, and auto-triggers would either waste tokens on unnecessary syncs or miss cases entirely. The owner knows when they've been in another project; they trigger when they want fresh data.

## Trigger keyword (canonical)

**`::cmsync`** — the canonical command. Eight keystrokes. The `::` prefix is unambiguous (never appears in natural prose; does not collide with Claude Code's `/` slash-commands or `!` bash-mode prefix). `cmsync` = Claudstermind-sync.

### Accepted variants

All of these fire this skill:

- `::cmsync`
- `::cmresync`
- `::cmrefresh`
- *"sync Claudstermind"* / *"resync the cluster"* / *"what's new in the cluster?"* (prose forms — less preferred but valid)

### What does NOT trigger this skill

- The word *"sync"* appearing in normal conversation (*"is the DB in sync?"*, *"let's sync up on this"*) — requires the `::cm…` prefix or an explicit cluster-referring phrase
- Topic shifts, cross-project mentions, extended breaks — **no auto-trigger**. The operator decides.
- Prompts that only touch the current project — pointless to sync, just work

## The two-phase protocol (cheap by default)

### Phase 1 — mtime scan (cheap, always runs)

Run one bash command to get modification times of every Claudstermind `.md` file:

```bash
find D:/_Claude/Claudstermind -type f -name '*.md' -printf '%T@ %p\n' | sort -n
```

(Or platform-equivalent on non-Windows. `stat -c '%Y %n'` works on Linux.)

Compare against the **baseline mtimes** held from the previous sync (or from session start if this is the first sync). The baseline lives in the agent's working context — no file on disk stores it, because within a single session the agent remembers the last-sync snapshot.

**Cost:** ~100 tokens for the command output.

### Phase 2 — read only what changed

Only `Read` files whose mtime is newer than the baseline. Skip everything else.

**If nothing changed:** skip Phase 2 entirely. Emit:

```
::cmsync → nothing new since last sync.
```

**If something changed:** Read each changed file, then emit a compact diff-style report:

```
::cmsync →
- projects/StoaChain/STATE.md  updated (v0.3.2; 1 new outstanding item)
- projects/StoaChain/LOG.md    +1 entry (chainweb fork upstream merge)
- meta/shared-facts.md         +1 section (gas schedule refinement for chain 0)

No changes: AncientHoldings, OuronetCore, OuronetUI, MANIFEST.md
```

Keep under ~10 lines. If the owner wants more, they ask.

### Update the baseline

After reporting, record the new mtime snapshot as the baseline for the next `::cmsync`. From the next `::cmsync` forward, "since last sync" means since this moment, not since session start.

## What to cover in the scan

All `.md` files under `D:/_Claude/Claudstermind/`:

- Top-level: `README.md`, `MANIFEST.md`
- `meta/*.md` — shared facts, conventions, glossary, cluster-map
- `projects/*/STATE.md`, `LEARNINGS.md`, `LOG.md` — the living files
- `projects/*/ONBOARDING.md`, `ARCHITECTURE.md`, `CONVENTIONS.md` — less frequent but scan anyway

Skip `projects/_TEMPLATE/*` — that's template content, doesn't change in normal operation.

## Edge cases

- **First `::cmsync` of the session.** No baseline yet — the baseline is "session start". Scan everything, report any changes since session start (which should usually be "nothing" unless another session wrote in the meantime).
- **Claudstermind folder moved / renamed.** Scan fails. Tell the owner: *"Claudstermind not found at expected path. Where is it?"*. Don't silently skip.
- **One or more files have mtimes older than the baseline.** Should be impossible under normal use (files don't travel back in time). Report as an anomaly — the folder might have been restored from a backup or synced from elsewhere.
- **Many files changed at once** (e.g. the owner pulled a big update from git). Report the count + the biggest diffs; don't spam every file. Example: *"::cmsync → 14 files updated across 3 projects. Largest deltas: …"*
- **Agent doesn't remember the baseline** (context compacted away). Fall back to "session start" as the baseline and re-scan everything. Cost: one full read of files that probably haven't changed. Acceptable as a recovery path; flag it: *"(baseline lost; treated as full re-read)"*.

## What NOT to do

- **Don't auto-fire.** The owner controls timing. Heuristic auto-triggers were considered and rejected — wasted tokens compound faster than they save re-briefing.
- **Don't Read files whose mtime is unchanged.** That defeats the whole efficiency of the two-phase protocol.
- **Don't re-run `load-cluster`.** That's the heavyweight start-of-session protocol with full status-line reporting. `::cmsync` is the light mid-session variant.
- **Don't silently drop stale assumptions.** If the agent was working against an out-of-date view of a sibling project, say so explicitly: *"I was reasoning against an older view of StoaChain; here's what's actually current."*
- **Don't commit Claudstermind changes.** `::cmsync` is read-only. Writes go through [`session-close.md`](session-close.md)'s continuous write-back protocol.
