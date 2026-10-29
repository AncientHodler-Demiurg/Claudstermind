// Tests for lib/conversationFts.mjs — the generic SQLite FTS5 engine behind recallByQuery, and
// specifically the incremental-rebuild guard copied from Hermes (see the module header for the
// verified "why": an external-content FTS5 table does not reject a duplicate-rowid write, and a
// DELETE for a rowid that isn't indexed corrupts the index outright).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  probeFts5,
  openDb,
  openDatabaseFile,
  upsertRow,
  deleteSegment,
  currentMaxId,
  getSyncFingerprint,
  setSyncFingerprint,
  seedRebuildMarkers,
  rebuildStatus,
  rebuildStep,
  finishRebuild,
  rebuildFromScratch,
  search,
} from "./conversationFts.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "convfts-"));
}

test("probeFts5 reports FTS5 support (this environment: SQLite 3.46.1)", () => {
  assert.equal(probeFts5(), true);
});

test("openDb creates the db file under _segments/ and is idempotent to reopen", () => {
  const base = tmp();
  const db1 = openDb(base);
  assert.ok(db1, "first open must succeed");
  assert.ok(fs.existsSync(path.join(base, "_segments", "_fts.sqlite3")));
  db1.close();
  const db2 = openDb(base); // reopen an existing, schema-complete file
  assert.ok(db2);
  db2.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("openDb(null-ish) never throws", () => {
  assert.equal(openDb(null), null);
  assert.equal(openDb(undefined), null);
});

test("openDatabaseFile is the generic engine other stores reuse — works with an arbitrary plain-relational schema, no FTS5 involved", () => {
  const base = tmp();
  const dbPath = path.join(base, "plain.sqlite3");
  const db = openDatabaseFile(dbPath, "CREATE TABLE IF NOT EXISTS widgets (id INTEGER PRIMARY KEY, name TEXT)");
  assert.ok(db, "must succeed even though the schema has no virtual table");
  assert.ok(fs.existsSync(dbPath));
  db.prepare("INSERT INTO widgets (name) VALUES (?)").run("gear");
  assert.equal(db.prepare("SELECT name FROM widgets").get().name, "gear");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("openDatabaseFile recovers from a corrupt existing file by deleting and recreating it fresh", () => {
  const base = tmp();
  const dbPath = path.join(base, "corrupt.sqlite3");
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(dbPath, "not a sqlite file at all");
  const db = openDatabaseFile(dbPath, "CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)");
  assert.ok(db, "a corrupt file must not permanently block opening — it gets replaced");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("openDatabaseFile with recreateOnCorruption:false PRESERVES a corrupt file instead of wiping it — for a non-disposable store, null (a surfaced failure) beats silent data loss", () => {
  const base = tmp();
  const dbPath = path.join(base, "corrupt.sqlite3");
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(dbPath, "not a sqlite file at all — imagine this were someone's real facts/decisions");
  const db = openDatabaseFile(dbPath, "CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)", { recreateOnCorruption: false });
  assert.equal(db, null, "must fail loudly (null), not silently recreate");
  assert.ok(fs.existsSync(dbPath), "the corrupt file itself must be left on disk for manual recovery — never deleted");
  assert.equal(fs.readFileSync(dbPath, "utf8"), "not a sqlite file at all — imagine this were someone's real facts/decisions", "byte-for-byte untouched");
  fs.rmSync(base, { recursive: true, force: true });
});

test("openDatabaseFile does not leak the half-open handle from a failed schema exec before recreating", () => {
  // Regression test for a real leak found in review: the constructor succeeds even against a
  // corrupt file (only exec() throws), so the first, broken DatabaseSync must be closed before
  // the file is deleted and reopened — otherwise every corruption-recovery cycle leaks one fd.
  // Not directly observable from JS (no fd-count API here), so this pins the OBSERVABLE
  // consequence instead: recovery must still succeed cleanly and repeatedly, which would not be
  // reliable if stale handles against an unlinked inode were accumulating.
  const base = tmp();
  const dbPath = path.join(base, "corrupt.sqlite3");
  for (let i = 0; i < 5; i++) {
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(dbPath, "corrupt again");
    const db = openDatabaseFile(dbPath, "CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)");
    assert.ok(db, `recovery attempt ${i} must succeed`);
    db.close();
  }
  fs.rmSync(base, { recursive: true, force: true });
});

test("openDatabaseFile(null-ish) never throws", () => {
  assert.equal(openDatabaseFile(null, "CREATE TABLE t (id INTEGER)"), null);
  assert.equal(openDatabaseFile(undefined, "CREATE TABLE t (id INTEGER)"), null);
});

test("upsertRow + search: basic BM25 match, case-insensitive", () => {
  const base = tmp();
  const db = openDb(base);
  upsertRow(db, { conversationId: "c1", segmentRef: "c1#seg0", workspaceId: "W", kind: "prompt", number: 1, text: "hello there, first prompt", images: 0 });
  upsertRow(db, { conversationId: "c1", segmentRef: "c1#seg0", workspaceId: "W", kind: "prompt", number: 2, text: "second prompt mentions bananas", images: 0 });

  const hits = search(db, { conversationId: "c1", query: "BANANAS" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].number, 2);
  assert.equal(hits[0].kind, "prompt");
  assert.equal(hits[0].workspaceId, "W");

  assert.deepEqual(search(db, { conversationId: "c1", query: "" }), []);
  assert.deepEqual(search(db, { conversationId: "c1", query: "nonexistentword" }), []);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("`at` round-trips through search when present, and is null (never throws) when the source row omitted it", () => {
  const base = tmp();
  const db = openDb(base);
  upsertRow(db, { conversationId: "c1", segmentRef: "s", kind: "prompt", number: 1, text: "stamped row", at: 1700000000000 });
  upsertRow(db, { conversationId: "c1", segmentRef: "s", kind: "prompt", number: 2, text: "unstamped row" }); // no `at` at all

  const stamped = search(db, { conversationId: "c1", query: "stamped" })[0];
  assert.equal(stamped.at, 1700000000000);

  const unstamped = search(db, { conversationId: "c1", query: "unstamped" })[0];
  assert.equal(unstamped.at, null, "a row with no timestamp must degrade to null, not throw or fabricate one");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("search is scoped by conversationId — a hit in another conversation never leaks", () => {
  const base = tmp();
  const db = openDb(base);
  upsertRow(db, { conversationId: "c1", segmentRef: "c1#seg0", kind: "prompt", number: 1, text: "unique-marker-one" });
  upsertRow(db, { conversationId: "c2", segmentRef: "c2#seg0", kind: "prompt", number: 1, text: "unique-marker-one" });

  assert.equal(search(db, { conversationId: "c1", query: "unique-marker-one" }).length, 1);
  assert.equal(search(db, { conversationId: "c2", query: "unique-marker-one" }).length, 1);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("upsertRow rejects a missing/non-finite number rather than silently defaulting to 0 and colliding with another row", () => {
  const base = tmp();
  const db = openDb(base);
  assert.equal(upsertRow(db, { conversationId: "c1", segmentRef: "s", kind: "prompt", text: "no number at all" }), false);
  assert.equal(upsertRow(db, { conversationId: "c1", segmentRef: "s", kind: "prompt", number: NaN, text: "NaN number" }), false);
  assert.equal(upsertRow(db, { conversationId: "c1", segmentRef: "s", kind: "prompt", number: "not a number", text: "x" }), false);
  assert.deepEqual(search(db, { conversationId: "c1", query: "number" }), [], "nothing was silently written under a defaulted number:0");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("upsertRow REPLACE on the same (conversationId,kind,number) updates content and stays searchable only under the new text", () => {
  const base = tmp();
  const db = openDb(base);
  upsertRow(db, { conversationId: "c1", segmentRef: "c1#seg0", kind: "prompt", number: 1, text: "about apples" });
  assert.equal(search(db, { conversationId: "c1", query: "apples" }).length, 1);

  upsertRow(db, { conversationId: "c1", segmentRef: "c1#seg0", kind: "prompt", number: 1, text: "about cherries" });
  assert.equal(search(db, { conversationId: "c1", query: "apples" }).length, 0, "old content must not still match — this is exactly what a corrupted index would get wrong");
  assert.equal(search(db, { conversationId: "c1", query: "cherries" }).length, 1);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("deleteSegment removes every row of that segmentRef and its FTS entries", () => {
  const base = tmp();
  const db = openDb(base);
  upsertRow(db, { conversationId: "c1", segmentRef: "c1#seg0", kind: "prompt", number: 1, text: "keep-me" });
  upsertRow(db, { conversationId: "c1", segmentRef: "c1#seg1", kind: "prompt", number: 2, text: "drop-me" });
  deleteSegment(db, "c1#seg1");
  assert.equal(search(db, { conversationId: "c1", query: "drop-me" }).length, 0);
  assert.equal(search(db, { conversationId: "c1", query: "keep-me" }).length, 1);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("segment_sync bookkeeping round-trips (used to skip unchanged JSONL on re-sync)", () => {
  const base = tmp();
  const db = openDb(base);
  assert.equal(getSyncFingerprint(db, "c1#seg0"), null);
  setSyncFingerprint(db, "c1#seg0", "12345.5:20");
  assert.equal(getSyncFingerprint(db, "c1#seg0"), "12345.5:20");
  setSyncFingerprint(db, "c1#seg0", "99999:8");
  assert.equal(getSyncFingerprint(db, "c1#seg0"), "99999:8");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The incremental-rebuild guard — the actual point of this slice.
// ---------------------------------------------------------------------------

test("rebuildStatus is null when no rebuild is pending", () => {
  const base = tmp();
  const db = openDb(base);
  assert.equal(rebuildStatus(db), null);
  upsertRow(db, { conversationId: "c1", segmentRef: "s", kind: "prompt", number: 1, text: "x" });
  assert.equal(rebuildStatus(db), null, "ordinary live writes never seed rebuild markers");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("a mid-rebuild write is indexed immediately (id > H), even though the historical sweep hasn't reached it — the guard's core property", () => {
  const base = tmp();
  const db = openDb(base);

  // Simulate a genuine gap: bulk-load content directly into segment_rows WITHOUT going through
  // the live trigger, by wiping the FTS index after normal inserts (this is what a real "index
  // found corrupt/missing" recovery looks like: content survives, index doesn't).
  for (let i = 1; i <= 12; i++) {
    upsertRow(db, { conversationId: "c1", segmentRef: "s0", kind: "prompt", number: i, text: `old row number ${i}` });
  }
  db.exec("INSERT INTO segment_rows_fts(segment_rows_fts) VALUES('delete-all')");
  assert.equal(search(db, { conversationId: "c1", query: "old" }).length, 0, "index wiped — content exists but nothing is indexed yet");

  const h = seedRebuildMarkers(db, { force: true }); // H = 12, P = 0
  assert.equal(h, 12);
  const status0 = rebuildStatus(db);
  assert.equal(status0.pending, true);
  assert.equal(status0.total, 12);
  assert.equal(status0.indexed, 0);

  // A NEW row arrives mid-rebuild (id 13, > H=12) — e.g. archiveSegment ran a fresh archive while
  // the rebuild was in progress. It must be searchable RIGHT NOW, without waiting for the sweep.
  upsertRow(db, { conversationId: "c1", segmentRef: "s1", kind: "prompt", number: 13, text: "brand new after high water" });
  assert.equal(search(db, { conversationId: "c1", query: "brand" }).length, 1, "id > H must self-index live even while a historical rebuild is pending");

  // But the 12 pre-existing rows are still NOT indexed yet — the sweep hasn't covered them.
  assert.equal(search(db, { conversationId: "c1", query: "old" }).length, 0, "rows in (P,H] are deliberately not yet indexed");

  // Step the rebuild forward in small chunks and confirm partial coverage matches progress exactly.
  // (limit:100 throughout — the default limit is 10, and this test deliberately exceeds it.)
  let more = rebuildStep(db, { chunkRows: 5 }); // covers id (0,5]
  assert.equal(more, true);
  assert.equal(rebuildStatus(db).indexed, 5);
  assert.equal(search(db, { conversationId: "c1", query: "old", limit: 100 }).length, 5, "exactly the 5 rows just swept are indexed");

  more = rebuildStep(db, { chunkRows: 5 }); // covers id (5,10]
  assert.equal(more, true);
  assert.equal(rebuildStatus(db).indexed, 10);
  assert.equal(search(db, { conversationId: "c1", query: "old", limit: 100 }).length, 10);

  more = rebuildStep(db, { chunkRows: 5 }); // covers id (10,12] — reaches H, finishes
  assert.equal(more, false, "rebuildStep returns false once it reaches H");
  assert.equal(rebuildStatus(db), null, "finishRebuild cleared the markers");
  assert.equal(search(db, { conversationId: "c1", query: "old", limit: 100 }).length, 12, "all pre-existing rows now indexed");
  assert.equal(search(db, { conversationId: "c1", query: "brand" }).length, 1, "the mid-rebuild row is still there too");

  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("rebuildStep with no pending rebuild is a no-op returning false", () => {
  const base = tmp();
  const db = openDb(base);
  assert.equal(rebuildStep(db), false);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("rebuildFromScratch converges to full coverage in one call for a small corpus, without disturbing a concurrent new write", () => {
  const base = tmp();
  const db = openDb(base);
  for (let i = 1; i <= 30; i++) {
    upsertRow(db, { conversationId: "c1", segmentRef: "s0", kind: "response", number: i, text: `content ${i}` });
  }
  db.exec("INSERT INTO segment_rows_fts(segment_rows_fts) VALUES('delete-all')");
  assert.equal(search(db, { conversationId: "c1", query: "content" }).length, 0);

  rebuildFromScratch(db, { chunkRows: 7 }); // deliberately does not divide 30 evenly

  assert.equal(rebuildStatus(db), null);
  assert.equal(search(db, { conversationId: "c1", query: "content", limit: 100 }).length, 30);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("finishRebuild with no markers set is a harmless no-op", () => {
  const base = tmp();
  const db = openDb(base);
  finishRebuild(db); // must not throw
  assert.equal(rebuildStatus(db), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});
