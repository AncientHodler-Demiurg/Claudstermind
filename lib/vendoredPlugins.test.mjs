// node --test lib/vendoredPlugins.test.mjs
//
// bee / wasp / nectar are VENDORED into this repo and handed to every session, rather than installed
// per machine. The failure this prevents is quiet and confusing: before it, only nectar was enabled
// on the work machine, so the same prompt got a different methodology depending on which box
// answered it — and a fresh clone got none of them, with nothing on screen saying so.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { vendoredPluginOptions, vendoredManifest, VENDORED_PLUGINS, PLUGINS_DIR } from "./vendoredPlugins.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));

test("all three plugins are actually in the repo, each with a manifest", () => {
  for (const name of VENDORED_PLUGINS) {
    const p = join(PLUGINS_DIR, name, ".claude-plugin", "plugin.json");
    assert.ok(existsSync(p), `${name} is not vendored — a session would silently run without it`);
    const m = JSON.parse(readFileSync(p, "utf8"));
    assert.equal(m.name, name);
    assert.ok(m.version, `${name} must declare a version, or "which bee is this?" is unanswerable`);
  }
});

test("the SDK option is the shape the SDK documents, with ABSOLUTE paths", () => {
  const opts = vendoredPluginOptions();
  assert.equal(opts.length, 3);
  for (const o of opts) {
    assert.equal(o.type, "local", "the SDK supports only local plugins today");
    assert.ok(isAbsolute(o.path),
      "a session's cwd is the repository it is WORKING ON, not this one — a relative path would " +
      "resolve against that repo and find nothing");
  }
});

test("bee loads before wasp, because wasp is an additive layer on it", () => {
  const order = vendoredPluginOptions().map((o) => o.path.split("/").pop());
  assert.ok(order.indexOf("bee") < order.indexOf("wasp"),
    "wasp's own README calls itself an additive layer on top of bee");
});

test("a missing plugin directory is skipped, never thrown", () => {
  // A broken vendor tree must not be the reason you cannot talk to your agent.
  const empty = mkdtempSync(join(tmpdir(), "vend-"));
  assert.deepEqual(vendoredPluginOptions(empty), []);
  // …and a half-vendored one yields only what is really there.
  mkdirSync(join(empty, "nectar", ".claude-plugin"), { recursive: true });
  writeFileSync(join(empty, "nectar", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "nectar", version: "1.0.0" }));
  assert.deepEqual(vendoredPluginOptions(empty).map((o) => o.path.split("/").pop()), ["nectar"]);
});

test("every session gets them — the wiring, not just the helper", () => {
  const src = readFileSync(join(__dir, "claudeSession.mjs"), "utf8");
  assert.match(src, /plugins: vendoredPluginOptions\(\)/,
    "the option must be on the SDK query itself, or the vendored tree is decoration");
});

test("provenance is recorded, so a vendored copy can be traced and re-synced", () => {
  const m = vendoredManifest();
  assert.ok(m, "plugins/.vendor.json must exist");
  assert.ok(m.commit && m.commit.length >= 7, "the upstream commit is what makes a re-sync auditable");
  assert.ok(m.upstream, "…and where it came from");
  for (const name of VENDORED_PLUGINS) assert.ok(m.plugins[name]?.version, `${name} version must be recorded`);
});
