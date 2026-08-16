// node --test lib/pactNextChatName.test.mjs
// pactNextChatName (the default "Chat N" namer for a new Pact chat tab) lives in the browser monolith
// (dashboard/public/app.js). We can't eval the whole file (it boots the DOM), so we slice out the
// sentinel-marked pure helper and eval just that. Mirrors lib/pactDuration.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT NEXT CHAT NAME — pure helper";
const end = "// ===== end PACT NEXT CHAT NAME pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "pact-next-chat-name helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactNextChatName } = new Function(block + "\nreturn { pactNextChatName };")();

test("the bug report: 2 chats open → a new one is 'Chat 3' (not an ever-growing counter)", () => {
  assert.equal(pactNextChatName([{ name: "Master" }, { name: "ATS Audit" }]), "Chat 3");
});

test("stable across close+reopen: 2 chats always yields 'Chat 3', never drifting up", () => {
  const tabs = [{ name: "Master" }, { name: "ATS Audit" }];
  assert.equal(pactNextChatName(tabs), "Chat 3");
  // simulate: open Chat 3, then close it → back to 2 tabs → next is Chat 3 again
  assert.equal(pactNextChatName(tabs), "Chat 3");
});

test("count grows with the number of tabs", () => {
  assert.equal(pactNextChatName([]), "Chat 1");
  assert.equal(pactNextChatName([{ name: "Master" }]), "Chat 2");
  assert.equal(pactNextChatName([{ name: "Master" }, { name: "A" }, { name: "B" }]), "Chat 4");
});

test("never collides with an existing default 'Chat N' — bumps past it", () => {
  // A middle chat was closed, leaving a higher-numbered default in place.
  assert.equal(pactNextChatName([{ name: "Master" }, { name: "ATS Audit" }, { name: "Chat 3" }]), "Chat 4");
  // count+1 would be "Chat 3" but it's taken → bump to the first free number.
  assert.equal(pactNextChatName([{ name: "Master" }, { name: "Chat 3" }]), "Chat 4");
  // multiple defaults present → skip all taken ones.
  assert.equal(pactNextChatName([{ name: "Chat 3" }, { name: "Chat 4" }, { name: "X" }]), "Chat 5");
});

test("guards: non-array input, and tabs without names", () => {
  assert.equal(pactNextChatName(null), "Chat 1");
  assert.equal(pactNextChatName(undefined), "Chat 1");
  assert.equal(pactNextChatName([{}, {}]), "Chat 3", "unnamed tabs still count toward the total");
});
