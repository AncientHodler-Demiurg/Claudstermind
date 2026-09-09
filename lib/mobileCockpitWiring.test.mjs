// node --test lib/mobileCockpitWiring.test.mjs
//
// WHY THIS EXISTS. The mobile cockpit (docs/work/mobile-cockpit/design.md) is a second arrangement of
// a pane that is used daily from a phone, so it ships behind a switch that defaults OFF. Two things
// therefore have to stay true no matter what else changes: the cockpit must not run unless the switch
// is on, and it must not REBUILD controls that already exist — it re-homes the package's own nodes or
// drives them, because a second implementation of a model picker is how the two drift apart.
//
// dashboard/public/app.js is a ~15,000-line browser monolith that cannot be imported (it boots the
// DOM), so this is a wiring check over the source, the same technique as lib/manualWrapUi.test.mjs.
// The BEHAVIOUR is verified by running the real page: `node scripts/mobile-smoke.mjs` with the switch
// off and again against `http://127.0.0.1:3001/?m2=1`, which is how the two defects this file now
// guards were found (a `mc` binding read inside its temporal dead zone, and a class scoped to the
// workspace root that could never reach the app header).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const mod = readFileSync(join(__dir, "..", "dashboard", "public", "mobile-cockpit.js"), "utf8");
const html = readFileSync(join(__dir, "..", "dashboard", "public", "index.html"), "utf8");

