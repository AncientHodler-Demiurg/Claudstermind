// node --test lib/engineStateReadouts.test.mjs
//
// THE REPORT: "why is the context not being reported? in pact the model is also not reported, why
// isn't this looking similar between the two places" — plus a model picker offering only aliases.
//
// Three readouts, three different-looking malfunctions, ONE ordinary state underneath: a conversation
// that is open but has never been prompted has no `claude` process at all (workspace.mjs calls
// `s.start()` only from `_prompt`), so `getContextUsage()`, `getSupportedModels()` and the `init`
// event that names the running model have nothing to answer with.
//
// The client could not tell that apart from "a process is running and hasn't answered yet", because
// nothing ever told it. It does now — the contextUsage reply carries `live` — and both readouts word
// the three states through ONE shared pair of functions, executed here rather than grepped for.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WorkspaceManager } from "./workspace.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

function slice(begin, end, what) {
  const a = src.indexOf(begin), b = src.indexOf(end);
  assert.ok(a >= 0 && b > a, `${what} markers must exist in app.js`);
  return src.slice(a, b + end.length);
}
// eslint-disable-next-line no-new-func
const H = new Function(`
  ${slice("// ===== WS USAGE — pure token/context formatter", "// ===== end WS USAGE pure helper =====", "usage label")}
  ${slice("// ===== ENGINE STATE", "// ===== end ENGINE STATE", "engine state")}
  return { wsUsageReadout, wsModelNowReadout };
`)();

/* ---- the context readout --------------------------------------------------------------------- */

test("nothing running: the context readout says WHEN a reading will arrive, not that there is none", () => {
  const r = H.wsUsageReadout(null, null, false);
  assert.equal(r.known, false);
  assert.match(r.text, /starts on your first message/,
    "'no reading yet' reads as a fault; naming the cause and the trigger reads as a state");
  assert.match(r.title, /not an error/i, "…and it must say so outright — this is the reported confusion");
});

test("running but silent: 'no reading yet' is now literally true, and offers the way to ask", () => {
  const r = H.wsUsageReadout(null, null, true);
  assert.match(r.text, /no reading yet/);
  assert.match(r.title, /Click to ask for it now/);
});

test("before the server has answered at all, the readout claims nothing about the engine", () => {
  const r = H.wsUsageReadout(null, null, undefined);
  assert.match(r.text, /no reading yet/, "undefined is 'we have not heard', not 'nothing is running'");
  assert.ok(!/starts on your first message/.test(r.text));
});

test("a real reading always wins, whatever the engine flag says", () => {
  const usage = { totalTokens: 93016, maxTokens: 1000000 };
  for (const live of [true, false, undefined]) {
    const r = H.wsUsageReadout(null, usage, live);
    assert.equal(r.known, true);
    assert.match(r.text, /93,016/, "a measured number is never replaced by an explanation of its absence");
  }
});

/* ---- the running-model readout ---------------------------------------------------------------- */

test("nothing running: the model chip names what WILL run instead of reporting a blank", () => {
  const r = H.wsModelNowReadout({ text: "", title: "" }, false, "Opus 5");
  assert.match(r.text, /will run Opus 5/,
    "the pick is a real, useful answer while nothing runs — 'not reported yet' throws it away");
  assert.match(r.title, /pick, not a report/, "…and it must not be mistaken for a report");
  assert.equal(r.known, false);
});

test("nothing running and nothing picked: it still says which state it is in", () => {
  const r = H.wsModelNowReadout({ text: "", title: "" }, false, "");
  assert.match(r.text, /engine not started/);
  assert.ok(!/not reported/.test(r.text), "'not reported' implies something that should have reported");
});

test("running: it reports the engine's own answer, in Core's and Pact's identical words", () => {
  const r = H.wsModelNowReadout({ text: "Opus 5", title: "Build …" }, true, "Sonnet 5");
  assert.match(r.text, /running Opus 5/, "what is RUNNING beats what was picked");
  assert.equal(r.known, true);
});

test("running but silent: 'model not reported yet' — and never the planned model dressed up as fact", () => {
  const r = H.wsModelNowReadout({ text: "", title: "" }, true, "Opus 5");
  assert.match(r.text, /model not reported yet/);
  assert.ok(!/Opus 5/.test(r.text), "a process exists; guessing what it runs would be inventing a report");
});

/* ---- the server must supply the fact ----------------------------------------------------------- */

test("the contextUsage reply carries `live` — the only place that fact is knowable", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-engine-"));
  const sends = [];
  const m = new WorkspaceManager({ root, send: (kind, key, data) => sends.push({ kind, key, data }) });
  m._contextUsage("no-such-session");
  const ev = sends.find((x) => x.data && x.data.kind === "contextUsage");
  assert.equal(ev.data.live, false,
    "a conversation with no session is not a conversation whose engine went quiet — the client has to be able to tell");
  assert.equal(ev.data.usage, null);
  assert.ok(ev.data.contextBreakdown, "the breakdown is always an object, on every path (CONTRACT §1)");
  rmSync(root, { recursive: true, force: true });
});

/* ---- and both workspaces must actually ask ----------------------------------------------------- */

test("Pact asks for a reading once per conversation, exactly as Core does", () => {
  // Pact only ever requested one after a `result`, a compaction or a resync — so a tab reopened
  // without sending anything never asked at all, and sat on 'no reading yet' indefinitely with no
  // way to distinguish that from a broken readout.
  assert.ok(src.includes("if (t.key && !t.contextUsage && t._ctxAsked !== t.key) {"),
    "Pact must have the ask-once guard");
  assert.ok(src.includes("if (p.sessionKey && !p.readonly && !p.contextUsage && p._ctxAsked !== p.sessionKey) {"),
    "…the same one Core has");
});

test("both workspaces record the `live` flag they are sent", () => {
  assert.equal((src.match(/if \(typeof d(?:ata)?\.live === "boolean"\)/g) || []).length, 2,
    "Core and Pact must each store it — a readout that never learns the fact cannot use it");
});

/* ---- the suggest bar must not invent a suggestion ---------------------------------------------- */

// "There still is a suggested continue line that probably shouldn't be here." It returned
// "Continue where you left off." for EVERY conversation that had ever had a reply, so a whole row sat
// permanently above the compose box offering a suggestion read from nothing the agent said.
const sg = src.indexOf("function pactSuggestNext(");
const sgEnd = src.indexOf("\nfunction pactAutoStop(");
// eslint-disable-next-line no-new-func
const S = new Function(src.slice(sg, sgEnd) + "\nreturn { pactSuggestNext, pactAutoNextText };")();

test("no suggestion is offered unless the reply actually named a next step", () => {
  const reply = (text) => ({ msgs: [{ role: "assistant", text }] });
  assert.equal(S.pactSuggestNext(reply("Done. Everything is green and committed.")), null,
    "a bar offering a suggestion nobody suggested is noise in the one place the real next prompt goes");
  assert.equal(S.pactSuggestNext(reply("Next: P8-signoff")).text, "Continue with P8-signoff.");
  assert.equal(S.pactSuggestNext(reply("I'll continue with wave3 after that.")).text, "Continue with wave3.");
  assert.equal(S.pactSuggestNext({ msgs: [] }), null, "and nothing at all before the first reply");
});

test("auto-continue keeps its own fallback — the loop must still have something to send", () => {
  const t = { msgs: [{ role: "assistant", text: "Done." }] };
  assert.equal(S.pactSuggestNext(t), null, "nothing to ADVERTISE…");
  assert.equal(S.pactAutoNextText(t), "Continue where you left off.",
    "…is a different question from what an armed loop sends; conflating them is what put the bar there");
});
