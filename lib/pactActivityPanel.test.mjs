// node --test lib/pactActivityPanel.test.mjs
//
// THE REQUEST: "wire the REPL terminal to show Pact/REPL activity as it happens... the chat just goes
// quiet for six minutes. The operator cannot tell a long gate from a stalled agent." This is the
// PRESENTATION layer: a process label, an elapsed-time formatter, and the activity panel itself, which
// renders a GET /api/pact/repl-activity poll (lib/replActivity.mjs does the actual detection/parsing —
// see lib/replActivity.test.mjs for that half).
//
// pactActivityPanel is DOM-producing (uses the real `el()`/`document.createElement`), so this evals it
// against a MINIMAL fake DOM (plain JS objects standing in for elements) rather than requiring jsdom —
// real behavioural assertions on the actual rendered tree, not just source-text pinning, since the
// stub is cheap enough here to be worth building properly (see /tmp verification during development).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

function makeNode(tag) {
  return {
    tag, className: "", attrs: {}, children: [], listeners: {}, hidden: false,
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(k, v) { this.listeners[k] = v; },
    append(...cs) { for (const c of cs) this.children.push(c); },
    replaceChildren(...cs) { this.children = cs; },
  };
}

function buildPanel() {
  const elSrc = (() => {
    const s = src.indexOf("const el = (tag, props = {}, kids = []) => {");
    const e = src.indexOf("\n};\n", s) + 3;
    return src.slice(s, e);
  })();
  const beginM = "// ===== PACT ACTIVITY PANEL — pure helpers";
  const endM = "// ===== end PACT ACTIVITY PANEL pure helpers =====";
  const a = src.indexOf(beginM), b = src.indexOf(endM);
  assert.ok(a >= 0 && b > a, "the pure-helpers block markers must exist in app.js");
  const pureHelpers = src.slice(a, b + endM.length);
  const panelStart = src.indexOf("function pactActivityPanel() {");
  assert.ok(panelStart >= 0, "pactActivityPanel must exist");
  const panelEnd = src.indexOf("\n}\n", panelStart) + 3;
  const panelFn = src.slice(panelStart, panelEnd);
  const factory = new Function("document", [elSrc, pureHelpers, panelFn, "return pactActivityPanel();"].join("\n"));
  return factory({ createElement: (tag) => makeNode(tag) });
}

function findAll(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const c of node.children || []) if (c && typeof c === "object") findAll(c, predicate, out);
  return out;
}
function textOf(node) {
  return (node.children || []).map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}
function hasClass(node, cls) { return (node.className || "").split(" ").includes(cls); }

// ===== pactActivityProcLabel / pactActivityElapsed — pure, extracted independently too =====
function pureHelpers() {
  const beginM = "// ===== PACT ACTIVITY PANEL — pure helpers";
  const endM = "// ===== end PACT ACTIVITY PANEL pure helpers =====";
  const a = src.indexOf(beginM), b = src.indexOf(endM);
  const block = src.slice(a, b + endM.length);
  // eslint-disable-next-line no-new-func
  return new Function(block + "\nreturn { pactActivityProcLabel, pactActivityElapsed };")();
}

test("pactActivityProcLabel: the four request patterns get a readable label", () => {
  const { pactActivityProcLabel: label } = pureHelpers();
  assert.equal(label("pact AQP-FULL.repl"), "pact AQP-FULL.repl");
  assert.equal(label("pact Stage02_Tester.repl"), "pact Stage02_Tester.repl");
  assert.equal(label("python3 REPL/tools/_gate.py --live -j8"), "gate (full suite)");
  assert.equal(label("python3 REPL/tools/_suite_stats.py --gate"), "suite stats");
  assert.equal(label("python3 REPL/tools/_scale_report.py --functions"), "_scale_report.py");
});
test("pactActivityProcLabel: a `pact /abs/path/file.repl` invocation shows just the basename", () => {
  const { pactActivityProcLabel: label } = pureHelpers();
  assert.equal(label("pact /home/x/REPL/deep/Stage00b_Run.repl"), "pact Stage00b_Run.repl");
});
test("pactActivityProcLabel: never throws on empty/odd input", () => {
  const { pactActivityProcLabel: label } = pureHelpers();
  assert.equal(label(""), "(unknown)");
  assert.equal(label(null), "(unknown)");
});

