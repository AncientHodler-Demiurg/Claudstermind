// node --test lib/pactTabsDisplayOrder.test.mjs
// pactTabsDisplayOrder (pins the Master/prime Pact conversation first in the tab bar + mobile
// "Conversations" sheet, regardless of creation order) lives in the browser monolith
// (dashboard/public/app.js). We can't eval the whole file (it boots the DOM), so we slice out the
// sentinel-marked pure helper and eval just that. Mirrors lib/pactTabMove.test.mjs / pactPrimeRow.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT TAB DISPLAY ORDER — pure helper";
const end = "// ===== end PACT TAB DISPLAY ORDER pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "pact-tab-display-order helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactTabsDisplayOrder } = new Function(block + "\nreturn { pactTabsDisplayOrder };")();

test("no prime tab: order is unchanged (creation order passes through)", () => {
  const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(pactTabsDisplayOrder(tabs).map((t) => t.id), [1, 2, 3]);
});

test("prime already first: order is unchanged", () => {
  const tabs = [{ id: 1, prime: true }, { id: 2 }, { id: 3 }];
  assert.deepEqual(pactTabsDisplayOrder(tabs).map((t) => t.id), [1, 2, 3]);
});

test("prime in the middle: moves to the front, everyone else keeps relative order", () => {
  const tabs = [{ id: 1 }, { id: 2 }, { id: 3, prime: true }, { id: 4 }];
  assert.deepEqual(pactTabsDisplayOrder(tabs).map((t) => t.id), [3, 1, 2, 4]);
});

test("prime last: moves to the front", () => {
  const tabs = [{ id: 1 }, { id: 2 }, { id: 3, prime: true }];
  assert.deepEqual(pactTabsDisplayOrder(tabs).map((t) => t.id), [3, 1, 2]);
});

test("does not mutate the input array or its objects (render-only reorder)", () => {
  const tabs = [{ id: 1 }, { id: 2, prime: true }, { id: 3 }];
  const snapshot = tabs.map((t) => ({ ...t }));
  pactTabsDisplayOrder(tabs);
  assert.deepEqual(tabs, snapshot, "source array order must be untouched — pactChatCloseTab's fallback relies on it");
});

test("guards: non-array / missing input returns an empty array, never throws", () => {
  assert.deepEqual(pactTabsDisplayOrder(null), []);
  assert.deepEqual(pactTabsDisplayOrder(undefined), []);
  assert.deepEqual(pactTabsDisplayOrder("nope"), []);
  assert.deepEqual(pactTabsDisplayOrder([]), []);
});

test("more than one flagged prime (shouldn't happen, but defensive): all prime-flagged tabs lead, in their original relative order", () => {
  const tabs = [{ id: 1 }, { id: 2, prime: true }, { id: 3 }, { id: 4, prime: true }];
  assert.deepEqual(pactTabsDisplayOrder(tabs).map((t) => t.id), [2, 4, 1, 3]);
});
