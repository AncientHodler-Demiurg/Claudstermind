// node --test lib/pactRun.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pactRunSpec, resolvePactBin } from "./pactRun.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pactrun-"));
  mkdirSync(join(root, "REPL"));
  writeFileSync(join(root, "REPL", "Stage00.repl"), "(print 1)\n");
  writeFileSync(join(root, "REPL", "notes.md"), "# not runnable\n");
  return root;
}

test("pactRunSpec builds bin/args/cwd for a .repl (basename arg, cwd = its dir)", () => {
  const root = fixture();
  const s = pactRunSpec(root, "REPL/Stage00.repl", { bin: "pact" });
  assert.equal(s.ok, true);
  assert.equal(s.bin, "pact");
  assert.deepEqual(s.args, ["Stage00.repl"]);
  assert.equal(s.cwd, join(root, "REPL"));
  assert.equal(s.file, "REPL/Stage00.repl");
  rmSync(root, { recursive: true, force: true });
});

test("pactRunSpec refuses non-.repl files, traversal, and missing files", () => {
  const root = fixture();
  assert.equal(pactRunSpec(root, "REPL/notes.md", { bin: "pact" }).ok, false);
  assert.equal(pactRunSpec(root, "../../etc/evil.repl", { bin: "pact" }).ok, false);
  assert.equal(pactRunSpec(root, "REPL/nope.repl", { bin: "pact" }).ok, false);
  rmSync(root, { recursive: true, force: true });
});

test("resolvePactBin prefers $PACT_BIN, then ~/.local/bin/pact, else bare 'pact'", () => {
  const exists = (p) => p === "/opt/custom/pact" || p === "/home/me/.local/bin/pact";
  assert.equal(resolvePactBin({ PACT_BIN: "/opt/custom/pact" }, "/home/me", exists), "/opt/custom/pact");
  assert.equal(resolvePactBin({}, "/home/me", exists), "/home/me/.local/bin/pact");
  assert.equal(resolvePactBin({}, "/home/nobody", () => false), "pact");
});