test("pactActivityElapsed: formats minutes+seconds, bare seconds, and missing data", () => {
  const { pactActivityElapsed: fmt } = pureHelpers();
  assert.equal(fmt(65000), "1m 05s");
  assert.equal(fmt(5000), "5s");
  assert.equal(fmt(0), "0s");
  assert.equal(fmt(null), "—");
  assert.equal(fmt(-5), "—");
});

// ===== pactActivityPanel — real rendered structure, against a minimal fake DOM =====
test("idle: no data at all shows the calm 'nothing detected' line and nothing else", () => {
  const panel = buildPanel();
  assert.equal(textOf(findAll(panel.el, (n) => hasClass(n, "pact-activity-idle"))[0]), "No Pact/REPL activity detected.");
  assert.equal(findAll(panel.el, (n) => hasClass(n, "pact-activity-procs"))[0].hidden, true);
  assert.equal(findAll(panel.el, (n) => hasClass(n, "pact-activity-gate"))[0].hidden, true);
});

test("a running process renders its label, cwd, and elapsed — and the idle line disappears", () => {
  const panel = buildPanel();
  panel.render({ processes: [{ pid: 1, cmdline: "pact AQP-FULL.repl", cwd: "/repo/REPL", elapsedMs: 125000 }], gate: null, progress: null, history: [] });
  const proc = findAll(panel.el, (n) => hasClass(n, "pact-activity-proc"))[0];
  assert.ok(proc, "a process row must be rendered");
  assert.equal(textOf(findAll(proc, (n) => hasClass(n, "pact-activity-proc-label"))[0]), "pact AQP-FULL.repl");
  assert.equal(textOf(findAll(proc, (n) => hasClass(n, "pact-activity-proc-elapsed"))[0]), "2m 05s");
  assert.equal(findAll(panel.el, (n) => hasClass(n, "pact-activity-idle"))[0].hidden, true);
});

test("multiple concurrent processes each get their own row — the exact 'several overlap' scenario from the request", () => {
  const panel = buildPanel();
  panel.render({
    processes: [
      { pid: 1, cmdline: "python3 REPL/tools/_gate.py", cwd: "/repo/REPL", elapsedMs: 300000 },
      { pid: 2, cmdline: "pact AQP-FULL.repl", cwd: "/repo/REPL", elapsedMs: 60000 },
      { pid: 3, cmdline: "python3 REPL/tools/_suite_stats.py --gate", cwd: "/repo/REPL", elapsedMs: 500000 },
    ],
    gate: null, progress: null, history: [],
  });
  const procs = findAll(panel.el, (n) => hasClass(n, "pact-activity-proc"));
  assert.equal(procs.length, 3);
  const labels = procs.map((p) => textOf(findAll(p, (n) => hasClass(n, "pact-activity-proc-label"))[0]));
  assert.deepEqual(labels, ["gate (full suite)", "pact AQP-FULL.repl", "suite stats"]);
});

test("in-flight progress renders a bar + label, and does NOT show a verdict chip (nothing has finished)", () => {
  const panel = buildPanel();
  panel.render({ processes: [], gate: null, progress: { completed: 42, total: 110, ok: true, secs: 12.3, asserts: 45, path: "bar.repl", failingSoFar: 0 }, history: [] });
  const bar = findAll(panel.el, (n) => hasClass(n, "pact-activity-bar-fill"))[0];
  assert.ok(bar, "a progress bar must render");
  assert.equal(bar.attrs.style, "width:38%");   // round(42/110*100) = 38
  const label = textOf(findAll(panel.el, (n) => hasClass(n, "pact-activity-progress-label"))[0]);
  assert.match(label, /42\/110 entrypoints/);
  assert.match(label, /bar\.repl/);
  assert.equal(findAll(panel.el, (n) => hasClass(n, "pact-gate-chip")).length, 0);
});

