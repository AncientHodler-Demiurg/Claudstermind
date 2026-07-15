# Claudstermind Online — design

The **online variant**: a containerized cloud relay at `brain.ancientholdings.eu` that mirrors
the local dashboard over the web, plus an outbound **bridge** added to the local dashboard so an
`ancient` admin can view *and* execute from the browser (relayed home) while a `modern` admin
gets a read-only window. The local machine stays the only source of truth and the only executor;
the cloud is a gateway that relays reads up and commands down a reverse tunnel.

## Acceptance criteria (the confirmed outcome)

1. **Containerized relay.** `docker compose up` behind `brain.ancientholdings.eu` serves the same
   dashboard UI with AncientHub login in front and automatic HTTPS. No Node on the host; config via
   env / `.env`, never baked into the image.
2. **Connection awareness.** After login, if the local bridge isn't connected the dashboard shows
   **"Local Claudstermind not connected"** and disables every action; when connected it shows live
   data (map, git, brain, cascade, packages, token metadata) streamed up from the local machine.
3. **Ancient executes from the web.** commit / push / pull, backup, restore, master-pollinate
   **dry-run**, and token renewal are relayed down the tunnel and executed locally; the result
   returns to the browser. Real `--execute` publishing stays terminal-only.
4. **Modern is read-only.** A `modern` hub account sees everything (incl. brain worklog + prompt
   snippets) but has no action buttons and is refused (403) on any write.
5. **The bridge is opt-in and invisible when off.** Setting `RELAY_URL` + `AGENT_DEVICE_SECRET`
   opens an outbound secure tunnel (no inbound ports); unset, the local dashboard behaves exactly
   as today.
6. **Cross-platform local side.** The bridge and the local-only actions run on Ubuntu as well as
   Windows (tar, backup paths, drive checks hardened).
7. **Deploy-ready, not deployed.** Dockerfile + compose + Caddy + a deploy handoff are delivered;
   the OIDC client registration and deployment are the user's. The full tunnel is verified
   **locally** (relay + agent on one machine).

## Architecture — reverse tunnel

```
 browser (ancient/modern)                    the user's machine
        │  https                                    │
        ▼                                            │
 ┌──────────────┐        wss (outbound)       ┌──────┴──────┐
 │  Caddy (TLS) │◄───────── tunnel ───────────│   bridge    │  agent/agent.mjs
 │   + relay    │  snapshot ▲   ▼ command      │ (WebSocket  │
 │ relay/server │           │   │              │   client)   │
 └──────────────┘           │   │              └──────┬──────┘
   serves public/ UI        │   │                     │ executeCommand()
   reuses dashboard/auth     ndjson frames             ▼
                                                 gitActions / backup /
                                                 restore / tokenRegistry
```

- The **bridge** (behind NAT) dials **out** to the relay over `wss://` and holds the socket open.
  No port-forwarding, no inbound firewall change.
- The bridge **pushes snapshots up** and **receives commands down**; the relay never reaches into
  the machine.
- The relay serves the identical `dashboard/public/` UI and reuses `dashboard/auth/` wholesale, so
  the login, role model, and CSRF guard are the proven ones.

## Components

### Shared core (`lib/`)
- **`lib/protocol.mjs`** — the tunnel envelope: frame type constants and pure validators.
  Agent→relay: `hello` (auth), `snapshot`, `result`. Relay→agent: `welcome`, `command`, and a
  liveness `ping`/`pong`. `validateFrame(obj)` rejects anything malformed before it is acted on.
- **`lib/commands.mjs`** — the single command path. `COMMAND_TYPES` is the whitelist
  (`git.commit`, `git.push`, `git.pull`, `backup`, `restore`, `pollinate.dryrun`, `tokens.save`).
  `executeCommand(type, args, ctx)` validates the type, dispatches to the existing lib/orchestrator
  functions, and returns their result. An unknown type returns `{ok:false, reason:"unknown-command"}`
  and never dispatches. Both the local server's POST handlers and the bridge route through this, so
  "what can run" is defined once.
- **`lib/snapshot.mjs`** — `buildSnapshot(root)` gathers map, git status, brain (repos + worklog +
  daily), cascade, packages, activity, and **token metadata only** (via `tokenRegistry.enrich` —
  never values). This is the payload pushed up. `/api/brain` and `/api/packages` gathering move here
  so the local server and the bridge produce byte-identical data.

