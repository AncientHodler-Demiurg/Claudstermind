// node --test relay/integration.test.mjs
//
// The end-to-end proof: a REAL relay + a REAL bridge on one machine, exercising the
// whole reverse tunnel. Ancient sessions and the device secret are forged locally
// (no hub, no deploy) — everything up to the live deployment is verified here.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRelay } from "./server.mjs";
import { createBridge } from "../agent/agent.mjs";
import { signSession, SESSION_COOKIE } from "../dashboard/auth/session.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ORCH = resolve(__dir, "..", "orchestrator");
const DEVICE = "device-secret-at-least-32-chars-long!!";
const OIDC = {
  issuer: "https://hub.test", clientId: "c", clientSecret: "s",
  redirectUri: "https://brain.test/auth/callback",
  sessionSecret: "test-session-secret-at-least-32-chars!!", scope: "openid",
};

function tempWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "e2e-root-"));
  const dataDir = join(root, "data"); mkdirSync(dataDir);
  const brainDir = join(root, "brain"); mkdirSync(brainDir);
  const secretsDir = join(root, ".secrets"); mkdirSync(secretsDir);
  const repo = join(root, "repo"); mkdirSync(repo);
  const g = (...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  g("init", "-q"); g("symbolic-ref", "HEAD", "refs/heads/main");
  g("config", "user.email", "t@t.t"); g("config", "user.name", "t"); g("config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "a.txt"), "1"); g("add", "."); g("commit", "-qm", "init");
  writeFileSync(join(dataDir, "map.json"), JSON.stringify({ repos: [{ name: "repo", localPath: "repo" }] }));
  return { root, dataDir, brainDir, secretsDir, repo, g };
}

const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};

test("full tunnel: not-connected → connected → ancient executes → modern refused", async () => {
  const ws = tempWorkspace();
  const relay = createRelay({ oidc: OIDC, deviceSecret: DEVICE });
  await new Promise((r) => relay.server.listen(0, "127.0.0.1", r));
  const port = relay.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const ancient = `${SESSION_COOKIE}=${await signSession({ sub: "a", roles: ["ancient"], name: "Anc" }, OIDC.sessionSecret)}`;
  const modern = `${SESSION_COOKIE}=${await signSession({ sub: "m", roles: ["modern"], name: "Mod" }, OIDC.sessionSecret)}`;

  // 1. Before the bridge connects: not connected, and a mutation is refused with 503.
  let me = await (await fetch(`${base}/api/me`, { headers: { cookie: ancient } })).json();
  assert.equal(me.localConnected, false);
  assert.equal(me.canExecute, true);
  const early = await fetch(`${base}/api/git/commit`, { method: "POST", headers: { cookie: ancient, "content-type": "application/json" }, body: JSON.stringify({ localPath: "repo", message: "x" }) });
  assert.equal(early.status, 503, "a mutation while disconnected must be 503");

  // 2. Connect the bridge against the temp workspace.
  const bridge = createBridge({
    url: `ws://127.0.0.1:${port}/agent`, deviceSecret: DEVICE, allowInsecure: true,
    snapshotIntervalMs: 500,
    paths: { root: ws.root, dataDir: ws.dataDir, brainDir: ws.brainDir, secretsDir: ws.secretsDir, orchDir: ORCH },
    log: () => {},
  }).start();

  const connected = await waitFor(async () => (await (await fetch(`${base}/api/me`, { headers: { cookie: ancient } })).json()).localConnected);
  assert.equal(connected, true, "the relay should report the bridge connected");

  // 3. A read view is served from the pushed snapshot.
  const gotGit = await waitFor(async () => {
    const g = await (await fetch(`${base}/api/git`, { headers: { cookie: ancient } })).json();
    return Array.isArray(g.repos) && g.repos.length >= 1;
  });
  assert.equal(gotGit, true, "the snapshot's git view should reach the browser");

  // The receiving-end indicator: /api/me exposes how fresh the last snapshot is.
  const meConn = await (await fetch(`${base}/api/me`, { headers: { cookie: ancient } })).json();
  assert.equal(typeof meConn.snapshotAgeMs, "number", "connected → snapshotAgeMs should be a number for the 'updated Xs ago' indicator");
  assert.ok(meConn.snapshotAgeMs >= 0);

  // 4. An ancient command is relayed down and EXECUTED on the local repo.
  writeFileSync(join(ws.repo, "b.txt"), "new work");
  const res = await (await fetch(`${base}/api/git/commit`, { method: "POST", headers: { cookie: ancient, "content-type": "application/json" }, body: JSON.stringify({ localPath: "repo", message: "relayed commit" }) })).json();
  assert.equal(res.ok, true, `commit should succeed: ${JSON.stringify(res)}`);
  const log = spawnSync("git", ["-C", ws.repo, "log", "--oneline"], { encoding: "utf8" }).stdout;
  assert.match(log, /relayed commit/, "the commit must actually land in the local repo");

  // 5. A modern session is refused (403) on the same mutation.
  const mod = await fetch(`${base}/api/git/commit`, { method: "POST", headers: { cookie: modern, "content-type": "application/json" }, body: JSON.stringify({ localPath: "repo", message: "nope" }) });
  assert.equal(mod.status, 403, "a modern viewer must be refused");
  const modMe = await (await fetch(`${base}/api/me`, { headers: { cookie: modern } })).json();
  assert.equal(modMe.canExecute, false);
  assert.equal(modMe.canRead, true, "modern still reads");

  bridge.stop();
  await new Promise((r) => relay.server.close(r));
  rmSync(ws.root, { recursive: true, force: true });
});
