// node --test lib/chatShellControlsWiring.test.mjs
//
// Five controls that LOOKED right after the chat box became a package but were not actually wired,
// each reported from the live app:
//
//   1. the model selector rendered as a bare caret naming nothing
//   2. the effort selector was absent entirely
//   3. the context readout said "—", which is not a fact about anything
//   4. "▲ 7,146 earlier turns · load earlier" appeared with no explanation of what it counted
//   5. auto-continue existed in Pact and not at all in Core
//
// Getting the shell's SHAPE right is not the same as getting its wiring right; these pin the wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const shellUi = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell-ui.js"), "utf8");

/* ---- 1. the model selector can never be empty ------------------------------------------------- */

test("the model selector always names a model, even before the catalogue has loaded", () => {
  // st.models is populated when a session answers "models" — until then, and whenever the cached
  // catalogue happens to hold only OmniRoute entries while OmniRoute is off, fillModelSelect built
  // ZERO option groups and the control rendered as a bare caret.
  assert.ok(app.includes("const WS_FALLBACK_MODELS = ["), "a fallback catalogue must exist");
  // The CONDITION this fallback hangs on is the part that was wrong, and it is now behaviour, not
  // text: lib/modelSelectFill.test.mjs executes the real fill against a DOM and proves a picker with
  // a running model still offers every other one. ("no options at all" was too narrow — a select
  // carrying one injected option is not empty, which is exactly how the dead-end picker got through.)
  assert.ok(app.includes("function wsFillModelSelectFrom(sel, list, shown, requestRefresh, sig) {"),
    "ONE fill implementation, shared by both selector builders so they cannot drift");
  // Minus the definition itself, which shares the parameter names. Matched on arguments rather than
  // line-leading whitespace: the Core call wraps across two lines now that it passes a cache
  // signature, and a formatting change must not read as "a builder stopped calling the shared fill".
  const defs = (app.match(/function wsFillModelSelectFrom\(/g) || []).length;
  assert.equal((app.match(/wsFillModelSelectFrom\(sel, list, /g) || []).length - defs, 2,
    "fillModelSelect AND buildMobileModelSelect must both go through it");
  // The fallbacks must be REAL subscription aliases the SDK accepts, never invented labels.
  for (const v of ['{ value: "default"', '{ value: "opus"', '{ value: "sonnet"', '{ value: "haiku"']) {
    assert.ok(app.includes(v), `${v} must be offered as a real, accepted model alias`);
  }
});

/* ---- 2. the effort selector is offered, not hidden -------------------------------------------- */

test("effort is offered when the model's capability is UNKNOWN, and only hidden when it is known-absent", () => {
  // The old rule hid the control whenever `supportsEffort` was falsy — which includes "the catalogue
  // has not told us yet", i.e. most of a cold load. Three states, not two.
  assert.ok(app.includes("const WS_SDK_EFFORT_LEVELS = [\"low\", \"medium\", \"high\", \"xhigh\", \"max\"]"),
    "the SDK's own five levels must be declared as the fallback");
  assert.ok(app.includes("sel.hidden = known && !levels.length;"),
    "the selector may only vanish when the model has actually SAID it has no effort levels");
  assert.ok(app.includes("has not reported its supported levels yet"),
    "…and when it is a fallback, the tooltip must say so rather than implying certainty");
});

test("an unset effort reads as 'Default effort', never as 'low'", () => {
  // A <select> whose value matches no option falls back to the first — so a list starting at "low"
  // silently claimed the lowest level for a conversation that had simply never chosen one.
  assert.ok(shellUi.includes('[{ value: "", label: "Default effort" }].concat('),
    "the package's default effort list must carry an explicit unset entry, first");
  assert.ok(app.includes('el("option", { value: "" }, ["Default effort"])'),
    "…and Core's own filler must keep offering the same unset entry");
});

/* ---- 3. the context readout says something true ---------------------------------------------- */

test("a missing context reading says so, in both workspaces, instead of showing a dash", () => {
  // Stronger than the old version of this test, which counted THREE copies of the phrase and so
  // enforced the duplication rather than the behaviour: there is now one painter, and the three
  // call sites (Core's paint, Core's live-event path, Pact's) all go through it.
  const said = app.split("context: no reading yet").length - 1;
  assert.equal(said, 1, "one painter owns the wording — three copies is how two phrasings appear");
  assert.ok(app.includes("function wsPaintUsage(node, usage, contextUsage, engineLive)"),
    "…and that painter exists, and takes the engine-live fact the wording depends on");
  assert.ok(!app.includes('ui.usageEl.textContent = usg.text || "—";'), "the bare dash must be gone");
  assert.ok(app.includes("node.hidden = false;"),
    "Pact must stop hiding the readout entirely — hidden made 'no reading' look like 'no such control'");
  assert.ok(app.includes("Click to ask for it now."), "…and the readout must offer the way to fetch one");
  // The THIRD hand-written copy, inside pactChatPaint, disagreed with the painter it duplicated:
  // `hidden = !usg.text` rendered "no reading yet" as no control at all.
  assert.ok(!app.includes("usageEl.hidden = !usg.text"),
    "Pact's paint must not re-hide the readout behind the painter's back");
});

test("the context readout never prints a number and a percentage that disagree", () => {
  // "1,600 tok · 94% of 1000k ctx" — the number was the turn's billed tokens, the percentage was the
  // window's fill. Two measurements, one sentence. Both halves now come from `contextUsage`.
  assert.ok(!app.includes("const ctxSuffix = ctxPct !== null"),
    "the old suffix-onto-turn-usage construction must be gone");
  assert.ok(app.includes("last turn: ${turn.toLocaleString()} tok"),
    "turn usage may still be shown when there is no context reading — but LABELLED as the turn");
  assert.ok(app.includes("Last turn: ${turn.toLocaleString()} tokens in + out (billed for that turn — not the window)"),
    "…and the breakdown must say plainly that it is not the window");
});

test("a pane with a live session asks for a context reading instead of waiting for a turn to end", () => {
  // contextUsage was only ever requested after a turn completed, so a resumed or reattached pane
  // showed an empty readout indefinitely.
  assert.ok(app.includes("p._ctxAsked !== p.sessionKey"),
    "the request must be made once per pane per session key, not on every paint");
  assert.ok(app.includes('!p.contextUsage && p._ctxAsked !== p.sessionKey'),
    "…and only while there is genuinely no reading yet");
});

/* ---- 4. the earlier-turns affordance explains itself ------------------------------------------ */

test("'N earlier turns' says what it counts and that nothing is lost", () => {
  assert.ok(app.includes("This conversation is longer than what is rendered right now."),
    "the count must name what it is counting");
  assert.ok(app.includes("nothing is lost, they are stored and searchable"),
    "…and say plainly that the turns above are not gone");
  assert.ok(app.includes("Click to load the next block into view."), "…and what clicking does");
});

/* ---- 5. auto-continue exists in Core, on the same engine as Pact ------------------------------ */

test("Core's auto-continue drives the SAME pure decision function Pact's does", () => {
  // A second set of rules for the same feature is how two implementations start. pactAutoDecide is
  // pure — no DOM, no Pact state — so Core feeds it Core's inputs and gets the same semantics.
  assert.ok(app.includes("function wsAutoEnsure(p) {"), "Core must have a real loop, not a decorative checkbox");
  assert.ok(app.includes("const d = pactAutoDecide({"), "…driven by the shared decision function");
  assert.ok(app.includes("autoCap: p._autoCap, deadline: p._autoDeadline"), "…with Core's own per-pane state");
  assert.ok(app.includes("wsAutoEnsure(p);"), "…and actually called from the pane's paint");
});

test("Core's loop is off by default, and the browser neither counts nor sends", () => {
  // THE LOOP MOVED TO THE SERVER (lib/autoContinue.mjs + workspace.mjs). It had to: a browser loop
  // runs only while a browser is awake, so a locked phone froze an unattended sweep and fired it on
  // return — reported three times in three different disguises.
  //
  // What this test guards is the hazard that move creates. If the browser ALSO fired, every round
  // would go out twice, and this codebase has already shipped a double-send twice from exactly here
  // ("Why was this send multiple times, it must be sent once"). So the assertions are now negative:
  // the client may ask, display and stop — it may not send, and it may not keep a count of its own
  // that could disagree with the machine doing the work.
  assert.ok(app.includes("autoContinue: { shown: false, on: !!p._autoContinue }"),
    "a fresh pane must not start an autonomous loop");
  // EXACTLY ONE OWNER, NEVER BOTH — and never NEITHER, which is the failure this shape exists for.
  // The relay serves the page; the engine runs on the work machine; they deploy separately, so a
  // browser can always be newer than the server it talks to. When the client stopped firing before
  // the engine was restarted, auto-continue belonged to nobody and silently did nothing. So the
  // browser still drives until the engine SAYS it owns the loop by publishing its own auto state.
  assert.ok(app.includes("if (p._autoServer) { wsAutoStop(p); return d; }"),
    "once the engine owns the loop the browser must not also send — that is a double round");
  assert.ok(app.includes("o._autoServer = true;"),
    "…and ownership must be learned from the engine's own state frame, not assumed by version");
  assert.ok(app.includes("if (d.fire && !t._autoServer)"),
    "Pact must hand over on the same signal Core does");
  assert.ok(app.includes('action: "autoContinue", args: { sessionKey: p.sessionKey, on: !!on }'),
    "the switch must ask the server, which is what keeps a sweep running with this page closed");
  // …and the ceiling it asks about is enforced where the sending happens — see
  // lib/autoContinueServer.test.mjs ("it stops at the ceiling, unattended", "the client cannot raise
  // its own ceiling"), which are the tests that now carry this guarantee.
});

test("the ceiling's release exists on the DESKTOP control too", () => {
  // "The desktop doesn't have a continuation button for the auto." The ceiling waits for a human on
  // every surface, so the release has to exist on every surface — it was built for the phone only.
  // An arrow rather than a word: this group already carries auto, its counter, Stop and Send.
  const ui = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell-ui.js"), "utf8");
  assert.match(ui, /var autoMore = el\("button", \{ class: "automore"/,
    "the shared control needs the grant, or only the phone can release the ceiling");
  assert.match(ui, /call\("autoGrant"\)/, "…wired to the same callback the phone uses");
  assert.match(ui, /autoMore\.hidden = !\(ac\.on && nn\(ac\.n, 0\) >= nn\(ac\.max, 10\)\)/,
    "shown at the ceiling and nowhere else — the same condition the engine refuses on");
  assert.equal((app.match(/autoGrant: \(\) =>/g) || []).length, 4,
    "both workspaces must answer it on BOTH of their surfaces (desktop control + phone cockpit)");
});

test("Core's loop never fires silently — the control reports why it is paused", () => {
  assert.ok(app.includes("const why = pactAutoWhy(d);"), "the reason must come from the shared decision");
  // The title is computed up front and published through the same change-gate as the state, so a
  // 250 ms-per-pane timer stops repainting eight shells with a decision that has not moved.
  assert.ok(app.includes("if (ui.view.els.sendGrp) ui.view.els.sendGrp.title = title;"),
    "…and be readable on the control itself, not only in a log");
  assert.ok(app.includes("const title = d.on"), "…computed from the same decision, not restated");
  assert.ok(app.includes('"Auto-continue armed — sending in "'), "an armed loop must show its countdown");
});

test("auto-continue survives a reload in Core, flag AND round count", () => {
  // Restoring the flag without the count would silently hand back a spent ceiling.
  assert.ok(app.includes("autoContinue: !!p._autoContinue, autoCount: p._autoCount || 0, autoCap: p._autoCap || PACT_AUTO_CAP,"),
    "all three must be saved");
  assert.ok(app.includes("_autoContinue: !!p.autoContinue,"), "…and restored");
  assert.ok(app.includes("_autoCount: typeof p.autoCount === \"number\" ? p.autoCount : 0,"), "…including the count");
});

test("Pact's auto-continue moved onto the shell's control instead of being duplicated beside it", () => {
  // The suggest bar drew its own checkbox for the same flag; with the package's send-group control
  // wired to the same engine that would have been two switches for one setting.
  // It wires it to ONE shared setter now, rather than repeating the engine inline: the mobile cockpit
  // grew a second copy of this handler and the copy was missing the deadline reset and the ceiling
  // re-grant, so the same switch behaved differently depending on which surface you flipped it from.
  assert.ok(app.includes("autoContinue: (v) => pactSetAutoContinue(pactChatActive(), v)"),
    "Pact must wire the shell control to its engine");
  assert.match(app, /function pactSetAutoContinue\(a, v\)/, "…and that engine must be one function");
  assert.ok(app.includes("function pactPaintAutoControl(t, d)"),
    "one painter pushes the decision onto the shell control");
  assert.ok(app.includes("on: d.on, n: d.autoCount, max: d.autoCap,"),
    "…fed by the same decision the bar draws from, so the two can never disagree");
  // The desktop bar itself is gone (see the next block of tests) rather than merely suppressed
  // piece-by-piece — DESKTOP has no `.pc-suggest` DOM at all any more, only mobile does.
  assert.ok(app.includes('const box = PACT_CHAT.host.querySelector(".pc-suggest"); if (!box) return;'),
    "…and the box lookup itself must be reached only on the mobile-only path");
});

test("the auto-continue COUNTDOWN is on the switch that owns it, not in another bar", () => {
  // Reported: "the auto ticker isn't as in the chat shell lab, wrapped around the stop/send buttons".
  // It wasn't — the seconds ticked in Pact's suggest bar, a different row entirely, so the switch
  // looked inert while the loop was counting down and the thing that stops it was somewhere else.
  assert.ok(app.includes("in: d.arm && !d.fire ? Math.max(1, Math.ceil(d.msLeft / 1000)) : null"),
    "Pact must hand the shell the seconds remaining");
  assert.ok(shellUi.includes('txt(roundsEl, !ac.on ? "—" : secs != null ? rounds + " · " + secs + "s" : rounds)'),
    "…and the send-group control must render it beside the round count");
  // Reported again a round later: "there still is a suggested continue line that probably shouldn't
  // be here". The suggest bar wasn't merely de-duplicated any more — it's not built on desktop at
  // all. The suggestion is ghost text inside the compose box; only mobile still draws the old bar.
  assert.ok(app.includes('if (!mob) {'), "desktop must take a genuinely different path, not a suppressed copy");
  assert.ok(app.includes('PACT_CHAT._view.setState({ compose: { suggest: sug ? sug.text : "" } });'),
    "…feeding the suggestion into the compose box's own ghost-text state");
  assert.equal((app.match(/pactPaintAutoControl\(t, d\);/g) || []).length, 2,
    "the per-second tick AND pactChatUpdateSuggest must both drive the shell control, on every path, desktop included");
});

/* ---- 6. Pact could not send AT ALL ------------------------------------------------------------
 * Reported from the live app: neither Send nor Ctrl+Enter did anything in the Pact workspace.
 * Both funnel into pactChatSend, which reads the compose box as
 * `PACT_CHAT.host.querySelector(".pc-input")`. When Pact's desktop chat became the package, the
 * textarea it mounts carries `rg-typebox` — so that lookup returned null, `typed` was "", and the
 * function returned silently. SEVEN paths find the compose box by that class, so all seven broke at
 * once, every one of them behind an `if (ta)` guard that turned a hard failure into a quiet one.  */

test("Pact's compose box keeps its `.pc-input` identity when it is the package's textarea", () => {
  const lookups = (app.match(/querySelector\("\.pc-input"\)/g) || []).length;
  assert.ok(lookups >= 5, `the '.pc-input' contract must still be load-bearing (found ${lookups} lookups)`);
  assert.ok(app.includes("input = pv.els.typebox;"), "Pact must alias the package's textarea");
  assert.ok(app.includes('input.classList.add("pc-input");'),
    "…and tag it `.pc-input`, or every one of those lookups silently resolves to null");
  // The order matters: the class has to go on the node Pact actually mounted, not a discarded one.
  const alias = app.indexOf("input = pv.els.typebox;");
  const tag = app.indexOf('input.classList.add("pc-input");');
  assert.ok(tag > alias && tag - alias < 900, "the tag must be applied to the aliased package node");
});

/* ---- 7. "which model is actually working" is always on screen -------------------------------- */

test("the running-model readout is never blank and never hidden, in either workspace", () => {
  // Core wrote the right text straight onto the node — while the package kept it hidden, because it
  // hides that chip whenever `activeLabel` is empty, and Core never passed one. Text present, chip
  // invisible: the reason "which model is working" could not be read anywhere in Core.
  assert.ok(app.includes("if (ui.view) ui.view.setState({ model: { activeLabel: r.text.replace"),
    "Core must publish the running model THROUGH the package, so the chip is actually shown");
  assert.ok(!app.includes('ui.modelNow.textContent = mr.text ? "· " + mr.text : "· model unreported";'),
    "…and must not go back to writing textContent onto a node the package leaves hidden");
  // Pact says the same thing in the same words — not by two functions that happen to agree, but by
  // calling the SAME one. Wording that is merely copied is wording that drifts.
  assert.equal((app.match(/function wsModelNowReadout\(/g) || []).length, 1, "one readout function");
  assert.equal((app.match(/^ +(?:const \w+ = )?wsModelNowReadout\(/gm) || []).length, 2,
    "…called by Core and by Pact, and by nobody who reimplements it");
  // The package hides the chip on an empty label — so an empty label is exactly what must never be sent.
  assert.ok(shellUi.includes('show(modelNow, !!m.activeLabel)'),
    "the package's own rule (empty label ⇒ hidden) is what makes the fallback text mandatory");
});
