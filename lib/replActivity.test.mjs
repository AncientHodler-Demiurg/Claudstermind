// node --test lib/replActivity.test.mjs
//
// THE REQUEST: "wire the REPL terminal to show Pact/REPL activity as it happens... the chat just goes
// quiet for six minutes. The operator cannot tell a long gate from a stalled agent." Priority 1+3
// together ("most of the value"): detect/list running processes, and parse _gate.py's real table +
// verdict into something the UI can render as a table with a green/red chip. Priority 2 (tail the
// live log) and 4 (history) round it out.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  matchesReplActivity, parseProcStatStartTicks, parseBootEpochSeconds, procStartEpochMs, elapsedMsSince,
  parseGateOutput, parseGateLiveProgress, pushGateHistory, listRecentLogs, tailFile, readGateReceipt, createReplActivityTracker,
  GATE_RECEIPT_PATH, LOG_TAIL_BYTES,
} from "./replActivity.mjs";

function tdir() { return mkdtempSync(join(tmpdir(), "repl-activity-")); }

// ===== matchesReplActivity — the four patterns from the request, verbatim =====
test("matchesReplActivity: the four requested patterns all match", () => {
  assert.ok(matchesReplActivity("pact AQP-FULL.repl"));
  assert.ok(matchesReplActivity("pact Stage02_Tester.repl"));
  assert.ok(matchesReplActivity("python3 REPL/tools/_gate.py --live -j8"));
  assert.ok(matchesReplActivity("python3 REPL/tools/_suite_stats.py --gate"));
  assert.ok(matchesReplActivity("python3 REPL/tools/_scale_report.py --functions"));
});
test("matchesReplActivity: unrelated processes, and near-miss substrings, do not match", () => {
  assert.equal(matchesReplActivity("node dashboard/server.mjs"), false);
  assert.equal(matchesReplActivity("/usr/bin/compact-disc-burner --eject"), false, "'compact' must not false-positive on bare 'pact'");
  assert.equal(matchesReplActivity("python3 REPL/tools/helper.py"), false, "tools/_*.py requires the leading underscore");
  assert.equal(matchesReplActivity(""), false);
  assert.equal(matchesReplActivity(null), false);
  assert.equal(matchesReplActivity(undefined), false);
});

// ===== /proc parsing (pure math/string helpers — no real /proc needed) =====
test("parseProcStatStartTicks: field 22, robust to a comm field containing spaces and parens", () => {
  // A normal comm field.
  assert.equal(parseProcStatStartTicks("12345 (pact) R 1 12345 12345 0 -1 4194304 100 0 0 0 10 2 0 0 20 0 1 0 999999 ..."), 999999);
  // comm containing a space AND a nested paren — procfs's own edge case. The REAL starttime is still
  // field 22 overall; counting from the LAST ')' is what makes this safe.
  const line = "99 (my (weird) proc name) S 1 99 99 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 555555 extra fields after";
  assert.equal(parseProcStatStartTicks(line), 555555);
});
test("parseProcStatStartTicks: malformed input never throws, returns null", () => {
  assert.equal(parseProcStatStartTicks(""), null);
  assert.equal(parseProcStatStartTicks("no parens here at all"), null);
  assert.equal(parseProcStatStartTicks(null), null);
});
test("parseBootEpochSeconds: reads the btime line out of /proc/stat's own format", () => {
  const procStat = "cpu  123 0 456 789\ncpu0 1 2 3 4\nbtime 1764000000\nprocesses 5000\n";
  assert.equal(parseBootEpochSeconds(procStat), 1764000000);
  assert.equal(parseBootEpochSeconds("no btime line"), null);
  assert.equal(parseBootEpochSeconds(""), null);
});
test("procStartEpochMs + elapsedMsSince: a process that started 375s ago reports ~375000ms elapsed", () => {
  const bootEpochSeconds = 1764000000;
  const startTicks = 37500;   // 375s * 100 ticks/s
  const startMs = procStartEpochMs(startTicks, bootEpochSeconds);
  assert.equal(startMs, (bootEpochSeconds + 375) * 1000);
  const now = startMs + 375000;
  assert.equal(elapsedMsSince(startMs, now), 375000);
});
test("procStartEpochMs / elapsedMsSince: missing data yields null, never NaN or a throw", () => {
  assert.equal(procStartEpochMs(null, 123), null);
  assert.equal(procStartEpochMs(123, null), null);
  assert.equal(elapsedMsSince(null, 1000), null);
});
test("elapsedMsSince never goes negative (clock skew / a start time that looks like the future)", () => {
  assert.equal(elapsedMsSince(2000, 1000), 0);
});

