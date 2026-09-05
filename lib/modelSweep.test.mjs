// node --test lib/modelSweep.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { runModelSweep, summarizeSweepRow, createSweepRun } from "./modelSweep.mjs";

function delay(ms, value) { return new Promise((res) => setTimeout(() => res(value), ms)); }

test("empty model list resolves to an empty array without calling testFn", async () => {
  let calls = 0;
  const r = await runModelSweep([], async () => { calls++; });
  assert.deepEqual(r, []);
  assert.equal(calls, 0);
});

test("non-array / garbage model list is treated as empty", async () => {
  assert.deepEqual(await runModelSweep(null, async () => ({})), []);
  assert.deepEqual(await runModelSweep(undefined, async () => ({})), []);
  assert.deepEqual(await runModelSweep(["ok", 42, null, ""], async (m) => ({ ok: true, model: m })).then((r) => r.map((x) => x.model)), ["ok"]);
});

test("results preserve INPUT order regardless of completion order (fast model finishes after a slow one)", async () => {
  const order = { a: 40, b: 5, c: 20 };
  const r = await runModelSweep(["a", "b", "c"], async (m) => { await delay(order[m]); return { ok: true, model: m }; }, { concurrency: 3 });
  assert.deepEqual(r.map((x) => x.model), ["a", "b", "c"]);
});

test("respects the concurrency cap — never more than N in flight at once", async () => {
  let inFlight = 0, maxInFlight = 0;
  const models = Array.from({ length: 10 }, (_, i) => "m" + i);
  await runModelSweep(models, async (m) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await delay(15);
    inFlight--;
    return { ok: true, model: m };
  }, { concurrency: 3 });
  assert.ok(maxInFlight <= 3, `expected at most 3 in flight, saw ${maxInFlight}`);
  assert.equal(maxInFlight, 3, "with 10 models and concurrency 3 it should actually reach the cap, not under-use it");
});

test("a testFn that throws is captured per-model — one bad model doesn't abort the sweep", async () => {
  const r = await runModelSweep(["good", "bad"], async (m) => {
    if (m === "bad") throw new Error("boom");
    return { ok: true, model: m, reply: "hi" };
  }, { concurrency: 2 });
  assert.equal(r[0].ok, true);
  assert.equal(r[1].ok, false);
  assert.equal(r[1].model, "bad");
  assert.match(r[1].error, /boom/);
});

test("concurrency guards: 0, negative, non-finite all clamp to at least 1 (never a stuck/zero-worker sweep)", async () => {
  const r0 = await runModelSweep(["a"], async (m) => ({ ok: true, model: m }), { concurrency: 0 });
  const rNeg = await runModelSweep(["a"], async (m) => ({ ok: true, model: m }), { concurrency: -5 });
  const rNaN = await runModelSweep(["a"], async (m) => ({ ok: true, model: m }), { concurrency: NaN });
  assert.equal(r0.length, 1); assert.equal(rNeg.length, 1); assert.equal(rNaN.length, 1);
});

test("missing testFn (not a function) resolves to an empty array instead of throwing", async () => {
  assert.deepEqual(await runModelSweep(["a", "b"], null), []);
});

test("summarizeSweepRow: a successful result truncates the reply to ~200 chars for the preview", () => {
  const longReply = "x".repeat(500);
  const row = summarizeSweepRow({ ok: true, model: "omni/cursor/gpt-5", provider: { key: "cursor", label: "Cursor" }, reply: longReply, latencyMs: 1234 });
  assert.equal(row.status, "ok");
  assert.equal(row.model, "omni/cursor/gpt-5");
  assert.deepEqual(row.provider, { key: "cursor", label: "Cursor" });
  assert.equal(row.latencyMs, 1234);
  assert.equal(row.preview.length, 200);
  assert.equal(row.preview, "x".repeat(200));
});

test("summarizeSweepRow: a failed result surfaces the RAW error text, never a generic placeholder", () => {
  const row = summarizeSweepRow({ ok: false, model: "omni/groq/bad-id", provider: { key: "groq" }, error: "402 insufficient credits", latencyMs: 88 });
  assert.equal(row.status, "error");
  assert.equal(row.preview, "402 insufficient credits");
});

test("summarizeSweepRow: guards against a missing/malformed result", () => {
  const row = summarizeSweepRow(null);
  assert.equal(row.ok, false);
  assert.equal(row.model, "");
  assert.equal(row.provider, null);
  assert.equal(row.latencyMs, null);
  assert.equal(row.preview, "Unknown error");
});

test("onProgress fires once per model with a running done/total count", async () => {
  const seen = [];
  await runModelSweep(["a", "b", "c"], async (m) => ({ ok: true, model: m }), {
    concurrency: 1, onProgress: (p) => seen.push({ model: p.model, done: p.done, total: p.total }),
  });
  assert.deepEqual(seen, [
    { model: "a", done: 1, total: 3 },
    { model: "b", done: 2, total: 3 },
    { model: "c", done: 3, total: 3 },
  ]);
});

