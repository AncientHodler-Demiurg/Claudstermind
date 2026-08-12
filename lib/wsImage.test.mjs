// node --test lib/wsImage.test.mjs
// The pure image-attachment helpers (wsDataUrlToAttachment, wsDataUrlEncodedSize) live in the browser
// monolith (dashboard/public/app.js). We can't eval the whole file (it boots the DOM), so we slice
// out the sentinel-marked pure-helper block and eval just that. The canvas/DOM-touching helpers in the
// same block (wsCompressImage, wsLoadDrawable) are only *defined* here, never called, so no DOM is
// needed. Mirrors the pactFind / pactChangedPath tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== WS IMAGE — pure attach/encode helpers";
const end = "// ===== end WS IMAGE pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "image helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { wsDataUrlToAttachment, wsDataUrlEncodedSize, WS_IMG_MAX_COUNT, WS_IMG_ALLOWED_TYPES } =
  new Function(block + "\nreturn { wsDataUrlToAttachment, wsDataUrlEncodedSize, WS_IMG_MAX_COUNT, WS_IMG_ALLOWED_TYPES };")();

test("caps + allowed types are the shared constants", () => {
  assert.equal(WS_IMG_MAX_COUNT, 5);
  assert.deepEqual(WS_IMG_ALLOWED_TYPES, ["image/png", "image/jpeg", "image/webp"]);
});

test("wsDataUrlToAttachment splits mediaType + base64 payload", () => {
  const r = wsDataUrlToAttachment("data:image/png;base64,AAAB");
  assert.deepEqual(r, { mediaType: "image/png", base64Data: "AAAB", dataUrl: "data:image/png;base64,AAAB" });
});

test("wsDataUrlToAttachment tolerates a data url with no ;base64 marker", () => {
  const r = wsDataUrlToAttachment("data:image/jpeg,ZZZ");
  assert.equal(r.mediaType, "image/jpeg");
  assert.equal(r.base64Data, "ZZZ");
});

test("wsDataUrlToAttachment returns null for junk / empty", () => {
  assert.equal(wsDataUrlToAttachment(""), null);
  assert.equal(wsDataUrlToAttachment("not a data url"), null);
  assert.equal(wsDataUrlToAttachment("data:image/png;base64,"), null);
});

test("wsDataUrlEncodedSize measures only the payload after the comma", () => {
  assert.equal(wsDataUrlEncodedSize("data:image/png;base64,AAAB"), 4);
  assert.equal(wsDataUrlEncodedSize("no-comma-here"), 0);
});
