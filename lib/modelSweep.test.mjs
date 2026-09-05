// node --test lib/modelSweep.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { runModelSweep, summarizeSweepRow } from "./modelSweep.mjs";

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
