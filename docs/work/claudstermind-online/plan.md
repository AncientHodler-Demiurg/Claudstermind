# Claudstermind Online — plan

Autonomous honey run. TDD per task: failing test → minimal impl → refactor. Waves are ordered by
dependency; tasks within a wave are independent unless noted.

## Wave 1 — shared core + cross-platform (foundation)

- [x] **T1.1 `lib/protocol.mjs`** — frame type constants (`HELLO`, `WELCOME`, `SNAPSHOT`, `COMMAND`,
  `RESULT`, `PING`, `PONG`) + `validateFrame(obj)` returning `{ok, reason}`. Tests: each valid frame
  passes; missing/wrong-type fields rejected; non-object rejected; unknown `t` rejected.
- [x] **T1.2 `lib/commands.mjs`** — `COMMAND_TYPES` whitelist + `executeCommand(type, args, ctx)`
  dispatching to `gitActions`/`backup`/`restore`/`tokenRegistry`/pollinate. `ctx` carries
  `{root, secretsDir, dataDir, runProc}`. Tests: unknown type → `unknown-command` and no dispatch;
  each known type routes to the right function (spies/temp repos); `git.commit` with no message
  fails as before; `tokens.save` writes to a temp `.secrets` and never returns the value.
- [x] **T1.3 `lib/snapshot.mjs`** — `buildSnapshot(root)` + extracted `readBrain(brainDir)` and
  `scanPackages(root)` (moved from server.mjs). Tests: snapshot shape has map/git/brain/packages/
  cascade/activity/tokens; **assert no token value string appears anywhere in the serialized
  snapshot**; brain/packages match the previous inline output on a fixture.
- [x] **T1.4 cross-platform `orchestrator/archives.mjs`** — platform-aware `BACKUP_ROOT`
  (`defaultBackupRoot()`), win32-guarded drive check in `listArchives`. Tests: `defaultBackupRoot`
  returns a `X:\`-style path on win32 and a homedir path otherwise (mock `process.platform`);
  `listArchives` on posix with a missing parent reports "no archives yet", not "drive not mounted".
- [x] **T1.5 wire server.mjs to shared core** — `/api/brain`, `/api/packages` call
  `lib/snapshot.mjs`; the POST mutation handlers (`/api/git/*`, `/api/backup`, `/api/restore`,
  `/api/master-pollinate`, `/api/tokens/save`) route through `executeCommand`. Existing behavior +
  existing tests unchanged. Verify by running the local server and hitting each endpoint.

## Wave 2 — bridge + relay (the tunnel)

- [x] **T2.1 `agent/agent.mjs`** — outbound `WebSocket` client: `hello` auth, snapshot push
  (interval + on connect), `command` handling via `executeCommand`, reconnect-with-backoff, `wss`
  enforced unless `AGENT_ALLOW_INSECURE=1`. Tests (against a stub ws server): sends `hello` with the
  secret; on `welcome` pushes a snapshot; answers a `command` with a matching `result`; refuses
  `ws://` without the opt-in.
- [x] **T2.2 `relay/server.mjs` — agent link** — `ws` `WebSocketServer` on `/agent`: constant-time
  device-secret check on `hello`, hold latest snapshot, newest-wins replacement, pending-command map
  with 130 s timeout + disconnect rejection. Tests: bad secret closed; good secret welcomed; snapshot
  stored; command correlates to result; timeout → 504-shaped result; disconnect → 503-shaped.
- [x] **T2.3 `relay/server.mjs` — browser side** — reuse `handleAuthRoute` + `guard`; `/api/me` adds
  `localConnected`; GET views from snapshot (empty-but-200 when absent); POST forwards to the tunnel
  with the role lock (`modern`→403) and connection lock (down→503); never logs token values; CSRF
  `sameOrigin`. Tests: modern POST → 403; ancient POST while disconnected → 503; ancient POST while
  connected → relayed result; GET while disconnected → `localConnected:false` payload.
- [x] **T2.4 relay `package.json`** — `jose` + `ws`, `start` script, `type:module`.

## Wave 3 — frontend, container, integration

- [x] **T3.1 frontend connection banner** — `/api/me` consumer in `app.js` sets a `localConnected`
  flag; a banner renders and action controls disable when `live && !localConnected`; `styles.css`
  banner rule. Verify in the browser against the running relay.
- [x] **T3.2 container** — `relay/Dockerfile` (node:24-alpine, non-root), `relay/docker-compose.yml`
  (relay + Caddy TLS), `relay/Caddyfile`, `relay/.env.example`. `docker compose config` validates;
  Dockerfile builds if Docker is available, else lint the syntax and note it.
- [x] **T3.3 integration test `relay/integration.test.mjs`** — start the relay on an ephemeral port,
  connect a real bridge against a temp workspace, assert: not-connected state before connect; live
  snapshot after; an ancient command executes locally and returns; a modern session is refused. This
  is the local end-to-end proof.
- [x] **T3.4 `relay/DEPLOY.md`** — register the OIDC client (redirect `https://<domain>/auth/callback`),
  set `.env`, `docker compose up`, set the matching `RELAY_URL` + `AGENT_DEVICE_SECRET` on the local
  bridge. Cross-platform bridge start (Windows + Ubuntu).

## Verification gate (before review)
- [x] Full test suite green (`node --test` across lib/, orchestrator/, dashboard/auth/, relay/).
- [x] Local end-to-end: relay + bridge on this machine, drive `/api/me`, a GET view, and one
  ancient command via curl; confirm execution + result.
