// node --test lib/pactChatWidth.test.mjs
//
// "I need the width of the Pact workspace to be a bit bigger on desktop, or rather make it manually
// tunable." It was a fixed 4:1 share of the work area with a hard 600px floor — one number, chosen
// once, for every screen and every job.
//
// The clamp is the part worth executing rather than eyeballing: 420px is the measured width below
// which the chat shell's model row falls out of `.pact-chat`'s `overflow: hidden`, and the stylesheet
// carries a `min-width: min(600px, 40vw)` floor that would silently refuse anything the user drags
// below 600 — which reads as a broken drag, not a clamp.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const css = readFileSync(join(__dir, "..", "dashboard", "public", "styles.css"), "utf8");

const begin = "// ===== PACT CHAT COLUMN WIDTH";
const end = "// ===== end PACT CHAT COLUMN WIDTH";
const a = app.indexOf(begin), b = app.indexOf(end);
assert.ok(a >= 0 && b > a, "the width block markers must exist in app.js");
// eslint-disable-next-line no-new-func
const H = new Function("localStorage", app.slice(a, b + end.length)
  + "\nreturn { pactClampChatW, pactReadChatW, pactApplyChatW, PACT_CHAT_W_MIN, PACT_CHAT_W_KEY };")
  ({ getItem: () => null, setItem() {}, removeItem() {} });

test("the drag can never make the chat narrower than the width at which it clips", () => {
  assert.equal(H.PACT_CHAT_W_MIN, 420, "the measured floor, not a round number someone liked");
  assert.equal(H.pactClampChatW(100, 2000), 420);
  assert.equal(H.pactClampChatW(-5000, 2000), 420);
});

test("…nor wide enough to leave the editor unusable", () => {
  assert.equal(H.pactClampChatW(5000, 2000), 1500, "75% of the work area is the ceiling");
  assert.equal(H.pactClampChatW(900, 2000), 900, "and anything in between is honoured exactly");
});

test("on a window too small for both, the floor still wins over the ceiling", () => {
  // 75% of 400 is 300, below the 420 floor. A clamp whose bounds cross must not invert.
  assert.equal(H.pactClampChatW(380, 400), 420);
  assert.ok(H.pactClampChatW(9999, 400) >= 420);
});

test("applying a width also drops the stylesheet's 600px floor, or the drag silently does nothing", () => {
  const node = { style: {} };
  H.pactApplyChatW(node, 480);
  assert.equal(node.style.flex, "0 0 480px");
  assert.equal(node.style.minWidth, "0",
    "styles.css pins `.pact-right { min-width: min(600px, 40vw) }` — left in place it would refuse 480 "
    + "and the grip would look broken rather than clamped");
});

test("resetting clears BOTH, so the CSS default share takes over again", () => {
  const node = { style: { flex: "0 0 480px", minWidth: "0" } };
  H.pactApplyChatW(node, 0);
  assert.equal(node.style.flex, "");
  assert.equal(node.style.minWidth, "", "a leftover min-width:0 would drop the floor for everyone");
});

test("a stored width below the floor is ignored rather than trusted", () => {
  const mk = (v) => new Function("localStorage", app.slice(a, b + end.length) + "\nreturn pactReadChatW();")
    ({ getItem: () => v, setItem() {}, removeItem() {} });
  assert.equal(mk("880"), 880);
  assert.equal(mk("12"), 0, "a corrupted/stale value must fall back to the default, not clip the pane");
  assert.equal(mk("nonsense"), 0);
  assert.equal(mk(null), 0);
});

test("the default share really is bigger than it was", () => {
  assert.match(css, /\.pact-editor-wrap \{ flex: 3 1 0;/,
    "editor:chat was 4:1 — a fifth of the work area — which is the 'make it bigger' half of the report");
});

test("the grip is visible, grabbable, and gone where the columns stack", () => {
  assert.match(css, /\.pact-wgrip \{[^}]*cursor: col-resize/, "it must announce what it does");
  assert.match(css, /\.pact-wgrip::before \{ content: ""; position: absolute; inset: 0 -5px; \}/,
    "a 6px bar needs a padded hit area, or it is a control you can see and cannot grab");
  assert.match(css, /\.pact-wgrip \{[^}]*touch-action: none/, "pointer drag needs it, or the page scrolls instead");
  const stacked = css.slice(css.indexOf("@media (max-width: 900px), (pointer: coarse)"));
  assert.match(stacked, /\.pact-wgrip \{ display: none; \}/, "nothing to resize when the columns stack");
  assert.match(stacked, /\.pact-right \{ flex: 0 0 auto !important; min-width: 0 !important; \}/,
    "…and a width saved on desktop must not survive into the stacked layout — it is set inline");
});

test("the drag is wired to the grip, and the choice is remembered", () => {
  assert.ok(app.includes("pactWireChatGrip(rightGrip, rightEl);"), "the grip must actually be wired");
  assert.ok(app.includes('el("div", { class: "pact-work" }, [editorWrap, rightGrip, rightEl])'),
    "…and sit BETWEEN the two columns it resizes");
  assert.ok(app.includes("localStorage.setItem(PACT_CHAT_W_KEY"), "a width you have to set on every load is not tunable");
  assert.ok(app.includes('grip.addEventListener("dblclick"'), "and there must be a way back to the default");
});
