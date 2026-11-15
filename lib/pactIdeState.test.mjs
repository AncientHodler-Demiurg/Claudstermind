// node --test lib/pactIdeState.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PACT_WORKSPACE_ID, MAX_IDE_STATE_BYTES, SEED_CHAT_NAMES, ideStatePath, readIdeState, writeIdeState, mergeForeignTabs,
} from "./pactIdeState.mjs";

function tdir() { return mkdtempSync(join(tmpdir(), "pact-ide-")); }
// readIdeState always merges the pre-seeded chat names in; a "fresh" read is exactly the seeds.
const SEEDS = () => ({ chatNames: { ...SEED_CHAT_NAMES } });

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
  // Everything authored survives; readIdeState additionally merges the seed names into chatNames.
  const back = readIdeState(dir);
  assert.equal(back.collapse, "chat");
  assert.deepEqual(back.editor, state.editor);
  assert.deepEqual(back.chat, state.chat);
  assert.equal(back.chatNames.k1, "Chat 1");                        // authored name kept
  assert.equal(back.chatNames["9b41003b-b616-4ac3-9b2b-780f3b229662"], "Ouronet Pact audit");   // seed merged
  rmSync(dir, { recursive: true, force: true });
});

test("read returns just the seed names for a missing file", () => {
  const dir = tdir();
  assert.deepEqual(readIdeState(dir), SEEDS());
  rmSync(dir, { recursive: true, force: true });
});

test("read returns seed-only for corrupt JSON, never throws", () => {
  const dir = tdir();
  mkdirSync(join(dir, "OuroborosNetwork~2f~_onchain~2f~Ouronet@main"), { recursive: true });
  writeFileSync(ideStatePath(dir), "{ not json ]]", "utf8");
  assert.deepEqual(readIdeState(dir), SEEDS());
  rmSync(dir, { recursive: true, force: true });
});

test("read returns seed-only when the JSON is an array, not an object", () => {
  const dir = tdir();
  mkdirSync(join(dir, "OuroborosNetwork~2f~_onchain~2f~Ouronet@main"), { recursive: true });
  writeFileSync(ideStatePath(dir), "[1,2,3]", "utf8");
  assert.deepEqual(readIdeState(dir), SEEDS());
  rmSync(dir, { recursive: true, force: true });
});

test("the recovered chat is pre-seeded as 'Ouronet Pact audit' but a user rename wins", () => {
  const dir = tdir();
  const recovered = "9b41003b-b616-4ac3-9b2b-780f3b229662";
  // Fresh: the seed shows.
  assert.equal(readIdeState(dir).chatNames[recovered], "Ouronet Pact audit");
  // After the user renames it, the stored name is NOT clobbered by the seed on the next read.
  writeIdeState(dir, { chatNames: { [recovered]: "my own name" } });
  assert.equal(readIdeState(dir).chatNames[recovered], "my own name");
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
  // nothing was written — read falls back to the seed-only default
  assert.deepEqual(readIdeState(dir), SEEDS());
  rmSync(dir, { recursive: true, force: true });
});

test("write creates the workspace dir when absent", () => {
  const dir = tdir();
  assert.equal(writeIdeState(dir, { a: 1 }).ok, true);
  const onDisk = JSON.parse(readFileSync(ideStatePath(dir), "utf8"));
  assert.deepEqual(onDisk, { a: 1 });
  rmSync(dir, { recursive: true, force: true });
});

test("write with no transcript dir fails cleanly; read still yields the seed names", () => {
  assert.equal(writeIdeState(null, { a: 1 }).ok, false);
  assert.deepEqual(readIdeState(null), SEEDS());
});

// ===== THE LIVE BUG: "if i have two chats opened on pact workspace, and i reload the page, only the
// master chat is kept, the other one is closed" — caught in the act (a real workspace's _ide-state.json
// observed dropping from 3 tabs to 1 between two reads, no deliberate close in between). Root cause: a
// stale client (open since before the other tabs existed) eventually PUTs its own one-tab snapshot,
// and a PUT is a blind full-replace — straight data loss, no trail. mergeForeignTabs is the pure guard;
// these pin it directly plus its wiring into writeIdeState via `opts.knownKeys`.

test("mergeForeignTabs: a tab on disk that's missing from BOTH incoming and knownKeys is foreign — protected", () => {
  const current = { chat: { tabs: [{ key: "a", name: "Master" }, { key: "b", name: "Chat 2" }, { key: "c", name: "Explorer" }], activeIndex: 2 } };
  const incoming = { chat: { tabs: [{ key: "a", name: "Master" }], activeIndex: 0 } };   // a stale client that never heard of b/c
  const r = mergeForeignTabs(current, incoming, ["a"]);   // this writer has only ever known about "a"
  assert.equal(r.merged, true);
  assert.deepEqual(r.recoveredTabs.map((t) => t.key).sort(), ["b", "c"]);
  assert.deepEqual(r.state.chat.tabs.map((t) => t.key), ["a", "b", "c"]);   // incoming first, foreign appended
});