test("in-flight progress with a running fail count surfaces a visible warning", () => {
  const panel = buildPanel();
  panel.render({ processes: [], gate: null, progress: { completed: 10, total: 110, ok: false, secs: 1, asserts: 5, path: "bad.repl", failingSoFar: 2 }, history: [] });
  const label = textOf(findAll(panel.el, (n) => hasClass(n, "pact-activity-progress-label"))[0]);
  assert.match(label, /⚠ 2 failing so far/);
});

test("a finished GREEN gate: chip, summary, and the full table render, broken rows styled distinctly", () => {
  const panel = buildPanel();
  panel.render({
    processes: [],
    gate: {
      rows: [
        { secs: 214.2, positive: 1405, negative: 223, failures: 0, broken: false, path: "ZALL.repl" },
        { secs: 8.1, positive: 20, negative: 2, failures: 2, broken: true, path: "Stage02_Tester.repl" },
      ],
      summary: { wallSeconds: 378.8, assertions: 37802, positive: 30934, negative: 6868 },
      verdict: "GREEN", reason: null,
    },
    progress: null, history: [],
  });
  const chip = findAll(panel.el, (n) => hasClass(n, "pact-gate-chip"))[0];
  assert.ok(hasClass(chip, "--green"));
  assert.equal(textOf(chip), "🟢 GATE GREEN");
  assert.match(textOf(findAll(panel.el, (n) => hasClass(n, "pact-activity-summary"))[0]), /378\.8s.*37802 assertions/);
  const rows = findAll(panel.el, (n) => hasClass(n, "pact-activity-row") && !hasClass(n, "pact-activity-row-hd"));
  assert.equal(rows.length, 2);
  assert.ok(hasClass(rows[1], "--broken"), "the broken row must carry a distinct style class");
  assert.ok(!hasClass(rows[0], "--broken"));
});

test("a FAILED gate (early pre-flight shape) shows the reason in the chip itself", () => {
  const panel = buildPanel();
  panel.render({ processes: [], gate: { rows: [], summary: null, verdict: "FAILED", reason: "leftover scratch loader(s)" }, progress: null, history: [] });
  const chip = findAll(panel.el, (n) => hasClass(n, "pact-gate-chip"))[0];
  assert.ok(hasClass(chip, "--red"));
  assert.match(textOf(chip), /GATE FAILED/);
  assert.match(textOf(chip), /leftover scratch loader\(s\)/);
});

test("history renders one chip per past run, newest first, green/red matching verdict", () => {
  const panel = buildPanel();
  panel.render({
    processes: [], gate: null, progress: null,
    history: [{ verdict: "GREEN", at: 1000 }, { verdict: "FAILED", at: 500, reason: "a broken entrypoint" }],
  });
  const chips = findAll(panel.el, (n) => hasClass(n, "pact-activity-hist-chip"));
  assert.equal(chips.length, 2);
  assert.ok(hasClass(chips[0], "--green"));
  assert.ok(hasClass(chips[1], "--red"));
  assert.match(chips[1].attrs.title, /a broken entrypoint/);
});

test("an empty history array hides the strip entirely — no bare label floating with nothing after it", () => {
  const panel = buildPanel();
  panel.render({ processes: [], gate: null, progress: null, history: [] });
  assert.equal(findAll(panel.el, (n) => hasClass(n, "pact-activity-hist"))[0].hidden, true);
});

test("render(null) / render(undefined) is safe — the calm idle state, never a throw", () => {
  const panel = buildPanel();
  assert.doesNotThrow(() => panel.render(null));
  assert.doesNotThrow(() => panel.render(undefined));
  assert.equal(findAll(panel.el, (n) => hasClass(n, "pact-activity-idle"))[0].hidden, false);
});
