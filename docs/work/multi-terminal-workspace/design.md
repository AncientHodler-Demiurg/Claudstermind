# Multi-terminal workspace

Move seamlessly between terminals — laptop, phone, local dashboard, live site. One server on
the work machine owns every session; terminals are views onto it.

## Acceptance criteria (the confirmed outcome)

After this you'll have:

1. Opening a repository that already has live work asks **"N workspaces live on `<repo>` — join
   one, or start a new worktree?"** instead of silently starting a disconnected session.
2. Joining a workspace from a second terminal shows **the same conversation, live** — a prompt
   typed on the laptop appears in the phone's pane, and vice versa.
3. The dashboard shows **which terminals are connected** and what each is looking at, whether
   they came in through `localhost:3001` or through the live site.
4. While a turn is running, other terminals see **"busy"** rather than interleaving a second
   prompt into the same agent.
5. Raw conversation history is stored **per repository per worktree**, appended turn by turn,
   and a retired workspace keeps its history with a `retired` record at the end.
6. A second workspace on the same repo is a **separate git worktree** under `.worktrees/`,
   which never appears as a new repository anywhere in the dashboard.

**Decided for you**
- A new worktree does **not** auto-install `node_modules` — it surfaces a "needs install" state.
- Presence authority lives on the **work machine**; the relay is a sensor that reports its own
  browsers up the tunnel. Reason: the relay cannot see `localhost` terminals, and blue-green
  deploys reset it.
- Legacy flat transcripts stay readable — history is never orphaned by the layout change.

**Not included**
- Auto-installing worktree dependencies; HMR through the mirror; deploying to the live relay.

## Decisions

Autonomous run confirmed 2026-07-22.

- **Workspace identity is `<repoPath>@<worktree>`** (e.g. `AncientPantheon/automatons/Mnemosyne@main`).
  Server-minted, never browser-minted. This is the keystone: session identity currently comes from
  `crypto.randomUUID()` in the browser's `localStorage`, which is precisely why a second terminal
  is blind to the first.
- **Storage is one directory per workspace**, slug `<repoPath with / → __>@<worktree>`, holding
  `<sessionId>.jsonl` + `_meta.json`. One level deep, so listing stays a single `readdir` — no
  recursive walk in six call sites.
- **JSONL append-only**, one record per turn. Replaces rewriting the entire transcript on every
  result, which grows with conversation length and can corrupt the whole history on a crash mid-write.
- **A store module owns all transcript I/O.** Scope correction found during grounding: there are
  **six** call sites in `lib/workspace.mjs` touching the flat layout (`readDataSizes`,
  `_sendSearch`, `_readSavedTranscript`, `_sendHistory`, `_openTranscript`, `_persist`) plus
  `readBrain` in `lib/snapshot.mjs` and the distill loop — not the two I first estimated. Routing
  them through one module is what makes the layout change tractable.
- **Both layouts are read.** The store reads legacy `<key>.json` at the root *and* the new
  per-workspace dirs, so existing history keeps working with no migration step required.
- **Worktrees live at `$ROOT/.worktrees/`** — root level, never inside an ecosystem folder.
  Verified empirically with a real git worktree: `walkTree` skips dot-directories, and
  `scanPackages` only walks six *named* ecosystem folders (it does **not** skip dot-dirs, so a
  worktree nested under one *would* be picked up and duplicate every package).
- **Turn lock is per session, advisory, server-held.** Claude sessions are already turn-based;
  this only makes the existing constraint visible instead of letting two prompts interleave.
- **Review (2026-07-23):** one HIGH + two LOW found and fixed.
  - HIGH — the transcript-store slug used `-<hex>-` escapes, but `-` is a kept character, so
    `idFromSlug` mis-decoded any key with a hex-flanked segment (e.g. a worktree named `rc-1-2`):
    its saved conversation could not be reopened or reseeded. Fixed by moving the escape delimiter
    to `~` (outside the kept set), making the encode/decode a true inverse. Regression-tested.
  - LOW — a first-turn server error (bad path / missing token) discarded the typed prompt; now
    restored to the box like the busy path.
  - LOW — remote (relay-reported) presence entries could linger as ghosts if the tunnel dropped
    silently; `prune` now ages them out too.

## Constraints

- `node --test` from the repo root — 237 passing, 0 failing, must stay green.
- `lib/version.test.mjs` gates `package.json` version against the newest `CHANGELOG.md` entry.
- Node builtins only; no new dependencies.
- Cross-platform: Windows dev, Linux (systemd) production. No drive letters, no `shell: true`,
  `process.execPath` for spawns, case-sensitive-filesystem tolerant.
- Any new `lib/` module imported by `relay/server.mjs` needs a `COPY` line in `relay/Dockerfile`,
  or the live site breaks on the next deploy.
- New control actions must be added to `WS_CONTROL_ACTIONS` in `lib/protocol.mjs` or they cannot
  cross the tunnel.
