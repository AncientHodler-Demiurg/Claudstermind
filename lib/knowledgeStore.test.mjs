// Tests for lib/knowledgeStore.mjs — Ch.2.1's durable knowledge store: facts/conventions,
// decisions with a supersedes FK, and mandatory provenance on every write.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  openDb,
  addFact,
  getFact,
  listFacts,
  demoteFact,
  refreshFact,
  addDecision,
  getDecision,
  listDecisions,
  provenanceOf,
  resolveText,
} from "./knowledgeStore.mjs";
import { archiveSegment } from "./conversationArchive.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-"));
}

const PROV = { conversationId: "c1", turnKind: "prompt", turnNumber: 1, at: 1700000000000 };

test("openDb creates knowledge.sqlite3 and enforces foreign keys on this connection", () => {
  const base = tmp();
  const db = openDb(base);
  assert.ok(db);
  assert.ok(fs.existsSync(path.join(base, "knowledge.sqlite3")));
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("openDb(null-ish) never throws", () => {
  assert.equal(openDb(null), null);
  assert.equal(openDb(undefined), null);
});

test("openDb on a CORRUPT knowledge.sqlite3 returns null and PRESERVES the file — this store has nothing to rebuild from, so it must never silently wipe real facts/decisions", () => {
  const base = tmp();
  fs.mkdirSync(base, { recursive: true });
  const dbPath = path.join(base, "knowledge.sqlite3");
  fs.writeFileSync(dbPath, "not a real sqlite file — imagine this were someone's real knowledge base");
  assert.equal(openDb(base), null, "a corrupt store must fail loudly (null), not silently recreate empty");
  assert.ok(fs.existsSync(dbPath), "the corrupt file itself must survive for manual recovery");
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// facts — provenance is mandatory
// ---------------------------------------------------------------------------

test("addFact requires provenance — rejects missing conversationId/turnKind/turnNumber", () => {
  const base = tmp();
  const db = openDb(base);
  assert.equal(addFact(db, { text: "no provenance at all" }), null);
  assert.equal(addFact(db, { text: "x", conversationId: "c1" }), null, "missing turnKind/turnNumber");
  assert.equal(addFact(db, { text: "x", conversationId: "c1", turnKind: "prompt" }), null, "missing turnNumber");
  assert.equal(addFact(db, { text: "x", conversationId: "c1", turnKind: "bogus", turnNumber: 1 }), null, "turnKind must be prompt|response");
  assert.equal(addFact(db, { text: "x", conversationId: "c1", turnKind: "prompt", turnNumber: 0 }), null, "turnNumber must be >= 1");
  assert.equal(listFacts(db).length, 0, "none of the rejected calls left a row behind");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("addFact rejects empty text even with valid provenance", () => {
  const base = tmp();
  const db = openDb(base);
  assert.equal(addFact(db, { text: "   ", ...PROV }), null);
  assert.equal(addFact(db, { ...PROV }), null, "text entirely absent");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("addFact succeeds with valid provenance, defaults kind to 'fact', stamps createdAt, `at` optional", () => {
  const base = tmp();
  const db = openDb(base);
  const f = addFact(db, { text: "Pact prefers explicit error types", ...PROV });
  assert.ok(f);
  assert.equal(f.kind, "fact");
  assert.equal(f.text, "Pact prefers explicit error types");
  assert.equal(f.conversationId, "c1");
  assert.equal(f.turnKind, "prompt");
  assert.equal(f.turnNumber, 1);
  assert.equal(f.at, 1700000000000);
  assert.equal(f.status, "active");
  assert.ok(Number.isFinite(f.createdAt) && f.createdAt > 0);

  const convention = addFact(db, { kind: "convention", text: "always run node --check", conversationId: "c1", turnKind: "response", turnNumber: 2 });
  assert.ok(convention);
  assert.equal(convention.kind, "convention");
  assert.equal(convention.at, null, "no `at` supplied — nullable, not fabricated");
  assert.equal(convention.confidence, null, "no confidence supplied — nullable, not fabricated");
  assert.equal(convention.scope, "project", "defaults to project — safer than contaminating the global space");

  assert.deepEqual(getFact(db, f.id).text, f.text);
  assert.equal(getFact(db, 999999), null);
  assert.equal(getFact(db, null), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("addFact accepts an explicit confidence + scope, and rejects an out-of-range confidence rather than clamping it silently", () => {
  const base = tmp();
  const db = openDb(base);
  const global = addFact(db, { text: "always use double quotes", confidence: 0.8, scope: "global", ...PROV });
  assert.equal(global.confidence, 0.8);
  assert.equal(global.scope, "global");

  const outOfRange = addFact(db, { text: "bogus confidence", confidence: 1.5, ...PROV });
  assert.equal(outOfRange.confidence, null, "an out-of-range confidence degrades to null rather than being clamped/fabricated");

  const negative = addFact(db, { text: "bogus confidence 2", confidence: -0.1, ...PROV });
  assert.equal(negative.confidence, null);

  const junkScope = addFact(db, { text: "bogus scope", scope: "wat", ...PROV });
  assert.equal(junkScope.scope, "project", "an unrecognized scope falls back to the safe default, not thrown");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("listFacts filters by conversationId and kind, respects limit, newest first", () => {
  const base = tmp();
  const db = openDb(base);
  addFact(db, { text: "fact one", conversationId: "c1", turnKind: "prompt", turnNumber: 1 });
  addFact(db, { kind: "convention", text: "convention one", conversationId: "c1", turnKind: "prompt", turnNumber: 2 });
  addFact(db, { text: "fact in other conversation", conversationId: "c2", turnKind: "prompt", turnNumber: 1 });

  const c1All = listFacts(db, { conversationId: "c1" });
  assert.equal(c1All.length, 2);
  assert.equal(c1All[0].text, "convention one", "newest first");

  const c1Facts = listFacts(db, { conversationId: "c1", kind: "fact" });
  assert.equal(c1Facts.length, 1);
  assert.equal(c1Facts[0].text, "fact one");

  assert.equal(listFacts(db).length, 3, "no filter — everything");
  assert.equal(listFacts(db, { limit: 1 }).length, 1);
  assert.deepEqual(listFacts(null), []);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Ch.2.4 — decay (facts demoted/refreshed) and conflict handling (decisions superseded)
// ---------------------------------------------------------------------------

test("demoteFact flags a fact stale; it disappears from the default listFacts but stays reachable via includeStale/getFact", () => {
  const base = tmp();
  const db = openDb(base);
  const f = addFact(db, { text: "outdated advice", ...PROV });

  const demoted = demoteFact(db, f.id, { reason: "contradicted by a newer decision" });
  assert.ok(demoted);
  assert.equal(demoted.status, "stale");
  assert.equal(demoted.staleReason, "contradicted by a newer decision");
  assert.ok(Number.isFinite(demoted.staleAt));

  assert.equal(listFacts(db).length, 0, "not silently kept authoritative in the default listing");
  assert.equal(listFacts(db, { includeStale: true }).length, 1, "still reachable by explicit history lookup");
  assert.equal(getFact(db, f.id).status, "stale", "getFact never filters — nothing is deleted");

  assert.equal(demoteFact(db, f.id, { reason: "again" }), null, "already stale — cannot re-demote");
  assert.equal(demoteFact(db, 999999, {}), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("refreshFact reverses demoteFact — decay reflects current standing, not a permanent scar", () => {
  const base = tmp();
  const db = openDb(base);
  const f = addFact(db, { text: "advice", ...PROV });
  demoteFact(db, f.id, { reason: "temporary" });

  const refreshed = refreshFact(db, f.id);
  assert.ok(refreshed);
  assert.equal(refreshed.status, "active");
  assert.equal(refreshed.staleAt, null);
  assert.equal(refreshed.staleReason, "");
  assert.equal(listFacts(db).length, 1, "back in the default listing");

  assert.equal(refreshFact(db, f.id), null, "already active — nothing to refresh");
  assert.equal(refreshFact(db, 999999), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// decisions — the ECC-shaped supersedes FK
// ---------------------------------------------------------------------------

test("addDecision requires provenance and a non-empty title", () => {
  const base = tmp();
  const db = openDb(base);
  assert.equal(addDecision(db, { rationale: "because" }), null, "no title, no provenance");
  assert.equal(addDecision(db, { title: "Use FTS5", rationale: "fast" }), null, "no provenance");
  assert.equal(addDecision(db, { title: "  ", ...PROV }), null, "blank title");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("addDecision succeeds, defaults rationale/alternatives, alternatives round-trips through getDecision", () => {
  const base = tmp();
  const db = openDb(base);
  const d = addDecision(db, {
    title: "Use SQLite FTS5 for recall",
    rationale: "zero new dependencies, node:sqlite ships it",
    alternatives: ["linear scan", "a vector DB"],
    ...PROV,
  });
  assert.ok(d);
  assert.equal(d.title, "Use SQLite FTS5 for recall");
  assert.equal(d.status, "active");
  assert.equal(d.supersedes, null);
  assert.deepEqual(d.alternatives, ["linear scan", "a vector DB"]);

  const minimal = addDecision(db, { title: "A minimal decision", ...PROV });
  assert.equal(minimal.rationale, "");
  assert.deepEqual(minimal.alternatives, []);

  assert.equal(getDecision(db, 999999), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("addDecision rejects un-serializable alternatives rather than silently dropping them", () => {
  const base = tmp();
  const db = openDb(base);
  const circular = {};
  circular.self = circular;
  assert.equal(addDecision(db, { title: "bad alternatives", alternatives: circular, ...PROV }), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("addDecision's `supersedes` is a REAL foreign key — a valid prior id is accepted, a bogus one is rejected", () => {
  const base = tmp();
  const db = openDb(base);
  const original = addDecision(db, { title: "Use trigram FTS for CJK", ...PROV });
  assert.ok(original);

  const replacement = addDecision(db, {
    title: "Skip trigram FTS — no CJK corpus to justify 2.6x the storage",
    supersedes: original.id,
    conversationId: "c1", turnKind: "response", turnNumber: 2,
  });
  assert.ok(replacement, "a supersedes value naming a REAL decision must be accepted");
  assert.equal(replacement.supersedes, original.id);

  // Ch.2.4: the superseded row is demoted in the SAME transaction as the new row's insert.
  const supersededRow = getDecision(db, original.id);
  assert.equal(supersededRow.status, "superseded");
  assert.ok(Number.isFinite(supersededRow.supersededAt));

  const bogus = addDecision(db, { title: "orphaned supersedes", supersedes: 999999, ...PROV });
  assert.equal(bogus, null, "a supersedes value naming a decision that doesn't exist must be rejected (real FK enforcement)");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("a superseded decision is excluded from listDecisions by default, but reachable via includeSuperseded or getDecision — nothing is deleted", () => {
  const base = tmp();
  const db = openDb(base);
  const original = addDecision(db, { title: "old approach", ...PROV });
  addDecision(db, { title: "new approach", supersedes: original.id, ...PROV });

  const current = listDecisions(db);
  assert.equal(current.length, 1, "the superseded row is excluded from the default 'current' listing");
  assert.equal(current[0].title, "new approach");

  const all = listDecisions(db, { includeSuperseded: true });
  assert.equal(all.length, 2, "explicit history lookup still finds it");
  assert.ok(all.some((d) => d.title === "old approach"));

  assert.equal(getDecision(db, original.id).status, "superseded", "getDecision never filters — nothing is deleted");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("listDecisions filters by conversationId, respects limit, newest first, raw (unparsed) alternatives", () => {
  const base = tmp();
  const db = openDb(base);
  addDecision(db, { title: "d1", conversationId: "c1", turnKind: "prompt", turnNumber: 1 });
  addDecision(db, { title: "d2", conversationId: "c1", turnKind: "prompt", turnNumber: 2, alternatives: ["x"] });
  addDecision(db, { title: "d3", conversationId: "c2", turnKind: "prompt", turnNumber: 1 });

  const c1 = listDecisions(db, { conversationId: "c1" });
  assert.equal(c1.length, 2);
  assert.equal(c1[0].title, "d2", "newest first");
  assert.equal(typeof c1[0].alternatives, "string", "listDecisions returns the raw JSON text, not parsed");

  assert.equal(listDecisions(db).length, 3);
  assert.equal(listDecisions(db, { limit: 1 }).length, 1);
  assert.deepEqual(listDecisions(null), []);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// provenance + resolveText — recovering the original turn
// ---------------------------------------------------------------------------

test("provenanceOf extracts the four fields from either a fact or a decision row; null on junk", () => {
  const base = tmp();
  const db = openDb(base);
  const f = addFact(db, { text: "x", ...PROV });
  assert.deepEqual(provenanceOf(f), { conversationId: "c1", turnKind: "prompt", turnNumber: 1, at: 1700000000000 });

  const d = addDecision(db, { title: "y", conversationId: "c9", turnKind: "response", turnNumber: 4 });
  assert.deepEqual(provenanceOf(d), { conversationId: "c9", turnKind: "response", turnNumber: 4, at: null });

  assert.equal(provenanceOf(null), null);
  assert.equal(provenanceOf({}), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("resolveText recovers the ORIGINAL turn text via conversationArchive.recallByNumber, given the archive's own baseDir", () => {
  const archiveBase = tmp();
  archiveSegment(archiveBase, {
    conversationId: "c1", n: 0, summary: "",
    rows: [{ role: "user", text: "Claudstermind should stay model-agnostic", at: 1700000000000 }],
  });

  const knowledgeBase = tmp(); // deliberately a DIFFERENT directory — the two stores are independent
  const db = openDb(knowledgeBase);
  const f = addFact(db, { text: "decided: model-agnostic architecture", conversationId: "c1", turnKind: "prompt", turnNumber: 1, at: 1700000000000 });

  assert.equal(resolveText(archiveBase, f), "Claudstermind should stay model-agnostic");
  assert.equal(resolveText(null, f), null, "no archive base — cannot resolve, not an error");
  assert.equal(resolveText(archiveBase, null), null);

  const unresolvable = addFact(db, { text: "cannot be traced back", conversationId: "nonexistent-conv", turnKind: "prompt", turnNumber: 1 });
  assert.equal(resolveText(archiveBase, unresolvable), null, "provenance pointing at a conversation with no archive resolves to null, not a throw");

  db.close();
  fs.rmSync(archiveBase, { recursive: true, force: true });
  fs.rmSync(knowledgeBase, { recursive: true, force: true });
});
