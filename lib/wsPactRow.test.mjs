// node --test lib/wsPactRow.test.mjs
// wsIsPactRow (segregates the Ouronet Pact repo out of the Core cockpit's history/search) lives in the
// browser monolith (dashboard/public/app.js). We can't eval the whole file (it boots the DOM), so we
// slice out the sentinel-marked pure helper and eval just that. Mirrors lib/pactDuration.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== WS PACT ROW — pure helper";
const end = "// ===== end WS PACT ROW pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "ws-pact-row helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { wsIsPactRow } = new Function(block + "\nreturn { wsIsPactRow };")();

const PACT = "OuroborosNetwork/_onchain/Ouronet";

test("matches a row by its repo field", () => {
  assert.equal(wsIsPactRow({ repo: PACT, workspaceId: PACT + "@main" }, PACT), true);
});

test("matches a row by workspaceId prefix even if repo is absent", () => {
  assert.equal(wsIsPactRow({ workspaceId: PACT + "@main" }, PACT), true);
  assert.equal(wsIsPactRow({ workspaceId: PACT + "@romania" }, PACT), true);
});

test("does NOT match other repos (they stay in Core)", () => {
  assert.equal(wsIsPactRow({ repo: "OuroborosNetwork/daimons/OuronetUI", workspaceId: "OuroborosNetwork/daimons/OuronetUI@main" }, PACT), false);
  assert.equal(wsIsPactRow({ repo: "Claudstermind", workspaceId: "Claudstermind@main" }, PACT), false);
});

test("does not false-match a repo that merely has the Pact path as a prefix without the @ boundary", () => {
  // A hypothetical sibling repo whose path starts with the Pact repo's name must NOT be swallowed.
  assert.equal(wsIsPactRow({ workspaceId: PACT + "-extra@main" }, PACT), false);
  assert.equal(wsIsPactRow({ repo: PACT + "-extra" }, PACT), false);
});

test("guards: null/empty rows and missing fields", () => {
  assert.equal(wsIsPactRow(null, PACT), false);
  assert.equal(wsIsPactRow(undefined, PACT), false);
  assert.equal(wsIsPactRow({}, PACT), false);
  assert.equal(wsIsPactRow({ repo: null, workspaceId: null }, PACT), false);
});