test("mergeForeignTabs: a tab in knownKeys but missing from incoming is a DELIBERATE close — never resurrected", () => {
  const current = { chat: { tabs: [{ key: "a", name: "Master" }, { key: "b", name: "Chat 2" }], activeIndex: 1 } };
  const incoming = { chat: { tabs: [{ key: "a", name: "Master" }], activeIndex: 0 } };   // this writer closed "b" on purpose
  const r = mergeForeignTabs(current, incoming, ["a", "b"]);   // it HAS seen "b" before — in knownKeys
  assert.equal(r.merged, false);
  assert.deepEqual(r.state.chat.tabs.map((t) => t.key), ["a"]);   // the close sticks
});

test("mergeForeignTabs: activeIndex is recomputed to keep pointing at the writer's own active tab, never a recovered one", () => {
  const current = { chat: { tabs: [{ key: "a" }, { key: "b" }, { key: "c" }], activeIndex: 2 } };
  const incoming = { chat: { tabs: [{ key: "x" }, { key: "a" }], activeIndex: 1 } };   // writer's active tab is "a", at index 1 of ITS OWN list
  const r = mergeForeignTabs(current, incoming, ["x", "a"]);   // "b"/"c" are foreign
  assert.equal(r.merged, true);
  assert.deepEqual(r.state.chat.tabs.map((t) => t.key), ["x", "a", "b", "c"]);
  assert.equal(r.state.chat.activeIndex, 1);   // still "a", now at index 1 in the merged array (unchanged here, but recomputed, not copied blindly)
});

test("mergeForeignTabs: nothing to protect (incoming already has everything) is a true no-op — same reference back", () => {
  const current = { chat: { tabs: [{ key: "a" }, { key: "b" }], activeIndex: 0 } };
  const incoming = { chat: { tabs: [{ key: "a" }, { key: "b" }], activeIndex: 1 } };
  const r = mergeForeignTabs(current, incoming, []);
  assert.equal(r.merged, false);
  assert.equal(r.state, incoming);   // same object, not a rebuilt copy — no needless re-render on the caller's side
});

test("mergeForeignTabs: missing chat.tabs on either side is a safe no-op, never throws", () => {
  assert.deepEqual(mergeForeignTabs({}, { a: 1 }, ["x"]), { state: { a: 1 }, merged: false, recoveredTabs: [] });
  assert.deepEqual(mergeForeignTabs({ chat: { tabs: [{ key: "a" }] } }, {}, ["x"]), { state: {}, merged: false, recoveredTabs: [] });
  assert.doesNotThrow(() => mergeForeignTabs(null, null, null));
});

test("writeIdeState: WITHOUT opts.knownKeys, the guard is skipped entirely — pre-fix behaviour, a plain overwrite", () => {
  const dir = tdir();
  writeIdeState(dir, { chat: { tabs: [{ key: "a" }, { key: "b" }], activeIndex: 0 } });
  const w = writeIdeState(dir, { chat: { tabs: [{ key: "a" }], activeIndex: 0 } });   // no knownKeys at all — an old/unpatched writer
  assert.equal(w.ok, true);
  assert.equal(w.merged, false);
  assert.deepEqual(readIdeState(dir).chat.tabs.map((t) => t.key), ["a"]);   // "b" is genuinely gone — this writer never opted in to protection
  rmSync(dir, { recursive: true, force: true });
});

test("writeIdeState: WITH opts.knownKeys, a tab unknown to the writer survives the write (THE FIX, end to end)", () => {
  const dir = tdir();
  writeIdeState(dir, { chat: { tabs: [{ key: "a", name: "Master" }], activeIndex: 0 } });
  // a second client creates "b" — this writer (the first client) never heard about it
  writeIdeState(dir, { chat: { tabs: [{ key: "a", name: "Master" }, { key: "b", name: "Chat 2" }], activeIndex: 1 } }, { knownKeys: ["a"] });
  // now the FIRST client (still thinks only "a" exists) saves again, with knownKeys honestly reflecting only "a"
  const w = writeIdeState(dir, { chat: { tabs: [{ key: "a", name: "Master" }], activeIndex: 0 } }, { knownKeys: ["a"] });
  assert.equal(w.ok, true);
  assert.equal(w.merged, true);
  assert.deepEqual(w.recoveredTabs.map((t) => t.key), ["b"]);
  assert.deepEqual(readIdeState(dir).chat.tabs.map((t) => t.key), ["a", "b"]);   // "b" survived the stale client's write
  rmSync(dir, { recursive: true, force: true });
});

test("writeIdeState: WITH opts.knownKeys, a tab the writer deliberately closes (knows it, omits it) stays closed", () => {
  const dir = tdir();
  writeIdeState(dir, { chat: { tabs: [{ key: "a" }, { key: "b" }], activeIndex: 0 } }, { knownKeys: ["a", "b"] });
  const w = writeIdeState(dir, { chat: { tabs: [{ key: "a" }], activeIndex: 0 } }, { knownKeys: ["a", "b"] });   // closed "b" on purpose
  assert.equal(w.merged, false);
  assert.deepEqual(readIdeState(dir).chat.tabs.map((t) => t.key), ["a"]);
  rmSync(dir, { recursive: true, force: true });
});
