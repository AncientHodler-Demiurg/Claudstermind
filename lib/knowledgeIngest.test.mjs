// node --test lib/knowledgeIngest.test.mjs — the real, committed ingestion engine.
//
// "so thats what i means as the ingestion engine that distill existing conversation into exocortex
// knowledge base or something." A prior session piloted this exact idea live against two real
// workspaces ($3.57, 212 facts/decisions extracted) using a script that was never committed — this
// file pins the PERMANENT replacement: the same mechanics (chunked, one-shot Claude calls, cost
// tracked from the SDK's own total_cost_usd), but as real, reusable, tested code.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb as openFtsDb, upsertRow } from "./conversationFts.mjs";
import { openDb as openKnowledgeDb, listFacts, listDecisions } from "./knowledgeStore.mjs";
import {
  chunkRows, readWorkspaceRows, ingestPrompt, parseIngestReply, toStoreOps, runKnowledgeIngest, INGEST_CHUNK_ROWS,
} from "./knowledgeIngest.mjs";

function wsFixture() {
  const dir = mkdtempSync(join(tmpdir(), "kingest-"));
  return dir;
}
function row(n, overrides = {}) { return { conversationId: "conv-1", kind: "response", number: n, text: `row ${n} text`, at: 1000 + n, ...overrides }; }

test("chunkRows: splits into fixed-size chunks, in order, last chunk may be shorter", () => {
  const rows = Array.from({ length: 450 }, (_, i) => row(i + 1));
  const chunks = chunkRows(rows, 200);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 200); assert.equal(chunks[1].length, 200); assert.equal(chunks[2].length, 50);
  assert.equal(chunks[0][0].number, 1); assert.equal(chunks[2][chunks[2].length - 1].number, 450);
});

test("chunkRows: an empty or missing list is just an empty list of chunks, never a throw", () => {
  assert.deepEqual(chunkRows([]), []);
  assert.deepEqual(chunkRows(null), []);
  assert.deepEqual(chunkRows(undefined), []);
});

test("readWorkspaceRows: reads real archived rows, oldest first, from a real FTS db — and degrades to [] when there's no store at all", () => {
  const dir = wsFixture();
  assert.deepEqual(readWorkspaceRows(dir), [], "no FTS db yet — genuinely nothing archived");
  const db = openFtsDb(dir);
  upsertRow(db, { conversationId: "c1", segmentRef: "s1", workspaceId: "w", kind: "prompt", number: 1, text: "first", at: 100 });
  upsertRow(db, { conversationId: "c1", segmentRef: "s1", workspaceId: "w", kind: "response", number: 2, text: "second", at: 200 });
  db.close();
  const rows = readWorkspaceRows(dir);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].number, 1, "ascending id = archive order");
  assert.equal(rows[1].text, "second");
  rmSync(dir, { recursive: true, force: true });
});