// ===== parseGateOutput — against the REAL _gate.py print format, verified via python3 directly =====
// (OuroborosNetwork/_onchain/Ouronet/REPL/tools/_gate.py: the header/row/summary f-strings, verbatim.)
const GATE_HEADER = "   secs      +     -  fail  entrypoint";
function gateRow({ secs, pos, neg, fail, broken, path }) {
  const secsStr = secs.toFixed(1).padStart(7);
  const posStr = String(pos).padStart(6);
  const negStr = String(neg).padStart(5);
  const failStr = String(fail).padStart(5);
  return `${secsStr} ${posStr} ${negStr} ${failStr}  ${broken ? "BROKEN " : ""}${path}`;
}
function buildGateSample({ rows, wallSeconds, positive, negative, verdict }) {
  const lines = [
    "GATE RUN STARTED 2026-11-28 10:00:00",
    "GATE: 110 entrypoints, 112 files reachable",
    "orphan check: clean -- every asserting file is reachable from the gate",
    "",
    "running 110 entrypoints on 8 workers ...",
    "",
    GATE_HEADER,
    ...rows.map(gateRow),
    "",
    `wall ${wallSeconds.toFixed(1)}s   executed ${positive + negative} assertions (${positive} positive, ${negative} negative)`,
    "",
    `GATE ${verdict}`,
  ];
  return lines.join("\n");
}

test("parseGateOutput: a real GREEN run — table, summary, and verdict all parse", () => {
  const text = buildGateSample({
    rows: [
      { secs: 12.3, pos: 45, neg: 3, fail: 0, path: "REPL/foo/bar.repl" },
      { secs: 375.2, pos: 1200, neg: 30, fail: 0, path: "REPL/Stage02_Tester.repl" },
    ],
    wallSeconds: 375.2, positive: 1245, negative: 33, verdict: "GREEN",
  });
  const r = parseGateOutput(text);
  assert.equal(r.verdict, "GREEN");
  assert.equal(r.reason, null);
  assert.equal(r.running, false);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { secs: 12.3, positive: 45, negative: 3, failures: 0, broken: false, path: "REPL/foo/bar.repl" });
  assert.deepEqual(r.summary, { wallSeconds: 375.2, assertions: 1278, positive: 1245, negative: 33 });
});

test("parseGateOutput: a FAILED full run — BROKEN rows are flagged, verdict is FAILED, no reason (the bare-verdict shape)", () => {
  const text = buildGateSample({
    rows: [
      { secs: 12.3, pos: 45, neg: 3, fail: 0, path: "REPL/foo/bar.repl" },
      { secs: 8.1, pos: 20, neg: 2, fail: 2, broken: true, path: "REPL/Stage02_Tester.repl" },
    ],
    wallSeconds: 20.4, positive: 65, negative: 5, verdict: "FAILED",
  });
  const r = parseGateOutput(text);
  assert.equal(r.verdict, "FAILED");
  assert.equal(r.reason, null, "the full-run failure shape has no colon/reason — only the orphan/broken rows say why");
  assert.equal(r.rows.filter((x) => x.broken).length, 1);
  assert.equal(r.rows[1].failures, 2);
});

