// node --test lib/workspaceStore.test.mjs — per-repo/per-worktree transcript store.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  workspaceId, parseWorkspaceId, slugFor,
  appendTurn, readSession, findSession, listSessions, searchSessions, dataSizes, retire,
} from "./workspaceStore.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "wsstore-"));

test("workspaceId joins repo + worktree, parseWorkspaceId inverts it", () => {
  const id = workspaceId("AncientPantheon/automatons/Mnemosyne", "main");
  assert.equal(id, "AncientPantheon/automatons/Mnemosyne@main");
  assert.deepEqual(parseWorkspaceId(id), { repo: "AncientPantheon/automatons/Mnemosyne", worktree: "main" });
  // A repo path could itself contain no @, but a worktree name never does — split on the LAST @.
  assert.deepEqual(parseWorkspaceId("a/b@wt-1"), { repo: "a/b", worktree: "wt-1" });
});

test("workspaceId defaults the worktree to main", () => {
  assert.equal(workspaceId("Repo"), "Repo@main");
});

test("parseWorkspaceId tolerates a bare id (no @) as the main worktree", () => {
  assert.deepEqual(parseWorkspaceId("SomeRepo"), { repo: "SomeRepo", worktree: "main" });
});

test("slugFor is filesystem-safe and one level deep — no path separators survive", () => {
  const slug = slugFor("AncientPantheon/automatons/Mnemosyne@main");
  assert.ok(!slug.includes("/") && !slug.includes("\\"), "no separators");
  assert.ok(!slug.includes("@") || /@/.test(slug), "id round-trippable by convention");
  // Distinct ids get distinct slugs (no collision from the folder flattening).
  assert.notEqual(slugFor("a/b@main"), slugFor("a__b@main"));
});

