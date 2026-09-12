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

/* ---- a hook that cannot be executed is not a hook ---------------------------------------------- */
//
// The very first line of a real session:
//
//   PreCompact [${CLAUDE_PLUGIN_ROOT}/scripts/save-session-context.sh] failed:
//   /bin/sh: 1: .../plugins/bee/scripts/save-session-context.sh: Permission denied
//
// Measured: 0 of 18 vendored `.sh` files carried the executable bit — and neither do they upstream,
// because git only records the bit when a file was committed as 100755. So every hook bee and wasp
// register (SessionStart, UserPromptSubmit, PreToolUse on Bash, PostToolUse, Stop, SessionEnd) failed
// the moment it fired, silently apart from that one line.
//
// Upstream's packaging is upstream's business right up until we VENDOR it and ship it as part of
// ourselves ("it will just have it as part of itself"). Then it is ours: the sync marks them
// executable, and --check fails if they ever are not.
import { statSync as _statSync, readdirSync as _readdirSync } from "node:fs";
import { join as _join } from "node:path";

const _walk = (dir, out = []) => {
  for (const e of _readdirSync(dir, { withFileTypes: true })) {
    const p = _join(dir, e.name);
    if (e.isDirectory()) _walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
};

test("every vendored hook script is executable", () => {
  const root = new URL("../plugins/", import.meta.url).pathname;
  const shells = _walk(root).filter((f) => f.endsWith(".sh"));
  assert.ok(shells.length > 0, "there are hook scripts to check");
  const dead = shells.filter((f) => !(_statSync(f).mode & 0o111));
  assert.deepEqual(dead, [],
    "a hook the shell cannot execute fails with 'Permission denied' the first time it fires — " +
    "and every one of these is registered in a hooks.json we ship");
});

test("the sync restores the bit rather than trusting the source", () => {
  const sync = readFileSync(new URL("../scripts/sync-plugins.mjs", import.meta.url), "utf8");
  assert.match(sync, /chmodSync/, "cpSync copies the source's mode — and the source's mode is wrong");
  assert.match(sync, /\.sh\b/, "…for the shell scripts the hooks actually invoke");
  assert.match(sync, /deadHooks|notExecutable|0o111/, "--check must be able to fail on it too");
});