test("parseGateOutput: the EARLY pre-flight failure shape — no table at all, a real reason after the colon", () => {
  const text = [
    "GATE RUN STARTED 2026-11-28 10:00:00",
    "GATE FAILED: leftover scratch loader(s) -- delete before running:",
    "  REPL/scratch/measure123.repl",
  ].join("\n");
  const r = parseGateOutput(text);
  assert.equal(r.verdict, "FAILED");
  assert.equal(r.reason, "leftover scratch loader(s) -- delete before running:");
  assert.equal(r.rows.length, 0);
  assert.equal(r.summary, null);
});

test("parseGateOutput: output that isn't gate output at all (a manual .repl run) parses as 'running: true', nothing else", () => {
  const r = parseGateOutput("❯ pact Stage00_Sanboxes.repl\nLoaded module free.coin\n");
  assert.equal(r.verdict, null);
  assert.equal(r.running, true);
  assert.deepEqual(r.rows, []);
  assert.equal(r.summary, null);
});

test("parseGateOutput: empty/null/undefined input is safe", () => {
  for (const v of ["", null, undefined, 42]) {
    const r = parseGateOutput(v);
    assert.equal(r.verdict, null);
    assert.deepEqual(r.rows, []);
  }
});

test("parseGateOutput: a row's numeric columns can overflow their padding width without breaking the parse (explicit single-space separators survive)", () => {
  const text = buildGateSample({
    rows: [{ secs: 1234.5, pos: 1000000, neg: 999999, fail: 0, path: "REPL/huge.repl" }],
    wallSeconds: 1234.5, positive: 1000000, negative: 999999, verdict: "GREEN",
  });
  const r = parseGateOutput(text);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].positive, 1000000);
  assert.equal(r.rows[0].path, "REPL/huge.repl");
});

test("parseGateOutput: the header row itself is never mistaken for a data row", () => {
  const r = parseGateOutput(GATE_HEADER);
  assert.deepEqual(r.rows, []);
});

// ===== parseGateLiveProgress — the --live streaming shape, verified via python3 directly =====
// (same script, different print path: as entrypoints finish, completion order, not the sorted table —
// this is what shows "how far along it is" WHILE the run is still going.)
test("parseGateLiveProgress: an ok line and a FAIL line with a running fail count both parse", () => {
  const text = [
    "  [  5/110]   ok   12.3s     45 asserts  bar.repl",
    "  [ 42/110] FAIL    8.1s     22 asserts  Stage02_Tester.repl   <-- 3 failing so far",
  ].join("\n");
  const p = parseGateLiveProgress(text);
  assert.deepEqual(p, { completed: 42, total: 110, ok: false, secs: 8.1, asserts: 22, path: "Stage02_Tester.repl", failingSoFar: 3 });
});
test("parseGateLiveProgress: returns the LATEST line (highest completion count), not the first", () => {
  const text = [
    "  [  1/110]   ok    1.0s      5 asserts  a.repl",
    "  [  2/110]   ok    2.0s      8 asserts  b.repl",
    "  [  3/110]   ok    3.0s     12 asserts  c.repl",
  ].join("\n");
  assert.equal(parseGateLiveProgress(text).completed, 3);
  assert.equal(parseGateLiveProgress(text).path, "c.repl");
});
test("parseGateLiveProgress: failingSoFar is the MAX seen across every line, not just the last one's", () => {
  // The count is only printed on a FAIL line; a later PASSING entrypoint must not make it look like
  // nothing has ever failed.
  const text = [
    "  [ 10/110] FAIL    1.0s      5 asserts  bad.repl   <-- 1 failing so far",
    "  [ 11/110]   ok    1.0s      5 asserts  good.repl",
  ].join("\n");
  assert.equal(parseGateLiveProgress(text).failingSoFar, 1);
});
test("parseGateLiveProgress: no matching lines at all (not a --live run) returns null", () => {
  assert.equal(parseGateLiveProgress("ordinary text, no progress lines here"), null);
  assert.equal(parseGateLiveProgress(""), null);
  assert.equal(parseGateLiveProgress(null), null);
});

