#!/usr/bin/env node
// scripts/graph-smoke.mjs — Ch.3.4's "verified with a real run" requirement: load graph.html in
// a REAL headless Chromium (same raw-CDP-over-WebSocket approach as scripts/mobile-smoke.mjs,
// reused rather than re-invented) and confirm vis-network actually rendered the fixture graph —
// not just that the file exists or that the pure transform unit-tests pass.
//
// Self-contained: serves dashboard/public/ with a throwaway static server on a free port (never
// the real dashboard — no secrets dir, no auth, nothing to interrupt) and passes the fixture
// graph as a `data:` URL query param, so no fixture file is ever written into dashboard/public/.
//
//   node scripts/graph-smoke.mjs
//
// Exits 1 on any console error/exception, a missing render, or a node/edge count mismatch.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dir, "..", "dashboard", "public");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const require = createRequire(import.meta.url);
let WebSocket;
try { WebSocket = require("ws"); } catch { console.error("needs the repo's `ws` dependency — run from the repo root"); process.exit(1); }

const BROWSERS = ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/snap/bin/chromium", "/usr/bin/google-chrome"];
const bin = BROWSERS.find((b) => { try { return require("node:fs").existsSync(b); } catch { return false; } });
if (!bin) { console.error("no Chromium found — install one, or point BROWSERS at it"); process.exit(1); }

// --- the fixture graph: one node of each real type + an external placeholder, one edge of each confidence tag
const FIXTURE = {
  directed: true, multigraph: true, graph: {},
  nodes: [
    { id: "file:a.js", type: "file", name: "a.js" },
    { id: "function:a.js#foo", type: "function", name: "foo" },
    { id: "class:a.js#Bar", type: "class", name: "Bar" },
    { id: "module:lodash", type: "external", name: "module:lodash" },
  ],
  links: [
    { source: "file:a.js", target: "function:a.js#foo", key: "k1", kind: "contains", confidence: "EXTRACTED" },
    { source: "file:a.js", target: "class:a.js#Bar", key: "k2", kind: "contains", confidence: "EXTRACTED" },
    { source: "file:a.js", target: "module:lodash", key: "k3", kind: "imports", confidence: "INFERRED" },
    { source: "function:a.js#foo", target: "function:a.js#foo", key: "k4", kind: "calls", confidence: "AMBIGUOUS" },
  ],
};
const EXPECTED_STATUS = "4 nodes, 4 links";

// --- a throwaway static server over dashboard/public/, nothing else ---------------------------
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const abs = join(PUBLIC_DIR, "." + (p === "/" ? "/graph.html" : p));
  if (!abs.startsWith(PUBLIC_DIR)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(abs);
    res.writeHead(200, { "content-type": MIME[extname(abs)] || "application/octet-stream" }).end(data);
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const httpPort = server.address().port;
process.on("exit", () => { try { server.close(); } catch {} });

// --- headless chromium over raw CDP, same pattern as scripts/mobile-smoke.mjs -----------------
const cdpPort = 9444 + (process.pid % 500);
const chrome = spawn(bin, ["--headless=new", `--remote-debugging-port=${cdpPort}`, "--no-sandbox",
  "--disable-gpu", `--user-data-dir=/tmp/cm-graph-smoke-${process.pid}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => { try { chrome.kill(); } catch {} });

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(300);
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
}
if (!target) { console.error("browser never came up"); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const errors = [];
await new Promise((r) => ws.on("open", r));
ws.on("message", (d) => {
  const m = JSON.parse(d);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push("EXCEPTION: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("CONSOLE: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
});
await send("Runtime.enable"); await send("Page.enable");

const dataUrl = "data:application/json;base64," + Buffer.from(JSON.stringify(FIXTURE)).toString("base64");
const pageUrl = `http://127.0.0.1:${httpPort}/graph.html?src=${encodeURIComponent(dataUrl)}`;
await send("Page.navigate", { url: pageUrl });
await sleep(4000);

const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.value;
const statusText = await evaluate("document.getElementById('status').textContent");
const hasNetwork = await evaluate("typeof window.__graphNetwork === 'object' && window.__graphNetwork !== null");
const canvas = await evaluate("(function(){ var c = document.querySelector('#network canvas'); return c ? { w: c.width, h: c.height } : null; })()");

let bad = 0;
const check = (ok, label) => { console.log(`${ok ? "✓" : "✗"} ${label}`); if (!ok) bad++; };
check(statusText === EXPECTED_STATUS, `status text is "${EXPECTED_STATUS}" (got ${JSON.stringify(statusText)})`);
check(hasNetwork === true, "window.__graphNetwork was constructed (a real vis.Network instance)");
check(!!canvas && canvas.w > 0 && canvas.h > 0, `vis-network rendered a non-empty canvas (got ${JSON.stringify(canvas)})`);
check(errors.length === 0, "no console errors/exceptions" + (errors.length ? ":\n  " + errors.join("\n  ") : ""));

console.log(bad ? `\n${bad} check(s) failed` : "\nall checks passed — graph.html renders a real fixture graph in a real browser");
process.exit(bad ? 1 : 0);
