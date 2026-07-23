# Workspace conversation UX — fold history, clean view, live status

Continuing a chat on a repo+worktree picks up its whole prior conversation instead of piling up
new history rows; the chat view shows Claude's answers instead of tool-call noise; a status icon
shows whether Claude is working or done; the "resume" control actually works.

## Acceptance criteria (the confirmed outcome)

After this you'll have:

1. The workspace history list shows **one row per repository+worktree**, not one row per past
   session id — starting a "new" chat on a worktree that already has history no longer creates a
   second, disconnected-looking entry.
2. Continuing a chat on that repo+worktree resumes with the **full prior conversation as real
   Claude context** (not just a transcript that looks continuous while the model actually starts
   fresh) — merged from every past session file for that workspace, on read, with nothing deleted
   or rewritten on disk.
3. The live chat view shows Claude's actual answers by default; tool_use/tool_result activity
   collapses into one compact, expandable summary per turn instead of a line per event.
4. A status icon on the pane spins while Claude is working a turn and stops (idle/done) the
   moment that turn concludes, success or error — reusing the existing turn-lock busy signal.
5. The "open/resume" control in history either succeeds or shows a clear, bounded-time error
   (e.g. "local bridge not connected") — it never again produces a silent, permanent no-response.

**Decided for you**
- Grouping is merge-on-read only. No physical file merges, no deletions — the existing
  `<workspace>/<sessionId>.jsonl` layout is untouched; only how it's read and displayed changes.
  Reason: reversible, zero data-loss risk, matches the "both layouts read" precedent already set
  by multi-terminal-workspace.
- Tool activity collapses to an expandable "N tool calls" summary, not a full hide. Reason: keeps
  activity inspectable (debugging, trust) without letting it dominate the default view.
- The status icon reuses the existing per-session turn-lock `busy`/`result`/`error` events — no
  new state machine.
- The resume/open control stays (it's the fallback for a worktree with no currently-live session);
  it gets fixed, not removed.

**Not included**
- Any change to session identity (`<repoPath>@<worktree>`, unchanged).
- Local/remote session unification — separate topic (`local-remote-unification`).
- Deleting or physically merging any existing history files.

## Decisions

Autonomous run confirmed 2026-07-23.

- **Merge-on-read grouping** lives in `workspaceStore.mjs` as new functions (`listWorkspaces`,
  `readWorkspace`) alongside the existing per-session functions, rather than changing what the
  per-session functions return — nothing already depending on per-session reads breaks.
- **Real resume seeds `options.resume`** from the latest recorded sessionId for the workspace when
  no in-memory session exists yet; the merged transcript preloads the pane's display so the shown
  history and the SDK's actual context agree, closing the "cosmetic vs. real resume" gap found
  during grounding.
- **`_openTranscript`'s error path stops sending `sessionKey: null`** — it echoes back the
  requested key so client-side correlation (`pendingOpens`) always resolves; a client-side timeout
  covers the case where no response ever arrives (bridge disconnected), clearing the pending entry
  and surfacing an explicit note either way.

## Constraints

- `node --test` from the repo root must stay green throughout.
- `lib/version.test.mjs` gates `package.json` version against the newest `CHANGELOG.md` entry —
  the version bump happens once at project close, not per topic.
- Any new/changed control action needs an entry in `WS_CONTROL_ACTIONS` (`lib/protocol.mjs`) or it
  cannot cross the tunnel.
- `lib/workspace.mjs` / `lib/workspaceStore.mjs` are **not** imported by `relay/server.mjs`
  (confirmed: not in `relay/Dockerfile`'s `COPY` lines) — no Dockerfile change needed for this
  topic's server-side files. `dashboard/public/` **is** copied wholesale to the relay image, so
  the UI changes reach the live site only after the relay is redeployed (same caveat as
  multi-terminal-workspace).
- No new dependencies; Node builtins only.
- Cross-platform (Windows dev / Linux systemd prod): no drive letters, no `shell: true`.
