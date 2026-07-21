# Remote Claude Workspace — plan

Autonomous honey run. TDD per task. Foundation (protocol WS frames + claudeSession) is
done + committed (62c3bb3). Waves ordered by dependency.

## Wave 1 — bridge WorkspaceManager
- [x] **T1.1 lib/workspace.mjs** — `WorkspaceManager` + `readClaudeToken`. handleIn
  {prompt, permission, stop, control}; control {newFolder, newRepo, list, setTrusted,
  delete}; WS_OUT via injected `send`; path validation; per-session transcript+usage record.
- [x] **T1.2 workspace.test.mjs** — mock sdkQuery: prompt starts a session + streams events;
  permission routes + resolves; trusted default; stop; control newFolder/newRepo (temp dir);
  list; path-escape rejected; no token → error event.
- [x] **T1.3 real smoke** — one minimal REAL Claude prompt (no tools, tiny) through the
  manager proving bridge→real-Claude with the token. (Gated: skips if no token.)

## Wave 2 — tunnel wiring
- [x] **T2.1 relay/relay-core.mjs** — WS subscriber registry: `addWsSubscriber(fn)`,
  `routeWsOut(frame)` fans to subscribers, `sendWsIn(kind, sessionKey, data)` → bridge
  socket. Handle WS_OUT frames arriving from the bridge in AgentLink.onFrame.
- [x] **T2.2 relay-core.test.mjs** — WS_OUT fans to subscribers; WS_IN forwarded to socket;
  subscriber add/remove; no bridge → sendWsIn returns not-connected.
- [x] **T2.3 agent/agent.mjs** — instantiate WorkspaceManager; on WS_IN frame → handleIn;
  manager.send → push WS_OUT frame up. Token/model from config. Existing paths untouched.

## Wave 3 — relay endpoints
- [x] **T3.1 relay/server.mjs** — SSE `GET /api/workspace/stream` (ancient-only): register
  subscriber, stream `WS_OUT` as SSE events, heartbeat, cleanup on close. POST
  `/api/workspace/{prompt,permission,stop,control}` (ancient-only + connection-gated) →
  `sendWsIn`. `/api/me` gains `canWorkspace` (ancient && connected).
- [x] **T3.2 relay-core.test / integration** — modern → 403 on workspace POST; disconnected
  → 503; ancient+connected → forwarded.

## Wave 4 — Web Workspace UI
- [x] **T4.1 index.html + app.js** — Workspace tab (ancient-only, hidden modern/public).
  Repo picker, transcript stream (EventSource), prompt box, approve/deny modal, trusted
  toggle, usage readout, session list + reopen, new-folder/new-repo control. styles.
- [x] **T4.2 verify render** — browser check of the tab structure (ancient), gating (hidden
  for non-ancient).

## Wave 5 — deploy + real e2e
- [x] **T5.1 migration checklist** — relay/DEPLOY.md Linux-migration section.
- [x] **T5.2 deploy** — relay rebuild on StoaNodePrime; restart local dashboard (bridge
  reconnects). Full suite green.
- [x] **T5.3 real end-to-end** — drive a tiny real Claude prompt in a repo through the
  tunnel (forged ancient session), confirm streamed reply + usage. Minimal cost.

## Verification gate
- [x] Full `node --test` suite green across lib/, orchestrator/, dashboard/auth/, relay/, agent/.
- [x] One real streamed Claude turn confirmed through the relay.
- [x] review clean pass
