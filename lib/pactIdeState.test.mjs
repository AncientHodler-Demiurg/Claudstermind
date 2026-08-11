// node --test lib/pactIdeState.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PACT_WORKSPACE_ID, MAX_IDE_STATE_BYTES, ideStatePath, readIdeState, writeIdeState,
} from "./pactIdeState.mjs";

function tdir() { return mkdtempSync(join(tmpdir(), "pact-ide-")); }

test("ideStatePath lands under the Pact workspace slug dir", () => {
  const dir = "/tmp/ws";
  const p = ideStatePath(dir);
  assert.equal(p, join(dir, "OuroborosNetwork~2f~_onchain~2f~Ouronet@main", "_ide-state.json"));
  assert.equal(PACT_WORKSPACE_ID, "OuroborosNetwork/_onchain/Ouronet@main");
});

test("write then read round-trips the opaque blob", () => {
  const dir = tdir();
  const state = { editor: { groups: [{ tabs: ["a.pact"], active: "a.pact", fontPx: 13, weight: 1 }], activeId: 1 },
    chat: { tabs: [{ key: "k1", name: "Chat 1", draft: "hi" }], activeId: 1 }, collapse: "chat", chatNames: { k1: "Chat 1" } };
  const w = writeIdeState(dir, state);
  assert.equal(w.ok, true);
  assert.deepEqual(readIdeState(dir), state);
  rmSync(dir, { recursive: true, force: true });
});

test("read returns {} for a missing file", () => {
  const dir = tdir();
  assert.deepEqual(readIdeState(dir), {});
  rmSync(dir, { recursive: true, force: true });
});

test("read returns {} for corrupt JSON, never throws", () => {
  const dir = tdir();
  mkdirSync(join(dir, "OuroborosNetwork~2f~_onchain~2f~Ouronet@main"), { recursive: true });
  writeFileSync(ideStatePath(dir), "{ not json ]]", "utf8");
  assert.deepEqual(readIdeState(dir), {});
  rmSync(dir, { recursive: true, force: true });
});

test("read returns {} when the JSON is an array, not an object", () => {
  const dir = tdir();
  mkdirSync(join(dir, "OuroborosNetwork~2f~_onchain~2f~Ouronet@main"), { recursive: true });
  writeFileSync(ideStatePath(dir), "[1,2,3]", "utf8");
  assert.deepEqual(readIdeState(dir), {});
  rmSync(dir, { recursive: true, force: true });
});

test("write refuses a non-object state", () => {
  const dir = tdir();
  assert.equal(writeIdeState(dir, null).ok, false);
  assert.equal(writeIdeState(dir, [1, 2]).ok, false);
  assert.equal(writeIdeState(dir, "nope").ok, false);
  rmSync(dir, { recursive: true, force: true });
});

test("write refuses a blob over the size cap", () => {
  const dir = tdir();
  const big = { blob: "x".repeat(MAX_IDE_STATE_BYTES + 10) };
  const w = writeIdeState(dir, big);
  assert.equal(w.ok, false);
  assert.equal(w.tooLarge, true);
  // nothing was written
  assert.deepEqual(readIdeState(dir), {});
  rmSync(dir, { recursive: true, force: true });
});

test("write creates the workspace dir when absent", () => {
  const dir = tdir();
  assert.equal(writeIdeState(dir, { a: 1 }).ok, true);
  const onDisk = JSON.parse(readFileSync(ideStatePath(dir), "utf8"));
  assert.deepEqual(onDisk, { a: 1 });
  rmSync(dir, { recursive: true, force: true });
});

test("write with no transcript dir fails cleanly", () => {
  assert.equal(writeIdeState(null, { a: 1 }).ok, false);
  assert.deepEqual(readIdeState(null), {});
});
