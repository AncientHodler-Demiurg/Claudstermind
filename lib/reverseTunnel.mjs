// reverseTunnel.mjs — a generic, portless reverse HTTP tunnel over ONE WebSocket, un-coupled from any app
// (no OIDC, no WorkspaceManager). Same mechanism as Claudstermind's brain relay: the NAT'd side DIALS OUT, so
// nothing inbound is opened on the home machine, and no extra TCP port is opened on the public side either —
// requests ride the existing WS. Built for DMP so `dmp-remote` (VPS) can relay to `dmp-main` (AncientIntel).
//
//   VPS (dmp-remote):        attachReverseTunnel(httpServer, { path, secret }) → { isBridgeConnected, forward }
//   AncientIntel (bridge):   startReverseTunnelBridge({ url, secret, targetOrigin }) → { stop }
//
// Protocol (multiplexed by a uint32 request id): JSON text frames carry control; binary frames carry body
// bytes, each prefixed with the 4-byte id. Direction disambiguates a body chunk (server→bridge = request body,
// bridge→server = response body). Hop-by-hop headers are stripped both ways.
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import https from "node:https";
import { timingSafeEqual } from "node:crypto";

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
function stripHop(headers = {}) {
  const out = {};
  for (const k of Object.keys(headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = headers[k];
  return out;
}
function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
const u32 = (id) => { const b = Buffer.allocUnsafe(4); b.writeUInt32BE(id >>> 0, 0); return b; };
const toBuf = (chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

// ---- SERVER side: runs inside the public server (dmp-remote on the VPS) ---------------------------------
export function attachReverseTunnel(server, { path = "/dmp-agent", secret, log = () => {} } = {}) {
  if (!secret || String(secret).length < 16) throw new Error("attachReverseTunnel: a `secret` (>= 16 chars) is required");
  const wss = new WebSocketServer({ noServer: true, maxPayload: 200 * 1024 * 1024 });
  let bridge = null;                 // the single connected bridge (newest wins)
  const pending = new Map();         // id -> { res, started, aborted, resolve }
  let seq = 1;
  const nextId = () => (seq = (seq % 0xffffffff) + 1);

  server.on("upgrade", (req, socket, head) => {
    let pathname; try { pathname = new URL(req.url, "http://x").pathname; } catch { return; }
    if (pathname !== path) return;   // not ours — leave it for other upgrade handlers (mirror-ws etc.)
    const m = /^Bearer (.+)$/.exec(req.headers["authorization"] || "");
    if (!m || !safeEqual(m[1], secret)) { try { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); } catch {} socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (bridge && bridge.readyState === WebSocket.OPEN) { try { bridge.close(); } catch {} }
      bridge = ws; log("reverseTunnel: bridge connected");
      ws.on("message", (data, isBinary) => onBridgeMsg(data, isBinary));
      ws.on("close", () => { if (bridge === ws) bridge = null; log("reverseTunnel: bridge disconnected"); failAll(); });
      ws.on("error", () => {});
    });
  });

  function failAll() {
    for (const [, p] of pending) { if (!p.started) { try { p.res.writeHead(502); p.res.end("tunnel: bridge lost"); } catch {} p.resolve(false); } else { try { p.res.end(); } catch {} } }
    pending.clear();
  }
  function onBridgeMsg(data, isBinary) {
    if (isBinary) {                                   // [4-byte id][response body chunk]
      if (data.length < 4) return;
      const p = pending.get(data.readUInt32BE(0));
      if (p && !p.aborted) { try { p.res.write(data.subarray(4)); } catch {} }
      return;
    }
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    const p = pending.get(msg.id); if (!p) return;
    if (msg.t === "res") { if (!p.aborted) { try { p.res.writeHead(msg.status || 502, stripHop(msg.headers || {})); } catch {} } p.started = true; p.resolve(true); }
    else if (msg.t === "res-end") { try { p.res.end(); } catch {} pending.delete(msg.id); }
    else if (msg.t === "res-err") { if (!p.started) { try { p.res.writeHead(502); p.res.end("tunnel: upstream error"); } catch {} p.resolve(false); } else { try { p.res.end(); } catch {} } pending.delete(msg.id); }
  }

  return {
    isBridgeConnected: () => !!bridge && bridge.readyState === WebSocket.OPEN,
    /** Pipe a Node HTTP req/res through the tunnel to the bridge's target. Resolves true if it was relayed
     *  (response started), false if there's no bridge / it failed before any response — so the caller can fall
     *  back (e.g. to a read-only replica). Streams both directions; never buffers a whole body. */
    forward(req, res) {
      return new Promise((resolve) => {
        if (!bridge || bridge.readyState !== WebSocket.OPEN) return resolve(false);
        const id = nextId();
        const p = { res, started: false, aborted: false, resolve };
        pending.set(id, p);
        try { bridge.send(JSON.stringify({ t: "req", id, method: req.method, url: req.url, headers: stripHop(req.headers) })); }
        catch { pending.delete(id); return resolve(false); }
        req.on("data", (chunk) => { try { bridge.send(Buffer.concat([u32(id), toBuf(chunk)])); } catch {} });
        req.on("end", () => { try { bridge.send(JSON.stringify({ t: "req-end", id })); } catch {} });
        req.on("error", () => { try { bridge.send(JSON.stringify({ t: "abort", id })); } catch {} });
        res.on("close", () => { if (pending.has(id)) { p.aborted = true; try { bridge.send(JSON.stringify({ t: "abort", id })); } catch {} pending.delete(id); if (!p.started) resolve(false); } });
      });
    },
  };
}

// ---- BRIDGE side: runs on the NAT'd machine (AncientIntel), dials OUT to the server --------------------
export function startReverseTunnelBridge({ url, secret, targetOrigin = "http://127.0.0.1:4002", log = () => {}, reconnectMs = 3000 } = {}) {
  if (!url) throw new Error("startReverseTunnelBridge: `url` (wss://…/dmp-agent) is required");
  if (!secret || String(secret).length < 16) throw new Error("startReverseTunnelBridge: a `secret` (>= 16 chars) is required");
  const target = new URL(targetOrigin);
  const lib = target.protocol === "https:" ? https : http;
  const inflight = new Map();   // id -> upstream ClientRequest
  let ws = null, stopped = false;

  function connect() {
    if (stopped) return;
    ws = new WebSocket(url, { headers: { authorization: "Bearer " + secret }, maxPayload: 200 * 1024 * 1024 });
    ws.on("open", () => log("reverseTunnel bridge: connected to " + url));
    ws.on("message", (data, isBinary) => onServerMsg(data, isBinary));
    ws.on("close", () => { for (const [, up] of inflight) { try { up.destroy(); } catch {} } inflight.clear(); if (!stopped) setTimeout(connect, reconnectMs); });
    ws.on("error", () => { try { ws.close(); } catch {} });   // 'close' handles the reconnect
  }
  const send = (frame) => { try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame); } catch {} };

  function onServerMsg(data, isBinary) {
    if (isBinary) {                                   // [4-byte id][request body chunk]
      if (data.length < 4) return;
      const up = inflight.get(data.readUInt32BE(0));
      if (up) { try { up.write(data.subarray(4)); } catch {} }
      return;
    }
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.t === "req") startUpstream(msg);
    else if (msg.t === "req-end") { const up = inflight.get(msg.id); if (up) { try { up.end(); } catch {} } }
    else if (msg.t === "abort") { const up = inflight.get(msg.id); if (up) { try { up.destroy(); } catch {} } inflight.delete(msg.id); }
  }
  function startUpstream(msg) {
    const id = msg.id;
    const up = lib.request({
      protocol: target.protocol, hostname: target.hostname, port: target.port,
      method: msg.method, path: msg.url, headers: { ...stripHop(msg.headers || {}), host: target.host },
    }, (upRes) => {
      send(JSON.stringify({ t: "res", id, status: upRes.statusCode, headers: stripHop(upRes.headers) }));
      upRes.on("data", (chunk) => send(Buffer.concat([u32(id), toBuf(chunk)])));
      upRes.on("end", () => { send(JSON.stringify({ t: "res-end", id })); inflight.delete(id); });
      upRes.on("error", () => { send(JSON.stringify({ t: "res-err", id, message: "upstream stream error" })); inflight.delete(id); });
    });
    up.on("error", (e) => { send(JSON.stringify({ t: "res-err", id, message: String(e && e.message || e) })); inflight.delete(id); });
    inflight.set(id, up);
  }
  connect();
  return { stop() { stopped = true; try { ws && ws.close(); } catch {} for (const [, up] of inflight) { try { up.destroy(); } catch {} } inflight.clear(); } };
}
