// node --test lib/exocortexBundle.test.mjs
//
// dashboard/public/exocortex.js is the BROWSER mirror of the seven pure exocortex modules in lib/.
// app.js is a classic script and cannot import ESM (see index.html — no bundler, no build step), so
// the repo's existing answer for a self-contained helper library is "ship it as a classic script that
// hangs off window.*, and eval it in Node with a fake window to test it" (md-mini.js, pact-highlight.js,
// deploy-helpers.js + lib/deployHelpers.test.mjs). The mirror is GENERATED rather than hand-copied so
// there is exactly one source of truth.
//
// This file is the guard on that arrangement, and it has two jobs:
//
//   1. DRIFT. Re-run the generator over the current lib/ sources and assert the committed bundle is
//      byte-identical. If someone edits one of the seven modules and forgets to regenerate, the suite
//      goes red HERE with the exact command to run — instead of the browser silently running stale
//      logic that no longer matches its own tests.
//   2. PARITY. Eval the bundle with a fake window and assert its output is deep-equal to the real ESM
//      module's for a representative call per namespace. A transform that stripped the wrong line
//      would still be byte-stable; only executing it catches that.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildBundle, readSources, transformModule, MODULES, OUT_FILE } from "../dashboard/public/exocortex.gen.mjs";
import * as usage from "./contextUsage.mjs";
import * as popover from "./contextPopover.mjs";
import * as ind from "./thresholdIndicator.mjs";
import * as win from "./transcriptWindow.mjs";
import * as cache from "./scrollCache.mjs";
import * as agents from "./agentsPanel.mjs";
import * as recall from "./recallCue.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const bundleSrc = readFileSync(join(__dir, "..", "dashboard", "public", "exocortex.js"), "utf8");

const fakeWindow = {};
new Function("window", bundleSrc)(fakeWindow);
const EXO = fakeWindow.EXO;

test("the committed browser bundle is in sync with lib/ (regenerate if this fails)", () => {
  const fresh = buildBundle(readSources());
  assert.equal(
    fresh,
    bundleSrc,
    `dashboard/public/exocortex.js is STALE.\nRun:  node dashboard/public/exocortex.gen.mjs\n(One of ${MODULES.map((m) => m.file).join(", ")} changed.)`
  );
});

test("the bundle publishes every namespace on window.EXO", () => {
  assert.ok(EXO, "window.EXO must exist after the classic script runs");
  for (const m of MODULES) assert.equal(typeof EXO[m.ns], "object", `EXO.${m.ns} must exist`);
});

test("every export of every module survives the transform", () => {
  const sources = readSources();
  for (const m of MODULES) {
    const { exports } = transformModule(m.file, sources[m.file]);
    for (const name of exports.keys()) {
      assert.notEqual(EXO[m.ns][name], undefined, `EXO.${m.ns}.${name} must be exported by the bundle`);
    }
  }
});

// --- parity, namespace by namespace -------------------------------------------------------------

const BREAKDOWN = {
  ok: true, totalTokens: 316000, maxTokens: 1000000, percentage: 31.6, model: "claude-opus-4-6",
  categories: [
    { name: "Messages", tokens: 210000, color: "#7aa2f7", pct: 21, isDeferred: false },
    { name: "System tools", tokens: 42000, color: "#9ece6a", pct: 4.2, isDeferred: false },
    { name: "Autocompact buffer", tokens: 20000, color: "#565f89", pct: 2, isDeferred: true },
  ],
  grid: [], free: { tokens: 684000, pct: 68.4 },
  memoryFiles: [{ path: "CLAUDE.md", type: "project", tokens: 12000 }],
  mcpTools: [], systemTools: [{ name: "Bash", tokens: 1400 }], systemPromptSections: [],
};

test("parity: EXO.usage / EXO.popover", () => {
  assert.equal(EXO.usage.k(316000), usage.k(316000));
  assert.deepEqual(EXO.popover.shapeContextPopover(BREAKDOWN), popover.shapeContextPopover(BREAKDOWN));
  // The unavailable path is the one that must never render as "0% used" — check it crosses too.
  const zeroed = { ok: false, totalTokens: 0, maxTokens: 0, categories: [], grid: [], free: { tokens: 0, pct: 0 } };
  assert.deepEqual(EXO.popover.shapeContextPopover(zeroed), popover.shapeContextPopover(zeroed));
  assert.equal(EXO.popover.shapeContextPopover(zeroed).available, false);
});

test("parity: EXO.ind", () => {
  let a = EXO.ind.emptyIndicatorState(), b = ind.emptyIndicatorState();
  for (const ev of [
    { kind: "loadingHistory", bytes: 61e6, at: 1000 },
    { kind: "rolling", segment: 2, sourceRef: "Repo@main#seg2", at: 1100 },
    { kind: "lookingUp", mode: "number", kindOf: "response", number: 1237, at: 1200 },
    { kind: "recall", mode: "number", ok: true, at: 1300 },
    { kind: "compacted", trigger: "auto", preTokens: 812000, postTokens: 190000, at: 1400 },
  ]) {
    a = EXO.ind.reduceIndicator(a, ev, 9999);
    b = ind.reduceIndicator(b, ev, 9999);
  }
  assert.deepEqual(a, b);
  const opts = { now: 2000, popover: popover.shapeContextPopover(BREAKDOWN) };
  assert.deepEqual(EXO.ind.shapeIndicators(a, opts), ind.shapeIndicators(b, opts));
  assert.equal(EXO.ind.nextIndicatorDeadline(a, 2000), ind.nextIndicatorDeadline(b, 2000));
  assert.deepEqual(
    EXO.ind.contextTierFromPopover(EXO.popover.shapeContextPopover(BREAKDOWN)),
    ind.contextTierFromPopover(popover.shapeContextPopover(BREAKDOWN))
  );
});