test("appendTurn/readSession/findSession round-trip for keys with hex-flanked segments", () => {
  // Regression: an escape delimiter that is itself a KEPT character (the old `-`) made slugFor's
  // inverse ambiguous — a worktree like `rc-1-2` decoded wrongly and its conversation could not be
  // reopened. The delimiter is now outside the kept set, so these must all round-trip exactly.
  const dir = tmp();
  try {
    for (const wt of ["rc-1-2", "fix-a-bug", "v1-0-2", "release-2-x"]) {
      const id = workspaceId("Repo/Nested", wt);
      appendTurn(dir, id, id, { role: "user", text: "hi " + wt, at: 1 });
      const s = readSession(dir, id, id);
      assert.ok(s, `readSession works for ${wt}`);
      assert.equal(s.worktree, wt);
      const f = findSession(dir, id);
      assert.ok(f, `findSession locates ${wt}`);
      assert.equal(f.transcript[0].text, "hi " + wt);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("appendTurn writes JSONL and readSession returns the ordered records", () => {
  const dir = tmp();
  try {
    const id = workspaceId("Repo", "main");
    appendTurn(dir, id, "sess1", { role: "user", text: "hello", at: 1 });
    appendTurn(dir, id, "sess1", { role: "assistant", text: "hi", at: 2 });
    const s = readSession(dir, id, "sess1");
    assert.equal(s.repo, "Repo");
    assert.equal(s.worktree, "main");
    assert.equal(s.transcript.length, 2);
    assert.deepEqual(s.transcript.map((r) => r.role), ["user", "assistant"]);
    // On disk it is genuinely line-delimited, not one JSON blob.
    const files = readdirSync(join(dir, slugFor(id)));
    const jsonl = files.find((f) => f.endsWith(".jsonl"));
    const lines = readFileSync(join(dir, slugFor(id), jsonl), "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("appendTurn is append-only — a second session in the same workspace is a separate file", () => {
  const dir = tmp();
  try {
    const id = workspaceId("Repo", "main");
    appendTurn(dir, id, "sA", { role: "user", text: "one", at: 1 });
    appendTurn(dir, id, "sB", { role: "user", text: "two", at: 2 });
    const list = listSessions(dir);
    const keys = list.map((x) => x.sessionId).sort();
    assert.deepEqual(keys, ["sA", "sB"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a malformed JSONL line is skipped, not fatal", () => {
  const dir = tmp();
  try {
    const id = workspaceId("Repo", "main");
    appendTurn(dir, id, "s1", { role: "user", text: "good", at: 1 });
    // Corrupt the file with a bad line in the middle.
    const f = join(dir, slugFor(id), "s1.jsonl");
    writeFileSync(f, readFileSync(f, "utf8") + "{ this is not json\n" + JSON.stringify({ role: "assistant", text: "still parsed", at: 3 }) + "\n");
    const s = readSession(dir, id, "s1");
    assert.equal(s.transcript.length, 2, "the two valid lines survive; the garbage line is dropped");
    assert.equal(s.transcript[1].text, "still parsed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("retire appends a retired record that readSession surfaces as metadata", () => {
  const dir = tmp();
  try {
    const id = workspaceId("Repo", "main");
    appendTurn(dir, id, "s1", { role: "user", text: "hi", at: 1 });
    retire(dir, id, "s1", 999);
    const s = readSession(dir, id, "s1");
    assert.equal(s.retired, true);
    assert.equal(s.retiredAt, 999);
    // A retired record is metadata, not a conversation turn.
    assert.equal(s.transcript.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("listSessions summarises newest-first with first prompt and turn count", () => {
  const dir = tmp();
  try {
    const id = workspaceId("Repo", "main");
    appendTurn(dir, id, "old", { role: "user", text: "older question", at: 100 });
    appendTurn(dir, id, "new", { role: "user", text: "newer question", at: 200 });
    appendTurn(dir, id, "new", { role: "assistant", text: "answer", at: 210 });
    const list = listSessions(dir);
    assert.equal(list[0].sessionId, "new", "newest first");
    assert.equal(list[0].firstPrompt, "newer question");
    assert.equal(list[0].turns, 1, "one user turn");
    assert.equal(list[0].repo, "Repo");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("listSessions can filter to one repo", () => {
  const dir = tmp();
  try {
    appendTurn(dir, workspaceId("RepoA", "main"), "a", { role: "user", text: "x", at: 1 });
    appendTurn(dir, workspaceId("RepoB", "main"), "b", { role: "user", text: "y", at: 2 });
    assert.deepEqual(listSessions(dir, { repo: "RepoA" }).map((s) => s.sessionId), ["a"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("searchSessions finds a hit with a snippet, scoped to a repo when asked", () => {
  const dir = tmp();
  try {
    appendTurn(dir, workspaceId("RepoA", "main"), "a", { role: "user", text: "the quick brown fox", at: 1 });
    appendTurn(dir, workspaceId("RepoB", "main"), "b", { role: "user", text: "quick and nothing else", at: 2 });
    const all = searchSessions(dir, "quick");
    assert.equal(all.length, 2);
    const scoped = searchSessions(dir, "quick", "RepoA");
    assert.equal(scoped.length, 1);
    assert.match(scoped[0].snippet, /quick brown fox/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dataSizes aggregates raw bytes/turns per repo", () => {
  const dir = tmp();
  try {
    appendTurn(dir, workspaceId("RepoA", "main"), "a", { role: "user", text: "x", at: 1 });
    appendTurn(dir, workspaceId("RepoA", "wt-1"), "a2", { role: "user", text: "y", at: 2 });
    appendTurn(dir, workspaceId("RepoB", "main"), "b", { role: "user", text: "z", at: 3 });
    const sizes = dataSizes(dir);
    const a = sizes.find((s) => s.repo === "RepoA");
    assert.ok(a.bytes > 0);
    assert.equal(a.conversations, 2, "both worktrees of RepoA counted under the repo");
    assert.equal(a.turns, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- legacy: the flat <key>.json store must keep working, unmigrated ----

function writeLegacy(dir, key, obj) {
  const safe = String(key).replace(/[^a-zA-Z0-9_-]/g, "_");
  writeFileSync(join(dir, `${safe}.json`), JSON.stringify(obj), "utf8");
}

test("readSession falls back to a legacy <key>.json file", () => {
  const dir = tmp();
  try {
    writeLegacy(dir, "e2e1", { sessionKey: "e2e1", sessionId: "e2e1", repo: "OldRepo",
      usage: { turns: 1 }, updatedAt: 5, transcript: [{ role: "user", text: "legacy", at: 1 }] });
    const s = readSession(dir, "e2e1");
    assert.equal(s.repo, "OldRepo");
    assert.equal(s.transcript[0].text, "legacy");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("listSessions and search include legacy files alongside new ones", () => {
  const dir = tmp();
  try {
    writeLegacy(dir, "legacy", { sessionKey: "legacy", sessionId: "legacy", repo: "OldRepo",
      usage: { turns: 1 }, updatedAt: 5, transcript: [{ role: "user", text: "findme legacy", at: 1 }] });
    appendTurn(dir, workspaceId("NewRepo", "main"), "new", { role: "user", text: "findme new", at: 100 });
    const list = listSessions(dir);
    assert.equal(list.length, 2, "legacy + new both listed");
    assert.deepEqual(list.map((s) => s.sessionId).sort(), ["legacy", "new"]);
    const hits = searchSessions(dir, "findme");
    assert.equal(hits.length, 2, "search spans both layouts");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dataSizes counts legacy files too", () => {
  const dir = tmp();
  try {
    writeLegacy(dir, "legacy", { sessionKey: "legacy", sessionId: "legacy", repo: "OldRepo",
      usage: { turns: 2 }, updatedAt: 5, transcript: [{ role: "user", text: "a", at: 1 }, { role: "user", text: "b", at: 2 }] });
    const sizes = dataSizes(dir);
    const old = sizes.find((s) => s.repo === "OldRepo");
    assert.equal(old.conversations, 1);
    assert.equal(old.turns, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("findSession locates a session by its id alone, across layouts", () => {
  const dir = tmp();
  try {
    appendTurn(dir, workspaceId("NewRepo", "wt-1"), "abc", { role: "user", text: "new one", at: 1 });
    writeLegacy(dir, "oldkey", { sessionKey: "oldkey", sessionId: "oldkey", repo: "OldRepo",
      usage: { turns: 1 }, updatedAt: 5, transcript: [{ role: "user", text: "old one", at: 1 }] });
    const a = findSession(dir, "abc");
    assert.equal(a.repo, "NewRepo");
    assert.equal(a.worktree, "wt-1");
    assert.equal(a.transcript[0].text, "new one");
    const b = findSession(dir, "oldkey");
    assert.equal(b.repo, "OldRepo");
    assert.equal(b.transcript[0].text, "old one");
    assert.equal(findSession(dir, "nope"), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("everything degrades to empty on a missing directory rather than throwing", () => {
  const missing = join(tmpdir(), "wsstore-does-not-exist-" + Math.random().toString(36).slice(2));
  assert.deepEqual(listSessions(missing), []);
  assert.deepEqual(searchSessions(missing, "x"), []);
  assert.deepEqual(dataSizes(missing), []);
  assert.equal(readSession(missing, workspaceId("R", "main"), "s"), null);
});