### Local bridge (`agent/agent.mjs`)
- Standalone process (`node agent/agent.mjs`) that reuses the shared core. Started manually or
  alongside the dashboard. Zero new dependency — Node 24's global `WebSocket` client.
- Reads `RELAY_URL` + `AGENT_DEVICE_SECRET` from env. Dials the relay, sends `hello` with the
  device secret, then on `welcome` begins pushing snapshots (on an interval + immediately on
  connect) and answering `command` frames via `executeCommand`.
- Reconnects with backoff on drop. `ws://` is refused unless `AGENT_ALLOW_INSECURE=1`
  (localhost testing only); production is `wss://`.

### Cloud relay (`relay/server.mjs`)
- `node:http` server + a `ws` `WebSocketServer` on `/agent`. `ws` is the one added dependency
  (the relay is a container; stated explicitly, same principle as `jose`).
- **Agent link:** the `/agent` upgrade authenticates the `hello` device secret (constant-time
  compare against `AGENT_DEVICE_SECRET`). Newest valid connection wins. Holds the latest snapshot in
  memory and a map of pending command promises.
- **Browser side:** reuses `handleAuthRoute` + `guard`. `/api/me` adds `localConnected`. GET views
  answer from the held snapshot (or an empty "not connected" shape, still 200 so the UI renders the
  banner). POST (ancient only) forwards a `command` frame down the tunnel, correlates the `result`
  by id with a 130 s timeout (> git's 120 s), and returns it. Authorization:
  - `modern` → 403 on any POST (role lock, reused).
  - not connected → 503 `local-not-connected` on any POST.
  - never persists a token value; forwards it through memory only.
- Serves `dashboard/public/` and `dashboard/data/map.json` is **not** used — the map arrives in the
  snapshot, so the relay has no local disk dependency.

### Container (`relay/`)
- **Dockerfile** — `node:24-alpine`, copies `relay/`, `dashboard/auth/`, `dashboard/public/`,
  installs `jose` + `ws`, runs the relay. Non-root user.
- **docker-compose.yml** — the relay + a **Caddy** service that terminates TLS for the configured
  domain and reverse-proxies to the relay. Config via `.env` (domain, OIDC vars, session + device
  secrets).
- **Caddyfile**, **.env.example**, **DEPLOY.md** handoff (register the OIDC client with redirect
  `https://<domain>/auth/callback`; set the same device secret on the local bridge).

### Frontend (`dashboard/public/`)
- `/api/me` gains `localConnected`; `app.js` renders a dismissible-free banner + disables action
  controls when `mode==="live"` and `!localConnected`. Existing `canExecute` already hides
  actions for `modern`. Minimal, additive.

### Cross-platform (`orchestrator/archives.mjs`)
- `BACKUP_ROOT` default becomes platform-aware (win32 `X:\_Claude-backup`, else
  `~/claude-backup`); the `listArchives` drive-reachability check is guarded to win32 (posix checks
  the parent dir). `tarBin()` already branches correctly.

## Non-goals
- No deployment, no OIDC client registration (user's, with hub credentials).
- No real `--execute` publishing from the web.
- No change to local-dashboard behavior when the bridge env is unset.
- The bridge is not containerized (it needs direct filesystem + git access).

## Decisions
Autonomous run confirmed 2026-07-15.

- **Transport = WebSocket, relay adds `ws`, bridge adds nothing.** Node 24 has a built-in
  `WebSocket` *client* (bridge) but no server; `ws` is the battle-tested server for a
  security-sensitive channel, and the relay is a container where a dep is normal.
- **Config via env/`.env`, not baked into the image.** Answers the user's "embed into production"
  musing without putting secrets in an image layer; same one-time-setup ergonomics.
- **Domain is a config var.** Caddy site address + OIDC redirect derive from `.env`, so
  `brain` vs `brains.ancientholdings.eu` is settled by what the user registers, not by code.
- **Single command path through `lib/commands.mjs`.** Local buttons and relayed commands share one
  whitelist + executor, so a command type can't exist on one path and not the other.
- **Token values never touch the relay's storage.** Snapshot carries metadata only; `tokens.save`
  forwards the value through relay memory to the local `.secrets` and nowhere else.
- **Connection-lock replaces the place-lock on the relay.** The live *dashboard* refuses local-only
  actions outright; the *relay* instead relays them, gated on the tunnel being up (503 when down).
- **Newest agent connection wins.** A reconnect after a network drop must not be locked out by a
  stale half-dead socket.
