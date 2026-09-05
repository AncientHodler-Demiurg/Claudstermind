// node --test lib/chatShell.test.mjs
// Pure layout maths for the unified chat shell. dashboard/public/chat-shell.js is a classic script
// (no bundler) exposing window.ChatShell — evaluated here against a fake window, the same way
// lib/deployHelpers.test.mjs treats deploy-helpers.js. The LAB PAGE runs this exact file, so what is
// approved visually is what these tests describe.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "chat-shell.js"), "utf8");
const win = {};
new Function("window", src)(win);
const CS = win.ChatShell;

// A roomy desktop: 900px shell, 100px header, 150px footer at rest ⇒ Core = 650.
const TALL = { shellH: 900, headerH: 100, footerBaseH: 150, lineH: 18, minTypeH: 34 };
// A cramped window where a bare 40% fraction would be an unusable box.
const SHORT = { shellH: 340, headerH: 100, footerBaseH: 150, lineH: 18, minTypeH: 34 };

test("the percentage is of CORE, not the viewport — the old Core/Pact divergence", () => {
  assert.equal(CS.coreAtRest(TALL), 650);
  // The % caps how much the box may GROW (how much of Core it takes), not its total height:
  // 34 (resting) + 40% of Core (650) = 294 — independent of any window/viewport figure
  assert.equal(CS.swallowCap({ ...TALL, expanded: false }), 34 + 260);
  // toggled: the box may take ALL of Core, so its total is resting + all of Core
  assert.equal(CS.swallowCap({ ...TALL, expanded: true }), 34 + 650);
});

test("40% is hardcoded and global — not a per-conversation setting", () => {
  assert.equal(CS.SWALLOW_PCT, 0.40);
  assert.equal(CS.SWALLOW_PCT_MAX, 1.00);
});

test("a short window does NOT read as broken: the row floor beats the fraction", () => {
  // Core here is only 90px; a bare 40% would be a 36px, two-line box.
  assert.equal(CS.coreAtRest(SHORT), 90);
  const cap = CS.swallowCap({ ...SHORT, expanded: false });
  assert.ok(cap > 34 + 0.40 * 90, "the fraction must not be allowed to produce a stunted box");
  assert.equal(cap, CS.FLOOR_ROWS * 18, "the 6-row floor wins here, and still fits inside Core's give");
  assert.equal(CS.computeShell({ ...SHORT, contentH: 40, expanded: false }).capIsFloored, true,
    "and the layout REPORTS that the floor took over, rather than hiding it");
});

test("growth takes height from Core, and gives it straight back", () => {
  const rest = CS.computeShell({ ...TALL, contentH: 34, expanded: false });
  assert.equal(rest.coreH, 650, "at rest Core is whole");
  assert.equal(rest.typeScrolls, false);
  assert.equal(rest.collapseLevel, 0, "nothing collapses until the box is actually at its cap");

  const grown = CS.computeShell({ ...TALL, contentH: 150, expanded: false });
  assert.equal(grown.typeH, 150);
  assert.equal(grown.coreH, 650 - (150 - 34), "Core gives up exactly what the box took");

  // symmetric: shrinking the text returns the space
  const back = CS.computeShell({ ...TALL, contentH: 34, expanded: false, prevLevel: 0 });
  assert.equal(back.coreH, 650);
});

test("at the cap the TEXT scrolls — the box stops growing (40%, Core survives)", () => {
  const r = CS.computeShell({ ...TALL, contentH: 5000, expanded: false });
  assert.equal(r.typeScrolls, true);
  assert.ok(r.coreH > 0, "the 40% cap must never make Core vanish on a normal window");
  assert.equal(r.coreHidden, false);
});

test("at 100% Core vanishes entirely, and the text scrolls beyond that", () => {
  const r = CS.computeShell({ ...TALL, contentH: 5000, expanded: true });
  assert.equal(r.coreHidden, true, "toggled to full, Core is gone — shell is Header + Footer");
  assert.equal(r.coreH, 0);
  assert.equal(r.typeScrolls, true);
});

test("INVARIANT I5: Send and Stop survive every state, including full collapse", () => {
  for (const expanded of [false, true]) {
    for (const contentH of [34, 200, 1000, 100000]) {
      const r = CS.computeShell({ ...TALL, contentH, expanded });
      assert.equal(r.sendVisible, true, `send hidden at contentH=${contentH} expanded=${expanded}`);
      assert.equal(r.stopVisible, true, `stop hidden at contentH=${contentH} expanded=${expanded}`);
      assert.ok(!("send" in r.collapsed), "send must not even be a collapsible slot");
      assert.ok(!("stop" in r.collapsed), "stop must not even be a collapsible slot");
    }
  }
});

