#!/usr/bin/env node
// scripts/mobile-smoke.mjs — load the REAL dashboard in a phone-sized browser and fail on any
// console error. Written after "mobile view is broken, doesn't work": two independent crashes had
// shipped, and neither was reachable from the desk. Nothing in the suite had ever loaded the app at
// a mobile viewport, so nothing could have caught them.
//
//   node scripts/mobile-smoke.mjs                      # against http://127.0.0.1:3001
//   node scripts/mobile-smoke.mjs https://host  '#workspace,#workspace/pact'
//
// Exits 1 if any route throws, renders the error boundary, or logs a console error — so it can gate
// a deploy. Not part of `node --test`: it needs a running dashboard and a real Chromium, and a test
// that silently skips when either is missing is worse than a command you run on purpose.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const BASE = process.argv[2] || "http://127.0.0.1:3001";
const ROUTES = (process.argv[3] || "#overview,#workspace,#workspace/pact,#workspace/usage,#brain").split(",");
const BROWSERS = ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/snap/bin/chromium", "/usr/bin/google-chrome"];
const PORT = 9333 + (process.pid % 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const require = createRequire(import.meta.url);
let WebSocket;
try { WebSocket = require("ws"); } catch { console.error("needs the repo's `ws` dependency — run from the repo root"); process.exit(1); }

const bin = BROWSERS.find((b) => { try { return require("node:fs").existsSync(b); } catch { return false; } });
if (!bin) { console.error("no Chromium found — install one, or point BROWSERS at it"); process.exit(1); }

const chrome = spawn(bin, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox",
  "--disable-gpu", `--user-data-dir=/tmp/cm-mobile-smoke-${process.pid}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => { try { chrome.kill(); } catch {} });

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(300);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
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
  if (m.method === "Runtime.exceptionThrown") {
    const e = m.params.exceptionDetails;
    errors.push("EXCEPTION: " + (e.exception?.description || e.text));
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("CONSOLE: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    // A 404 on an asset is exactly how the chat-shell package went missing through the relay.
    errors.push("NETWORK/LOG: " + m.params.entry.text + " " + (m.params.entry.url || ""));
  }
});
await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
// A real phone, not a narrow desktop: `mobile: true` + touch is what flips the app's own
// `(pointer: coarse)` media query, and the mobile-only branches live behind it.
await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: BASE + "/" });
await sleep(6000);

const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.value;
let bad = 0;
for (const g of ["ChatShell", "ChatShellUI"]) {
  const t = await evaluate(`typeof window.${g}`);
  if (t !== "object") { console.log(`✗ window.${g} is ${t} — the chat box package did not load`); bad++; }
}
for (const route of ROUTES) {
  const before = errors.length;
  await send("Runtime.evaluate", { expression: `location.hash = '${route}'` });
  await sleep(6000);
  const boundary = await evaluate("document.querySelector('.conn-lost-title')?.textContent || ''");
  const failed = boundary || errors.length > before;
  if (failed) bad++;
  console.log(`${failed ? "✗" : "✓"} ${route}${boundary ? "  → " + boundary : ""}`);
}
if (errors.length) { console.log("\n--- console ---"); errors.forEach((e) => console.log("  " + e.split("\n")[0].slice(0, 200))); }
console.log(bad ? `\n${bad} failing route(s)` : "\nall routes clean");
process.exit(bad ? 1 : 0);
