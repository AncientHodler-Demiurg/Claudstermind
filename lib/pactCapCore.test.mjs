// node --test lib/pactCapCore.test.mjs
//
// THE BUG: a "Trivial" capability (body is just `true`) should render its name-medallion BRONZE, but a
// trivial cap whose `@doc` string spans a line using Pact's `\`-at-end-of-line CONTINUATION rendered
// SILVER. capCore() (in pact-medallion.js / pact-medallion-embed.js) strips strings before deciding
// `core === "true"`; its regex used `\\.` for the escape branch, and `.` doesn't match `\n`, so a
// multi-line continuation string never matched and was left in `core` → `core !== "true"` → not
// trivial → fell through to silver. Real case: OuroborosNetwork .../03_DSP+.pact `DSP|S2-GOV`. Fixed by
// `\\[\s\S]` (match any char incl newline). This test extracts the REAL capCore from each shipped copy
// and runs it, so a regression (reverting to `\\.`) fails here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

// Pull the capCore function body out of a source file and eval it (it's pure string ops, no deps).
function extractCapCore(relPath) {
  const src = readFileSync(join(__dir, "..", relPath), "utf8");
  // Grab from "capCore" up to the ".trim(); }" (embed, one-liner) or the multi-line "}" form.
  const m = src.match(/function capCore\(body\)\s*\{[\s\S]*?\n  \}/)          // pact-medallion.js multi-line form
        || src.match(/var capCore = function \(body\) \{ return body[\s\S]*?\.trim\(\); \};/); // embed one-liner
  assert.ok(m, `capCore not found in ${relPath}`);
  let code = m[0];
  if (code.startsWith("var capCore")) code = code.replace(/^var capCore = /, "").replace(/;$/, "");
  else code = code.replace(/^function capCore/, "function");
  // eslint-disable-next-line no-new-func
  return new Function("return (" + code + ")")();
}

const TRIVIAL_MULTILINE = `(defcap DSP|S2-GOV ()
        @doc "Governor Capability for the Stage Two Dispensing Bucket Smart DALOS Account. \\
            \\ Composed only from this module -- a governor guard is an ownership proof."
        true
    )`;
const TRIVIAL_SINGLELINE = `(defcap DSP|GOV ()
        @doc "Governor Capability for the Dispenser Smart DALOS Account"
        true
    )`;
const TRIVIAL_BARE = `(defcap SECURE ()
        true
    )`;
const NON_TRIVIAL = `(defcap X ()
        @doc "does a real check"
        (enforce-guard (keyset-ref-guard "k"))
    )`;

for (const relPath of ["dashboard/public/pact-medallion.js", "dashboard/public/pact-medallion-embed.js"]) {
  test(`${relPath}: a trivial cap with a MULTI-LINE @doc classifies as trivial (→ bronze), not silver`, () => {
    const capCore = extractCapCore(relPath);
    assert.equal(capCore(TRIVIAL_MULTILINE), "true",
      "the \\-continuation @doc string must be stripped so core is exactly 'true'");
  });
  test(`${relPath}: single-line @doc and bare-true trivial caps still classify trivial`, () => {
    const capCore = extractCapCore(relPath);
    assert.equal(capCore(TRIVIAL_SINGLELINE), "true");
    assert.equal(capCore(TRIVIAL_BARE), "true");
  });
  test(`${relPath}: a cap with real logic is NOT trivial (core keeps the enforce)`, () => {
    const capCore = extractCapCore(relPath);
    const core = capCore(NON_TRIVIAL);
    assert.notEqual(core, "true", "a cap doing a real check must not be mistaken for trivial/bronze");
    assert.match(core, /enforce-guard/, "the real body survives stripping");
  });
}