test("footer rows collapse in the specified order, never out of it", () => {
  // measured steps, as a real caller supplies them
  const steps = [{ id: "imageStrip", frees: 30 }, { id: "meta", frees: 0 }];
  const order = steps.map((s) => s.id);
  assert.deepEqual(CS.COLLAPSE_STEPS.map((s) => s.id), order, "the fallback table must list the same order");
  const seen = [];
  for (let h = 34; h <= 900; h += 6) {
    const r = CS.computeShell({ ...TALL, contentH: h, expanded: false, steps });
    for (let i = 0; i < order.length; i++) {
      if (r.collapsed[order[i]] && !seen.includes(order[i])) seen.push(order[i]);
      // a later step can never be collapsed while an earlier one is not
      if (i > 0 && r.collapsed[order[i]]) assert.ok(r.collapsed[order[i - 1]], "out-of-order collapse at " + h);
    }
  }
  assert.deepEqual(seen, order, "every step should engage as the box grows");
});

test("hysteresis: a single character on the boundary cannot flicker the footer", () => {
  // Find the exact content height where level 1 engages.
  let engageAt = null;
  for (let h = 34; h < 900 && engageAt === null; h++) {
    if (CS.computeShell({ ...TALL, contentH: h, expanded: false }).collapseLevel >= 1) engageAt = h;
  }
  assert.ok(engageAt, "level 1 must engage somewhere");
  // One pixel BELOW the engage point, coming down from level 1, it must NOT immediately release.
  const held = CS.computeShell({ ...TALL, contentH: engageAt - 1, expanded: false, prevLevel: 1 });
  assert.equal(held.collapseLevel, 1, "released too eagerly — this is the flicker case");
  // Far below, it does release.
  const released = CS.computeShell({ ...TALL, contentH: 40, expanded: false, prevLevel: 1 });
  assert.equal(released.collapseLevel, 0);
});

test("collapsing FREES footer height and hands it to the type box", () => {
  const r = CS.computeShell({ ...TALL, contentH: 5000, expanded: false, steps: [{ id: "imageStrip", frees: 30 }] });
  assert.ok(r.freed > 0, "collapsed rows must actually give their height to the text");
  assert.equal(r.cap, r.baseCap + r.freed);
});

test("slotsFor: ONE shell, two configurations — the repo/history case", () => {
  const core = CS.slotsFor("core"), pact = CS.slotsFor("pact");
  // Core CHOOSES a repo; Pact is locked to its own.
  assert.equal(core.footer.repoPicker, true);
  assert.equal(pact.footer.repoPicker, false);
  // Pact is multi-tab; Core has exactly one active conversation.
  assert.equal(pact.header.tabs, true);
  assert.equal(core.header.tabs, false);
  assert.equal(pact.history.multi, true);
  assert.equal(core.history.multi, false);
  // BOTH get a per-repository history popup with a Retired tab — never an all-repos list.
  for (const s of [core, pact]) {
    assert.equal(s.footer.historyBtn, true);
    assert.equal(s.history.scope, "repo");
    assert.equal(s.history.retiredTab, true);
    assert.equal(s.header.exoBar, true);
    // the wasted-line fix: transient status is a CHIP in the header row, never its own row
    assert.equal(s.header.statusChip, true);
  }
  // Pact-only footer extras stay Pact-only.
  assert.equal(pact.footer.contLine, true);
  assert.equal(core.footer.contLine, false);
});

test("degenerate inputs never produce negative or NaN geometry", () => {
  for (const bad of [{}, { shellH: 0 }, { shellH: -50, headerH: 999 }, { shellH: 200, headerH: 500, footerBaseH: 500 }]) {
    const r = CS.computeShell(bad);
    assert.ok(Number.isFinite(r.coreH) && r.coreH >= 0, "coreH must be a finite, non-negative number");
    assert.ok(Number.isFinite(r.typeH) && r.typeH >= 0, "typeH must be a finite, non-negative number");
    assert.equal(r.sendVisible, true);
  }
});


// ---------------------------------------------------------------------------------------------
// v1 CLIPPING BUG. COLLAPSE_STEPS carried HARDCODED `frees` (34/30/26) while the renderer only hid
// inline spans, which free ~no row height. The module therefore handed the type box ~90px it never
// received, the footer overflowed the shell, and its bottom row — Stop/Send — was clipped away.
// ---------------------------------------------------------------------------------------------

test("the footer can NEVER be taller than the space under the header (clipping guard)", () => {
  // A caller that wildly over-promises freed height must still not be able to clip Send off-screen.
  const lying = [{ id: "a", frees: 9999 }, { id: "b", frees: 9999 }];
  for (const expanded of [false, true]) {
    for (const contentH of [34, 300, 5000, 50000]) {
      const r = CS.computeShell({ ...TALL, contentH, expanded, steps: lying });
      const used = TALL.headerH + r.coreH + r.footerH;
      assert.ok(used <= TALL.shellH + 0.5, `footer overflowed: ${used} > ${TALL.shellH}`);
      assert.equal(r.sendVisible, true);
    }
  }
});

