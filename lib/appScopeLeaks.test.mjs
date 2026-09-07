// node --test lib/appScopeLeaks.test.mjs
//
// WHY THIS EXISTS. Shipped in 1.8.4 and reported immediately: the whole Pact workspace died with
// "This view couldn't load — WS_FALLBACK_MODELS is not defined". The constant was declared with
// `const` INSIDE the Core view's closure, but referenced from `buildMobileModelSelect`, a TOP-LEVEL
// function (which, despite its name, builds Pact's desktop selector too). The reference resolved to
// nothing and threw, taking the entire view down.
//
// Nothing caught it: `node --check` only parses, the 1,466 existing tests are source-text or
// package-level, and the throwing branch only runs when the model catalogue is EMPTY — which any
// browser session that had already answered "models" never reaches. So it passed every gate and
// still broke the app on a cold load.
//
// dashboard/public/app.js is a ~14k-line browser monolith that cannot simply be imported (it boots
// the DOM), so this is a scope-shape check over the source: a SHOUTY constant declared inside a
// closure must never be referenced from earlier in the file, because "earlier" is either a different
// scope (a hard ReferenceError, as here) or the temporal dead zone (also a ReferenceError). It found
// exactly one offender when written — this bug — and no false positives.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const lines = app.split("\n");

test("no closure-scoped constant is referenced from earlier in the file", () => {
  const declared = new Map();
  lines.forEach((l, i) => {
    const m = /^(\s+)const ([A-Z][A-Z0-9_]{2,}) = /.exec(l);
    if (m && !declared.has(m[2])) declared.set(m[2], i + 1);
  });
  const offenders = [];
  for (const [name, declLine] of declared) {
    const re = new RegExp("\\b" + name + "\\b");
    for (let i = 0; i < declLine - 1; i++) {
      const l = lines[i];
      if (l.trim().startsWith("//") || l.trim().startsWith("*")) continue;
      // Strip STRING and REGEX literals before looking. A SHOUTY word inside quotes is data, not a
      // reference — `t.tagName !== "INPUT"` is a comparison against a tag name, and flagging it sent
      // this check chasing a constant called INPUT declared 3,000 lines later. A guard that cries
      // wolf gets muted, which is worse than not having it.
      const code = l.replace(/"(?:[^"\\]|\\.)*"/g, '""')
                    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
                    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
                    .replace(/\/(?![*/])(?:[^/\\\n]|\\.)+\/[gimsuy]*/g, "/re/");
      if (re.test(code)) { offenders.push(`${name}: used at line ${i + 1}, declared (in a closure) at line ${declLine}`); break; }
    }
  }
  assert.deepEqual(offenders, [],
    "a constant used above its own closure-scoped declaration is a ReferenceError at runtime, not a style issue");
});

test("the fallback model list is top-level, because both selector builders need it", () => {
  assert.match(app, /^const WS_FALLBACK_MODELS = \[/m,
    "declared at top level — one of its two consumers is a top-level function");
  assert.equal((app.match(/const WS_FALLBACK_MODELS = \[/g) || []).length, 1,
    "exactly one list: two copies is how the fallbacks drift apart");
});

test("BOTH selector builders share ONE fill, so a fallback can never reach only one of them", () => {
  // This used to count two copies of the same fallback `if`. Counting copies is how the copies got
  // there: the two builders were duplicated line for line, and the fix for one genuinely did not
  // reach the other. There is one implementation now — what it DOES is proven by executing it in
  // lib/modelSelectFill.test.mjs, not by matching its source here.
  const hits = app.match(/function wsFillModelSelectFrom\(/g) || [];
  assert.equal(hits.length, 1, "exactly one definition of the fill");
  // The call sites are matched on their arguments rather than on line-leading whitespace: the Core
  // one wraps across two lines now that it passes a cache signature, and a formatting change must
  // not read as "a builder stopped calling the shared fill".
  const calls = (app.match(/wsFillModelSelectFrom\(sel, list, /g) || []).length - hits.length;
  assert.equal(calls, 2, "and both builders call it");
  assert.ok(!/const g = modelOptionGroups\(list\);[\s\S]{0,80}const g = modelOptionGroups/.test(app),
    "no builder may rebuild the option groups itself again");
});
