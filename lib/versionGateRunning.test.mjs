// node --test lib/versionGateRunning.test.mjs
//
// "It says the page is 1.20.7, but from the deploy I see neither localhost nor remote is updated to
//  1.20.7. Isn't this a bug?"
//
// It is. `/api/version` returns TWO numbers and lib/version.mjs spells out the difference in its own
// comment: `version` is re-read from package.json on every call, so it is whatever is ON DISK right
// now — the Admin panel's "Pending". `runningVersion` is frozen at first read: the code actually
// loaded and executing. The panel shows them as two honestly different numbers.
//
// The chat gate took `version`. So the moment a version is bumped on the work machine's disk — before
// any reload, any deploy, any restart — every open browser started claiming to be the new build and
// the gate disabled chat against an engine that had not changed and did not need to. Nobody did
// anything; a file was edited. That is what the screenshot shows: page "v1.20.7", both hosts v1.20.6,
// chat disabled.
//
// The gate's question is "is the code on this side the same build as the code on that side". Both
// terms have to be things that are RUNNING.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const ver = readFileSync(join(__dir, "..", "lib", "version.mjs"), "utf8");

test("the endpoint really does offer both numbers, and they mean different things", () => {
  assert.match(ver, /runningVersion: version/, "frozen at first read — what is executing");
  assert.match(ver, /re-read live on every call/, "…as opposed to the one that tracks disk");
});

test("the gate compares RUNNING to RUNNING, never disk to running", () => {
  assert.match(app, /WS_WEB_VERSION = v\.runningVersion \|\| v\.version/,
    "the page's side of the comparison must be what the web process is actually running");
  assert.ok(!/WS_WEB_VERSION = v\.version \|\| ""/.test(app),
    "taking the live-from-disk number is what disabled chat on an un-deployed edit");
  // The version CHIP is a different question — "what would a deploy produce" — and must keep showing
  // the pending number, which is what the Admin panel and the operator reason about.
  assert.match(app, /vc\.textContent = "v" \+ v\.version;/,
    "the header chip still reports Pending: that is the number you are about to ship");
});

test("the banner names both sides as running builds", () => {
  const at = app.indexOf("function wsVersionWhy()");
  const fn = app.slice(at, app.indexOf("\n}", at));
  assert.match(fn, /is running v/, "'this page is v1.20.7' was a claim about a file, not about this page");
});