test("freedOverPromised: you cannot free more footer chrome than the footer contains", () => {
  const honest = CS.computeShell({ ...TALL, contentH: 5000, expanded: true, steps: [{ id: "a", frees: 20 }] });
  assert.equal(honest.freedOverPromised, false);
  const lying = CS.computeShell({ ...TALL, contentH: 5000, expanded: true, steps: [{ id: "a", frees: 9999 }] });
  assert.equal(lying.freedOverPromised, true, "an over-promise must be visible, not silently absorbed");
  assert.ok(lying.footerH >= 0, "and the resulting footer height must never go negative");
});

test("at 100% Core reaches EXACTLY zero — 'vanishes' must actually vanish", () => {
  const r = CS.computeShell({ ...TALL, contentH: 100000, expanded: true });
  assert.equal(r.coreH, 0, "capping the box's TOTAL height (not its growth) left minTypeH of Core behind");
  assert.equal(r.coreHidden, true);
});

// ---------------------------------------------------------------------------------------------
// WRAP (roll) readiness + the escape-hatch invariant.
// ---------------------------------------------------------------------------------------------

test("wrapReadiness: a wrap deletes nothing and does NOT renumber turns", () => {
  // Verified against the engine: workspace.mjs only advances `_rolledThrough`; it never splices the
  // transcript, and turn numbers are derived from the whole array. R#219 stays R#219 after a wrap.
  const r = CS.wrapReadiness({ tokens: 660000, ceiling: 1000000 });
  assert.equal(r.deletesNothing, true);
  assert.equal(r.renumbers, false, "numbering must never restart at 1 — the wrap is virtual");
});

test("wrapReadiness: manual wrap is refused while the conversation is light, and says why", () => {
  const light = CS.wrapReadiness({ tokens: 100000, ceiling: 1000000 });
  assert.equal(light.canWrapManually, false);
  assert.equal(light.autoWouldFire, false);
  assert.match(light.reason, /Too light to wrap/);
  assert.match(light.reason, /warm prompt cache/, "a refusal must explain the cost, not just refuse");
  assert.equal(light.tone, "ok");
});

test("wrapReadiness: thresholds — manual at 60%, automatic at 85%", () => {
  assert.equal(CS.wrapReadiness({ tokens: 599000, ceiling: 1000000 }).canWrapManually, false);
  assert.equal(CS.wrapReadiness({ tokens: 600000, ceiling: 1000000 }).canWrapManually, true);
  assert.equal(CS.wrapReadiness({ tokens: 700000, ceiling: 1000000 }).tone, "warn");
  const hot = CS.wrapReadiness({ tokens: 900000, ceiling: 1000000 });
  assert.equal(hot.autoWouldFire, true);
  assert.equal(hot.tone, "err");
  assert.match(hot.reason, /automatic wrap fires at 85%/);
  assert.equal(CS.wrapReadiness({ tokens: 660000, ceiling: 1000000 }).pct, 66);
});

test("wrapReadiness never divides by zero or reports NaN", () => {
  for (const bad of [{}, { ceiling: 0 }, { tokens: -5, ceiling: -5 }]) {
    const r = CS.wrapReadiness(bad);
    assert.ok(Number.isFinite(r.pct) && Number.isFinite(r.frac));
  }
});

test("INVARIANT: the EXPAND toggle can never be collapsed — it is the escape hatch", () => {
  // It used to live in the model row, which is collapse step 1, so it disappeared at exactly the moment
  // a long prompt made you want it. Anything needed to ESCAPE a state must not be hidden BY that state.
  for (const expanded of [false, true]) {
    for (const contentH of [34, 400, 5000, 100000]) {
      const r = CS.computeShell({ ...TALL, contentH, expanded, steps: [{ id: "imageStrip", frees: 30 }] });
      assert.equal(r.expandVisible, true, `expand toggle lost at contentH=${contentH}`);
      assert.ok(!("expand" in r.collapsed), "expand must not even be a collapsible slot");
    }
  }
});

test("INVARIANT: the model bar is never collapsible — you check settings WHILE composing", () => {
  // It was collapse step 1, so a long prompt hid the model / effort / context controls at exactly the
  // moment a big prompt makes you want to confirm which model is about to receive it.
  assert.ok(!CS.COLLAPSE_STEPS.some((s) => s.id === "modelRow"), "modelRow must not be a collapse step");
  for (const expanded of [false, true]) {
    for (const contentH of [34, 400, 5000, 100000]) {
      const r = CS.computeShell({ ...TALL, contentH, expanded });
      assert.equal(r.modelBarVisible, true, `model bar lost at contentH=${contentH}`);
      assert.ok(!("modelRow" in r.collapsed));
    }
  }
});

