// node --test lib/pactSoloChat.test.mjs
//
// THE REQUEST: on the Pact workspace, a way to expand the agent chat to fill the whole area (hiding
// the editors) for a small screen — and CRUCIALLY per-device, NOT globally toggled: "toggling it once
// on a device" must not flip it on any other device viewing the same Pact workspace.
//
// The chat/editor split has two persistence channels: pactStateSnapshot() → _ide-state.json is SYNCED
// across devices; localStorage keys like PACT_CHAT_W_KEY ("cm.pact.chatw.v1") are PER-DEVICE. This
// feature MUST hang off the per-device channel. These are presence/invariant checks over the source
// (the toggle is DOM-bound and can't be eval'd headless here), same convention as coreMultiChat's
// "wiring:" tests — proof it can't silently regress into a synced/global toggle.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const css = readFileSync(join(__dir, "..", "dashboard", "public", "styles.css"), "utf8");

test("the toggle is stored per-device (localStorage), on a cm.pact.* key like the chat-width preference", () => {
  assert.match(app, /const PACT_CHAT_FULL_KEY = "cm\.pact\.chatfull\.v1";/,
    "a dedicated per-device localStorage key must exist");
  assert.match(app, /localStorage\.setItem\(PACT_CHAT_FULL_KEY/, "toggling persists to localStorage");
  assert.match(app, /localStorage\.getItem\(PACT_CHAT_FULL_KEY\)/, "state is read back from localStorage");
});

test("CRUCIAL: the solo-chat state is NEVER put in the synced snapshot — it can't leak to other devices", () => {
  // pactStateSnapshot() is the blob PUT to _ide-state.json and shared across every device. If the
  // solo key appeared inside it, toggling on the laptop would flip the phone too — the exact thing
  // the user does NOT want. Assert the snapshot function body doesn't mention the key.
  const a = app.indexOf("function pactStateSnapshot");
  assert.ok(a >= 0, "pactStateSnapshot must exist");
  const body = app.slice(a, a + 2000);
  assert.ok(!body.includes("PACT_CHAT_FULL_KEY") && !/chatfull/i.test(body),
    "the synced snapshot must NOT carry the solo-chat toggle — it is per-device only");
});

test("wiring: the toggle button sits in the CHAT header (headExtra), so it survives hiding the editors", () => {
  assert.match(app, /headExtra: \[headActions, soloBtn, chatCollapse\]/,
    "soloBtn must be in the desktop chat-shell headExtra — if it were in the editor toolbar it would vanish in solo mode");
  assert.match(app, /soloBtn\.addEventListener\("click", \(\) => pactToggleChatFull\(\)\)/, "the button toggles the mode");
});

test("wiring: the persisted class is applied when the Pact view is built", () => {
  assert.match(app, /"pact-ide" \+ \(pactReadChatFull\(\) \? " pact-chat-full" : ""\)/,
    "on build, the root .pact-ide gets .pact-chat-full when the per-device flag is set");
});

test("CSS: solo mode hides the tree, editor, and drag-grip, and lets the chat column take the full width", () => {
  assert.match(css, /\.pact-ide\.pact-chat-full \.pact-tree/, "hides the file tree");
  assert.match(css, /\.pact-ide\.pact-chat-full \.pact-editor-wrap/, "hides the editor region");
  assert.match(css, /\.pact-ide\.pact-chat-full \.pact-wgrip/, "hides the drag grip");
  // must override the inline flex a custom chat-width drag leaves on .pact-right (pactApplyChatW)
  assert.match(css, /\.pact-ide\.pact-chat-full \.pact-right \{[^}]*flex: 1 1 100% !important/,
    "the chat column must span the full width, overriding any dragged-width inline flex");
});
