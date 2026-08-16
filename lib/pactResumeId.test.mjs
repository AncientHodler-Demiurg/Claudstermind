// node --test lib/pactResumeId.test.mjs
// pactResumeIdOk (rejects a bogus resume id equal to the tab key) lives in the browser monolith
// (dashboard/public/app.js). We slice out the sentinel-marked pure helper and eval just that.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT RESUME-ID — pure helper";
const end = "// ===== end PACT RESUME-ID pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "pact-resume-id helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactResumeIdOk } = new Function(block + "\nreturn { pactResumeIdOk };")();

test("the report's bug: a resume equal to the tab key is rejected", () => {
  const key = "1029b5d2-fb47-4ac5-8eff-b62b98d1bbc0";
  assert.equal(pactResumeIdOk(key, key), null, "resume === key must be dropped (it's not a Claude session id)");
});

test("a real, different session id is kept", () => {
  assert.equal(pactResumeIdOk("29d5a644-1334-4eb9-89ad-f1e971b24076", "4cd4ed2d-4496-472f-973d-6e3239b7a8df"),
    "29d5a644-1334-4eb9-89ad-f1e971b24076");
});

test("empty / null / undefined resume yields null", () => {
  assert.equal(pactResumeIdOk("", "k"), null);
  assert.equal(pactResumeIdOk(null, "k"), null);
  assert.equal(pactResumeIdOk(undefined, "k"), null);
});

test("a non-string resume yields null", () => {
  assert.equal(pactResumeIdOk(123, "k"), null);
  assert.equal(pactResumeIdOk({}, "k"), null);
});