// ---------------------------------------------------------------------------------------------
// What ACTUALLY triggers a roll. Read from lib/conversationRoll.mjs: `turns >= 400 || bytes >= 25MB`.
// Context % is what the MODEL is squeezed by; it is not what fires our roll. The lab originally drove
// the wrap bar off context % alone, which implied a cause that does not exist.
// ---------------------------------------------------------------------------------------------

test("rollTriggers: turns and bytes are the real ceilings, context is shown alongside", () => {
  assert.equal(CS.ROLL_MAX_TURNS, 400, "must match lib/conversationRoll.mjs ROLL_DEFAULTS.maxTurns");
  assert.equal(CS.ROLL_MAX_BYTES, 25 * 1024 * 1024, "must match ROLL_DEFAULTS.maxBytes");
  const t = CS.rollTriggers({ prompts: 138, responses: 219, bytes: 4_272_000, tokens: 93016, ceiling: 1_000_000 });
  assert.deepEqual(t.list.map((x) => x.id), ["turns", "bytes", "context"]);
  // 357 turns of 400 is by far the nearest ceiling here — NOT the 9% context
  assert.equal(t.willRollOn, "turns");
  assert.equal(t.list[0].now, 357);
  assert.ok(t.list[0].pct > t.list[2].pct, "turns must outrank context in this scenario");
});

test("rollTriggers: whichever ceiling is nearest is the one reported", () => {
  const ctxBound = CS.rollTriggers({ prompts: 5, responses: 5, bytes: 1000, tokens: 950000, ceiling: 1000000 });
  assert.equal(ctxBound.willRollOn, "context");
  const byteBound = CS.rollTriggers({ prompts: 5, responses: 5, bytes: 24 * 1024 * 1024, tokens: 10, ceiling: 1000000 });
  assert.equal(byteBound.willRollOn, "bytes");
});

test("wrapSpan: R#from–R#to [count] and the character split, R before P", () => {
  const w = CS.wrapSpan({ rFrom: 253, rTo: 543, pFrom: 141, pTo: 431, rChars: 1234000, pChars: 543344 });
  assert.equal(w.r.count, 291, "253..543 inclusive is 291 responses");
  assert.equal(w.p.count, 291);
  assert.equal(w.chars, 1777344, "1,234,000 + 543,344 = 1,777,344");
  assert.equal(w.r.chars, 1234000);
  assert.equal(w.p.chars, 543344);
});

test("wrapSpan: an empty or inverted range yields 0, never a negative count", () => {
  assert.equal(CS.wrapSpan({ rFrom: 10, rTo: 9 }).r.count, 0);
  assert.equal(CS.wrapSpan({}).r.count, 0);
  assert.ok(CS.wrapSpan({ rFrom: -5, rTo: -9 }).r.count >= 0);
});

test("rollTriggers: the 25MB byte ceiling is never relevant against a real context window", () => {
  // Measured: 25MB is 6.2x a 1M-token window and 31x a 200k one, so it cannot bind first.
  for (const ceiling of [200_000, 1_000_000]) {
    const t = CS.rollTriggers({ prompts: 100, responses: 150, bytes: 4_000_000, tokens: ceiling * 0.6, ceiling });
    const bytes = t.list.find((c) => c.id === "bytes");
    assert.equal(bytes.relevant, false, `bytes should be irrelevant at ceiling=${ceiling}`);
    assert.ok(!t.visible.some((c) => c.id === "bytes"), "and must not be rendered");
    assert.ok(t.list.some((c) => c.id === "bytes"), "but must still be COMPUTED, so it stays checkable");
  }
});

test("rollTriggers: turns stays visible exactly when it can actually bind", () => {
  // 1M window, short turns → 400 turns arrives before the context does.
  const shortTurns = CS.rollTriggers({ prompts: 190, responses: 190, bytes: 760_000, tokens: 190_000, ceiling: 1_000_000 });
  assert.equal(shortTurns.willRollOn, "turns");
  assert.ok(shortTurns.visible.some((c) => c.id === "turns"));
  // 200k window → context always gets there first, so turns drops out of view.
  const smallWindow = CS.rollTriggers({ prompts: 30, responses: 30, bytes: 600_000, tokens: 150_000, ceiling: 200_000 });
  assert.equal(smallWindow.willRollOn, "context");
  assert.ok(!smallWindow.visible.some((c) => c.id === "turns"), "turns is far away — do not clutter with it");
});

test("slotsFor: OmniRoute is not selectable in the chat box in EITHER workspace, until verified", () => {
  assert.equal(CS.slotsFor("core").footer.omniRoute, false);
  assert.equal(CS.slotsFor("pact").footer.omniRoute, false);
});
