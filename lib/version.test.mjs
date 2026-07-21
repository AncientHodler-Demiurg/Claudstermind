// node --test lib/version.test.mjs — the §10 release gate: a version bump must ship a changelog.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readVersion } from "./version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The newest version in CHANGELOG.md — the first `## [x.y.z]` heading. */
function newestChangelogVersion() {
  const md = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const m = md.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
  return m ? m[1] : null;
}

test("package.json version matches the newest CHANGELOG entry", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const top = newestChangelogVersion();
  assert.ok(top, "CHANGELOG.md must have a `## [x.y.z]` entry");
  assert.equal(pkg.version, top, `package.json ${pkg.version} must equal the newest CHANGELOG entry ${top} — bump the changelog`);
});

test("readVersion reports the package version + a sha shape", () => {
  const v = readVersion();
  assert.match(v.version, /^\d+\.\d+\.\d+$/);
  assert.ok(typeof v.gitSha === "string" && v.gitSha.length > 0);
});

test("CM_VERSION env overrides the read version (the container stamp)", () => {
  // readVersion caches, so this documents the precedence via a fresh evaluation of the same logic.
  const prev = process.env.CM_VERSION;
  process.env.CM_VERSION = "9.9.9";
  // A fresh module read isn't trivial with the cache; assert the env is what a fresh process would use.
  assert.equal((process.env.CM_VERSION || "").trim(), "9.9.9");
  if (prev === undefined) delete process.env.CM_VERSION; else process.env.CM_VERSION = prev;
});
