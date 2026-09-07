// node --test lib/compactionMarker.test.mjs
//
// TWO REPORTED BUGS, one root cause.
//
//   "after compacting the compacting prompt looked like it didn't process"
//   "comapction didnt bring the compaction bar, like it was suppose to"
//
// `/compact` produces no assistant reply. Both clients recognise an INTERRUPTED prompt as "the
// trailing user turn on an idle conversation with no assistant turn after it" — which is exactly the
// shape a SUCCESSFUL compaction leaves behind. So a compaction that worked perfectly painted its own
// prompt dark blue with ▶ resume / ✕ discard buttons. And because compaction was only ever narrated
// to the per-client activity rail, there was no mark in the conversation at all: nothing on reload,
// nothing on another device, nothing to tell a reader where the window was summarised.
//
// Recording it as a TRANSCRIPT ROW fixes both, durably. This suite pins the row (server side) and
// the two scans that must treat it as an answer (client side).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WorkspaceManager } from "./workspace.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

function mgr() {
  const root = mkdtempSync(join(tmpdir(), "cm-compact-"));
  const sends = [];
  const m = new WorkspaceManager({ root, send: (kind, key, data) => sends.push({ kind, key, data }) });
  return { m, sends, root };
}

/* ---- 1. the row exists, and it is durable ------------------------------------------------------ */

test("a `compacted` event is RECORDED in the transcript, not just forwarded", () => {
  const { m, sends, root } = mgr();
  const s = { key: "k1", workspaceId: "w1", transcript: [{ role: "user", text: "/compact" }], status: "idle" };
  m.sessions.set("k1", s);
  m._onEvent("k1", { kind: "compacted", trigger: "manual", preTokens: 812000, postTokens: 190000 });

  const row = s.transcript[s.transcript.length - 1];
  assert.equal(row.kind, "compacted", "the conversation itself has to carry the boundary");
  assert.equal(row.preTokens, 812000);
  assert.equal(row.postTokens, 190000);
  assert.equal(row.trigger, "manual", "an automatic compaction is not the same event as one you asked for");
  assert.equal(typeof row.at, "number");

  const ev = sends.find((x) => x.kind === "event" && x.data.kind === "compacted");
  assert.equal(ev.data.at, row.at,
    "the forwarded event carries the SAME `at` as the persisted row — that is what lets a client render "
    + "it immediately and have a later resync replace its optimistic copy instead of doubling it");
  rmSync(root, { recursive: true, force: true });
});

test("the recorded row is what gets persisted, so it survives a reload and reaches other devices", () => {
  const { m, root } = mgr();
  const s = { key: "k1", workspaceId: "w1", transcript: [], status: "idle", _persistedCount: 0 };
  m.sessions.set("k1", s);
  m._onEvent("k1", { kind: "compacted", trigger: "auto", preTokens: 500000, postTokens: 120000 });
  const before = s._persistedCount;
  m._persist(s);
  assert.ok(s._persistedCount > before, "the mark is flushed with the rest of the turn — an activity-rail line was neither stored nor shared");
  rmSync(root, { recursive: true, force: true });
});

/* ---- 2. the row ANSWERS the prompt that caused it ---------------------------------------------- */

// Both scans are one line inside dashboard/public/app.js's view closures, so they are exercised by
// re-declaring them from the shipped source rather than re-describing them here.
function scanOf(fnName, arrayProp) {
  const i = app.indexOf(`function ${fnName}(`);
  assert.ok(i >= 0, `${fnName} must exist in app.js`);
  const body = app.slice(i, app.indexOf("\n  }", i) + 4);
  const loop = body.slice(body.indexOf("for (let i ="), body.lastIndexOf("return -1;"));
  // eslint-disable-next-line no-new-func
  return new Function("rows", `const p = { ${arrayProp}: rows }; ${loop.replace(/p\.\w+\.length/, "rows.length").replace(/p\.\w+\[i\]/, "rows[i]").replace(/t\.msgs\.length/, "rows.length").replace(/t\.msgs\[i\]/, "rows[i]")} return -1;`);
}

for (const [fn, prop] of [["wsInterruptedIdx", "transcript"], ["pactInterruptedIdx", "msgs"]]) {
  test(`${fn}: a compaction row counts as an answer — a successful /compact must not look interrupted`, () => {
    const scan = scanOf(fn, prop);
    const prompt = { role: "user", text: "/compact", at: 1 };
    assert.equal(scan([prompt]), 0,
      "sanity: an unanswered trailing prompt IS the interrupted shape — that part was never wrong");
    assert.equal(scan([prompt, { kind: "compacted", at: 2 }]), -1,
      "…but a compaction row after it is the answer. This is the reported bug: a compaction that "
      + "WORKED painted its own prompt dark blue with resume/discard buttons.");
    assert.equal(scan([prompt, { kind: "wrapped", at: 2 }]), -1,
      "a wrap is the same kind of answer — it also produces no assistant reply");
    assert.equal(scan([prompt, { kind: "compacted", at: 2 }, { role: "user", text: "next", at: 3 }]), 2,
      "and a genuinely unanswered prompt AFTER the mark is still recognised");
  });
}

/* ---- 3. the bar is drawn, by the package, in both workspaces ----------------------------------- */

test("both workspaces render the mark through the package's ONE builder", () => {
  assert.ok(app.includes("function wsMarkNode(m) {") && app.includes("window.ChatShell.buildMark({"),
    "the look, wording and tooltips belong to the package — this design already existed in the Chat "
    + "Shell Lab and, until now, existed ONLY there");
  // A FAILED TURN is the third kind of mark, and it rides the same builder: the two renderers must
  // stay one line each, or a third mark ends up drawn two different ways in two workspaces.
  assert.equal((app.match(/if \(m\.kind === "compacted" \|\| m\.kind === "wrapped" \|\| m\.kind === "turnError"\) return wsMarkNode\(m\);/g) || []).length, 2,
    "Core's renderItem and Pact's message renderer must both go through it");
  assert.match(app, /if \(m && m\.kind === "turnError"\) \{[\s\S]*?window\.ChatShell\.buildMark\(\{ kind: "error"/,
    "…and a failed turn must reach the package's builder too, not get its own ad-hoc node");
});

test("a compaction row survives Pact's rehydrate — otherwise the bar vanishes on the first resync", () => {
  const i = app.indexOf("function pactTranscriptToMsgs(");
  const body = app.slice(i, app.indexOf("\n}", i));
  assert.ok(body.includes('m.kind === "compacted"'),
    "a mark dropped on rehydrate would take the /compact prompt back to looking interrupted");
  assert.ok(body.includes('m.kind === "wrapped"'), "same for the wrap mark");
});
