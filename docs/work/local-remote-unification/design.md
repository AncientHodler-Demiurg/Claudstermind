# Local ↔ remote unification — one live session, two attachment points

Grounding turned up the actual reason "local" and "live site" don't already share a conversation:
`dashboard/server.mjs` builds its own `WorkspaceManager` for local browser tabs, and separately
calls `createBridge(...)` **without** passing it that instance — so `agent/agent.mjs` falls back
to minting a **second, independent** `WorkspaceManager`. Same disk directory, two different
in-memory `sessions` Maps. A local tab and a live-site tab on the same repo+worktree today spawn
two independent `ClaudeSession`s that both happen to write to the same file — not one shared live
session. This topic makes them the same instance.

## Acceptance criteria (the confirmed outcome)

After this you'll have:

1. The local dashboard's session manager and the bridge's session manager are **the same object**
   — one `sessions` Map, one turn-lock, one source of truth per workspace.
2. A chat opened from the live site on a repo+worktree and one opened locally on the same
   repo+worktree are the same live session: the same turn-lock applies to both (a prompt from one
   while the other is mid-turn gets `busy`), and both see the same growing transcript in real time.
3. Session events reach **both** the local dashboard's SSE subscribers and the outbound tunnel
   (for the relay to fan out to its own subscribers) simultaneously, regardless of which side a
   prompt came from.
4. Existing fallback behavior is unchanged: local browsing still works with no bridge connected;
   the live site still degrades to its current read-only behavior when the bridge is down.

**Decided for you**
- Fix at the root: `dashboard/server.mjs` passes its own `WORKSPACE` into `createBridge({workspace:
  WORKSPACE, ...})` instead of letting the bridge construct a second one. Smallest change that
  matches the actual cause.
- The manager's broadcast path becomes sink-pluggable (a small set of registered output sinks —
  local SSE broadcast, outbound WS_OUT sender — each optional) instead of hard-wired to one
  transport, so the same session's events reach whichever sinks are currently registered.
- No change to the relay's own subscriber fan-out (`wsSubscribers`/`_fanWsOut` in
  `relay/relay-core.mjs`) — it already correctly fans to every relay-side SSE subscriber; the gap
  was entirely on the work-machine side.

**Not included**
- Any change to the attach-dialog UI or presence display (already correct once the underlying
  session is actually shared).
- Multi-terminal-workspace's existing worktree/presence machinery — reused as-is.

## Decisions

Autonomous run confirmed 2026-07-23.

- <filled in during build as real choices are made>

## Constraints

- Depends on `workspace-conversation-ux` landing first — both touch `lib/workspace.mjs`; building
  on top of its resume/history fixes rather than in parallel avoids a merge fight.
- `node --test` from the repo root must stay green throughout.
- `lib/workspace.mjs` / `lib/workspaceStore.mjs` remain outside `relay/Dockerfile`'s `COPY` lines
  (confirmed) — this topic's work-machine-side changes don't require a relay image rebuild by
  themselves, though the relay redeploy caveat from multi-terminal-workspace still applies to any
  UI-visible change.
- No new dependencies.
- Cross-platform: no drive letters, no `shell: true`.
