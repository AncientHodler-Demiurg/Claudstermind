# DMP back-channel tunnel (portless WebSocket reverse tunnel)

`dmp-remote` (the DMP VPS) must reach the NAT'd `dmp-main` on AncientIntel to relay **live** traffic. AncientIntel
has no public address, so it **dials OUT** over a single WebSocket to `dmp-remote`'s `/dmp-agent` endpoint; every
request then rides that one connection. **Portless** — no inbound port on AncientIntel, and no extra TCP port or
`ufw` rule on the VPS. Same mechanism as Claudstermind's brain relay; built on `lib/reverseTunnel.mjs`.

    Boss ─► demiourgos.ancientholdings.eu ─► VPS: dmp-remote
                                              │  attachReverseTunnel(server, { path:"/dmp-agent", secret })
                                              ▼  (forwards over the live WS)
                        AncientIntel: dmp-tunnel  ──dials out──►  dmp-main :4002

- Tunnel **up** → `dmp-remote` relays to `dmp-main` (writable DB + AI). `/healthz` → `mode:"relay"`, `mainReachable:true`.
- Tunnel **down** → `dmp-remote` serves its read-only snapshot. `/healthz` → `mode:"readonly"`, `mainReachable:false`.

## One shared secret, two sides
Pick a long random secret. It goes in BOTH files, byte-for-byte:
- AncientIntel: `~/ClaudeWS/.secrets/dmp-tunnel.env` → `DMP_TUNNEL_SECRET`
- VPS: `dmp-remote`'s `remote.env` → `DMP_TUNNEL_SECRET`

## AncientIntel (bridge) — Claudstermind-owned, this repo
```
cp deploy/dmp-tunnel.env.example ~/ClaudeWS/.secrets/dmp-tunnel.env
# edit it: set DMP_TUNNEL_SECRET (matches the VPS). URL/TARGET defaults are fine.
sudo cp deploy/dmp-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dmp-tunnel
```
The unit runs `agent/dmp-tunnel.mjs`, which imports `lib/reverseTunnel.mjs` (uses `ws`, already installed here).

## VPS (dmp-remote) — the DMP agent's part
`dmp-remote` vendors `reverseTunnel.mjs`, adds `ws`, and:
```js
const tunnel = attachReverseTunnel(server, { path: "/dmp-agent", secret: process.env.DMP_TUNNEL_SECRET });
// in relay mode, before the read-only fallback:
if (tunnel.isBridgeConnected() && await tunnel.forward(req, res)) return;
// …else serve the read-only snapshot…
// /healthz: mainReachable = tunnel.isBridgeConnected()
```
This **replaces** the earlier `DMP_MAIN_URL` HTTP-proxy idea — no `DMP_MAIN_URL`, no extra port. See the copy-paste
handoff for the exact wiring.

## Verify
1. `dmp-remote` `/healthz` → `mainReachable:true`, `mode:"relay"` once the bridge connects.
2. `sudo systemctl stop dmp-tunnel` on AncientIntel → `/healthz` flips to `mode:"readonly"`. `start` → relay resumes.
3. Electron control app → DMP tab → the `dmp-tunnel` row shows the bridge's live systemd state; `tunnelOk` keys off
   `dmp-remote`'s `mainReachable`.

## Security
- Portless + AncientIntel dials out → no inbound home port, no VPS `ufw` change.
- The WS upgrade is authenticated by the shared secret (`Authorization: Bearer <secret>`, constant-time compare).
- No DMP/AI secrets ride the tunnel — it carries only `dmp-remote`→`dmp-main` HTTP; `dmp-main` still enforces login
  + Demiourgos clearance (L7 full / L6 read-only / ≤L5 nothing) at its own app layer, in BOTH relay and readonly modes.