test("the cockpit mounts only on a phone, and only with the switch on", () => {
  assert.match(app, /if \(WS_MOBILE_MQ\.matches && WS_MOBILE2 && window\.MobileCockpit\)/,
    "both conditions must gate the mount, or a desktop pane gets a phone layout");
  // Not `st.isMobile`: nothing writes it until syncMobile(), which runs AFTER the saved layout has
  // already built its panes — so every pane that exists at load would have read `undefined`.
  assert.ok(!/if \(st\.isMobile && WS_MOBILE2/.test(app),
    "st.isMobile is not yet written when panes are built; the media query is");
  // ON BY DEFAULT. It shipped off for one release and the report was immediate and fair: "why do I
  // have to tap a switch button at all, I thought it goes automatically to this view, when on
  // mobile." A phone gets a phone's layout; the opt-out is the exception, not the entry fee.
  assert.match(app, /localStorage\.getItem\("ws\.mobile\.v2"\) !== "0"/,
    "absent means NEVER CHOSE, which must read as the default — not as a choice for the old layout");
  assert.match(app, /\[\?&\]m2=1/, "…and it can still be forced on by URL");
  assert.match(app, /\[\?&\]m2=0/, "…and off, which is the half people forget");
  // Both directions are written. Removing the key on opt-out would make the next load read "never
  // chose" and turn the cockpit back on — an opt-out that silently undoes itself.
  assert.match(app, /localStorage\.setItem\("ws\.mobile\.v2", WS_MOBILE2 \? "0" : "1"\)/,
    "turning it off must be recorded, or it does not stay off");
});

test("the switch's class goes on the BODY, because the way back lives outside the workspace root", () => {
  assert.match(app, /document\.body\.classList\.toggle\("ws-mobile2"/,
    "a class on the workspace root cannot reach the app header, and the exit button lives there");
  assert.match(html, /id="wsM2Btn"/, "the exit button exists in the page shell");
  assert.match(app, /m2b\.hidden = !\(st\.isMobile && WS_MOBILE2\)/,
    "…and is shown only when it means something");
});

test("controls are re-homed or driven — never rebuilt", () => {
  // Composites (a meter with a split button, a live context chip) move as nodes.
  for (const el of ["context: view.els.contextBtn", "wrap: view.els.wrapWrap"])
    assert.ok(app.includes(el), `${el} must be handed over as the package's own node`);
  // Values are driven: the wheel writes through to the real <select>, whose own listener then runs
  // Core's unchanged handler. Re-homing the <select> instead would put the dropdown back.
  assert.match(app, /node\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/,
    "driving a control means firing the event its real listener is waiting for");
  for (const cb of ["model: (v) => drive(modelSel, v)", "effort: (v) => drive(effortSel, v)",
                    "permission: (v) => drive(modeSel, v)", "ultracode: (v) => drive(ultracodeCb, v)"])
    assert.ok(app.includes(cb), `${cb} must drive the existing control`);
  assert.ok(!/new MobileModelSelect|buildMobileModelSelect\(.*cockpit/i.test(app),
    "no second model picker may be built for the phone");
});

test("the type box is a surface, not a second place the text lives", () => {
  assert.match(app, /const mirror = \(v\) => \{ promptEl\.value = v; p\.draft = v; saveDraftsSoon\(\); \}/,
    "drafts, the reply quote's prepending, attachments and auto-continue all read promptEl");
  assert.match(app, /send: \(\) => \{ send\(p\); return true; \}/, "and sending goes through Core's own send()");
});

test("the transcript is adopted WITH its stick wrapper, or the controller is left behind", () => {
  assert.match(app, /classList\.contains\("stick-wrap"\)\s*\?\s*view\.core\.parentNode : view\.core/,
    "adopting the core alone tore it out of the wrapper that holds the jump-to-latest pill");
});

test("the cockpit's own state feed rides the existing paint paths", () => {
  assert.match(app, /function wsMcSync\(p\)/);
  assert.match(app, /function wsMcStats\(p\)/);
  assert.ok((app.match(/wsMcSync\(p\);/g) || []).length >= 1, "called from paintPane, not from a second schedule");
  assert.match(app, /ui\.mc\.setState\(\{ stats: Array\.prototype\.slice\.call\(ui\.view\.statsRow\.children\) \}\)/,
    "the stats chips are MOVED, not rebuilt — same nodes, same numbers, one implementation");
  assert.match(app, /const ui0 = paneUI\.get\(p\.id\); if \(ui0\) ui0\.mc = mc;/,
    "recorded after the mount: naming `mc` inside the paneUI literal read it in its temporal dead zone");
});

test("every callback the module invokes is supplied by the host", () => {
  const wanted = [...mod.matchAll(/call\("([a-zA-Z]+)"/g)].map((m) => m[1]);
  const unique = [...new Set(wanted)];
  assert.ok(unique.length >= 12, "the module really does call back for its actions");
  const wiring = app.slice(app.indexOf("mc = window.MobileCockpit.mount("), app.indexOf("paneRoot.classList.add(\"ws-mobile2\")"));
  const missing = unique.filter((n) => !new RegExp("\\b" + n + ":").test(wiring));
  // `input`/`send`/`stop` and the rest must all land somewhere; a callback the host never supplies is
  // a control that silently does nothing, which is the failure this whole port keeps finding.
  assert.deepEqual(missing.filter((n) => !["compact", "wrap", "makeMain", "copyTurn", "replyTurn", "shareTurn", "starTurn"].includes(n)), [],
    "an unsupplied callback is a button that does nothing");
});

test("the state feed reads the field names its PRODUCERS emit, not names that sound right", () => {
  // Both of these were written from inference and both were wrong: the agents list used `t.name` and
  // `t.done` (the shape is `{label, status}`), so every row would have read "agent · running"; the
  // history list used `h.when` and `h.worktreeMissing` (they are `updatedAt` and `missingWorktree`)
  // and keyed off `sessionKey`, which is the SEARCH result's key — the plain list is one row per
  // workspace, so Resume would have reopened the wrong conversation. A mapping is only as good as the
  // shape on the other side, so this checks both ends.
  const feed = app.slice(app.indexOf("function wsMcSync(p)"), app.indexOf("function wsMcStats(p)"));
  const bg = readFileSync(join(__dir, "backgroundTasks.mjs"), "utf8");
  for (const f of ["label", "status", "tokens"]) {
    assert.ok(new RegExp("t\\." + f + "\\b").test(feed), `the agents mapping must read t.${f}`);
    assert.ok(new RegExp("\\b" + f + "\\b").test(bg), `…and lib/backgroundTasks.mjs must emit ${f}`);
  }
  assert.ok(/t\.status !== "removed"/.test(feed), "a retired task is not a finished one — filtered as paintSwarm filters it");
  const histItem = (() => {
    const at = app.indexOf("function histItem(h"), open = app.indexOf("{", at);
    let d = 0;
    for (let i = open; i < app.length; i++) {
      if (app[i] === "{") d++;
      else if (app[i] === "}" && --d === 0) return app.slice(at, i + 1);
    }
    return "";
  })();
  for (const f of ["workspaceId", "updatedAt", "missingWorktree", "firstPrompt"]) {
    assert.ok(new RegExp("h\\." + f + "\\b").test(feed), `the history mapping must read h.${f}`);
    assert.ok(new RegExp("h\\." + f + "\\b").test(histItem), `…and histItem must be reading h.${f} too`);
  }
  assert.ok(!/h\.sessionKey/.test(feed),
    "sessionKey is the search result's key; the plain history list is one row per workspace");
});

test("the page loads the cockpit before app.js, and its stylesheet with the package's", () => {
  assert.ok(html.indexOf('src="/mobile-cockpit.js"') < html.indexOf('src="/app.js"'),
    "app.js reads window.MobileCockpit at pane-build time");
  assert.match(html, /<link rel="stylesheet" href="\/mobile-cockpit\.css" \/>/);
});
