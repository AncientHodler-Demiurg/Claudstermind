/* chat-shell.js — PURE layout maths for the unified chat shell (Header / Core / Footer).
 *
 * Classic script (no bundler) exposing `window.ChatShell`, mirroring the md-mini.js / deploy-helpers.js
 * precedent so it can be loaded by BOTH the lab page and, later, app.js — and unit-tested in Node by
 * evaluating this file against a fake `window` (see lib/chatShell.test.mjs). ONE source of truth: the
 * shape you approve in the lab is literally the code production runs. No DOM here on purpose.
 *
 * THE MODEL (docs/work/chat-shell/spec.md):
 *   HEADER  fixed height, never grows
 *   CORE    prompts + answers; the ONLY flexing region; owns its scrollbar
 *   FOOTER  grows with the type box, taking height FROM Core, up to a cap
 *
 * Percentages are of CORE's height, never the viewport — that was one of the two divergent rules the
 * old Core/Pact split had (Core used 40% of the VIEWPORT, Pact 80% of the CONTAINER).
 */
(function (root) {
  "use strict";

  // Hardcoded, global, by decision. Not a per-conversation setting, not configurable.
  var SWALLOW_PCT = 0.40;      // default: the type box may take at most 40% of Core
  var SWALLOW_PCT_MAX = 1.00;  // toggled: it may take all of Core, and Core vanishes

  // The "don't read as broken" floor. A pure fraction means that on a SHORT window 40% of a small Core
  // is a 2-line box — technically correct, feels broken. So the cap is the LARGER of (a fixed row floor)
  // and (the fraction), then clamped so it can never exceed Core. On a tall window the fraction wins and
  // behaves exactly as specified; only on a cramped window does the floor take over.
  var FLOOR_ROWS = 6;

  // Footer rows collapse IN THIS ORDER once the type box is at its cap and still wants more room.
  // Stop/Send are deliberately absent: they are terminal and may never be collapsed (spec invariant I5).
  // NOTE the `frees` values here are FALLBACKS ONLY. v1 hardcoded them (34/30/26) while the renderer
  // merely hid inline spans, which free almost no row height — so the module granted the type box ~90px
  // it never actually received, the footer grew past the shell, and its bottom row was CLIPPED. A layout
  // module must never guess at a measurement. Callers pass `steps` with REAL measured heights; a step
  // that frees nothing measurable must declare 0 rather than a plausible-looking number.
  // The MODEL ROW is NOT here on purpose. It was collapse step 1, so typing a long prompt hid the model /
  // effort / context controls — the settings you are most likely to want to check while composing a big
  // prompt. It joins Stop, Send and the expand toggle in the never-collapsible set. What remains are rows
  // that carry no control you need mid-compose.
  // The IMAGE STRIP is not here either. Hiding it meant that at the moment you were writing the long
  // prompt the images belong to, the evidence that you had attached them disappeared — you could not
  // tell an attached image from a forgotten one. Attachments are part of the prompt you are composing,
  // so they stay. What is left collapses no rows at all, which is the honest outcome: this footer has
  // no row that is safe to take away mid-compose.
  var COLLAPSE_STEPS = [
    { id: "meta", frees: 0, note: "repo / worktree / identity text hidden (inline — frees no row)" }
  ];
  // Hysteresis: a step that engaged at X only releases below 0.9X, so typing on the boundary cannot
  // flicker the footer open/closed on every keystroke.
  var HYSTERESIS = 0.9;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  /** How much Core would have with the footer at its minimum. Everything else is a fraction of THIS. */
  function coreAtRest(o) {
    return Math.max(0, num(o.shellH, 0) - num(o.headerH, 0) - num(o.footerBaseH, 0));
  }

  /** The maximum height the type box may reach. See FLOOR_ROWS for why this is not a bare fraction. */
  function swallowCap(o) {
    var c0 = coreAtRest(o);
    var pct = o.expanded ? SWALLOW_PCT_MAX : SWALLOW_PCT;
    var lineH = num(o.lineH, 18);
    var minH = num(o.minTypeH, lineH + 16);
    var floor = FLOOR_ROWS * lineH;
    // The percentage caps how much the box may GROW — i.e. how much of Core it may take — not the box's
    // total height. Capping the total meant that at 100% the box could only reach Core's height, leaving
    // `minTypeH` of Core still on screen: "vanishes" never actually vanished. Total = min + growth.
    var cap = Math.max(floor, minH + pct * c0);
    // ...and never more than Core actually has to give (otherwise Core would go negative).
    return clamp(cap, minH, minH + Math.max(0, c0));
  }

  /**
   * THE layout decision. Pure: same inputs → same outputs, no measurement, no DOM.
   *
   *   shellH, headerH, footerBaseH — measured px
   *   contentH   — the type box's natural content height (its scrollHeight at height:auto)
   *   minTypeH   — the type box's resting height
   *   lineH      — one line of text, px
   *   expanded   — the global 40% → 100% toggle
   *   prevLevel  — the collapse level from the previous call, for hysteresis
   */
  function computeShell(o) {
    o = o || {};
    var c0 = coreAtRest(o);
    var lineH = num(o.lineH, 18);
    var minTypeH = num(o.minTypeH, lineH + 16);
    var contentH = Math.max(minTypeH, num(o.contentH, minTypeH));
    var baseCap = swallowCap(o);
    // Measured steps from the caller win over the fallback table. Only steps that free REAL height count.
    var steps = (o.steps && o.steps.length) ? o.steps : COLLAPSE_STEPS;

    // Collapsing footer rows FREES height, which raises the cap — that is the whole point of collapsing:
    // the growing text takes over the space the other footer pieces were using. Engage steps one at a
    // time, only while the box still wants more than the current cap allows.
    var level = 0, freed = 0;
    while (level < steps.length && contentH > baseCap + freed) {
      freed += Math.max(0, num(steps[level].frees, 0));
      level++;
    }
    // Hysteresis on the way back down: hold the previous (higher) level until the content drops clearly
    // below the threshold that engaged it, so a single character can't oscillate the footer.
    var prev = clamp(Math.round(num(o.prevLevel, 0)), 0, steps.length);
    if (prev > level) {
      // The threshold at which level `prev` ENGAGED is the cap as it stood with only the steps BEFORE
      // it collapsed — i.e. sum(frees[0 .. prev-2]), not sum(frees[0 .. prev-1]). Measuring against the
      // post-collapse cap put the release point ABOVE the engage point, which is worse than no
      // hysteresis at all: it released early and flickered. Hold until clearly below the engage point.
      var engagedAt = baseCap, holdFreed = 0, i;
      for (i = 0; i < prev - 1; i++) engagedAt += Math.max(0, num(steps[i].frees, 0));
      for (i = 0; i < prev; i++) holdFreed += Math.max(0, num(steps[i].frees, 0));
      if (contentH > engagedAt * HYSTERESIS) { level = prev; freed = holdFreed; }
    }

    // HARD GUARD, part 1 — the only over-promise the module can detect on its own: you cannot free more
    // footer chrome than the footer HAS. A caller claiming otherwise is mis-measuring, and the geometry
    // downstream (footerH = chrome + type - freed) would go negative and clip. Clamp and SAY SO.
    var footerChromeAll = Math.max(0, num(o.footerBaseH, 0) - minTypeH);
    var freedOverPromised = freed > footerChromeAll;
    if (freedOverPromised) freed = footerChromeAll;
    var cap = baseCap + freed;
    // HARD GUARD, part 2 (the v1 clipping bug): whatever the caps and freed-height arithmetic say, the footer can
    // never be taller than the space beneath the header, or its bottom row — Stop/Send — is clipped off the
    // shell. Derived from the geometry rather than trusted from it. This is belt AND braces on purpose:
    // with accurate measured `frees` it is a no-op, and when a caller mis-measures it degrades to a
    // slightly-short type box instead of an unreachable Send button.
    var footerChrome = footerChromeAll;
    var maxTypeAbs = Math.max(minTypeH, num(o.shellH, 0) - num(o.headerH, 0) - footerChrome + freed);
    if (cap > maxTypeAbs) cap = maxTypeAbs;
    var typeH = Math.min(contentH, cap);
    var typeScrolls = contentH > cap;             // at the ceiling: the TEXT scrolls, the box does not grow
    var grew = Math.max(0, typeH - minTypeH);     // how much Core is giving up right now
    var coreH = Math.max(0, c0 - grew);
    // Core vanishes only when it genuinely reaches zero — which the 40% cap cannot cause on a normal
    // window, and the 100% toggle can.
    var coreHidden = coreH <= 0;

    var collapsed = {};
    for (var j = 0; j < steps.length; j++) collapsed[steps[j].id] = j < level;
    // What the footer will actually occupy once rendered with this decision. A caller can assert on it.
    var footerH = footerChrome + typeH - freed;

    return {
      coreAtRest: c0,
      coreH: coreH,
      typeH: typeH,
      typeScrolls: typeScrolls,
      coreHidden: coreHidden,
      cap: cap,
      baseCap: baseCap,
      freed: freed,
      collapseLevel: level,
      collapsed: collapsed,
      footerH: footerH,
      // TRUE when a caller claimed to free more footer height than the footer contains.
      freedOverPromised: freedOverPromised,
      // Never hidden. Stated as data so a renderer cannot accidentally collapse them (spec I5).
      // The EXPAND TOGGLE joins them: it lived in the model row, which is collapse step 1 — so it
      // vanished at exactly the moment a long prompt makes you want it. Anything you need in order to
      // ESCAPE a state must not be hidden BY that state.
      sendVisible: true,
      stopVisible: true,
      expandVisible: true,
      modelBarVisible: true,
      imageStripVisible: true,
      capIsFloored: baseCap > minTypeH + (o.expanded ? SWALLOW_PCT_MAX : SWALLOW_PCT) * c0 + 0.5
    };
  }

  /**
   * Which slots a workspace renders. One shell, two configurations — a workspace may DISABLE a slot,
   * never re-order regions or re-implement one. `kind` is "core" | "pact".
   *
   * The repo/history relationship is the worked example of why this is one component and not two:
   *   core → repo is CHOSEN, one active conversation, history lists that repo's conversations
   *   pact → repo is LOCKED, many tabs, history has Open + Retired
   */
  function slotsFor(kind) {
    var pact = kind === "pact";
    return {
      kind: pact ? "pact" : "core",
      header: {
        tabs: pact,                    // Pact is multi-tab; Core has one active conversation
        identity: !pact,
        bulb: true,
        exoBar: true,
        cueStrip: true,
        statusChip: true,              // "Reconnected — caught up" is a CHIP here, never its own row
        actions: true
      },
      core: { transcript: true },
      footer: {
        // OmniRoute is NOT offered in the chat box until it is verified end to end. A selectable route
        // that might not work is worse than no route at all — you would discover it mid-conversation.
        omniRoute: false,
        imageStrip: true,
        contLine: pact,                // suggest + bookmark: Pact only
        autoContinue: true,
        typeBox: true,
        attach: true,
        repoPicker: !pact,             // Core CHOOSES a repo; Pact is locked to its own
        repoLabel: true,
        worktree: true,
        historyBtn: true,              // BOTH: per-repository conversation history in a popup
        stop: true, send: true,        // never collapsible
        modelBar: true,
        expandToggle: true
      },
      history: {
        scope: "repo",                 // never "all repos" — that is what buried the Core tree view
        multi: pact,                   // Pact: many open tabs. Core: exactly one active.
        retiredTab: true               // both get Open / Retired
      }
    };
  }

  /**
   * WRAP (roll) readiness. A wrap starts a fresh context window WITHOUT deleting anything: the engine
   * only advances a marker (`_rolledThrough`), never splices the transcript — so turn numbers CONTINUE
   * (R#219 stays R#219). Nothing restarts at 1; the wrap is invisible to addressing and the rolled-off
   * turns stay searchable in the archive.
   *
   *   manualAt — below this you may not wrap by hand: wrapping a light conversation throws away a warm
   *              prompt cache for no benefit, so the button is disabled and SAYS WHY.
   *   autoAt   — where automatic wrapping fires when the auto tick is on.
   */
  // The REAL roll triggers, read from lib/conversationRoll.mjs — NOT the context percentage. The engine
  // rolls when `turns >= 400 || bytes >= 25MB`. Context % is what the *model* is squeezed by (and what
  // drives SDK compaction), but it is not what fires our roll. Showing only context % would have implied
  // a cause that does not exist. All three are surfaced; whichever is nearest is the one that will fire.
  var ROLL_MAX_TURNS = 400;
  var ROLL_MAX_BYTES = 25 * 1024 * 1024;

  /** Every ceiling that can trigger a wrap, with the nearest one identified. */
  function rollTriggers(o) {
    o = o || {};
    var turns = Math.max(0, num(o.prompts, 0)) + Math.max(0, num(o.responses, 0));
    var bytes = Math.max(0, num(o.bytes, 0));
    var tokens = Math.max(0, num(o.tokens, 0));
    var ceiling = Math.max(1, num(o.ceiling, 1));
    var list = [
      { id: "turns",   label: "turns",   now: turns,  max: num(o.maxTurns, ROLL_MAX_TURNS), unit: "" },
      { id: "bytes",   label: "size",    now: bytes,  max: num(o.maxBytes, ROLL_MAX_BYTES), unit: "B" },
      { id: "context", label: "context", now: tokens, max: ceiling, unit: "tok" }
    ];
    var nearest = null, i;
    for (i = 0; i < list.length; i++) {
      list[i].frac = list[i].now / list[i].max;
      list[i].pct = Math.round(list[i].frac * 1000) / 10;
      if (!nearest || list[i].frac > nearest.frac) nearest = list[i];
    }
    // RELEVANCE. Showing all three ceilings all the time is noise: measured against a real context
    // window, the 25MB byte ceiling is 6x (1M window) to 31x (200k window) further away than context,
    // so it can never fire first and is pure clutter. `turns` CAN bind, but only on a large window with
    // short turns. So a ceiling is worth showing only when it is the nearest, or close enough to it to
    // plausibly overtake. Everything else stays computed (and therefore checkable) but unrendered —
    // hidden because it is irrelevant, not because we are pretending it does not exist.
    for (i = 0; i < list.length; i++) list[i].relevant = list[i] === nearest || list[i].frac >= nearest.frac * 0.75;
    return { list: list, visible: list.filter(function (c) { return c.relevant; }),
             nearest: nearest, willRollOn: nearest.id, frac: nearest.frac };
  }

  /** What a wrap would actually take: the R#/P# ranges, their counts, and the character split. */
  function wrapSpan(o) {
    o = o || {};
    var rFrom = Math.max(1, Math.round(num(o.rFrom, 1))), rTo = Math.max(rFrom - 1, Math.round(num(o.rTo, 0)));
    var pFrom = Math.max(1, Math.round(num(o.pFrom, 1))), pTo = Math.max(pFrom - 1, Math.round(num(o.pTo, 0)));
    var rChars = Math.max(0, num(o.rChars, 0)), pChars = Math.max(0, num(o.pChars, 0));
    return {
      // R first, then P — responses are the bulk, so they lead.
      r: { from: rFrom, to: rTo, count: Math.max(0, rTo - rFrom + 1), chars: rChars },
      p: { from: pFrom, to: pTo, count: Math.max(0, pTo - pFrom + 1), chars: pChars },
      chars: rChars + pChars
    };
  }

  /**
   * What the FRESH window actually starts at after a wrap. A wrap does not start from zero — the new
   * session is seeded with (a) a mechanical summary of the head and (b) the last `tailTurns` turns
   * VERBATIM. That tail is the expensive part, and it is a fixed number of turns, so on a small context
   * window it can be most of the window: the same wrap that frees 89% of a 1M window frees far less of
   * a 200k one. Callers should say so rather than promising a clean slate.
   */
  function wrapSeedEstimate(o) {
    o = o || {};
    var tailTurns = Math.max(0, num(o.tailTurns, 40));
    var charsPerTurn = Math.max(1, num(o.charsPerTurn, 10500));
    var ceiling = Math.max(1, num(o.ceiling, 1));
    var CHARS_PER_TOKEN = 4;
    var summaryChars = Math.min(80, Math.max(0, num(o.headPrompts, 80))) * 140;   // ≤80 lines of ≤140 chars
    var seedChars = tailTurns * charsPerTurn + summaryChars;
    var seedTokens = Math.round(seedChars / CHARS_PER_TOKEN);
    var frac = seedTokens / ceiling;
    return {
      seedTokens: seedTokens,
      pctOfCeiling: Math.round(frac * 1000) / 10,
      // Below this a wrap is not buying much: you pay a respawn and a cache reset to reclaim little.
      worthwhile: frac < 0.5,
      note: frac < 0.25
        ? "The fresh window starts near-empty."
        : frac < 0.5
          ? "The carried tail is a sizeable slice of this window."
          : "The carried tail alone fills most of this window — a wrap will not free much here."
    };
  }

  /**
   * SEED PLAN — what a fresh window should actually be given after a wrap.
   *
   * Measured on a real 8,039-turn session (164 MB of JSONL):
   *     prose (user + assistant text + thinking) ...  7.1%   ~156 tok/turn
   *     tool calls + results ......................  27.4%
   *     file attachments ..........................  65.5%
   *     => 92.9% of what the model has seen is RE-DERIVABLE.
   *
   * That is the whole answer. The current seed carries the last 40 turns VERBATIM (~87k tok on that
   * session) and 93% of those bytes are file contents and command output the agent can simply read
   * again. Writing a better summary optimises the 7% that is already cheap; dropping the 93% is where
   * the win is.
   *
   * Three tiers, cheapest last:
   *   working  the last few turns VERBATIM (tool output included) — the immediate task needs exact state
   *   spine    prose-only for a long stretch before that — at ~156 tok/turn this reaches ten times
   *            further than the verbatim tail for a fraction of the cost
   *   ledger   a durable decisions/constraints record, APPENDED as work happens rather than generated
   *            at wrap time. This is the part compaction cannot do well: compaction re-summarises its
   *            own previous summary every time it runs, so detail decays with each pass. An appended
   *            ledger is written once per decision and never re-compressed, so it does not decay.
   *   (+ the archive stays searchable, so specifics are FETCHED rather than carried.)
   */
  function seedPlan(o) {
    o = o || {};
    var TOK = 4;
    var proseTokPerTurn = Math.max(1, num(o.proseTokPerTurn, 156));
    var fullTokPerTurn = Math.max(proseTokPerTurn, num(o.fullTokPerTurn, 2184));   // measured: 87355/40
    // Defaults chosen against the measured ratio (a verbatim turn costs 14x a prose turn), balancing the
    // two things that trade off: 6 working + 200 spine gives ~1.9x cheaper AND ~5x more reach. Going
    // wider on the spine buys reach but gives back the saving; 10/300 was only 1.2x cheaper, which is
    // not a win worth the change.
    var working = Math.max(0, num(o.workingTurns, 6));
    var spine = Math.max(0, num(o.spineTurns, 200));
    var ledgerTok = Math.max(0, num(o.ledgerTokens, 2500));
    var ceiling = Math.max(1, num(o.ceiling, 1));

    var workingTok = working * fullTokPerTurn;
    var spineTok = spine * proseTokPerTurn;
    var total = workingTok + spineTok + ledgerTok;
    // What today's approach costs for comparison: tailTurns carried verbatim.
    var currentTail = Math.max(0, num(o.currentTailTurns, 40));
    var currentTok = currentTail * fullTokPerTurn;
    return {
      workingTurns: working, workingTok: workingTok,
      spineTurns: spine, spineTok: spineTok,
      ledgerTok: ledgerTok,
      totalTok: total,
      pctOfCeiling: Math.round(total / ceiling * 1000) / 10,
      currentTok: currentTok,
      // How much cheaper, and how much further back it reaches.
      cheaperBy: currentTok > 0 ? Math.round(currentTok / Math.max(1, total) * 10) / 10 : 0,
      reachTurns: working + spine,
      reachVsCurrent: currentTail > 0 ? Math.round((working + spine) / currentTail * 10) / 10 : 0
    };
  }

  /**
   * REPLY REFERENCES — "quote this turn and answer it", the way a chat reply works.
   *
   * The model does not reliably know what "R#219" means on its own: absolute turn numbers are OUR
   * addressing scheme, and after a wrap the referenced turn may not even be in the window any more. So
   * a reference cannot be passed as a bare number — it has to carry enough of the turn's own words to
   * be unambiguous, while staying small enough that quoting is cheap.
   *
   * Each quote is capped (default 280 chars ≈ 70 tokens) and truncated on a word boundary. An archived
   * reference is marked as such, because "this is from before the wrap" changes how the model should
   * treat it — it is not in the visible conversation.
   */
  function replyQuote(ref, maxChars) {
    var r = ref && typeof ref === "object" ? ref : {};
    var cap = Math.max(40, num(maxChars, 280));
    var kind = r.kind === "P" ? "P" : "R";
    var n = Math.max(1, Math.round(num(r.number, 1)));
    var text = typeof r.text === "string" ? r.text.replace(/\s+/g, " ").trim() : "";
    var truncated = text.length > cap;
    if (truncated) {
      var cut = text.slice(0, cap);
      var sp = cut.lastIndexOf(" ");
      text = (sp > cap * 0.6 ? cut.slice(0, sp) : cut) + "\u2026";
    }
    return {
      kind: kind, number: n, label: kind + "#" + n,
      who: kind === "R" ? "the agent" : "you",
      text: text, truncated: truncated,
      archived: !!r.archived, segment: r.segment == null ? null : r.segment,
      approxTokens: Math.ceil(text.length / 4)
    };
  }

  /** The block prepended to a prompt that carries reply references. "" when there are none. */
  function buildReplyPreamble(refs, opts) {
    var list = (Array.isArray(refs) ? refs : []).map(function (r) { return replyQuote(r, (opts || {}).maxChars); });
    if (!list.length) return "";
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      var head = "In reply to " + q.label + " (" + q.who + ")"
        + (q.archived ? " \u2014 from the archive" + (q.segment ? ", segment #" + q.segment : "") + ", not in the current window" : "");
      out.push("> **" + head + "**");
      out.push(q.text ? "> " + q.text.split("\n").join("\n> ") : "> _(no text)_");
      out.push("");
    }
    return out.join("\n");
  }

  /** Total cost of the pending references, so the UI can show it before you send. */
  function replyCost(refs, opts) {
    var list = (Array.isArray(refs) ? refs : []).map(function (r) { return replyQuote(r, (opts || {}).maxChars); });
    var t = 0;
    for (var i = 0; i < list.length; i++) t += list[i].approxTokens + 12;   // + the header line
    return { count: list.length, approxTokens: t };
  }

  function wrapReadiness(o) {
    o = o || {};
    var ceiling = Math.max(1, num(o.ceiling, 1));
    var tokens = Math.max(0, num(o.tokens, 0));
    var manualAt = num(o.manualAt, 0.60), autoAt = num(o.autoAt, 0.85);
    var frac = tokens / ceiling;
    var pct = Math.round(frac * 1000) / 10;
    var canWrapManually = frac >= manualAt;
    var autoWouldFire = frac >= autoAt;
    var tone = frac >= autoAt ? "err" : frac >= manualAt ? "warn" : "ok";
    var reason = canWrapManually
      ? (autoWouldFire ? "At " + pct + "% — automatic wrap fires at " + Math.round(autoAt * 100) + "%."
                       : "At " + pct + "% — wrapping now is worthwhile.")
      : "Too light to wrap (" + pct + "% of " + Math.round(manualAt * 100) + "%). Wrapping discards a warm prompt cache for no gain.";
    return { pct: pct, frac: frac, canWrapManually: canWrapManually, autoWouldFire: autoWouldFire,
             tone: tone, reason: reason, manualAt: manualAt, autoAt: autoAt,
             // Stated as data so no UI can imply a wrap deletes anything.
             deletesNothing: true, renumbers: false };
  }

  var API = {
    SWALLOW_PCT: SWALLOW_PCT, SWALLOW_PCT_MAX: SWALLOW_PCT_MAX, FLOOR_ROWS: FLOOR_ROWS,
    COLLAPSE_STEPS: COLLAPSE_STEPS, HYSTERESIS: HYSTERESIS,
    coreAtRest: coreAtRest, swallowCap: swallowCap, computeShell: computeShell, slotsFor: slotsFor, wrapReadiness: wrapReadiness, rollTriggers: rollTriggers, wrapSpan: wrapSpan, wrapSeedEstimate: wrapSeedEstimate, seedPlan: seedPlan,
    replyQuote: replyQuote, buildReplyPreamble: buildReplyPreamble, replyCost: replyCost,
    ROLL_MAX_TURNS: ROLL_MAX_TURNS, ROLL_MAX_BYTES: ROLL_MAX_BYTES
  };
  if (typeof module === "object" && module.exports) module.exports = API;
  root.ChatShell = API;
})(typeof window !== "undefined" ? window : globalThis);
