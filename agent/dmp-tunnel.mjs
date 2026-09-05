// dmp-tunnel — the AncientIntel side of DMP's portless reverse tunnel. Dials OUT (WebSocket) to the DMP VPS's
// dmp-remote (/dmp-agent) and relays its requests to the local dmp-main (:4002). Run as dmp-tunnel.service
// (see AncientClients/DemiourgosMotionPictures/site/deploy/TUNNEL.md). Portless: AncientIntel opens no inbound
// port; the WS upgrade is authenticated by a shared secret. Auto-reconnects.
//
//   DMP_TUNNEL_URL     wss://demiourgos.ancientholdings.eu/dmp-agent   (dmp-remote's WS endpoint)
//   DMP_TUNNEL_SECRET  shared secret — MUST match dmp-remote's DMP_TUNNEL_SECRET
//   DMP_TUNNEL_TARGET  http://127.0.0.1:4002   (dmp-main; default)
import { startReverseTunnelBridge } from "../lib/reverseTunnel.mjs";

const url = process.env.DMP_TUNNEL_URL;
const secret = process.env.DMP_TUNNEL_SECRET;
const targetOrigin = process.env.DMP_TUNNEL_TARGET || "http://127.0.0.1:4002";
if (!url || !secret) {
  console.error("dmp-tunnel: DMP_TUNNEL_URL and DMP_TUNNEL_SECRET are required (see deploy/TUNNEL.md).");
  process.exit(1);
}
console.log("dmp-tunnel: dialing " + url + " → " + targetOrigin);
const bridge = startReverseTunnelBridge({ url, secret, targetOrigin, log: (m) => console.log(m) });
process.on("SIGTERM", () => { try { bridge.stop(); } catch {} process.exit(0); });
process.on("SIGINT", () => { try { bridge.stop(); } catch {} process.exit(0); });
