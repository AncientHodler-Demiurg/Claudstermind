// node --test lib/pactChangeMarks.test.mjs
// pactChangeMarks (the editor overview-ruler's diff→marks helper) lives in the browser monolith
// (dashboard/public/app.js). We can't eval the whole file (it boots the DOM), so we slice out the
// sentinel-marked pure-helper block — which wraps pactDiffLines + pactChangeMarks together, since the
// latter calls the former — and eval just that. Mirrors lib/pactGutter.test.mjs / lib/pactChangedPath.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT CHANGE-MARKS — pure diff→ruler helper";
const end = "// ===== end PACT CHANGE-MARKS pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "change-marks helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactChangeMarks, pactChangeAnnRanges, pactDiffOvrBands } = new Function(block + "\nreturn { pactChangeMarks, pactChangeAnnRanges, pactDiffOvrBands };")();

test("pactDiffOvrBands merges adjacent add/del runs into positioned bands; skips 'same'", () => {
  const rows = [{ type: "same" }, { type: "add" }, { type: "add" }, { type: "same" }, { type: "del" }, { type: "same" }];
  const b = pactDiffOvrBands(rows);
  assert.equal(b.length, 2);
  assert.equal(b[0].type, "add"); assert.ok(Math.abs(b[0].top - 100 / 6) < 1e-6); assert.ok(Math.abs(b[0].height - 200 / 6) < 1e-6);
  assert.equal(b[1].type, "del"); assert.ok(Math.abs(b[1].top - 400 / 6) < 1e-6);
  assert.deepEqual(pactDiffOvrBands([]), []);
  assert.deepEqual(pactDiffOvrBands(null), []);
  assert.deepEqual(pactDiffOvrBands([{ type: "same" }]), []);
});

test("no change → empty", () => {
  assert.deepEqual(pactChangeMarks("a\nb\nc", "a\nb\nc"), []);
  assert.deepEqual(pactChangeMarks("", ""), []);
});

test("empty HEAD → every new line is 'add' (newly added / not-in-git file)", () => {
  assert.deepEqual(pactChangeMarks("", "a\nb\nc"), [
    { line: 0, type: "add" }, { line: 1, type: "add" }, { line: 2, type: "add" },
  ]);
  assert.deepEqual(pactChangeMarks("", "only"), [{ line: 0, type: "add" }]);
});

test("whole file emptied → single 'del' marker at line 0", () => {
  assert.deepEqual(pactChangeMarks("a\nb", ""), [{ line: 0, type: "del" }]);
});

test("pure add at end → 'add' at the new line index", () => {
  assert.deepEqual(pactChangeMarks("a\nb", "a\nb\nc"), [{ line: 2, type: "add" }]);
});

test("pure add in the middle → 'add' at the inserted line", () => {
  assert.deepEqual(pactChangeMarks("a\nc", "a\nb\nc"), [{ line: 1, type: "add" }]);
});

test("two adjacent inserted lines merge into two ascending 'add' marks", () => {
  assert.deepEqual(pactChangeMarks("a\nd", "a\nb\nc\nd"), [
    { line: 1, type: "add" }, { line: 2, type: "add" },
  ]);
});

test("pure delete → single 'del' at the line boundary following the deletion", () => {
  // delete "b": new file is a\nc; the removed line now sits before index 1 ("c")
  assert.deepEqual(pactChangeMarks("a\nb\nc", "a\nc"), [{ line: 1, type: "del" }]);
});

test("delete the last line → 'del' at the trailing line boundary", () => {
  assert.deepEqual(pactChangeMarks("a\nb", "a"), [{ line: 1, type: "del" }]);
});

test("one-for-one modification → 'mod' on the changed line", () => {
  assert.deepEqual(pactChangeMarks("a\nb\nc", "a\nX\nc"), [{ line: 1, type: "mod" }]);
});

test("modify + extra additions in one hunk → min(adds,dels) 'mod' then 'add'", () => {
  // 1 del ("b"), 2 adds ("X","Y") in one contiguous hunk → first add 'mod', extra add 'add'
  assert.deepEqual(pactChangeMarks("a\nb\nc", "a\nX\nY\nc"), [
    { line: 1, type: "mod" }, { line: 2, type: "add" },
  ]);
});

test("more deletes than adds in a hunk → the single add is 'mod', extra deletes absorbed", () => {
  // delete "b","c", add one "X" → one modification marker, no separate del marker
  assert.deepEqual(pactChangeMarks("a\nb\nc\nd", "a\nX\nd"), [{ line: 1, type: "mod" }]);
});

test("separate hunks yield ascending, non-overlapping marks", () => {
  // add near top, delete near bottom
  const marks = pactChangeMarks("a\nb\nc\nd", "a\nNEW\nb\nc");
  // "NEW" inserted at line 1 (add); "d" deleted at the end (del)
  assert.deepEqual(marks, [{ line: 1, type: "add" }, { line: 4, type: "del" }]);
});

test("nullish inputs are safe", () => {
  assert.deepEqual(pactChangeMarks(null, null), []);
  assert.deepEqual(pactChangeMarks(undefined, "x"), [{ line: 0, type: "add" }]);
});

// ---- pactChangeAnnRanges: marks → per-type CM annotateScrollbar ranges ----
test("annRanges: empty / non-array → all three empty layers", () => {
  assert.deepEqual(pactChangeAnnRanges([]), { add: [], del: [], mod: [] });
  assert.deepEqual(pactChangeAnnRanges(null), { add: [], del: [], mod: [] });
});

test("annRanges: single mark → one 1-line range on its type layer", () => {
  assert.deepEqual(pactChangeAnnRanges([{ line: 3, type: "add" }]), {
    add: [{ from: { line: 3, ch: 0 }, to: { line: 3, ch: 0 } }], del: [], mod: [],
  });
});

test("annRanges: consecutive same-type lines merge into one band", () => {
  const r = pactChangeAnnRanges([{ line: 0, type: "add" }, { line: 1, type: "add" }, { line: 2, type: "add" }]);
  assert.deepEqual(r.add, [{ from: { line: 0, ch: 0 }, to: { line: 2, ch: 0 } }]);
});

test("annRanges: interleaved types stay on their own layers, no cross-type merge", () => {
  const r = pactChangeAnnRanges([{ line: 0, type: "add" }, { line: 1, type: "mod" }, { line: 2, type: "add" }]);
  assert.deepEqual(r.add, [
    { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } },
    { from: { line: 2, ch: 0 }, to: { line: 2, ch: 0 } },
  ]);
  assert.deepEqual(r.mod, [{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 0 } }]);
});

test("annRanges: non-adjacent same-type lines do NOT merge", () => {
  const r = pactChangeAnnRanges([{ line: 0, type: "del" }, { line: 5, type: "del" }]);
  assert.deepEqual(r.del, [
    { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } },
    { from: { line: 5, ch: 0 }, to: { line: 5, ch: 0 } },
  ]);
});

test("annRanges: composes with pactChangeMarks output", () => {
  const r = pactChangeAnnRanges(pactChangeMarks("a\nb\nc\nd", "a\nNEW\nb\nc"));
  assert.deepEqual(r.add, [{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 0 } }]);
  assert.deepEqual(r.del, [{ from: { line: 4, ch: 0 }, to: { line: 4, ch: 0 } }]);
});
