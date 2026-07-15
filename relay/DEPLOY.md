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