// ===== pushGateHistory — pure ring buffer =====
test("pushGateHistory: newest first, capped at maxLen", () => {
  let h = [];
  h = pushGateHistory(h, { verdict: "GREEN", n: 1 }, 3);
  h = pushGateHistory(h, { verdict: "GREEN", n: 2 }, 3);
  h = pushGateHistory(h, { verdict: "FAILED", n: 3 }, 3);
  h = pushGateHistory(h, { verdict: "GREEN", n: 4 }, 3);
  assert.deepEqual(h.map((x) => x.n), [4, 3, 2]);
});
test("pushGateHistory: a bogus maxLen (0, negative) still keeps at least one entry", () => {
  const h = pushGateHistory([], { n: 1 }, 0);
  assert.equal(h.length, 1);
});

// ===== Real-FS I/O: listRecentLogs / tailFile / readGateReceipt (mkdtempSync — real files, no mocks) =====
test("listRecentLogs: only *.log files, newest first, old ones excluded by maxAgeMs", () => {
  const dir = tdir();
  const now = Date.now();
  writeFileSync(join(dir, "old.log"), "stale");
  utimesSync(join(dir, "old.log"), new Date(now - 10 * 60 * 60 * 1000), new Date(now - 10 * 60 * 60 * 1000));
  writeFileSync(join(dir, "new.log"), "fresh");
  utimesSync(join(dir, "new.log"), new Date(now), new Date(now));
  writeFileSync(join(dir, "notes.txt"), "not a log");
  const logs = listRecentLogs(dir, { now, maxAgeMs: 60 * 60 * 1000 });
  assert.deepEqual(logs.map((l) => l.name), ["new.log"]);
  rmSync(dir, { recursive: true, force: true });
});
test("listRecentLogs: a missing directory yields [], never throws", () => {
  assert.deepEqual(listRecentLogs(join(tdir(), "does-not-exist")), []);
});
test("listRecentLogs: respects `limit`, newest-first order across several files", () => {
  const dir = tdir();
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    writeFileSync(join(dir, `r${i}.log`), "x");
    utimesSync(join(dir, `r${i}.log`), new Date(now + i * 1000), new Date(now + i * 1000));
  }
  const logs = listRecentLogs(dir, { now: now + 10000, limit: 2 });
  assert.deepEqual(logs.map((l) => l.name), ["r4.log", "r3.log"]);
  rmSync(dir, { recursive: true, force: true });
});

test("tailFile: returns the last N bytes, flags truncation, real file", () => {
  const dir = tdir();
  const path = join(dir, "big.log");
  const content = "0123456789".repeat(10);   // 100 bytes
  writeFileSync(path, content);
  const r = tailFile(path, 20);
  assert.equal(r.text, content.slice(-20));
  assert.equal(r.truncated, true);
  assert.equal(r.sizeBytes, 100);
  rmSync(dir, { recursive: true, force: true });
});
test("tailFile: a file smaller than the cap returns in full, untruncated", () => {
  const dir = tdir();
  const path = join(dir, "small.log");
  writeFileSync(path, "hello");
  const r = tailFile(path, LOG_TAIL_BYTES);
  assert.equal(r.text, "hello");
  assert.equal(r.truncated, false);
  rmSync(dir, { recursive: true, force: true });
});
test("tailFile: a missing file is safe, empty text, never throws", () => {
  const r = tailFile("/does/not/exist/at/all.log");
  assert.deepEqual(r, { text: "", truncated: false, sizeBytes: 0 });
});

test("readGateReceipt: reads a real receipt file with its mtime; missing file is null", () => {
  const dir = tdir();
  const path = join(dir, "receipt.log");
  writeFileSync(path, "GATE RECEIPT 2026-11-28 10:00:00\nGATE GREEN\n");
  const r = readGateReceipt(path);
  assert.match(r.text, /GATE GREEN/);
  assert.equal(typeof r.mtimeMs, "number");
  assert.equal(readGateReceipt(join(dir, "nope.log")), null);
  rmSync(dir, { recursive: true, force: true });
});

