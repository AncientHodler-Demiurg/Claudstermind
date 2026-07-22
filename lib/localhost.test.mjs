// node --test lib/localhost.test.mjs — resolving, reading and supervising the LocalHost aggregator.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  localhostDir, readLocalRegistry, aggregatorPort, registryProjects, mirrorablePorts,
  probePort, createAggregator, DEFAULT_AGG_PORT,
} from "./localhost.mjs";

// A throwaway workspace root holding a LocalHost/registry.json, like $ROOT does.
function fakeRoot(registry, dirName = "LocalHost") {
  const root = mkdtempSync(join(tmpdir(), "lh-root-"));
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  if (registry) writeFileSync(join(dir, "registry.json"), JSON.stringify(registry), "utf8");
  return { root, dir };
}

const SAMPLE = {
  aggregator: { key: "localhost-aggregator", name: "LocalHost Aggregator", port: 3000 },
  projects: [
    { key: "claudstermind", name: "Claudstermind Dashboard", group: "Meta", port: 3001, managed: true },
    { key: "stoachain-website", name: "StoaChain Website", group: "StoaChain", port: 3002, managed: true },
    { key: "live-only", name: "Live only", live: "https://example.com" },   // no port — filtered out
  ],
};

test("localhostDir finds the sibling repo by its registry.json", () => {
  const { root, dir } = fakeRoot(SAMPLE);
  try { assert.equal(localhostDir(root), dir); } finally { rmSync(root, { recursive: true, force: true }); }
});

test("localhostDir returns null when LocalHost is absent — the dashboard must still boot", () => {
  const root = mkdtempSync(join(tmpdir(), "lh-empty-"));
  try { assert.equal(localhostDir(root), null); } finally { rmSync(root, { recursive: true, force: true }); }
});

