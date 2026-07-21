# Workspace redesign + per-repo history — design

Turn the single-column Workspace into a full-width, multi-pane cockpit with a repository
sidebar, and make every conversation durable per repository (the raw substrate a later
learning loop will mine).

## Acceptance criteria (confirmed outcome)

1. **Full-width.** The Workspace spans the whole browser width, not the centered column.
2. **Left sidebar, two modes.** A vertical repo menu toggling **Repositories** (flat list,
   every git-repo folder badged as a repo) and **Tree** (the workspace folder structure,
   repo-folders badged). Clicking a repo/tree entry targets the active pane.
3. **1–4 chat panes.** A layout picker (1/2/3/4) shows that many equal-width chat panes
   side by side. Each pane is an independent Claude session in its own repo. One pane is
   **active** (highlighted); picking a repo (pane dropdown or sidebar click) applies to it.
   Approve/deny, trusted mode, and usage keep working per pane.
4. **Per-repo persistent history (raw).** Every conversation is saved in full (all prompts +
   assistant text) and retrievable **by repository** — never lost. You can list a repo's
   past conversations, **reopen** one read-only, or **resume** it live (the agent continues
   with full prior context). Raw transcripts are retained (not pruned) as the learning-loop
   substrate.
5. Deployed (relay + local dashboard) and browser-verified.

## Architecture (reuses the streaming backend)

The backend already supports concurrency: `WorkspaceManager` keys sessions by `sessionKey`,
and every SSE frame carries `sessionKey`. So multi-pane is a **frontend** change plus a few
bridge control actions — no protocol/relay rebuild.

### Bridge (lib/workspace.mjs) — additions
- **control `tree`** — walk the workspace root (bounded depth; skip `node_modules`, `.git`
  internals, `.next`, `dist`, `build`, `.turbo`, `_Archive`), returning a nested folder tree
  with each folder flagged `isRepo` when it contains `.git`. `send("state", null, { tree })`.
- **control `repos`** — the tracked-repos list, each flagged as a repo (already via `list`;
  keep, ensure the badge data is present).
- **control `history`** `{ repo? }` — read the saved transcripts under `.claude/workspace/`,
  optionally filtered by repo; return `[{ sessionKey, sessionId, repo, updatedAt, turns,
  usage, firstPrompt }]`. `send("state", null, { history })`.
- **control `open`** `{ sessionKey }` — read one saved transcript and stream it back as a
  `WS_OUT { kind:"transcript" }` so the web can render it read-only.
- **resume** — a `prompt` carrying `{ resume: <sessionId> }` starts a `ClaudeSession` with the
  SDK `resume` option so the agent continues the saved session with full context.
- Persistence keeps the full raw transcript per session, tagged with `repo` (already written;
  ensure repo indexing + no pruning).

### Session engine (lib/claudeSession.mjs)
- Accept `resume` (sessionId) and pass it to the SDK query options.

### Frontend (dashboard/public/app.js + styles.css)
- `viewWorkspace` rebuilt: a full-width shell = **sidebar** (Repos | Tree toggle, repo
  badges, per-repo History) + a **pane grid** (1–4). Panes share the one `EventSource`;
  `onPayload` routes by `sessionKey` to the pane whose session it belongs to. Active-pane
  state; sidebar/dropdown repo selection sets the active pane's repo. History list → reopen
  (read-only transcript pane) / resume (live). Full-width via a body class toggled on
  enter/leave.

## Decisions
Autonomous run confirmed 2026-07-20.

- **Multi-pane over one SSE.** All panes multiplex the single existing stream keyed by
  `sessionKey` — no new transport; the backend already fans per-session events.
- **Tree from a bounded bridge walk**, not the snapshot — the snapshot only has tracked
  repos; the sidebar Tree needs real folders. Bounded depth + skip-list keeps it cheap and
  cross-platform (Node fs/path only).
- **History = raw transcript files by repo**, flat under `.claude/workspace/`, filtered by the
  `repo` field. Kept forever (learning-loop substrate); reopen reads the file, resume uses
  the SDK's own session persistence (`resume: sessionId`).
- **Active-pane model** — one target for sidebar selection; avoids ambiguity with N panes.
- Gating unchanged: ancient + online only.

## Not included
- The learning/distillation loop (next phase — this build only guarantees raw history exists).
- The LocalHost mirror (later phase). Hermes. Messaging gateways.
- A full every-file browser (Tree shows folders + repo badges, not file contents).