test("GATE_RECEIPT_PATH matches the real installed _gate.py's own fixed receipt path exactly", () => {
  // Pinned so this constant can never silently drift from the real script's own
  // `GATE_RECEIPT = "/tmp/.ouronet-gate-receipt.log"` without a test noticing.
  assert.equal(GATE_RECEIPT_PATH, "/tmp/.ouronet-gate-receipt.log");
});

// ===== createReplActivityTracker — the stateful layer, fully injected I/O (no real FS/processes) =====
function fakeIo(overrides = {}) {
  return {
    procRoot: "/proc", logDir: "/tmp", receiptPath: GATE_RECEIPT_PATH,
    scanReplProcesses: () => [],
    listRecentLogs: () => [],
    tailFile: () => ({ text: "", truncated: false, sizeBytes: 0 }),
    readGateReceipt: () => null,
    ...overrides,
  };
}

test("tracker: with nothing running and no receipt, poll() returns a calm, empty status", () => {
  const tr = createReplActivityTracker(fakeIo());
  const s = tr.poll(1000);
  assert.deepEqual(s.processes, []);
  assert.equal(s.tail, null);
  assert.equal(s.gate, null);
  assert.deepEqual(s.history, []);
});

test("tracker: a running process shows up with its cwd and cmdline untouched", () => {
  const proc = { pid: 123, cmdline: "pact AQP-FULL.repl", cwd: "/repo/REPL", elapsedMs: 42000 };
  const tr = createReplActivityTracker(fakeIo({ scanReplProcesses: () => [proc] }));
  const s = tr.poll(1000);
  assert.deepEqual(s.processes, [proc]);
});

test("tracker: tails the newest log and surfaces its text + name", () => {
  const tr = createReplActivityTracker(fakeIo({
    listRecentLogs: () => [{ name: "gate_run.log", path: "/tmp/gate_run.log", mtimeMs: 500, sizeBytes: 10 }],
    tailFile: (p) => (p === "/tmp/gate_run.log" ? { text: "hello from the gate\n", truncated: false, sizeBytes: 10 } : { text: "", truncated: false, sizeBytes: 0 }),
  }));
  const s = tr.poll(1000);
  assert.equal(s.tail.name, "gate_run.log");
  assert.equal(s.tail.text, "hello from the gate\n");
});

test("tracker: a live tail that itself contains a finished gate table is parsed and surfaced as `gate`", () => {
  const gateText = buildGateSample({
    rows: [{ secs: 1.0, pos: 2, neg: 0, fail: 0, path: "x.repl" }],
    wallSeconds: 1.0, positive: 2, negative: 0, verdict: "GREEN",
  });
  const tr = createReplActivityTracker(fakeIo({
    listRecentLogs: () => [{ name: "live.log", path: "/tmp/live.log", mtimeMs: 500, sizeBytes: gateText.length }],
    tailFile: () => ({ text: gateText, truncated: false, sizeBytes: gateText.length }),
  }));
  const s = tr.poll(1000);
  assert.equal(s.gate.verdict, "GREEN");
  assert.equal(s.gate.rows.length, 1);
});

test("tracker: falls back to the RECEIPT's parsed gate when the newest tail isn't gate output (e.g. a manual .repl run)", () => {
  const receiptText = buildGateSample({
    rows: [{ secs: 1.0, pos: 2, neg: 0, fail: 0, path: "x.repl" }],
    wallSeconds: 1.0, positive: 2, negative: 0, verdict: "GREEN",
  });
  const tr = createReplActivityTracker(fakeIo({
    listRecentLogs: () => [{ name: "manual.log", path: "/tmp/manual.log", mtimeMs: 500, sizeBytes: 5 }],
    tailFile: () => ({ text: "Loaded module free.coin\n", truncated: false, sizeBytes: 20 }),
    readGateReceipt: () => ({ text: receiptText, mtimeMs: 999 }),
  }));
  const s = tr.poll(1000);
  assert.equal(s.gate.verdict, "GREEN", "the receipt's real gate result must still surface even though the freshest log is unrelated");
});