test("parity: EXO.win", () => {
  const payload = {
    transcript: Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "r" + i })),
    transcriptTotal: 1200, transcriptTruncated: true, promptOffset: 175, responseOffset: 175,
    windowStart: 350, windowEnd: 390,
  };
  const bandA = EXO.win.normalizeBand(payload), bandB = win.normalizeBand(payload);
  assert.deepEqual(bandA, bandB);
  const va = EXO.win.applyBand(EXO.win.emptyView(), bandA, { center: 370 });
  const vb = win.applyBand(win.emptyView(), bandB, { center: 370 });
  assert.deepEqual(va, vb);
  assert.deepEqual(EXO.win.viewAffordances(va.view), win.viewAffordances(vb.view));
  assert.deepEqual(EXO.win.planJump(va.view, "prompt", 900), win.planJump(vb.view, "prompt", 900));
  assert.deepEqual(EXO.win.planExtend(va.view, "up"), win.planExtend(vb.view, "up"));
  assert.deepEqual(EXO.win.turnAt(bandA, 350), win.turnAt(bandB, 350));
});

test("parity: EXO.cache", () => {
  const band = { rows: [{ role: "user" }, { role: "assistant" }], start: 10, end: 12, total: 100 };
  const a = EXO.cache.createScrollCache({ signature: "x" });
  const b = cache.createScrollCache({ signature: "x" });
  assert.deepEqual(EXO.cache.put(a, band), cache.put(b, band));
  assert.deepEqual(EXO.cache.get(a, 10, 12), cache.get(b, 10, 12));
  assert.deepEqual(EXO.cache.findContaining(a, 11), cache.findContaining(b, 11));
  assert.deepEqual(EXO.cache.noteTotal(a, 50), cache.noteTotal(b, 50));
  assert.deepEqual(EXO.cache.stats(a), cache.stats(b));
});

test("parity: EXO.agents", () => {
  const payload = {
    panel: {
      count: 2, running: 1, done: 1, totalTokens: 4200,
      agents: [
        { id: "t1", label: "Explore", description: "audit", elapsedMs: 400000, tokens: 0, status: "running" },
        { id: "t2", label: "local_workflow", description: "phase 2", elapsedMs: 40000, tokens: 4200, status: "done" },
      ],
    },
  };
  const ta = EXO.agents.trackAgentActivity(null, payload, 1000);
  const tb = agents.trackAgentActivity(null, payload, 1000);
  assert.deepEqual(ta, tb);
  const now = 1000 + 6 * 60 * 1000;
  const va = EXO.agents.shapeAgentsPanel(payload, now, { tracking: ta });
  const vb = agents.shapeAgentsPanel(payload, now, { tracking: tb });
  assert.deepEqual(va, vb);
  assert.equal(va.anyStale, true, "a 6-minute-silent running agent must read as possibly stalled");
  assert.equal(EXO.agents.agentsPanelSummary(va), agents.agentsPanelSummary(vb));
  assert.deepEqual(EXO.agents.shapeAgentsPanel(null, now), agents.shapeAgentsPanel(null, now));
  assert.equal(EXO.agents.shapeAgentsPanel(null, now).hasData, false);
});

test("parity: EXO.recall", () => {
  const lookingUp = { kind: "lookingUp", mode: "number", kindOf: "response", number: 1237, at: 10 };
  const hit = {
    kind: "recall", mode: "number", kindOf: "response", number: 1237, ok: true, error: null, at: 20,
    hit: { segmentRef: "Repo@main#seg1", workspaceId: "Repo@main", kind: "response", number: 1237, text: "hello", images: [] },
  };
  const miss = { kind: "recall", mode: "query", query: "nope", ok: false, hits: [], error: "", at: 30 };
  let a = EXO.recall.reduceRecallCue(undefined, lookingUp);
  let b = recall.reduceRecallCue(undefined, lookingUp);
  assert.deepEqual(a, b);
  assert.deepEqual(EXO.recall.recallCueLabel(a), recall.recallCueLabel(b));
  a = EXO.recall.reduceRecallCue(a, hit);
  b = recall.reduceRecallCue(b, hit);
  assert.deepEqual(a, b);
  const ma = EXO.recall.reduceRecallCue(undefined, miss);
  assert.deepEqual(ma, recall.reduceRecallCue(undefined, miss));
  assert.equal(ma.active, false, "a miss must always turn the cue OFF — never a stuck spinner");
  assert.equal(ma.result.status, "empty");
});