test("a THROWING onProgress listener never aborts the sweep (a broken UI callback can't kill a 200-model run)", async () => {
  const r = await runModelSweep(["a", "b"], async (m) => ({ ok: true, model: m }), {
    concurrency: 1, onProgress: () => { throw new Error("listener blew up"); },
  });
  assert.deepEqual(r.map((x) => x.model), ["a", "b"]);
});

test("shouldStop halts dispatch of NEW models; already-settled results are still returned (dense, no holes)", async () => {
  let stopped = false;
  const called = [];
  const r = await runModelSweep(["a", "b", "c", "d"], async (m) => { called.push(m); if (m === "b") stopped = true; return { ok: true, model: m }; }, {
    concurrency: 1, shouldStop: () => stopped,
  });
  assert.deepEqual(called, ["a", "b"], "should not dispatch anything after the stop flag flips");
  assert.deepEqual(r.map((x) => x.model), ["a", "b"]);
  assert.ok(r.every(Boolean), "a cancelled sweep must not return holes");
});

test("createSweepRun: a full run emits start → one row per model → end, and the snapshot tracks done/total", async () => {
  const events = [];
  const run = createSweepRun({ testFn: async (m) => ({ ok: m !== "bad", model: m, reply: "hi", error: m === "bad" ? "429 rate limited" : null, latencyMs: 5 }), concurrency: 2, now: () => 1000 });
  run.subscribe((e) => events.push(e.kind));
  const out = await run.start(["good", "bad"], "say hi");
  assert.equal(out.ok, true);
  assert.deepEqual(events, ["start", "row", "row", "end"]);
  const snap = run.snapshot();
  assert.equal(snap.running, false);
  assert.equal(snap.total, 2);
  assert.equal(snap.done, 2);
  assert.equal(snap.prompt, "say hi");
  assert.equal(snap.startedAt, 1000);
  assert.equal(snap.finishedAt, 1000);
  const bad = snap.rows.find((r) => r.model === "bad");
  assert.equal(bad.status, "error");
  assert.equal(bad.preview, "429 rate limited", "the RAW provider error must survive into the row");
});

test("createSweepRun: a second start while one is running is refused as busy (never doubles provider load)", async () => {
  let release;
  const gate = new Promise((res) => { release = res; });
  const run = createSweepRun({ testFn: async (m) => { await gate; return { ok: true, model: m }; }, concurrency: 1 });
  const first = run.start(["a"], "p");
  const second = await run.start(["b"], "p");
  assert.equal(second.ok, false);
  assert.equal(second.reason, "busy");
  release();
  await first;
  assert.equal(run.snapshot().rows.length, 1, "the refused sweep must not have added rows");
});

test("createSweepRun: an empty / garbage model list is refused without flipping into a 'running' state", async () => {
  const run = createSweepRun({ testFn: async (m) => ({ ok: true, model: m }) });
  assert.equal((await run.start([], "p")).reason, "no-models");
  assert.equal((await run.start(null, "p")).reason, "no-models");
  assert.equal(run.snapshot().running, false);
});

test("createSweepRun: stop() halts a long sweep — the snapshot ends with fewer rows than total, and running goes false", async () => {
  const run = createSweepRun({ testFn: async (m) => ({ ok: true, model: m, reply: "x" }), concurrency: 1 });
  run.subscribe((e) => { if (e.kind === "row" && e.done === 1) run.stop(); });
  await run.start(["a", "b", "c", "d"], "p");
  const snap = run.snapshot();
  assert.equal(snap.running, false);
  assert.equal(snap.total, 4);
  assert.ok(snap.rows.length < 4, `expected a short sweep, got ${snap.rows.length} rows`);
  assert.ok(snap.rows.length >= 1);
});

test("createSweepRun: unsubscribe actually detaches, and a throwing subscriber can't break the run", async () => {
  const run = createSweepRun({ testFn: async (m) => ({ ok: true, model: m }), concurrency: 1 });
  let count = 0;
  const off = run.subscribe(() => { count++; });
  run.subscribe(() => { throw new Error("bad subscriber"); });
  off();
  const out = await run.start(["a"], "p");
  assert.equal(out.ok, true);
  assert.equal(count, 0, "an unsubscribed listener must stop receiving events");
  assert.equal(run.snapshot().rows.length, 1);
});

test("createSweepRun: snapshot() returns a COPY — a caller mutating it can't corrupt the live run state", async () => {
  const run = createSweepRun({ testFn: async (m) => ({ ok: true, model: m }) });
  await run.start(["a"], "p");
  const snap = run.snapshot();
  snap.rows.push({ model: "injected" });
  assert.equal(run.snapshot().rows.length, 1);
});

test("createSweepRun: a per-run concurrency override is honoured but hard-capped at 8 (a sweep can be dialled down, never up past the cap)", async () => {
  let inFlight = 0, maxInFlight = 0;
  const models = Array.from({ length: 30 }, (_, i) => "m" + i);
  const run = createSweepRun({ testFn: async (m) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return { ok: true, model: m }; }, concurrency: 3 });
  await run.start(models, "p", { concurrency: 999 });
  assert.ok(maxInFlight <= 8, `expected the hard cap of 8, saw ${maxInFlight}`);
});