test("localhostDir tolerates lowercase folder names on case-sensitive filesystems", () => {
  // The Linux target is case-sensitive; a tar extracted as `localhost/` must still resolve.
  // Compared case-insensitively because on Windows every candidate names the same directory.
  const { root, dir } = fakeRoot(SAMPLE, "localhost");
  try {
    assert.equal(String(localhostDir(root)).toLowerCase(), dir.toLowerCase());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("localhostDir honours the CLAUDSTERMIND_LOCALHOST_DIR override", () => {
  const { root, dir } = fakeRoot(SAMPLE);
  const other = mkdtempSync(join(tmpdir(), "lh-other-"));
  process.env.CLAUDSTERMIND_LOCALHOST_DIR = dir;
  try {
    assert.equal(localhostDir(other), dir);            // resolved from the override, not the root
    process.env.CLAUDSTERMIND_LOCALHOST_DIR = other;   // no registry.json there
    assert.equal(localhostDir(root), null);            // an override that doesn't hold up isn't silently ignored
  } finally {
    delete process.env.CLAUDSTERMIND_LOCALHOST_DIR;
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test("registry reads reflect what is on disk right now, with no cache to go stale", () => {
  const { root, dir } = fakeRoot(SAMPLE);
  try {
    assert.equal(registryProjects(root).length, 2);
    // Edit the LocalHost repo the way the human would — the next read must see it.
    const grown = { ...SAMPLE, projects: [...SAMPLE.projects, { key: "new", name: "New", port: 3009 }] };
    writeFileSync(join(dir, "registry.json"), JSON.stringify(grown), "utf8");
    const after = registryProjects(root);
    assert.equal(after.length, 3);
    assert.equal(after.at(-1).key, "new");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("registryProjects drops live-only entries and carries the display fields", () => {
  const { root } = fakeRoot(SAMPLE);
  try {
    const ps = registryProjects(root);
    assert.deepEqual(ps.map((p) => p.key), ["claudstermind", "stoachain-website"]);
    assert.deepEqual(ps[0], { key: "claudstermind", name: "Claudstermind Dashboard", port: 3001, group: "Meta", managed: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mirrorablePorts includes the aggregator, which lives outside `projects`", () => {
  // Regression: building this list from `projects` alone made the aggregator itself
  // un-mirrorable — its own page loaded, then every /api/* call it made 404'd.
  const { root } = fakeRoot(SAMPLE);
  try {
    const ports = mirrorablePorts(root);
    assert.ok(ports.includes(3000), "the aggregator's own port must be reachable");
    assert.ok(ports.includes(3001) && ports.includes(3002));
    assert.equal(new Set(ports).size, ports.length, "no duplicates when a project shares the aggregator port");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("aggregatorPort comes from the registry, falling back when it's missing or unreadable", () => {
  const a = fakeRoot({ ...SAMPLE, aggregator: { port: 3456 } });
  const b = fakeRoot({ projects: [] });                       // registry without an aggregator block
  const c = mkdtempSync(join(tmpdir(), "lh-none-"));          // no LocalHost at all
  try {
    assert.equal(aggregatorPort(a.root), 3456);
    assert.equal(aggregatorPort(b.root), DEFAULT_AGG_PORT);
    assert.equal(aggregatorPort(c), DEFAULT_AGG_PORT);
    assert.equal(readLocalRegistry(c), null);
  } finally {
    rmSync(a.root, { recursive: true, force: true });
    rmSync(b.root, { recursive: true, force: true });
    rmSync(c, { recursive: true, force: true });
  }
});

test("readLocalRegistry survives a malformed registry.json instead of throwing", () => {
  const { root, dir } = fakeRoot(SAMPLE);
  try {
    writeFileSync(join(dir, "registry.json"), "{ not json", "utf8");
    assert.equal(readLocalRegistry(root), null);
    assert.deepEqual(registryProjects(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("probePort detects a listener and reports a free port as down", async () => {
  const srv = http.createServer((_, res) => res.end("ok"));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  try {
    assert.equal(await probePort(port), true);
    assert.equal(await probePort(0), false);
  } finally { await new Promise((r) => srv.close(r)); }
});

test("status reports a missing LocalHost as absent rather than failing", async () => {
  const root = mkdtempSync(join(tmpdir(), "lh-absent-"));
  try {
    const agg = createAggregator({ root });
    const s = await agg.status();
    assert.equal(s.present, false);
    assert.equal(s.running, false);
    assert.equal(s.owned, false);
    const r = await agg.restart();
    assert.equal(r.ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("ensure ADOPTS an aggregator that is already listening — it never double-binds", async () => {
  // Stand a server on an ephemeral port and point a registry at it, exactly like a
  // human-started `npm start` in the LocalHost repo.
  const srv = http.createServer((_, res) => res.end("ok"));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const { root } = fakeRoot({ aggregator: { port }, projects: [] });
  try {
    const agg = createAggregator({ root });
    const s = await agg.ensure();
    assert.equal(s.running, true);
    assert.equal(s.owned, false, "an externally started aggregator must not be claimed as ours");
    assert.equal(s.port, port);
    assert.equal(s.url, `http://localhost:${port}`);
    // Restarting something we don't own must refuse, not kill a stranger's process.
    const r = await agg.restart();
    assert.equal(r.ok, false);
    assert.match(r.error, /outside Claudstermind/);
  } finally {
    await new Promise((r) => srv.close(r));
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensure SPAWNS the aggregator when the port is free, and stop tears it down", async () => {
  const { root, dir } = fakeRoot(null);
  // A stand-in for LocalHost/server.mjs: reads its own registry for the port, like the real one.
  writeFileSync(join(dir, "server.mjs"), `
    import http from "node:http";
    import { readFileSync } from "node:fs";
    import { dirname, join } from "node:path";
    import { fileURLToPath } from "node:url";
    const d = dirname(fileURLToPath(import.meta.url));
    const reg = JSON.parse(readFileSync(join(d, "registry.json"), "utf8"));
    http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    }).listen(reg.aggregator.port, "127.0.0.1");
  `, "utf8");
  // Grab a free port by binding and releasing it.
  const probe = http.createServer(); await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port; await new Promise((r) => probe.close(r));
  writeFileSync(join(dir, "registry.json"), JSON.stringify({ aggregator: { port }, projects: [] }), "utf8");

  const agg = createAggregator({ root });
  try {
    const s = await agg.ensure();
    assert.equal(s.running, true);
    assert.equal(s.owned, true, "we spawned it, so we own it");
    assert.ok(s.pid);
    // The API helper reaches the child's own HTTP surface.
    const r = await agg.api("/api/status");
    assert.equal(r.ok, true);
    assert.equal(r.data.path, "/api/status");
    assert.ok(agg.logs().length > 0, "boot output is captured for the panel");
  } finally {
    agg.stop();
    // Windows keeps a handle on the child's cwd until it has actually exited, so the
    // temp tree can't be removed the instant we send the kill.
    await new Promise((r) => setTimeout(r, 400));
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("api returns a structured failure instead of throwing when nothing is listening", async () => {
  const { root } = fakeRoot({ aggregator: { port: 1 }, projects: [] });   // port 1: never ours
  try {
    const agg = createAggregator({ root });
    const r = await agg.api("/api/status", { timeoutMs: 1500 });
    assert.equal(r.ok, false);
    assert.equal(r.status, 502);
    assert.ok(r.error);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