test("ingestPrompt: every row is tagged with its own [kind#number] so the model's citation can be resolved back to it", () => {
  const p = ingestPrompt("Claudstermind", [row(12, { kind: "response", text: "the engine respawns on key switch" })]);
  assert.match(p, /\[response#12\]/);
  assert.match(p, /the engine respawns on key switch/);
  assert.match(p, /STRICT JSON/i);
});

test("parseIngestReply: a well-formed JSON reply round-trips; markdown fences around it are stripped", () => {
  const raw = '{"facts":[{"text":"A","sourceKind":"response","sourceNumber":1}],"decisions":[{"title":"B","sourceKind":"prompt","sourceNumber":2}]}';
  assert.deepEqual(parseIngestReply(raw).facts.map((f) => f.text), ["A"]);
  assert.deepEqual(parseIngestReply(raw).decisions.map((d) => d.title), ["B"]);
  assert.deepEqual(parseIngestReply("```json\n" + raw + "\n```").facts.map((f) => f.text), ["A"], "fenced reply still parses");
});

test("parseIngestReply: malformed/garbage input degrades to empty, never throws — a long batch run can't die on one bad chunk", () => {
  assert.deepEqual(parseIngestReply("not json at all"), { facts: [], decisions: [] });
  assert.deepEqual(parseIngestReply(""), { facts: [], decisions: [] });
  assert.deepEqual(parseIngestReply(null), { facts: [], decisions: [] });
  assert.deepEqual(parseIngestReply('{"facts":"not an array"}'), { facts: [], decisions: [] });
  assert.deepEqual(parseIngestReply('{"facts":[{"text":""}]}').facts, [], "an empty-text fact is filtered out");
});

test("toStoreOps: resolves each item's citation back to the REAL row it points at — genuine provenance, not a guess", () => {
  const chunk = [row(10, { conversationId: "conv-A", kind: "prompt" }), row(11, { conversationId: "conv-A", kind: "response" }), row(12, { conversationId: "conv-A", kind: "response" })];
  const parsed = { facts: [{ text: "fact text", sourceKind: "response", sourceNumber: 11 }], decisions: [{ title: "decision title", sourceKind: "prompt", sourceNumber: 10 }] };
  const ops = toStoreOps(chunk, parsed);
  assert.equal(ops.facts[0].turnNumber, 11); assert.equal(ops.facts[0].turnKind, "response"); assert.equal(ops.facts[0].at, chunk[1].at);
  assert.equal(ops.decisions[0].turnNumber, 10); assert.equal(ops.decisions[0].turnKind, "prompt");
});

test("toStoreOps: a hallucinated/missing citation falls back to the chunk's LAST row — coarse provenance beats none", () => {
  const chunk = [row(1), row(2), row(3)];
  const parsed = { facts: [{ text: "no real citation", sourceKind: "response", sourceNumber: 999 }], decisions: [] };
  const ops = toStoreOps(chunk, parsed);
  assert.equal(ops.facts[0].turnNumber, 3, "falls back to the chunk's own last row");
});

test("runKnowledgeIngest (mock SDK): reads real rows, chunks them, writes REAL facts/decisions with real provenance, tracks real cost", async () => {
  const dir = wsFixture();
  const fdb = openFtsDb(dir);
  for (let i = 1; i <= 5; i++) upsertRow(fdb, { conversationId: "conv-1", segmentRef: "s1", workspaceId: "w", kind: i % 2 ? "prompt" : "response", number: i, text: `turn ${i} about the retry cap`, at: 1000 + i });
  fdb.close();

  const calls = [];
  const mockQuery = ({ prompt }) => (async function* () {
    const it = prompt[Symbol.asyncIterator](); const p = await it.next();
    calls.push(p.value.message.content);
    yield { type: "assistant", message: { content: [{ type: "text", text: '{"facts":[{"text":"the retry cap is bounded by key count","sourceKind":"response","sourceNumber":2}],"decisions":[{"title":"cap retries at keys.length","rationale":"avoid a runaway loop","sourceKind":"response","sourceNumber":4}]}' }] } };
    yield { type: "result", subtype: "success", usage: { input_tokens: 500, output_tokens: 60 }, total_cost_usd: 0.015 };
  })();

  const r = await runKnowledgeIngest({ workspaceDir: dir, repo: "TestRepo", root: dir, token: "t", sdkQuery: mockQuery });
  assert.equal(r.rowsRead, 5);
  assert.equal(r.chunksRun, 1, "5 rows fit in one chunk (chunk size 200)");
  assert.equal(r.factsWritten, 1);
  assert.equal(r.decisionsWritten, 1);
  assert.ok(Math.abs(r.totalCost - 0.015) < 1e-9);
  assert.equal(calls.length, 1, "exactly one SDK call for one chunk");
  assert.match(calls[0], /\[response#2\]/, "the prompt actually carried the real rows");

  // The write is REAL — verifiable straight from the knowledge store, not just the return value.
  const kdb = openKnowledgeDb(dir);
  const facts = listFacts(kdb);
  const decisions = listDecisions(kdb);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].turnNumber, 2, "provenance resolved to the cited row, not a guess");
  assert.equal(facts[0].conversationId, "conv-1");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].turnNumber, 4);
  kdb.close();
  rmSync(dir, { recursive: true, force: true });
});

