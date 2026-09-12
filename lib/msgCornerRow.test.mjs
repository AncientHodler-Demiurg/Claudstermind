// node --test lib/msgCornerRow.test.mjs
//
// THE CORNER ROW OF AN ANSWER BUBBLE — its R# medallion and the ⧉ ↩ ⤴ ★ buttons that stand beside it.
//
//   "If a chat is too short to properly show the medallion and all the other buttons, it needs to be
//    enlarged to the minimum size that allows for all the buttons to show properly."
//
// Measured on the real page before this file existed: every one of those five elements was positioned
// ABSOLUTELY — the medallion pinned to `left: 6px`, the four buttons pinned to `right: 6/30/54/78px` —
// so none of them contributed a single pixel to the bubble's own width. A bubble sized to a short
// answer therefore had nowhere to put them, and since the buttons carry `z-index: 2` against the
// medallion's `1`, they were drawn straight ON TOP of it. One real row from the transcript:
//
//   R#7,767 — bubble 153px, medallion 65px, 4 buttons → gap between them: -21px
//
// A -21px gap is the screenshot: "R#7," and then the buttons over the rest of the number.
//
// The fix is not a bigger min-width — a hard-coded minimum is a guess about how many digits an R#
// will ever have and how many buttons will ever stand there, and both change. The five elements go
// into one IN-FLOW flex row instead, pulled onto the bubble's top edge by a negative margin. Being in
// flow, they are part of the bubble's intrinsic width, so the browser widens a short bubble to
// exactly what they need — and keeps doing so when a digit or a button is added.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const css = readFileSync(join(__dir, "..", "dashboard", "public", "styles.css"), "utf8");

test("both workspaces build the corner row through ONE builder", () => {
  // Core and Pact each assembled this corner independently. Two copies of a five-element row is how
  // the two drifted in the first place (Pact's ⤴ and Core's ⤴ already sat at different offsets once).
  assert.match(app, /function wsMsgHead\(/, "one builder, used by both");
  assert.equal((app.match(/wsMsgHead\(/g) || []).length, 3,
    "the definition plus exactly two call sites — Core's answer bubble and Pact's");
  const at = app.indexOf("function wsMsgHead(");
  const body = app.slice(at, app.indexOf("\n}", at));
  assert.match(body, /ws-msghead-sp/, "a spacer is what pushes the buttons to the far end of the row");
});

test("the row is IN FLOW, so the bubble is sized by it", () => {
  // This is the whole fix. If any of the five goes back to position:absolute inside the row, the
  // bubble stops being sized by it and the overlap returns silently.
  assert.match(css, /\.ws-msghead \{[^}]*display: flex/, "a flex row");
  assert.match(css, /\.ws-msghead \{[^}]*margin: -17px -4px -3px/,
    "pulled onto the top edge — the row must cost the bubble NO height, only width");
  // THREE classes, not two: the rules this has to beat (`.ws-assistant .ws-copy-btn` and friends)
  // carry two, and a tie is settled by source order — by where the next rule happens to be pasted.
  // The two-class version was written first and measured: the buttons stayed absolute, overlap -21px.
  assert.match(css, /\.ws-line\.ws-assistant \.ws-msghead > \*, \.pc-msg\.pc-asst \.ws-msghead > \* \{\s*position: static;/,
    "inside the row nothing may be pinned to a corner — a pinned child contributes no width");
  assert.match(css, /\.ws-msghead .ws-msghead-sp \{[^}]*flex: 1 1 /,
    "the spacer takes the slack on a wide bubble, so medallion-left / buttons-right still reads as it did");
});

test("the old corner pins survive for every bubble that is NOT an answer", () => {
  // A prompt keeps its P# pinned top-right and its ⧉/↩ inline — measured, prompts never overlapped
  // (0 absolutely-positioned buttons, narrowest 97px against a 53px medallion). Changing them would
  // be churn, so the pins stay for them and only the answer's corner becomes a row.
  assert.match(css, /\.ws-num-p \{ right: 6px;/, "a prompt's badge is still pinned");
  assert.match(css, /\.ws-num \{ position: absolute;/, "…and the badge is still absolute by default");
});
