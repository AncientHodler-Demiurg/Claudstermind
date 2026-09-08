// node --test relay/staticAssets.test.mjs
//
// WHY THIS EXISTS. Reported from a phone: the online Workspace showed "This view couldn't load —
// Cannot read properties of undefined (reading 'mount')". The chat box IS the package
// @ancientpantheon/claude-chat-shell, and index.html loads it from /chat-shell/*. The DASHBOARD
// serves that prefix straight out of packages/claude-chat-shell/src (dashboard/server.mjs) instead of
// copying the files into public/, so the two can never drift — but the RELAY only ever served
// public/, and its Docker image did not even contain the package. Through the online gateway all
// three files 404'd, `window.ChatShellUI` never defined, and every Core pane threw on mount.
//
// It was invisible from the desk (the desktop talks to localhost:3001, which has the route) and
// INTERMITTENT on the phone: with a live mirror cookie the relay's mirror fallback proxied the misses
// down the tunnel to the work machine, so the same page sometimes worked.
//
// The generic lesson is the test: every absolute asset index.html loads must be servable by EVERY
// server that serves index.html, and shipped in the image that runs it. One list, checked three ways.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRelay } from "./server.mjs";
import { signSession, SESSION_COOKIE } from "../dashboard/auth/session.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const PUBLIC = join(ROOT, "dashboard", "public");
const INDEX = readFileSync(join(PUBLIC, "index.html"), "utf8");
const DOCKERFILE = readFileSync(join(__dir, "Dockerfile"), "utf8");
const OIDC = {
  issuer: "https://hub.test", clientId: "c", clientSecret: "s",
  redirectUri: "https://brain.test/auth/callback",
  sessionSecret: "test-session-secret-at-least-32-chars!!", scope: "openid",
};

// Every same-origin asset the page pulls in — the exact list a cold load needs to boot.
function pageAssets(html) {
  const out = [];
  const re = /(?:src|href)="(\/[^"#?]+)"/g;
  let m;
  while ((m = re.exec(html))) if (!m[1].startsWith("/api/")) out.push(m[1]);
  return [...new Set(out)];
}

test("every asset index.html loads exists on disk — in public/, or behind a route that maps to a real file", () => {
  const missing = [];
  for (const path of pageAssets(INDEX)) {
    if (existsSync(join(PUBLIC, "." + path))) continue;
    // Not in public/ → it must be a routed prefix. The only one today is the chat-shell package.
    if (path.startsWith("/chat-shell/") &&
        existsSync(join(ROOT, "packages", "claude-chat-shell", "src", path.slice("/chat-shell".length)))) continue;
    missing.push(path);
  }
  assert.deepEqual(missing, [], "an asset the page loads must resolve somewhere, or the page boots half-built");
});

test("the relay routes every prefix the dashboard routes — a route on one server only is a 404 on the other", () => {
  const dash = readFileSync(join(ROOT, "dashboard", "server.mjs"), "utf8");
  const prefixes = [...dash.matchAll(/path\.startsWith\("(\/[a-z-]+\/)"\)/g)].map((m) => m[1]);
  const relaySrc = readFileSync(join(__dir, "server.mjs"), "utf8");
  // /mirror/ is the dashboard's own local-only feature and is handled by the relay's tunnel, not as
  // a static prefix; every other routed prefix must exist on both.
  const shared = prefixes.filter((p) => p !== "/mirror/");
  for (const p of shared) {
    assert.ok(relaySrc.includes(`path.startsWith("${p}")`),
      `${p} is served by the dashboard but not by the relay — through the online gateway it 404s`);
  }
  assert.ok(shared.includes("/chat-shell/"), "the chat-shell prefix is the one this test was written for");
});

test("the relay IMAGE ships every directory the relay serves from", () => {
  // Serving a directory the image doesn't contain is the same 404 with a longer diagnosis.
  assert.match(DOCKERFILE, /^COPY dashboard\/public\/ /m, "the dashboard's static files");
  assert.match(DOCKERFILE, /^COPY packages\/claude-chat-shell\/src\/ /m,
    "the chat shell package — index.html loads it and the relay now serves it");
});

test("a real relay serves the chat shell package, byte for byte, with no mirror cookie in play", async () => {
  const relay = createRelay({ oidc: OIDC, deviceSecret: "device-secret-at-least-32-chars-long!!" });
  await new Promise((r) => relay.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${relay.server.address().port}`;
  const cookie = `${SESSION_COOKIE}=${await signSession({ sub: "a", roles: ["ancient"], name: "Anc" }, OIDC.sessionSecret)}`;
  try {
    for (const file of ["chat-shell.js", "chat-shell-ui.js", "chat-shell.css"]) {
      const res = await fetch(`${base}/chat-shell/${file}`, { headers: { cookie } });
      assert.equal(res.status, 200, `/chat-shell/${file} must be served by the relay`);
      const body = await res.text();
      assert.equal(body, readFileSync(join(ROOT, "packages", "claude-chat-shell", "src", file), "utf8"),
        "the relay must serve the package's own bytes — a copy is a second version that drifts");
    }
    // The one that actually broke the phone: the UI module must define the global app.js mounts.
    const ui = await (await fetch(`${base}/chat-shell/chat-shell-ui.js`, { headers: { cookie } })).text();
    assert.match(ui, /\.ChatShellUI = API;/, "without this global (app.js calls window.ChatShellUI.mount) every Core pane throws");
  } finally {
    await new Promise((r) => relay.server.close(r));
  }
});
