// node --test lib/chatModelLabel.test.mjs
// prettyModel / chatModelLabel live in the browser monolith (dashboard/public/app.js). We can't eval the whole
// file (it boots the DOM), so we slice out the sentinel-marked pure-helper block and eval just that — no
// duplication, no bundler. Mirrors the wsUsage / pactFind tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== CHAT MODEL LABEL — pure resolved-model helpers";
const end = "// ===== end CHAT MODEL LABEL pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "chat-model-label block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { prettyModel, chatModelLabel } = new Function(block + "\nreturn { prettyModel, chatModelLabel };")();

test("prettyModel strips the claude- prefix and trailing date", () => {
  assert.equal(prettyModel("claude-opus-4-1-20250805"), "opus-4-1");
  assert.equal(prettyModel("claude-sonnet-4-5"), "sonnet-4-5");
  assert.equal(prettyModel(""), "");
  assert.equal(prettyModel(null), "");
});

test("chatModelLabel: explicit pick wins over active", () => {
  assert.equal(chatModelLabel("claude-opus-4-1-20250805", "claude-sonnet-4-5"), "opus-4-1");
});

test("chatModelLabel: falls back to the active (resolved) model when no explicit pick", () => {
  assert.equal(chatModelLabel(null, "claude-sonnet-4-5-20250101"), "sonnet-4-5");
});

test("chatModelLabel: nothing known yet → empty", () => {
  assert.equal(chatModelLabel(null, null), "");
  assert.equal(chatModelLabel(undefined, undefined), "");
});