test("tracker: scans PAST a newer-but-unrelated log to find an older, still-relevant gate log — not just logs[0]", () => {
  // Real scenario this was built FOR: a one-off throwaway .repl measurement (or any other tool) lands
  // a newer mtime in /tmp than a gate run that finished moments earlier and is still what the operator
  // actually cares about. "gate" must not go blank just because something else wrote more recently.
  const gateText = buildGateSample({
    rows: [{ secs: 214.2, pos: 1405, neg: 223, fail: 0, path: "ZALL.repl" }],
    wallSeconds: 378.8, positive: 30934, negative: 6868, verdict: "GREEN",
  });
  const tr = createReplActivityTracker(fakeIo({
    listRecentLogs: () => [
      { name: "throwaway.log", path: "/tmp/throwaway.log", mtimeMs: 600, sizeBytes: 5 },   // newer mtime, not gate output
      { name: "gE.log", path: "/tmp/gE.log", mtimeMs: 500, sizeBytes: gateText.length },   // older, but the real gate table
    ],
    tailFile: (p) => (p === "/tmp/gE.log" ? { text: gateText, truncated: false, sizeBytes: gateText.length } : { text: "measuring something\n", truncated: false, sizeBytes: 19 }),
  }));
  const s = tr.poll(1000);
  assert.equal(s.gate.verdict, "GREEN");
  assert.equal(s.gate.rows.length, 1);
  assert.equal(s.gate.rows[0].path, "ZALL.repl");
  // The ambient "tail" feed still shows the genuinely newest log, unaffected — that part is honest
  // about "what's happening most recently", separate from the gate-table search above.
  assert.equal(s.tail.name, "throwaway.log");
});

test("tracker: REGRESSION (caught live, real /tmp data) — a verdict-only match (the receipt itself, picked up as a .log) never wins over a richer row table further down the list", () => {
  // The real GATE_RECEIPT_PATH ends in `.log` too, so it shows up in `listRecentLogs`'s own results
  // alongside everything else. It always parses with a real verdict but NEVER a row table (it's a
  // short final summary, not the full run's stdout) — if it happens to be newer than the log with the
  // actual table (exactly what was observed on a real box seconds after a gate finished), a naive
  // "stop at the first match with EITHER rows or a verdict" picks the thin receipt and never reaches
  // the rich table one slot later.
  const receiptOnlyText = "GATE RECEIPT 2026-11-28 15:17:55\nGATE: 110 entrypoints, 376 files reachable\nwall 378.8s   executed 37802 assertions (30934 positive, 6868 negative)\nGATE GREEN\n";
  const tableText = buildGateSample({
    rows: [{ secs: 214.2, pos: 1405, neg: 223, fail: 0, path: "ZALL.repl" }],
    wallSeconds: 378.8, positive: 30934, negative: 6868, verdict: "GREEN",
  });
  const tr = createReplActivityTracker(fakeIo({
    listRecentLogs: () => [
      { name: ".ouronet-gate-receipt.log", path: "/tmp/.ouronet-gate-receipt.log", mtimeMs: 700, sizeBytes: receiptOnlyText.length },
      { name: "gE.log", path: "/tmp/gE.log", mtimeMs: 500, sizeBytes: tableText.length },
    ],
    tailFile: (p) => (p === "/tmp/gE.log" ? { text: tableText, truncated: false, sizeBytes: tableText.length } : { text: receiptOnlyText, truncated: false, sizeBytes: receiptOnlyText.length }),
  }));
  const s = tr.poll(1000);
  assert.equal(s.gate.verdict, "GREEN");
  assert.equal(s.gate.rows.length, 1, "must keep scanning past the verdict-only receipt to find the real table");
  assert.equal(s.gate.rows[0].path, "ZALL.repl");
});

