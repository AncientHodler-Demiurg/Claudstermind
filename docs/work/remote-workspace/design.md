# Remote Claude Workspace — design

Drive Claude Code sessions running on the local machine (the bridge) from the web
dashboard at `brain.ancientholdings.eu`, per repository. The website becomes a remote
cockpit for a headless work machine — you prompt Claude, watch it work, approve or
auto-run its tools, and see cost, from anywhere.

## Acceptance criteria (the confirmed outcome)

1. **Workspace tab (ancient-only).** A new tab, visible only to the `ancient` admin —
   hidden for `modern` and never on the public page. Pick a repo, type a prompt, and a
   Claude Code session runs in that repo on the work machine, its conversation streamed
   live to the browser (assistant text, the tools it runs, results).
2. **Multi-turn chat.** Keep prompting the same session; it remembers context.
3. **Approve/deny + trusted toggle.** By default, each risky tool the agent wants to run
   pops an approve/deny in the browser; you decide remotely. A **trusted-mode toggle**
   turns that off — full-auto, no popups, exactly like working locally.
4. **Usage visible.** A live per-session token + cost readout, and a running total.
5. **Conversations saved.** Sessions persist on the machine and are listable/reopenable
   from the web; a transcript + usage is recorded per session.
6. **Create repos/folders from the web.** A control to make a new folder or a new git repo
   in the workspace, relayed to the machine.
7. **Subscription auth, not API key.** Sessions authenticate with the `claude setup-token`
   subscription token at `.secrets/claude-oauth-token.txt`. No API-key billing.
8. **Cross-platform.** Runs on Ubuntu (the imminent Linux mini-PC migration) as well as
   Windows. A migration checklist ships with it.
9. **Deployed + verified.** Relay rebuilt on StoaNodePrime, local dashboard restarted; one
   real end-to-end run confirms a streamed reply + usage through the tunnel.

## Architecture

```
 browser (ancient)                                   work machine (bridge)
   Workspace tab                                        WorkspaceManager
     │  POST /api/workspace/{prompt,permission,stop,control}   │
     ▼                                                         ▼
 ┌────────────┐   WS_IN  ───────tunnel───────▶  ┌──────────────────────┐
 │   relay    │◀── WS_OUT ──────────────────────│  ClaudeSession (SDK)  │→ spawns `claude`
 │ SSE stream │                                 │  canUseTool → web     │   in repo cwd
 └────────────┘   SSE /api/workspace/stream      └──────────────────────┘   (subscription token)
        │  event / permission / state
        ▼
   live transcript, approve/deny modal, usage, trusted toggle
```

- **Streaming**, not request/response: the session emits a continuous flow. The bridge
  pushes `WS_OUT` frames up the existing tunnel; the relay fans them to browser
  `EventSource` subscribers via SSE. Browser actions go down as `WS_IN` frames.
- **Foundation (built, committed 62c3bb3):** `lib/protocol.mjs` (WS_IN/WS_OUT frames,
  WS_CONTROL_ACTIONS), `lib/claudeSession.mjs` (streaming SDK session, permission routing,
  trusted auto-allow, usage, `cleanClaudeEnv`).

## Components (this run)

- **lib/workspace.mjs — WorkspaceManager (bridge side).** Sessions keyed by
  `sessionKey`→repo cwd. `handleIn(kind, sessionKey, data)` for WS_IN {prompt, permission,
  stop, control}; control {newFolder, newRepo (mkdir+git init), list, setTrusted, delete}.
  Streams WS_OUT {event, permission, state} via an injected `send`. Reads the token from
  `.secrets`; path-validates every repo/parent under the workspace root. Records a
  transcript + usage per session to `.claude/workspace/<key>.json` for history.
- **agent/agent.mjs (bridge).** On a `WS_IN` frame, call the manager; the manager's `send`
  pushes `WS_OUT` frames up. Existing snapshot + command whitelist untouched.
- **relay/relay-core.mjs.** Route WS frames: forward `WS_IN` from an SSE-authorized POST to
  the bridge socket; fan `WS_OUT` from the bridge to registered SSE subscribers. A small
  subscriber registry.
- **relay/server.mjs.** SSE `GET /api/workspace/stream` (ancient-only) + POST
  `/api/workspace/{prompt,permission,stop,control}` (ancient-only, connection-gated).
  Modern → 403; never public.
- **Web UI (Workspace tab).** Repo picker, streamed transcript, approve/deny modal,
  trusted toggle, usage readout, session list + reopen, new-folder/new-repo control.
- **Migration checklist** (`relay/DEPLOY.md` addition) for the Linux box.

## Decisions
Autonomous run confirmed 2026-07-20.

- **Subscription auth only** — token from `.secrets/claude-oauth-token.txt` → injected as
  `CLAUDE_CODE_OAUTH_TOKEN` after `cleanClaudeEnv`. Proven working headless. Never API key.
- **SSE for relay→browser streaming**, POST for browser→relay actions. Simpler than a
  second browser WebSocket; the bridge↔relay tunnel stays the existing WS.
- **Ancient-only, never public.** This is arbitrary agent execution on the machine — the
  most powerful surface; gated by the existing OIDC ancient role + device-secret tunnel +
  TLS. Modern is read-only; the public page never sees it.
- **Trusted mode = `permissionMode: bypassPermissions`**; default = `canUseTool` routes to
  the web. A global default toggle, applied to all sessions.
- **Persistence:** the SDK persists sessions by id (resume); the bridge additionally writes
  a compact transcript + usage per session under `.claude/workspace/` so the web lists them
  without depending on SDK internals.
- **Repo creation** limited to a safe name regex + a parent under the workspace root; git
  init only (GitHub repo creation deferred — noted in Not-included).
- **Cross-platform:** Node builtins + the SDK + git only; no tar/PowerShell/drive-letter
  assumptions in this feature.

## Not included
- Creating/pushing GitHub repos from the web (git init only; wire remote later).
- Running Claude with an API key (subscription only, by decision).
- Editing files directly in the web (you drive Claude; Claude edits).
- Modern/public access to the workspace (ancient-only).
