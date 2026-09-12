// node --test lib/wsApplySessionFields.test.mjs
//
// THE REPORT: an exocortex turn had genuinely been running for 11 minutes, unattended. Returning to
// its pane showed "Working… 0:00", which a few moments later corrected itself to "Working… 11:0X".
// A turn that looks like it just restarted is indistinguishable from one that actually did — the
// exact ambiguity that makes a working turn look stuck.
//
// Root cause: the pane's status/mode/usage arrive from TWO frames — the fast `sessions` list
// broadcast and a `session` upsert — but only the slower, per-pane `resync` reply ever adopted
// `turnStartedAt`/`lastActivityAt`. So the broadcast could flip a pane busy before ITS OWN resync
// landed, and paintPane's local fallback stamped `_busyAt = Date.now()` in the gap — a fabricated
// near-zero elapsed, later overwritten once resync caught up.
//
// wsApplySessionFields is the one function both frames now call, so the two authoritative-clock
// fields can never again be adopted on one path and forgotten on the other.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== WS SESSION FIELDS — pure helper";
const end = "// ===== end WS SESSION FIELDS pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "wsApplySessionFields helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { wsApplySessionFields } = new Function(block + "\nreturn { wsApplySessionFields };")();

test("a busy status arriving via the session frame carries its own authoritative turn start", () => {
  const p = { status: "idle" };
  wsApplySessionFields(p, { status: "thinking", turnStartedAt: 1000 });
  assert.equal(p.status, "thinking");
  assert.equal(p._turnStartedAt, 1000,
    "without this, paintPane's local fallback stamps Date.now() and the elapsed flashes near-zero");
});

test("lastActivityAt only ever moves forward — a stale/duplicate broadcast can't rewind a fresher stamp", () => {
  const p = { _lastEventAt: 5000 };
  wsApplySessionFields(p, { status: "thinking", lastActivityAt: 3000 });
  assert.equal(p._lastEventAt, 5000);
  wsApplySessionFields(p, { status: "thinking", lastActivityAt: 9000 });
  assert.equal(p._lastEventAt, 9000);
});

test("fields absent from the frame are left exactly as they were", () => {
  const p = { status: "thinking", mode: "plan", usage: { a: 1 }, _turnStartedAt: 42, _lastEventAt: 42 };
  wsApplySessionFields(p, {});
  assert.deepEqual(p, { status: "thinking", mode: "plan", usage: { a: 1 }, _turnStartedAt: 42, _lastEventAt: 42 });
});

test("mode, usage and background still adopt exactly as before", () => {
  const p = {};
  wsApplySessionFields(p, { status: "deepwork", mode: "code", usage: { totalTokens: 9 }, background: [{ id: 1 }] });
  assert.equal(p.mode, "code");
  assert.deepEqual(p.usage, { totalTokens: 9 });
  assert.deepEqual(p._background, [{ id: 1 }]);
});
