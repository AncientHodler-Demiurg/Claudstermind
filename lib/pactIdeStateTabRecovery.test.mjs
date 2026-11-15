// node --test lib/pactIdeStateTabRecovery.test.mjs
//
// THE REPORT: "if i have two chats opened on pact workspace, and i reload the page, only the master
// chat is kept, the other one is closed, and i think that messes up its flow." Caught live: a real
// workspace's `_ide-state.json` was directly observed collapsing from 3 chat tabs (Master, Chat 2,
// Explorer) down to 1 (Master only) between two reads taken two minutes apart, with no deliberate
// close in between. Root cause: the ide-state blob is ONE shared file across every device/browser-tab
// viewing Pact, written with a blind full-replace PUT — a client that's been open since before the
// other tabs existed still only has one tab in memory, and its next ordinary save (any keystroke,
// drag, periodic resync) overwrites the richer file straight back down to one tab.
//
// The server-side guard (mergeForeignTabs, see lib/pactIdeState.test.mjs) is pinned separately. This
// file pins the FRONTEND wiring that arms it: PACT_IDE_KNOWN_KEYS must be sent with every save, grown
// on every locally-created/-opened tab, seeded on every restore, and a server-reported recovery must
// actually get adopted into the live view (not just fixed in the file for next reload).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

test("PACT_IDE_KNOWN_KEYS exists and every save sends it to the server", () => {
  assert.match(app, /let PACT_IDE_KNOWN_KEYS = new Set\(\);/, "the known-keys set must exist");
  const i = app.indexOf("function pactStatePut(state, keepalive) {");
  assert.ok(i >= 0, "pactStatePut must exist");
  const body = app.slice(i, i + 1200);
  assert.match(body, /knownKeys: \[\.\.\.PACT_IDE_KNOWN_KEYS\]/, "every PUT must carry the writer's own known-keys set");
});

test("a server-reported recovery is adopted into the live view, not just left for the next reload", () => {
  const i = app.indexOf("function pactStatePut(state, keepalive) {");
  const body = app.slice(i, i + 1200);
  assert.match(body, /\.then\(\(r\) => r\.json\(\)\)\.then\(\(r\) => \{ if \(r && r\.ok && r\.merged && Array\.isArray\(r\.recoveredTabs\) && r\.recoveredTabs\.length\) pactAdoptRecoveredTabs\(r\.recoveredTabs\); \}\)/,
    "pactStatePut must read the PUT response and hand any recoveredTabs to pactAdoptRecoveredTabs");
  assert.match(app, /function pactAdoptRecoveredTabs\(recovered\)/, "the live-adoption function must exist");
});

test("pactAdoptRecoveredTabs builds real live tabs (shares pactRestoreChat's own per-tab constructor), renders, and never double-adopts", () => {
  const i = app.indexOf("function pactAdoptRecoveredTabs(recovered) {");
  assert.ok(i >= 0);
  const body = app.slice(i, i + 900);
  assert.match(body, /const have = new Set\(PACT_CHAT\.tabs\.map\(\(t\) => t\.key\)\);/, "must dedupe against tabs already present");
  assert.match(body, /if \(!ts \|\| typeof ts\.key !== "string" \|\| have\.has\(ts\.key\)\) continue;/, "a tab already adopted (or malformed) must be skipped");
  assert.match(body, /const t = pactLiveTabFromSaved\(ts\);/, "must reuse the SAME per-tab constructor pactRestoreChat uses — one implementation, not a second one that could drift");
  assert.match(body, /PACT_IDE_KNOWN_KEYS\.add\(t\.key\);/, "an adopted tab becomes known — this browser's own later close of it must be able to stick");
  assert.match(body, /pactChatRender\(\);/, "the newly adopted tab(s) must actually become visible");
});

test("pactRestoreChat delegates to the shared pactLiveTabFromSaved constructor, not an inline copy", () => {
  assert.match(app, /function pactLiveTabFromSaved\(ts\) \{/, "the shared constructor must exist");
  assert.match(app, /PACT_CHAT\.tabs = tabs\.map\(\(ts\) => pactLiveTabFromSaved\(ts\)\);/, "pactRestoreChat must delegate to it, not inline its own copy");
});

test("every tab-creation path marks its key known: pactChatNewTab (fresh) and pactChatOpenSaved (resumed from history)", () => {
  const nt = app.indexOf("function pactChatNewTab() {");
  assert.ok(nt >= 0);
  const ntBody = app.slice(nt, nt + 900);
  assert.match(ntBody, /const freshKey = wsUuid\(\);/, "the minted key must be captured, not inlined, so it can be recorded");
  assert.match(ntBody, /PACT_IDE_KNOWN_KEYS\.add\(freshKey\);/, "a freshly created tab's key must be marked known immediately");
  assert.match(ntBody, /key: freshKey,/, "the tab object itself must use the captured key");

  const os = app.indexOf("function pactChatOpenSaved(r, adopt) {");
  assert.ok(os >= 0);
  const osBody = app.slice(os, os + 900);
  assert.match(osBody, /if \(key\) PACT_IDE_KNOWN_KEYS\.add\(key\);/, "resuming a saved conversation as a tab must also mark it known");
});

test("pactRestoreState seeds PACT_IDE_KNOWN_KEYS from the final restored tab list, right before saving is armed", () => {
  const i = app.indexOf("PACT_STATE_READY = true;   // from here on, user changes persist");
  assert.ok(i >= 0, "the flip to PACT_STATE_READY = true at the end of pactRestoreState must exist");
  const before = app.slice(Math.max(0, i - 500), i);
  assert.match(before, /for \(const t of \(PACT_CHAT && PACT_CHAT\.tabs\) \|\| \[\]\) if \(t\.key\) PACT_IDE_KNOWN_KEYS\.add\(t\.key\);/,
    "every tab this restore ended up with must be seeded as known BEFORE PACT_STATE_READY/PACT_RESTORE_STATE flip, so this device's very first subsequent save already carries a correct knownKeys");
});
