# Deploying the Claudstermind online relay

The relay is the public gateway at your domain (e.g. `brain.ancientholdings.eu`). It mirrors
your **local** Claudstermind over a reverse tunnel: reads flow up from your machine, commands
flow down to it. The relay executes nothing itself — when your machine is offline the site says
so and disables every action.

Two things you do that this build cannot: **register the OIDC client** in AncientHub, and
**run the deployment**. Everything else is here and verified locally end-to-end.

---

## 1. Register the OIDC client in AncientHub

Create a confidential client in the hub with:

- **Redirect URI:** `https://<your-domain>/auth/callback` — exactly (e.g. `https://brain.ancientholdings.eu/auth/callback`).
- **Grant:** authorization code + PKCE (S256), `client_secret_basic` at the token endpoint.
- **Scopes:** `openid profile email roles`.
- Ensure the id_token carries the **roles** claim, and that your account has `ancient` (execute)
  and any read-only viewer has `modern`.

Note the issued **client id** and **client secret**.

## 2. Point DNS at the box

An `A`/`AAAA` record for `<your-domain>` → the server's IP. Caddy needs ports **80 + 443**
reachable to provision the TLS certificate automatically.

## 3. Configure `.env`

On the server, in the `relay/` directory:

```sh
cp .env.example .env
```

Fill it in:

| var | value |
|---|---|
| `RELAY_DOMAIN` | your domain, e.g. `brain.ancientholdings.eu` |
| `OIDC_ISSUER` | `https://ancientholdings.eu` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | from step 1 |
| `OIDC_REDIRECT_URI` | `https://<your-domain>/auth/callback` |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `AGENT_DEVICE_SECRET` | `openssl rand -hex 32` — **keep it**, it also goes on your work machine |

`.env` is gitignored; never commit it.

## 4. Bring it up

From `relay/` (Docker + the compose plugin installed on the host — nothing else):

```sh
docker compose up -d --build
docker compose logs -f relay      # watch it boot
```

Caddy provisions the certificate on first request. Visit `https://<your-domain>` — you should get
the AncientHub login. After signing in you'll see **"Local Claudstermind not connected"** until you
start the bridge (step 5).

## 5. Start the bridge on your work machine

The bridge is the outbound half of the tunnel. It needs the **same** `AGENT_DEVICE_SECRET` as the
relay. It runs from the Claudstermind checkout on your machine — no inbound ports, it dials out.

**Windows (PowerShell):**
```powershell
$env:RELAY_URL = "wss://brain.ancientholdings.eu/agent"
$env:AGENT_DEVICE_SECRET = "<the same secret as the relay>"
node agent/agent.mjs
```

**Ubuntu / Linux:**
```sh
export RELAY_URL="wss://brain.ancientholdings.eu/agent"
export AGENT_DEVICE_SECRET="<the same secret as the relay>"
node agent/agent.mjs
```

The bridge prints `connected — pushing snapshot` once the relay accepts it. Refresh the site: the
banner clears and live data appears. As an `ancient` admin your action buttons (commit/push/pull,
backup, restore, master-pollinate dry-run, token renew) now execute on your machine and report back.

> Keep the local dashboard (`dashboard/server.mjs`) running too — the bridge reads the same
> workspace it does. The bridge can run alongside it; they don't conflict.

To keep the bridge running after logout, wrap it in a service — a **systemd** unit on Ubuntu, or
**Task Scheduler** / `pm2` on Windows. Minimal systemd unit:

```ini
[Unit]
Description=Claudstermind bridge
After=network-online.target

[Service]
Environment=RELAY_URL=wss://brain.ancientholdings.eu/agent
Environment=AGENT_DEVICE_SECRET=<secret>
WorkingDirectory=/home/you/_Claude/Claudstermind
ExecStart=/usr/bin/node agent/agent.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

## Security model (what crosses the wire)

- **Snapshots** pushed up carry token *metadata* only (names, expiry, where declared) — **never a
  token value**. The live GitHub secret scan stays local (it needs your PAT).
- **Token renewal** from the web forwards the pasted value through relay memory to your local
  `.secrets` — the relay never stores or logs it.
- **Commands** are a fixed whitelist (`git.commit/push/pull`, `backup`, `restore`,
  `pollinate.dryrun`, `tokens.save`). The bridge refuses anything else. Real `--execute` publishing
  is not exposed — dry-run only.
- The bridge authenticates with the device secret (constant-time checked); the relay only forwards
  commands from an authenticated `ancient` browser session. `modern` is read-only (403 on writes).

## Verifying without the hub

The full tunnel is covered by `relay/integration.test.mjs` (a real relay + real bridge on one
machine): not-connected → 503, connected, ancient command executes locally, modern refused. Run:

```sh
node --test relay/integration.test.mjs
```

---

# The remote Claude workspace

The `Workspace` tab (online, `ancient` only) drives real Claude Code sessions running on
the work machine, per repository — you prompt, it streams the conversation back, you
approve tools or flip **Trusted mode** for full-auto. It authenticates with a **subscription
token**, never an API key.

## One-time setup on the work machine

```sh
# mint a long-lived subscription token (opens a browser to authorize):
claude setup-token
# save the token it prints where the bridge reads it:
printf '%s\n' '<TOKEN>' > <workspace-root>/.secrets/claude-oauth-token.txt
```

That's it — the local dashboard's in-process bridge picks it up. Verify:
`CLAUDE_CODE_OAUTH_TOKEN="$(cat .secrets/claude-oauth-token.txt)" claude -p "Reply: OK"`.

## Deployed reality (as of this build)

- Relay runs as a **container** on StoaNodePrime behind the box's existing **nginx** (not
  the bundled Caddy — nginx already owns 80/443). `docker-compose.yml` publishes the relay
  on `127.0.0.1:8088`; the vhost `brain.ancientholdings.eu.conf` terminates TLS (certbot)
  and reverse-proxies to it, WebSocket-upgrade + `X-Forwarded-Host` included.
- The **local dashboard** (`node dashboard/server.mjs`) runs the bridge in-process; its
  **Ops → Relay** panel (or a dedicated **Relay** tab) holds the address + device secret and
  shows the connection. The **Activity** tab + the public showcase read git history.

---

# Migrating the working base to the Linux mini-PC

The whole system is cross-platform (Node + git + the Agent SDK; no Windows-only paths).
To move the working base off Windows onto the headless Linux box — where the **web
dashboard is the only GUI** — do this on the Linux box:

1. **Copy the workspace** (`D:/_Claude` → e.g. `~/_Claude`). Keep `.git`, `.secrets`,
   `Claudstermind/dashboard/data`, the per-repo folders. Do NOT copy `node_modules`.
2. **Install prerequisites:** Node 22+ (24 recommended), `git`, and Claude Code (native
   installer). Then `npm install` in `Claudstermind/` (SDK + ws) and `Claudstermind/relay/`
   is only needed on the relay host, not here.
3. **Auth on the box:** `claude setup-token`, save to `~/_Claude/.secrets/claude-oauth-token.txt`.
4. **Wire the relay link:** create `~/_Claude/.secrets/relay-device-secret.txt` with the
   same `AGENT_DEVICE_SECRET` as the relay, and `Claudstermind/dashboard/data/relay.json`
   `{ "enabled": true, "url": "wss://brain.ancientholdings.eu/agent" }` — or set it from the
   Relay tab once the dashboard is up.
5. **Run the dashboard headless** (it hosts the bridge). A systemd unit keeps it up + auto-
   starts on boot:

   ```ini
   [Unit]
   Description=Claudstermind dashboard + bridge
   After=network-online.target
   [Service]
   WorkingDirectory=/home/you/_Claude/Claudstermind/dashboard
   ExecStart=/usr/bin/node server.mjs
   Restart=always
   RestartSec=5
   Environment=PORT=3001
   [Install]
   WantedBy=default.target
   ```

6. From anywhere, open `https://brain.ancientholdings.eu`, sign in, and the **Workspace**
   tab now drives Claude on the Linux box. Backups default to `~/claude-backup`; tar is
   native; nothing Windows-specific remains.

The Windows machine is then free — keep using the Claude desktop app there, but Claude
Code work lives on the Linux box.