test("runKnowledgeIngest: a large row count spans MULTIPLE chunks, each its own SDK call, costs accumulate", async () => {
  const dir = wsFixture();
  const fdb = openFtsDb(dir);
  for (let i = 1; i <= 450; i++) upsertRow(fdb, { conversationId: "conv-1", segmentRef: "s1", workspaceId: "w", kind: "response", number: i, text: `row ${i}`, at: i });
  fdb.close();

  let callCount = 0;
  const mockQuery = () => (async function* () {
    callCount++;
    yield { type: "assistant", message: { content: [{ type: "text", text: "{}" }] } };   // nothing extracted — still counts as a real, billed call
    yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0.01 };
  })();

  const r = await runKnowledgeIngest({ workspaceDir: dir, repo: "TestRepo", root: dir, token: "t", sdkQuery: mockQuery });
  assert.equal(r.rowsRead, 450);
  assert.equal(r.chunksRun, 3, "450 rows / 200 per chunk = 3 chunks (200, 200, 50)");
  assert.equal(callCount, 3);
  assert.ok(Math.abs(r.totalCost - 0.03) < 1e-9, "cost accumulates across every chunk's own call");
  rmSync(dir, { recursive: true, force: true });
});

test("runKnowledgeIngest: progress is reported per chunk, not just at the very end — a long, paid-per-call run must show live progress", async () => {
  const dir = wsFixture();
  const fdb = openFtsDb(dir);
  for (let i = 1; i <= 250; i++) upsertRow(fdb, { conversationId: "conv-1", segmentRef: "s1", workspaceId: "w", kind: "response", number: i, text: `row ${i}`, at: i });
  fdb.close();
  const mockQuery = () => (async function* () {
    yield { type: "assistant", message: { content: [{ type: "text", text: "{}" }] } };
    yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0.005 };
  })();
  const progress = [];
  await runKnowledgeIngest({ workspaceDir: dir, repo: "TestRepo", root: dir, token: "t", sdkQuery: mockQuery, onChunk: (i, total, result) => progress.push({ i, total, cost: result.cost }) });
  assert.deepEqual(progress.map((p) => [p.i, p.total]), [[1, 2], [2, 2]]);
  rmSync(dir, { recursive: true, force: true });
});

test("runKnowledgeIngest: a chunk whose SDK call throws is recorded as an error and writes NOTHING for that chunk, but the run continues to the next one", async () => {
  const dir = wsFixture();
  const fdb = openFtsDb(dir);
  for (let i = 1; i <= 250; i++) upsertRow(fdb, { conversationId: "conv-1", segmentRef: "s1", workspaceId: "w", kind: "response", number: i, text: `row ${i}`, at: i });
  fdb.close();
  let n = 0;
  const mockQuery = () => (async function* () {
    n++;
    if (n === 1) throw new Error("transport died");
    yield { type: "assistant", message: { content: [{ type: "text", text: '{"facts":[{"text":"survived the second chunk","sourceKind":"response","sourceNumber":210}]}' }] } };
    yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0.005 };
  })();
  const r = await runKnowledgeIngest({ workspaceDir: dir, repo: "TestRepo", root: dir, token: "t", sdkQuery: mockQuery });
  assert.equal(r.chunksRun, 2);
  assert.equal(r.chunks[0].error, "transport died");
  assert.equal(r.chunks[0].written.facts, 0);
  assert.equal(r.factsWritten, 1, "the SECOND chunk still succeeded and wrote its fact");
  rmSync(dir, { recursive: true, force: true });
});

test("INGEST_CHUNK_ROWS matches the earlier pilot's own chunk size (200) — not an arbitrary new number", () => {
  assert.equal(INGEST_CHUNK_ROWS, 200);
});
