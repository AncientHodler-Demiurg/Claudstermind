// node --test lib/pactTreeLive.test.mjs
//
// THE REPORT: in the Pact workspace, a file the agent CREATES doesn't appear in the tree (and a
// DELETED one doesn't disappear) until you hit reload. pactTreeRefresh() already exists and is built
// for exactly this ("agent-created / removed files appear, WITHOUT collapsing what you have open") —
// it just wasn't wired to agent activity. Now: debounced mid-turn refresh on file-mutating tools +
// an authoritative refresh on turn `result`. pactToolsTouchFs decides which tools warrant a re-scan
// (only ones that change the FILE SET — Write/Bash — not content-only Edit or read-only Read/Grep).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

// Extract the pure classifier + its const set and eval them standalone.
function loadClassifier() {
  const setM = app.match(/const PACT_FS_TOOLS = new Set\(\[[^\]]*\]\);/);
  const fnM = app.match(/function pactToolsTouchFs\(tools\) \{[\s\S]*?\n\}/);
  assert.ok(setM && fnM, "PACT_FS_TOOLS + pactToolsTouchFs must exist");
  // eslint-disable-next-line no-new-func
  return new Function(setM[0] + "\n" + fnM[0] + "\nreturn pactToolsTouchFs;")();
}

test("pactToolsTouchFs: file-set-changing tools (Write, Bash) trigger a re-scan", () => {
  const f = loadClassifier();
  assert.equal(f([{ name: "Write" }]), true);
  assert.equal(f([{ name: "Bash" }]), true);
  assert.equal(f([{ name: "Read" }, { name: "Write" }]), true, "any one FS tool in the batch is enough");
  assert.equal(f(["Bash"]), true, "bare-string tool shape also works");
});

test("pactToolsTouchFs: content-only / read-only tools do NOT trigger a re-scan", () => {
  const f = loadClassifier();
  assert.equal(f([{ name: "Edit" }]), false, "Edit changes content, not the file set — colouring handles it");
  assert.equal(f([{ name: "Read" }]), false);
  assert.equal(f([{ name: "Grep" }, { name: "Glob" }]), false);
});

test("pactToolsTouchFs: empty/missing is false (no needless re-scan)", () => {
  const f = loadClassifier();
  assert.equal(f([]), false);
  assert.equal(f(null), false);
  assert.equal(f(undefined), false);
});

test("wiring: mid-turn, a file-mutating tool_use schedules a debounced tree refresh", () => {
  assert.match(app, /case "tool_use":[\s\S]*?if \(pactToolsTouchFs\(d\.tools\)\) pactTreeRefreshSoon\(\);/,
    "the tool_use handler must debounce-refresh the tree on a file-mutating tool");
  assert.match(app, /function pactTreeRefreshSoon\(/, "the debounced wrapper must exist");
  assert.match(app, /clearTimeout\(PACT_TREE_REFRESH_T\)/, "it must coalesce a burst of writes into one refresh");
});

test("wiring: turn `result` does one authoritative tree re-scan (new files appear, deleted vanish)", () => {
  const i = app.indexOf('case "result":');
  assert.ok(i >= 0);
  const block = app.slice(i, i + 1600);
  assert.match(block, /pactTreeRefresh\(\);/, "the result handler must call pactTreeRefresh() at turn end");
});