test("tracker: history grows ONLY when the receipt's mtime actually changes — not once per poll of the same run", () => {
  const greenText = buildGateSample({ rows: [], wallSeconds: 1, positive: 0, negative: 0, verdict: "GREEN" });
  let mtime = 100;
  const tr = createReplActivityTracker(fakeIo({ readGateReceipt: () => ({ text: greenText, mtimeMs: mtime }) }));
  tr.poll(1000);
  tr.poll(2000);
  tr.poll(3000);
  const s = tr.poll(4000);
  assert.equal(s.history.length, 1, "three extra polls of the SAME receipt must not inflate history");
  mtime = 200;   // a genuinely new run landed
  const s2 = tr.poll(5000);
  assert.equal(s2.history.length, 2);
});

test("tracker: history is capped via historyMax and stays newest-first", () => {
  let mtime = 0, verdict = "GREEN";
  const tr = createReplActivityTracker(fakeIo({
    historyMax: 2,
    readGateReceipt: () => ({ text: buildGateSample({ rows: [], wallSeconds: 1, positive: 0, negative: 0, verdict }), mtimeMs: mtime }),
  }));
  mtime = 1; tr.poll(1);
  mtime = 2; verdict = "FAILED"; tr.poll(2);
  mtime = 3; verdict = "GREEN"; const s = tr.poll(3);
  assert.equal(s.history.length, 2);
  assert.equal(s.history[0].verdict, "GREEN");
  assert.equal(s.history[1].verdict, "FAILED");
});

test("tracker: a receipt with no parseable verdict (corrupt/partial write) never joins history", () => {
  const tr = createReplActivityTracker(fakeIo({ readGateReceipt: () => ({ text: "garbage, not a real receipt", mtimeMs: 1 }) }));
  const s = tr.poll(1);
  assert.deepEqual(s.history, []);
});

// ===== tracker: in-flight `progress` (the --live completion-order lines) =====
test("tracker: a run with no verdict yet but live progress lines surfaces `progress`, not `gate`", () => {
  const liveText = [
    "running 110 entrypoints on 8 workers ...",
    "  [ 42/110]   ok   12.3s     45 asserts  bar.repl",
  ].join("\n");
  const tr = createReplActivityTracker(fakeIo({
    listRecentLogs: () => [{ name: "live.log", path: "/tmp/live.log", mtimeMs: 500, sizeBytes: liveText.length }],
    tailFile: () => ({ text: liveText, truncated: false, sizeBytes: liveText.length }),
  }));
  const s = tr.poll(1000);
  assert.equal(s.gate, null, "no verdict and no table anywhere — there is nothing finished to report as `gate`");
  assert.deepEqual(s.progress, { completed: 42, total: 110, ok: true, secs: 12.3, asserts: 45, path: "bar.repl", failingSoFar: 0 });
});
test("tracker: once a verdict exists anywhere, `progress` is suppressed — a finished run shouldn't show a stale completion count", () => {
  const liveText = buildGateSample({
    rows: [{ secs: 1, pos: 2, neg: 0, fail: 0, path: "x.repl" }],
    wallSeconds: 1, positive: 2, negative: 0, verdict: "GREEN",
  }) + "\n  [110/110]   ok    0.1s      2 asserts  x.repl";   // a trailing progress-shaped line can still exist in the same log
  const tr = createReplActivityTracker(fakeIo({
    listRecentLogs: () => [{ name: "live.log", path: "/tmp/live.log", mtimeMs: 500, sizeBytes: liveText.length }],
    tailFile: () => ({ text: liveText, truncated: false, sizeBytes: liveText.length }),
  }));
  const s = tr.poll(1000);
  assert.equal(s.gate.verdict, "GREEN");
  assert.equal(s.progress, null, "a verdict already exists — showing '110/110' alongside it would read as stale, not useful");
});
test("tracker: no progress lines and no gate at all is a calm null, not an empty object", () => {
  const tr = createReplActivityTracker(fakeIo());
  const s = tr.poll(1000);
  assert.equal(s.progress, null);
});
