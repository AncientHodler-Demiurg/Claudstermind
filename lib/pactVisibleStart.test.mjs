// node --test lib/pactVisibleStart.test.mjs
// pactVisibleStart (the Pact chat's render-window cap) lives in the browser monolith
// (dashboard/public/app.js). We can't eval the whole file (it boots the DOM), so we slice out the
// sentinel-marked pure-helper block — which carries PACT_TEXT_RENDER_CAP / PACT_MSG_HARD_CAP + the
// function together — and eval just that. Mirrors lib/pactChangeMarks.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT VISIBLE-WINDOW — pure cap helper";
const end = "// ===== end PACT VISIBLE-WINDOW pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "visible-window helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactVisibleStart, PACT_TEXT_RENDER_CAP, PACT_MSG_HARD_CAP } =
  new Function(block + "\nreturn { pactVisibleStart, PACT_TEXT_RENDER_CAP, PACT_MSG_HARD_CAP };")();

const user = (n) => ({ role: "user", text: "u" + n });
const asst = (n) => ({ role: "assistant", text: "a" + n });
const tool = () => ({ kind: "tool_use", tools: [{ name: "Read" }] });

test("short conversation (under the readable cap) → window starts at 0", () => {
  const msgs = [user(1), asst(1), user(2), asst(2)];
  assert.equal(pactVisibleStart(msgs), 0);
  assert.equal(pactVisibleStart([]), 0);
  assert.equal(pactVisibleStart(null), 0);
});

test("tool rows do NOT count toward the readable budget — the last N readable are guaranteed", () => {
  // Build: 3 readable messages, each preceded by 10 tool rows. With textCap=3 the window must include
  // all 3 readable messages (and their interleaved tool rows), NOT just the last 3 RAW messages.
  const msgs = [];
  for (let k = 0; k < 3; k++) { for (let j = 0; j < 10; j++) msgs.push(tool()); msgs.push(asst(k)); }
  // total = 33 messages; last 3 raw would be [tool,tool,asst2]-ish → only 1 readable. We want all 3.
  const start = pactVisibleStart(msgs, 3, 400);
  const visible = msgs.slice(start);
  const readable = visible.filter((m) => m.role === "assistant" || m.role === "user").length;
  assert.equal(readable, 3, "all 3 readable messages are inside the window despite the tool-row flood");
  // and the window begins exactly at the 3rd-from-last readable message
  assert.equal(msgs[start].role, "assistant");
});

test("exactly the last `textCap` readable messages are included, no more", () => {
  const msgs = [];
  for (let k = 0; k < 10; k++) { msgs.push(asst(k)); msgs.push(tool()); }   // 10 readable, interleaved tools
  const start = pactVisibleStart(msgs, 4, 400);
  const readable = msgs.slice(start).filter((m) => m.role === "assistant").length;
  assert.equal(readable, 4);
});

test("hard node ceiling wins when tool rows flood a single gap", () => {
  // 500 tool rows then 1 readable: the readable budget (say 5) is never met, so the hard cap bounds it.
  const msgs = [];
  for (let j = 0; j < 500; j++) msgs.push(tool());
  msgs.push(asst(0));
  const start = pactVisibleStart(msgs, 5, 50);
  assert.equal(msgs.length - start, 50, "window is bounded to the hard cap of 50 nodes");
});

test("defaults: readable cap 50, hard cap 400", () => {
  assert.equal(PACT_TEXT_RENDER_CAP, 50);
  assert.equal(PACT_MSG_HARD_CAP, 400);
  // 60 plain readable messages → window starts at the 50th-from-last (index 10).
  const msgs = Array.from({ length: 60 }, (_, i) => asst(i));
  assert.equal(pactVisibleStart(msgs), 10);
});

test("empty-text assistant rows (e.g. a tool-only turn) don't count as readable", () => {
  const msgs = [{ role: "assistant", text: "" }, tool(), { role: "assistant", text: "real" }];
  // only ONE readable (the last). textCap 1 → window starts at that message (index 2).
  assert.equal(pactVisibleStart(msgs, 1, 400), 2);
});

test("a turn that floods past the readable cap still keeps YOUR last prompt in view", () => {
  // [prompt] then FAR more responses than textCap. Without the prompt-guarantee the window would start inside
  // the flood; with it, it reaches back to the prompt so you can still see what you asked (no "Show earlier").
  const msgs = [user(0)];
  for (let k = 0; k < 20; k++) { msgs.push(asst(k)); msgs.push(tool()); }   // 20 responses ≫ textCap
  const start = pactVisibleStart(msgs, 5, 400);
  assert.equal(start, 0, "window reaches back to the prompt");
  assert.equal(msgs[start].role, "user", "the last prompt is the first visible row");
});

test("the last-prompt guarantee never exceeds the hard node ceiling", () => {
  // A prompt then a flood BIGGER than the hard cap: the DOM protection wins, so the prompt stays behind
  // "Show earlier" (extreme, rare — a single turn with hundreds of rows).
  const msgs = [user(0)];
  for (let j = 0; j < 500; j++) msgs.push(tool());
  const start = pactVisibleStart(msgs, 5, 50);
  assert.equal(msgs.length - start, 50, "bounded to the hard cap even though the prompt is further back");
});
