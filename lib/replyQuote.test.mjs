// node --test lib/replyQuote.test.mjs
// The reply/quote pending-reference helpers live in the browser monolith (dashboard/public/app.js),
// same convention as lib/pactGutter.test.mjs: slice the marked pure-helper block out and eval just
// that. These manage the LIST of pending references a user has queued to reply to before they hit
// send; the actual quote text/capping/truncation is ChatShell.replyQuote (dashboard/public/chat-shell.js,
// already tested by lib/chatShell.test.mjs) — not duplicated here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== REPLY QUOTE — pending-reference pure helpers";
const end = "// ===== end REPLY QUOTE pure helpers =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "reply-quote helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { wsAddReplyRef, wsRemoveReplyRef, wsReplyChipLabel } =
  new Function(block + "\nreturn { wsAddReplyRef, wsRemoveReplyRef, wsReplyChipLabel };")();

test("wsAddReplyRef: creates _replyRefs on first use and appends", () => {
  const host = {};
  wsAddReplyRef(host, "R", 12, "the agent's answer");
  assert.deepEqual(host._replyRefs, [{ kind: "R", number: 12, text: "the agent's answer" }]);
});

test("wsAddReplyRef: adding the same turn twice is a no-op, not a duplicate", () => {
  const host = { _replyRefs: [{ kind: "P", number: 5, text: "hello" }] };
  wsAddReplyRef(host, "P", 5, "hello again — different text does not matter, the turn is the key");
  assert.equal(host._replyRefs.length, 1, "must not duplicate the same P#/R# reference");
  assert.equal(host._replyRefs[0].text, "hello", "the original text is kept, not overwritten");
});

test("wsAddReplyRef: a different kind with the same number is a DIFFERENT reference (P#5 vs R#5)", () => {
  const host = {};
  wsAddReplyRef(host, "P", 5, "a prompt");
  wsAddReplyRef(host, "R", 5, "an answer");
  assert.equal(host._replyRefs.length, 2);
});

test("wsAddReplyRef: on a null/undefined host, does nothing and does not throw", () => {
  assert.doesNotThrow(() => wsAddReplyRef(null, "R", 1, "x"));
  assert.doesNotThrow(() => wsAddReplyRef(undefined, "R", 1, "x"));
});

test("wsRemoveReplyRef: removes exactly the matching kind+number, leaves others", () => {
  const host = { _replyRefs: [{ kind: "R", number: 1, text: "a" }, { kind: "R", number: 2, text: "b" }, { kind: "P", number: 1, text: "c" }] };
  wsRemoveReplyRef(host, "R", 1);
  assert.deepEqual(host._replyRefs, [{ kind: "R", number: 2, text: "b" }, { kind: "P", number: 1, text: "c" }]);
});

test("wsRemoveReplyRef: on a host with no refs, does nothing and does not throw", () => {
  const host = {};
  assert.doesNotThrow(() => wsRemoveReplyRef(host, "R", 1));
});

test("wsReplyChipLabel: formats as KIND#NUMBER plus a flattened, length-capped snippet", () => {
  const label = wsReplyChipLabel({ kind: "R", number: 219, text: "line one\n\nline   two   with   gaps" });
  assert.match(label, /^R#219 /);
  assert.ok(!label.includes("\n"), "must be single-line for a chip");
  assert.ok(!/\s{2,}/.test(label), "internal whitespace runs must collapse");
});

test("wsReplyChipLabel: long text is capped, not left to overflow a chip", () => {
  const label = wsReplyChipLabel({ kind: "P", number: 1, text: "x".repeat(500) });
  assert.ok(label.length < 500, "the chip label must be capped well below the raw text length");
});

// The button-insertion/send-time wiring itself can't be exercised without a full DOM (app.js "boots
// the DOM" per lib/pactGutter.test.mjs's own note, and bookmarks/share have the same gap today) — these
// are presence checks, not behavior proof, and are named honestly as such. They exist so an accidental
// revert of a call site reads as a red test instead of a silent regression nobody notices until someone
// clicks ↩ and nothing happens.
test("wiring: the reply button is placed at exactly the 4 real call sites (Core+Pact × prompt+answer)", () => {
  const calls = (src.match(/wsReplyBtn\(/g) || []).length;
  const defs = (src.match(/function wsReplyBtn\(/g) || []).length;
  assert.equal(defs, 1, "wsReplyBtn must be defined exactly once");
  assert.equal(calls - defs, 4, "expected exactly 4 CALL sites — Core prompt, Core answer, Pact prompt, Pact answer");
});

test("wiring: both send paths actually build the reply preamble before clearing the pending list", () => {
  assert.ok(src.includes("window.ChatShell.buildReplyPreamble(pendingRefs)"),
    "the preamble must be built from window.ChatShell, the module wired into production in the foundation topic");
  const clears = (src.match(/_replyRefs = \[\];/g) || []).length;
  assert.ok(clears >= 2, "both Core's send() and Pact's pactChatSend() must clear _replyRefs after use — a one-shot, like attached images");
});
