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

  // `doc` is captured ONCE, at IIFE-eval time. In a real browser this file is a classic <script>, so
  // `root` is `window` and `root.document` is the live singleton — capturing it once changes nothing.
  // In the Node test shim (see lib/chatShellLabRender.test.mjs / lib/chatShellDom.test.mjs) a fake
  // `window.document` is assigned BEFORE this file is evaluated via `new Function("window", shellJs)`,
  // so it's already present at capture time. This is what lets the functions below build real DOM
  // without ever writing a bare `document` reference (which would throw in the CommonJS/Node path
  // this file also supports — see the `module.exports` line at the bottom).
  var doc = root && root.document;

  // THE DOM LAYER. Everything above this comment (until this block) is pure math with zero DOM —
  // that separation was deliberate and stays true for the layout functions. But "the shape you
  // approve in the Lab is literally the code production runs" was never true for the CHROME itself
  // (header stats chips, the line-number gutter, the Compact│Wrap split control): those were three
  // independent hand-written copies — Lab, Core's app.js, Pact's app.js — that happened to agree
  // and drifted the moment any one of them changed. These functions are the ONE implementation;
  // the Lab and both production workspaces all call them with their own data.

  /** The one DOM-builder every caller used to hand-roll separately (byte-identical in all three
   *  places before this). `k` (children) may be strings (→ text nodes) or real nodes. */
  function el(t, a, k) {
    var e = doc.createElement(t);
    for (var x in (a || {})) {
      if (x === "class") e.className = a[x];
      else if (x === "html") e.innerHTML = a[x];
      else e.setAttribute(x, a[x]);
    }
    (k || []).forEach(function (c) { e.appendChild(typeof c === "string" ? doc.createTextNode(c) : c); });
    return e;
  }

  /* ===================== THE LINE-NUMBER GUTTER =================================================
   * The box WRAPS, so a logical line can occupy several visual rows — and the number has to sit on
   * the row where its line actually starts. The first implementation numbered the visual rows
   * straight down (1, 2, 3, 4…), so the moment any line wrapped, every number below it named the
   * wrong line: two typed lines wrapping to four rows showed "1 2 3 4" against a box the counter
   * chip correctly called "2 lines". Reported as "line numbering also doesn't seem to be detected
   * properly", and the chip was the half that was right.
   *
   * One number per LOGICAL line, on that line's first visual row; its continuation rows are blank —
   * the same thing every editor does with wrapping on. Rows below the text keep counting, because
   * they are the lines you would type next. */

  /** PURE. The gutter's entries, given how many visual rows each logical line occupies and how many
   *  rows of space the box has. `n: null` is a continuation row: part of the line above, so it is
   *  deliberately unnumbered rather than numbered with a number that would be a lie. */
  function gutterEntries(rowsPerLine, slots) {
    var out = [], n = 0;
    (rowsPerLine || []).forEach(function (rows) {
      out.push({ n: ++n, on: true });
      for (var r = 1; r < Math.max(1, num(rows, 1)); r++) out.push({ n: null, on: true });
    });
    while (out.length < Math.max(1, num(slots, 1))) out.push({ n: ++n, on: false });
    return out;
  }

  /** How many visual rows each logical line wraps onto, measured against a hidden mirror that copies
   *  the box's own typography and content width. Returns one row per line when there is nothing to
   *  measure against (no layout engine: the Node test shim, a detached box) — which is exactly the
   *  unwrapped case, so the caller needs no special path for it. Cached on the textarea against the
   *  value and width, since paintGutter runs on every keystroke. */
  function measureWrapRows(ta, lines) {
    var flat = lines.map(function () { return 1; });
    try {
      if (!doc || !doc.createElement || !root.getComputedStyle || !lines.length) return flat;
      var cs = root.getComputedStyle(ta);
      var padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
      var contentW = (ta.clientWidth || 0) - padL - padR;
      var lineH = parseFloat(cs.lineHeight) || 18;
      if (!(contentW > 0) || !(lineH > 0)) return flat;
      var sig = contentW + "|" + lineH + "|" + cs.font + "|" + (ta.value || "");
      if (ta._gutSig === sig && ta._gutRows && ta._gutRows.length === lines.length) return ta._gutRows;
      var m = ta._gutMirror;
      if (!m || !m.parentNode) {
        m = doc.createElement("div");
        m.setAttribute("aria-hidden", "true");
        m._rows = [];              // the reused row divs travel WITH the mirror, never outlive it
        doc.body.appendChild(m);
        ta._gutMirror = m;
      }
      // Everything that can change where a line breaks. Anything missed here shows up as a number
      // one row out, so this copies from the box itself rather than restating the stylesheet.
      m.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:-99999px;top:0;"
        + "white-space:pre-wrap;overflow-wrap:" + cs.overflowWrap + ";word-break:" + cs.wordBreak
        + ";font:" + cs.font + ";letter-spacing:" + cs.letterSpacing + ";line-height:" + lineH
        + "px;tab-size:" + (cs.tabSize || "8") + ";width:" + contentW + "px;";
      // REUSE the mirror's rows instead of rebuilding them. This runs on every keystroke, and the
      // measurement itself is one forced layout no matter what — but recreating N divs and
      // replaceChildren-ing them made that layout more expensive AND churned the DOM for a result
      // that is usually identical to the last one. Profiled on a real Core pane, this function plus
      // its element-building callback were 45% of the script time left in typing after the row
      // alignment was gated. Only lines whose TEXT actually changed are written.
      var kids = m._rows || (m._rows = []);
      while (kids.length > lines.length) { m.removeChild(kids.pop()); }
      for (var i = 0; i < lines.length; i++) {
        // An empty line still occupies one row — with no content at all the div would collapse to
        // zero height and the line after it would be numbered a row too high.
        var text = lines[i] === "" ? "\u00a0" : lines[i];
        if (!kids[i]) { kids[i] = doc.createElement("div"); m.appendChild(kids[i]); }
        if (kids[i]._t !== text) { kids[i]._t = text; kids[i].textContent = text; }
      }
      var rows = kids.map(function (d) { return Math.max(1, Math.round((d.offsetHeight || lineH) / lineH)); });
      ta._gutSig = sig; ta._gutRows = rows;
      return rows;
    } catch (e) { return flat; }
  }

  /** Paints the compose box's line-number gutter into `gut` for the current content of `ta`.
   *  Pure side effect on the two elements passed in — no ids, no global lookup, so it works
   *  identically whether the caller found its gutter by `#f-gutter` (Lab) or a stored reference
   *  (Core/Pact's `paneUI`/`PACT_CHAT` entries). Returns the number of LINES TYPED, which is what
   *  the "N lines" chip reports — it and the gutter now agree by construction. */
  function paintGutter(ta, gut) {
    if (!gut || !ta) return;
    var val = ta.value || "";
    var lines = val ? val.split("\n") : [];                    // an empty box has typed NO lines
    var written = lines.length;
    var boxH = parseFloat(ta.style.height) || ta.clientHeight || 34;
    var slots = Math.max(1, Math.floor((boxH - 14) / 18));
    var entries = gutterEntries(measureWrapRows(ta, lines), slots);
    var kids = entries.map(function (e) {
      return e.n == null
        ? el("b", { class: "--cont" }, ["\u00a0"])             // wrapped continuation of the line above
        : el("b", { class: e.on ? "--on" : "" }, [String(e.n)]);
    });
    gut.replaceChildren.apply(gut, kids);
    // Width follows the widest number shown: one glyph costs one glyph.
    var maxN = 1;
    entries.forEach(function (e) { if (e.n != null && e.n > maxN) maxN = e.n; });
    var w = 14 + String(maxN).length * 7;                      // padding + glyph advance at 11px monospace
    gut.style.width = w + "px";
    ta.style.paddingLeft = (w + 10) + "px";                    // …and the text keeps clear of the divider
    ta.style.paddingRight = "44px";                            // …and clear of whatever sits on the right
    if (!ta._gutBound) {
      ta._gutBound = true;
      ta.addEventListener("scroll", function () { gut.scrollTop = ta.scrollTop; });
    }
    return written;
  }

  /* ===================== ROW GROUPS: per-LINE left/right alignment ==============================
   * A header/footer row is not a bag of controls — it is a few LOGICAL GROUPS ("how big is this
   * conversation", "what has been compacted/wrapped", "the turn in flight"). Two things follow, and
   * neither is achievable with a flex spacer:
   *
   *   1. A group never splits across a line break. Its members are one idea; half of it stranded on
   *      the line above is worse than the whole of it moved down.
   *   2. Alignment is decided PER LINE, not per row. A `.spacer { flex: 1 }` only redistributes
   *      space among items sharing ITS OWN line — so it can right-align exactly one group, on
   *      exactly the line it happens to land on, and every other wrapped line falls back to packing
   *      left. That is why a two-line stats row read as ragged: line 1 had a right-hand group and
   *      line 2 didn't, so the two lines ended at different x.
   *
   * A GROUP DOES NOT DECLARE A SIDE. Which side it takes is CAPTURED from where the current width
   * actually put it: on each line, the LAST group is right-aligned and the ones before it pack left
   * — so three groups on a line read "two left, the next right", and a group left alone on a line
   * (typically the last one, pushed down by a narrow pane) favours right, because it is also the
   * last on its line. Declaring a fixed side per group cannot express this: the same group is the
   * left-hand one at one width and the right-hand one at another, purely because of where it landed.
   *
   * `margin-left: auto` is what does the pushing: an auto margin is a property of the ITEM, so it
   * claims the free space on whatever line that item actually landed on.
   *
   * Auto margins are treated as zero when flex line-breaking is computed, so applying them cannot
   * change which groups share a line — no feedback loop, no oscillation. (Verified live, not just
   * assumed: lib/chatShellRowGroups.test.mjs pins the plan, and the alignment pass re-measures.) */

  /** A logical group of controls that travel together. No side: see rowAlignPlan — the side is a
   *  result of the layout, not an input to it. */
  function grp(kids) {
    return el("span", { class: "cs-grp" }, kids || []);
  }

  /** A group stacked into TWO ROWS — a control on top, its companion underneath.
   *
   *  WHY, and it is not primarily about width. Each pair is a control and its own caption: the model
   *  you PICKED over the model actually RUNNING; the effort level over the permission mode it runs
   *  under; ultracode over fast; the auto-wrap tick and its meter over the Compact│Wrap buttons that
   *  act on the same window. Side by side on one line those read as eight unrelated widgets, and
   *  "· running Opus 5" floating next to a box that says "Opus 5" reads as a duplicate rather than a
   *  confirmation. Stacked, each one is captioned by the thing above it.
   *
   *  The width saving is real too, and it is large, because a stacked pair is as wide as its WIDER
   *  member rather than the SUM of both. Measured on the live footer: the flat row needs 721–806px
   *  of controls; the same controls stacked need 492–544px. That is what turns a 3-line, 71px footer
   *  at Pact's real 560–700px pane into one 2-row shelf.
   *
   *  Either row may end up empty — Core has no `fast` toggle, a host may pass no permission control —
   *  and an empty row must not spend height on nothing, so alignRowGroups retires it, collapsing the
   *  group back to a single row. That is a property of the LIVE state, not of the call site, which is
   *  why it is decided at layout time rather than here. */
  function stack(topKids, bottomKids) {
    var g = grp([el("span", { class: "cs-grow" }, topKids || []),
                 el("span", { class: "cs-grow" }, bottomKids || [])]);
    g.classList.add("--stack");
    return g;
  }

  /** PURE. Does this row's content fit on ONE line if every stacked pair were laid out flat?
   *  in : [{ items: [px, …] }, …] — one entry per group, the pixel width of each control in it
   *  out: total pixels the flat layout needs, gaps included
   *
   *  Kept separate and pure because the WHOLE trick is that this number does not depend on whether
   *  the row is currently stacked: a control is the same width either way. A predicate that read the
   *  current layout would flip-flop — unstacking makes the row wider, which makes it not fit, which
   *  restacks it, which makes it fit… A measurement of the CONTENTS has no such feedback. */
  function flatRowWidth(groups, gap) {
    var g = num(gap, 6), total = 0, n = 0;
    (groups || []).forEach(function (grp) {
      var items = (grp && grp.items) || [];
      if (!items.length) return;
      n++;
      items.forEach(function (w, i) { total += num(w, 0) + (i ? g : 0); });
    });
    return total + g * Math.max(0, n - 1);
  }

  /** Lay the row's stacked pairs out FLAT when there is room for them on one line, and stacked when
   *  there is not — "in case the width is big enough to fit everything into one row", which is the
   *  common case for a wide Core pane where a second row was being spent on nothing.
   *
   *  Returns true when the row ended up flat. Sets `--flat` on the ROW; the CSS turns every stacked
   *  group inside it back into a plain inline run. */
  function fitStackedRow(row) {
    if (!row || !row.children) return false;
    var groups = [], i, j;
    for (i = 0; i < row.children.length; i++) {
      var c = row.children[i];
      if (c && c.classList && c.classList.contains("cs-grp") && !c.classList.contains("--gone")) groups.push(c);
    }
    if (!groups.length) return false;
    // Measure the CONTROLS, never the containers: a container that has already wrapped reports the
    // width it was given, not the width its contents want, which is exactly the wrong number here.
    var measured = groups.map(function (g) {
      var items = [];
      var rows = g.classList.contains("--stack") ? g.children : [g];
      for (var a = 0; a < rows.length; a++) {
        var r = rows[a];
        if (r.classList && r.classList.contains("--gone")) continue;
        var kids = r.children || [];
        for (var b = 0; b < kids.length; b++) if (csVisible(kids[b])) items.push(num(kids[b].offsetWidth, 0));
      }
      return { items: items };
    });
    var cs = root.getComputedStyle ? root.getComputedStyle(row) : null;
    var pad = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
    var gap = cs ? (parseFloat(cs.columnGap) || parseFloat(cs.gap) || 6) : 6;
    var avail = num(row.clientWidth, 0) - pad;
    var flat = avail > 0 && flatRowWidth(measured, gap) <= avail;
    row.classList.toggle("--flat", flat);
    return flat;
  }

  /** PURE. Which groups claim their line's free space, given the vertical band each one occupies.
   *  in : [{ top: px, bottom: px }, …] in DOM order   out: [index, …] to give `margin-left: auto`
   *
   *  THE RULE: the last group on each line goes right; everything before it on that line packs left.
   *  A lone group on a line is also the last on it, which is why "alone ⇒ right" needs no special
   *  case — it falls out of the same rule.
   *
   *  Groups share a LINE when their vertical bands overlap — NOT when their tops are equal. Rows are
   *  `align-items: center`, so a short group (a bare chip) sitting on the same line as a tall one (a
   *  select, a bordered send group) is centred against it and therefore starts several px LOWER.
   *  Bucketing on exact `top` split one line into two, which mis-assigns the sides outright. Found
   *  by measuring the running app; every unit test passed with the exact-top version. */
  function rowAlignPlan(items) {
    var out = [], lineBottom = null, lastOnLine = -1;
    (items || []).forEach(function (it, i) {
      if (!it) return;
      var top = num(it.top, 0);
      // A group with no measured height still has to be distinguishable from the next LINE, so it
      // occupies a nominal 1px band rather than a zero-height one (which would make every group its
      // own line, since `top >= bottom` would always hold).
      var bottom = num(it.bottom, top + 1);
      // Flex lines never overlap vertically, so "starts at or below the current line's deepest
      // point" is an exact test for "wrapped onto the next line" — row-gap only widens the margin.
      if (lineBottom === null || top >= lineBottom) {
        if (lastOnLine >= 0) out.push(lastOnLine);   // the line that just ended: its last group goes right
        lineBottom = bottom;
      } else lineBottom = Math.max(lineBottom, bottom);
      lastOnLine = i;
    });
    if (lastOnLine >= 0) out.push(lastOnLine);       // …and the final line's
    return out;
  }

  /** Is this control actually taking up space? The package hides things two ways — the `--gone`
   *  class and the `hidden` property — and a group whose every member is hidden must go with them. */
  function csVisible(n) {
    return !!n && !n.hidden && !(n.classList && n.classList.contains("--gone"));
  }

  /** The imperative half: retire empty groups, measure which line each surviving group wrapped onto,
   *  then apply the plan.
   *
   *  ORDER MATTERS. Hiding an all-hidden group changes the layout, so it happens BEFORE measuring
   *  (otherwise a group contributing nothing but the row's own 6px gap would still be counted as
   *  occupying a line). Margins are cleared before measuring too: an auto margin already in place is
   *  free space already claimed, so measuring around it would read the post-alignment layout rather
   *  than the natural one. Returns the plan, so a caller (or a test) can see what it decided. */
  function alignRowGroups(row) {
    if (!row || !row.children) return [];
    var groups = [], i, j;
    for (i = 0; i < row.children.length; i++) {
      var c = row.children[i];
      if (c && c.classList && c.classList.contains("cs-grp")) groups.push(c);
    }
    var live = [];
    for (i = 0; i < groups.length; i++) {
      // A STACKED group's rows are retired individually first: a pair whose bottom half has nothing
      // visible (Core shows no `fast` toggle, for one) must collapse to a single row rather than
      // reserve a second row's height for an empty box. Done before the group-level check below so
      // that a stack with BOTH rows empty is then correctly seen as an empty group.
      if (groups[i].classList.contains("--stack")) {
        var rows = groups[i].children || [];
        for (j = 0; j < rows.length; j++) {
          var rk = rows[j].children || [], rAny = false, x;
          for (x = 0; x < rk.length; x++) if (csVisible(rk[x])) { rAny = true; break; }
          rows[j].classList.toggle("--gone", !rAny);
        }
      }
      var kids = groups[i].children || [], any = false;
      for (j = 0; j < kids.length; j++) if (csVisible(kids[j])) { any = true; break; }
      // A group with no visible members is not "an empty box": left in flow it still spends the
      // row's gap on either side of nothing, which is exactly the stray-gap class of bug this whole
      // grouping exists to remove.
      groups[i].classList.toggle("--gone", !any);
      groups[i].style.marginLeft = "";
      if (any) live.push(groups[i]);
    }
    var plan = rowAlignPlan(live.map(function (g) {
      var top = num(g.offsetTop, 0);
      return { top: top, bottom: top + num(g.offsetHeight, 1) };
    }));
    for (i = 0; i < live.length; i++) {
      var end = plan.indexOf(i) >= 0;
      live[i].style.marginLeft = end ? "auto" : "";
      // The captured side is written back onto the node — this is the only place it exists. It is
      // what lets a right-hand group also pack its OWN wrapped lines right (see components.css),
      // and it makes the decision inspectable in devtools instead of implicit in a margin.
      live[i].setAttribute("data-align", end ? "end" : "start");
    }
    return plan;
  }

  /** Builds the header's turns/size/compacted/wrapped/would-wrap chips, GROUPED (see grp above) and
   *  ready to append: `[start: turns + size] [end: compacted + wrapped] [start: would wrap]`. The
   *  context readout is not built here — it is an interactive, stable node the shell owns (its click
   *  opens the breakdown), so it is appended by mount() as its own end-group and survives the
   *  wholesale rebuild this function feeds on every repaint.
   *
   *  `o.fmtNum`/`o.fmtBytes` are injected (Lab's `fmt`/`fmtBytes` and app.js's
   *  `wsNumFmt`/`wsFmtBytes` are functionally identical thousand-separator formatters that already
   *  existed independently on both sides — not worth forcing into one function too). `o.chipClass`/
   *  `o.warnClass`/`o.mutedClass` let each caller keep its own CSS naming (Lab's `chip`/`--acc`/`--far`
   *  vs production's `exo-chip`/`--warn`/`--muted`) without the shared function dictating a class
   *  rename across two live stylesheets.
   */
  function buildStatsChips(o) {
    o = o || {};
    // WINDOW vs CONVERSATION. Every threshold here is per-WINDOW: the engine measures turns and bytes
    // since the last wrap (workspace.mjs `_rollFrom`), because that is the slice a wrap would act on.
    // The chips were fed the WHOLE conversation instead, so a long-lived one read `7,668/1,000 turns
    // · 766.8%` — a percentage of a ceiling it had supposedly blown through seven times without ever
    // wrapping — and "would wrap R#1–R#6,841", claiming the next wrap would archive everything back
    // to the first turn when in truth it starts after the last wrap mark.
    //
    // `pFrom`/`rFrom` are the ABSOLUTE numbers of the first prompt/response still in the live window.
    // They default to 1, which is the correct answer for a conversation that has never wrapped.
    var pFrom = Math.max(1, Math.round(num(o.pFrom, 1))), rFrom = Math.max(1, Math.round(num(o.rFrom, 1)));
    var winP = Math.max(0, num(o.prompts, 0) - (pFrom - 1)), winR = Math.max(0, num(o.responses, 0) - (rFrom - 1));
    var fmtNum = o.fmtNum || function (n) { return String(Math.round(n || 0)); };
    var fmtBytes = o.fmtBytes || function (n) { return String(Math.round(n || 0)) + "B"; };
    var chipClass = o.chipClass || "chip";
    var warnClass = o.warnClass || "--acc";
    var mutedClass = o.mutedClass || "--far";
    // GROUP 1 (start) — "how big is this conversation": the turn count and the byte size, the two
    // figures that only mean anything read together against their ceilings.
    var size = [];
    var tg = rollTriggers({ prompts: winP, responses: winR, bytes: o.bytes, tokens: o.tokens,
                            ceiling: o.ceiling, maxTurns: o.maxTurns, maxBytes: o.maxBytes });
    tg.list.forEach(function (c) {
      if (c.id === "context") return;   // the context readout (its own end-group, below) carries this figure
      var near = c.id === tg.willRollOn;
      var label = c.id === "turns"
        ? fmtNum(c.now) + "/" + fmtNum(c.max) + " turns · " + fmtNum(Math.round(c.now / 2)) + " rounds"
        : fmtBytes(c.now) + " / " + fmtBytes(c.max);
      size.push(el("span", { class: chipClass + " " + (near ? warnClass : mutedClass),
        title: near ? "Nearest ceiling — this is what will fire the next wrap (" + c.pct + "%)"
                    : c.label + " is at " + c.pct + "% — far from binding" },
        [(near ? "▸ " : "") + label + " · " + c.pct + "%"]));
    });
    // These two counters carry a hardcoded, unconditional inline color rather than a caller-supplied
    // class — "same colours" was an explicit, repeated ask, and a class NAME matching across two
    // stylesheets is not the same guarantee as the same literal hex landing in both DOMs. Blue for an
    // active compaction count, the shared accent for an active wrap count; both fall back to the
    // caller's muted class at zero, same as every other chip.
    // GROUP 2 (end) — "what has already been done to this window": the two cumulative counters.
    var counters = [];
    var nComp = o.compactCount || 0, nWraps = o.wrapCount || 0;
    counters.push(el("span", { class: chipClass + (nComp ? "" : " " + mutedClass),
      style: nComp ? "color:#8fc3ff;border-color:#5aa8f055" : "",
      title: nComp
        ? nComp + " compaction" + (nComp === 1 ? "" : "s") + " in this window. Each replaced earlier turns "
          + "with a summary that still occupies the window — wrapping is what actually clears it. "
          + "This count resets at every wrap, because a fresh window starts with none."
        : "No compactions in this window yet. Resets at every wrap." },
      ["🗜 " + nComp + " compacted · this window"]));
    counters.push(el("span", { class: chipClass + (nWraps ? "" : " " + mutedClass),
      style: nWraps ? "color:" + (o.accentVar || "var(--acc)") + ";border-color:#c77dff55" : "",
      title: nWraps
        ? nWraps + " wrap" + (nWraps === 1 ? "" : "s") + " in this conversation — each one is a \u27f3 mark in the transcript "
          + "above, and everything before the last of them is archived and reachable with Recall. Cumulative: this only ever goes up."
        : "No wraps yet — the whole conversation is still in one window, and Recall has nothing to search." },
      ["⟳ " + nWraps + " wrapped · this conversation"]));
    // GROUP 3 (start) — "what the NEXT wrap would take", the one forward-looking figure here.
    var tailTurns = o.tailTurns || 80;
    var tailRounds = Math.round(tailTurns / 2);
    // The next wrap starts where the LAST one ended, not at the first turn of the conversation.
    var sp = wrapSpan({ rFrom: rFrom, rTo: Math.max(rFrom - 1, num(o.responses, 0) - tailRounds),
                        pFrom: pFrom, pTo: Math.max(pFrom - 1, num(o.prompts, 0) - tailRounds) });
    // ONE SIDE CAN BE EMPTY WHILE THE OTHER IS NOT — and it is the normal case, because the tail a
    // wrap keeps is counted in TURNS: a window with 145 archivable responses can easily have zero
    // archivable prompts, since prompts are far rarer. Printed as a range that came out backwards
    // ("P#15–P#14 [0]"), which reads as a broken number rather than as "none of these yet".
    var side = function (tag, r, f) {
      return r.count ? tag + "#" + f(r.from) + "–" + tag + "#" + f(r.to) + " [" + f(r.count) + "]"
                     : tag + "# none yet";
    };
    // NOTHING TO WRAP YET is a real, common state — a fresh window is entirely inside the tail that a
    // wrap always keeps verbatim — and it needs saying in words. Printed as a range it came out
    // backwards ("R#6,896–R#6,895 [0]"), which reads as a broken number rather than as "not yet".
    var span = sp.r.count || sp.p.count
      ? el("span", { class: chipClass,
          title: "Approximate — the last ~" + tailTurns + " turns are always kept verbatim. The Wrap dialog shows the exact figures." },
          ["would wrap ", el("span", { class: o.rTagClass || "tR" }, [side("R", sp.r, fmtNum)]),
           " · ", el("span", { class: o.pTagClass || "tP" }, [side("P", sp.p, fmtNum)])])
      : el("span", { class: chipClass + " " + mutedClass,
          title: "A wrap always keeps the last ~" + tailTurns + " turns verbatim, and this window is still inside that tail — "
               + "so there is nothing it could archive yet. The count above shows how far into the window you are." },
          ["would wrap nothing yet · window is inside the ~" + fmtNum(tailTurns) + "-turn tail"]);
    return [grp(size), grp(counters), grp([span])];
  }

  /** Builds the auto-wrap checkbox + progress meter + joined Compact│Wrap split button as one unit.
   *  `wrapReadiness` (below) already backed all three copies' MATH; this is the one place that now
   *  also backs their MARKUP, including the auto-wrap meter that Core/Pact never actually shipped —
   *  it was flagged missing rather than faked, and lands here for real, in both workspaces, together.
   *  Callbacks (`onToggleAutoWrap`/`onCompact`/`onWrap`) let each caller wire its own real action
   *  (the Lab's mock `runEvent`, or Core/Pact's real `wsCompact`/`wsOpenWrapDialog`) — this function
   *  never assumes what "compact" or "wrap" DOES, only what the control looks like. */
  function buildWrapControls(o) {
    o = o || {};
    var wr = wrapReadiness({ tokens: o.tokens, ceiling: o.ceiling, manualAt: o.manualAt, autoAt: o.autoAt });
    var cb = el("input", { type: "checkbox" }, []);
    cb.title = "Automatically wrap to a fresh window at " + Math.round(wr.autoAt * 100) + "%";
    cb.checked = o.autoWrap !== false;
    cb.onchange = function () { if (typeof o.onToggleAutoWrap === "function") o.onToggleAutoWrap(cb.checked); };
    var autoLabel = el("label", { class: o.autoLabelClass || "autolbl" }, [cb, o.autoLabelText || "auto-wrap"]);
    var fill = el("i", {}, []);
    fill.style.width = Math.min(100, wr.pct) + "%";
    var meter = el("span", { class: o.meterClass || "bar" }, [fill]);
    meter.title = wr.pct + "% of the context window — automatic wrap fires at " + Math.round(wr.autoAt * 100) + "%";
    var compactBtn = el("button", { class: o.compactClass || "splitL" }, [o.compactLabel || "🗜 Compact"]);
    compactBtn.title = o.compactTitle || "Compact — summarise earlier turns to shrink the context window. Cheap, keeps this session, but the summary itself stays in the window.";
    compactBtn.onclick = function () { if (typeof o.onCompact === "function") o.onCompact(); };
    var wrapBtn = el("button", { class: o.wrapClass || "splitR" },
      [wr.canWrapManually ? (o.wrapLabel || "⟳ Wrap") : "⟳ Wrap at " + Math.round(wr.manualAt * 100) + "%"]);
    wrapBtn.title = wr.reason;
    wrapBtn.disabled = !wr.canWrapManually;
    wrapBtn.onclick = function () { if (typeof o.onWrap === "function") o.onWrap(); };
    var split = el("span", { class: o.splitClass || "split" }, [compactBtn, wrapBtn]);
    return { autoLabel: autoLabel, checkbox: cb, meter: meter, meterFill: fill,
             compactBtn: compactBtn, wrapBtn: wrapBtn, split: split, readiness: wr };
  }

  /** PURE. What the Send/Stop pair should SAY and LOOK LIKE, given what the pane is doing.
   *
   *  One decision, two workspaces. Core and Pact each had their own chain of ternaries for this, and
   *  they had quietly drifted apart in three ways — every one of them a case where Pact told you less
   *  than Core did:
   *
   *    • BACKGROUND WORK. The ring means "work is happening", and that includes work which is not
   *      this turn: an agent-spawned task keeps running while the chat itself reads idle. Core pulsed
   *      for it; Pact did not, so the one state a host cannot signal any other way was invisible
   *      there.
   *    • A PRESSED STOP. The turn is still running until the interrupt actually lands, so the button
   *      must stay its working colour. Pact dropped back to the resting accent the instant Stop was
   *      pressed, which reads as "finished" while the agent is still going.
   *    • THE LABEL while stopping. Core kept saying "Working…", which is true but unhelpful when you
   *      have just pressed Stop. "Stopping…" is what you want to read, and it is now what both say.
   *
   *  `suffix` is the caller's own trailing detail (Core appends a live elapsed clock); it rides only
   *  on a running turn, never on "Send" and never on "Stopping…" where it would just be noise. */
  function sendPresentation(o) {
    o = o || {};
    var busy = !!o.busy, deep = !!o.deep, stopping = !!o.stopping;
    var label = stopping ? "Stopping\u2026" : deep ? "Deep Work\u2026" : busy ? "Working\u2026" : "Send";
    return {
      // Deep work IS busy — it is the same turn-lock, just open-ended — so the colour survives a
      // pressed Stop for as long as the turn does.
      state: deep ? "deep" : busy ? "busy" : null,
      pulse: busy || !!o.background,
      sendLabel: label + (busy && !stopping && o.suffix ? o.suffix : ""),
      stopShown: true,
      stopDisabled: !busy || stopping,
      stopPending: stopping,
      stopLabel: stopping ? "\u25a0 Stopping\u2026" : "\u25a0 Stop",
    };
  }

  /** "Still fetching this conversation" — a bar for the CORE region.
   *
   *  The gap it fills is real and was completely unexplained: during a reload with several panes,
   *  Core's transcript area sits blank while its conversation is fetched, and the header meanwhile
   *  reports `0/1,000 turns · 0%` and "context: no reading yet". So it does not merely look unloaded,
   *  it actively asserts that the conversation is EMPTY. Pact has had a loading state all along;
   *  Core never did.
   *
   *  The bar animates `transform`, not `left`/`width`: animating either of those re-runs LAYOUT every
   *  frame, and this shows up on every pane at once, which is exactly when the main thread is
   *  busiest. (See lib/compositedAnimations.test.mjs.) */
  function buildLoading(o) {
    o = o || {};
    var bar = el("span", { class: "cs-loadbar" }, [el("i", {}, [])]);
    return el("div", { class: "cs-loading" + (o.className ? " " + o.className : "") },
      [bar, el("span", { class: "cs-loadlbl" }, [o.label || "Loading conversation\u2026"])]);
  }

  /** Put a buildWrapControls() result into the shell's STACKED wrap group: the auto-wrap tick and its
   *  meter on top (what the window is doing on its own), Compact│Wrap underneath (what you can do
   *  about it).
   *
   *  This exists because all three callers — the package's own paintWrap, Core's
   *  wsPaintWrapControls and Pact's pactPaintWrapControls — each did their own
   *  `replaceChildren(autoLabel, meter, split)` straight onto the group. That is fine while the group
   *  is a flat span, and it silently DESTROYS a stacked one: the two rows the stack is made of get
   *  replaced by three loose children, so the group renders as a three-row column and the pairing is
   *  gone. Measured exactly that way in Pact before this function existed — a 58px column where the
   *  stack should be ~49px in two rows. Hosts pass their own classes/labels/handlers to
   *  buildWrapControls; where the pieces LAND is the shell's business, and now has one owner. */
  function fillWrapGroup(groupEl, wc) {
    if (!groupEl || !wc) return groupEl;
    var rows = [];
    for (var i = 0; i < (groupEl.children || []).length; i++) {
      if (groupEl.children[i].classList && groupEl.children[i].classList.contains("cs-grow")) rows.push(groupEl.children[i]);
    }
    // A caller holding a group that is not a stack (an older host, or a bare container) still gets
    // correct output rather than nothing — flat, in the same order.
    if (rows.length < 2) { groupEl.replaceChildren(wc.autoLabel, wc.meter, wc.split); return groupEl; }
    rows[0].replaceChildren(wc.autoLabel, wc.meter);
    rows[1].replaceChildren(wc.split);
    return groupEl;
  }

  /** THE SHELL. The Lab's `build()` assembles header→core→footer in one specific order: header row1
   *  (identity/status — genuinely different per workspace, so it's caller-supplied content, not built
   *  here) then row2 (stats, via buildStatsChips above); an empty core region production's OWN real
   *  transcript renderer fills (this function must never write into it — that renderer solves real
   *  performance/correctness problems, huge real conversations and live streaming, that this file's
   *  mock generator was never built to handle); footer action row (buttons — again caller-supplied,
   *  since Core's and Pact's real controls differ) then model row, ending in the wrap controls (via
   *  buildWrapControls above) exactly the way the Lab's `mb.appendChild(...)` sequence ends.
   *
   *  This is the ONE remaining piece of "bring the whole construction, not just leaf widgets": Core
   *  and Pact both call this to build their actual header+footer DOM instead of hand-assembling their
   *  own tree that merely CALLS a few shared functions. Class names are ADDITIVE (`headerClass` etc.
   *  may list several space-separated classes) so production keeps its own existing class alongside
   *  the shared one — a rename was rejected in design.md as disproportionate risk for no behavioral
   *  gain over adding the shared class next to the existing one. */
  function buildShellFrame(o) {
    o = o || {};
    var header = el("div", { class: o.headerClass || "rg-header" }, []);
    var identityRow = el("div", { class: o.identityRowClass || "hrow --r1" }, o.identityContent || []);
    header.appendChild(identityRow);
    // statsRow defaults to PRESENT-BUT-EMPTY when no data is given yet, not omitted — production
    // holds a stable reference to this row and repaints real data into it on every paint (the Lab's
    // render() rebuilds the whole shell every time instead, so it always has data in hand up front).
    // `statsRow: false` is the explicit opt-out for a workspace kind that never shows one at all.
    var statsRow = null;
    if (o.statsRow !== false) {
      statsRow = el("div", { class: o.statsRowClass || "hrow hright" }, o.statsData ? buildStatsChips(o.statsData) : []);
      header.appendChild(statsRow);
    }
    // `existingCore`: production's real transcript container (Core's transcriptEl, Pact's .pc-scroll)
    // already exists by the time this runs — it's built earlier, filled by production's own real,
    // untouched renderer, and its scroll state must survive across rebuilds. Reusing it here (adding
    // the shared class to the SAME node) is what actually wires frame.core to something real; a fresh
    // node no caller ever mounts would be shared-in-name-only. No `existingCore` (the Lab's own
    // call, and any future caller with nothing built yet) still gets a fresh empty mount point.
    var core = o.existingCore || el("div", {}, []);
    (o.coreClass || "rg-core").split(/\s+/).forEach(function (c) { if (c) core.classList.add(c); });
    var footer = el("div", { class: o.footerClass || "rg-footer" }, []);
    // FOOTER LEAD — everything the Lab's footer puts ABOVE its action row, in the Lab's own order:
    //   seam bulb → attachment/image strip → pending-reply chips → the full-width type box row →
    //   the search drawer                       (chat-shell-lab.html: ftr.appendChild(bulb); … ir …
    //                                            rr … taRow … sr … act … mb)
    // These are caller-supplied nodes rather than built here for the same reason identityContent is:
    // Core's compose row (real paste/drag-drop/attachment plumbing) and Pact's are genuinely
    // different objects. What this slot fixes is the STRUCTURE: production used to leave them as
    // SIBLINGS of the footer inside .ws-pane, so the shell was 9 flex children instead of the Lab's
    // three regions — the footer was not one bordered box containing the compose area, and the
    // .rg-footer chrome tone/seam highlight therefore covered only the button rows.
    (o.footerLeadContent || []).forEach(function (n) { if (n) footer.appendChild(n); });
    // actionRow is genuinely optional (unlike statsRow/modelRow): Core's and Pact's real compose
    // areas (the type box, its gutter, image previews, the search drawer) do not fold cleanly into
    // one .frow the way the Lab's simpler mock footer does — forcing them into this slot risks
    // breaking a real, differently-shaped layout for no verified visual gain, which is exactly the
    // kind of fake-shared code this whole effort exists to stop producing. Callers that DO have a
    // one-row action bar (matching the Lab's shape) may still use it via actionRowContent.
    var actionRow = null;
    if (o.actionRow !== false && o.actionRowContent) {
      actionRow = el("div", { class: o.actionRowClass || "frow" }, o.actionRowContent);
      footer.appendChild(actionRow);
    }
    var modelRow = el("div", { class: o.modelRowClass || "frow" }, o.modelRowContent || []);
    if (o.wrapControlsData) {
      var wc = buildWrapControls(o.wrapControlsData);
      modelRow.appendChild(wc.autoLabel);
      modelRow.appendChild(wc.meter);
      modelRow.appendChild(wc.split);
    }
    footer.appendChild(modelRow);
    return { header: header, identityRow: identityRow, statsRow: statsRow, core: core,
             footer: footer, actionRow: actionRow, modelRow: modelRow };
  }

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
  function slotsFor(kind, opts) {
    var pact = kind === "pact";
    // MULTI-CHAT in Core is a READ-MODE FLIP, not new storage. The store already writes one file per
    // conversation (`appendTurn(dir, id, sessionId, …)`) and exposes both views: `readSession()` for one
    // conversation and `readWorkspace()` for the merged one — which even tags every record with its
    // `_sessionId`. Core simply chooses the merged view today. So turning this on does not create,
    // migrate or split anything: it stops merging conversations that were always stored apart.
    // Off by default in Core, because one repository usually means one thread and tabs you did not ask
    // for are clutter. Pact is always multi.
    var multi = pact || !!(opts && opts.multiChat);
    return {
      kind: pact ? "pact" : "core",
      multiChat: multi,
      header: {
        tabs: multi,                   // tabs appear only where several conversations can exist
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
        // There is no longer a separate "continuation line" row for the suggested-next text + the
        // bookmark star (Pact used to carry one; it read as a permanent row saying nothing most of
        // the time — "there still is a suggested continue line that probably shouldn't be here").
        // The suggestion is GHOST TEXT inside the type box itself (`typeBox`, below); the bookmark
        // star is a normal footer control (`bmBtn`/its role substitution) in both kinds, same as any
        // other action-row button — neither needs its own slot.
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
        multi: multi,                  // several open conversations, or exactly one
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

  /** A CONVERSATION MARK — the horizontal rule through the transcript that says "the context window
   *  changed here". Two kinds, and the difference matters to a reader deciding whether their earlier
   *  instructions still hold:
   *    compact — the engine SUMMARISED earlier turns to fit the window. The transcript is unchanged;
   *              only the hidden context shrank.
   *    wrap    — everything before this line was rolled out of the live window onto a fresh one.
   *              Nothing was deleted; it stays searchable.
   *  This design already existed in the Chat Shell Lab and was the ONLY place it existed: production
   *  logged a line to its activity rail and drew nothing in the conversation, so "compaction didn't
   *  bring the compaction bar" was literally true. One function now, so a mark cannot look one way in
   *  the Lab and another way (or not at all) in a live workspace.
   *  @param {{kind, preTokens?, postTokens?, trigger?, at?, fmtNum?}} o */
  function buildMark(o) {
    o = o || {};
    // A FAILED TURN is a third kind of boundary, and it belongs in the transcript for the same
    // reason the other two do: it is something the reader has to know happened. The SDK ends a
    // broken turn with an ordinary result frame and no text, so without this the pane just looks
    // empty — which is exactly how a conversation whose SDK session file had been pruned read as
    // "the prompts are stuck" rather than "that turn could not start".
    if (o.kind === "error") {
      // TWO DIFFERENT EVENTS, and calling both "TURN FAILED" was wrong the moment it shipped: the
      // recovery case is a turn that SUCCEEDED. A conversation whose SDK window had been pruned now
      // drops the dead id and starts a fresh one — the reader needs to know the agent no longer
      // carries that window's context, but shouting FAILED at them about a turn that worked is a
      // worse lie than saying nothing. Red for a turn that died, amber for one that recovered.
      var note = o.tone === "notice";
      var emsg = o.message || "The turn ended with an error.";
      var elabel = (note ? "\u21bb FRESH WINDOW \u2014 " : "\u26a0 TURN FAILED \u2014 ") + emsg;
      if (o.at) { var ed = new Date(o.at); if (!isNaN(ed.getTime())) elabel += "  \u00b7  " + ed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
      return el("div", { class: "mark " + (note ? "--note" : "--err"), title: emsg },
        [el("span", { class: "mlbl" }, [elabel])]);
    }
    var isWrap = o.kind === "wrap";
    var fmt = o.fmtNum || function (n) { return String(n); };
    var pre = Number(o.preTokens) || 0, post = Number(o.postTokens) || 0;
    var label = isWrap
      ? "WRAPPED \u2014 a fresh context window starts here"
      : "COMPACTED (" + (o.trigger || "auto") + ")"
        + (pre && post ? " \u2014 " + fmt(pre) + " \u2192 " + fmt(post) + " tok, freed " + fmt(pre - post) : "");
    // The clock is production-only: a real conversation is read hours later and "when" is part of
    // reading it. The Lab has no real time to show, so it simply passes no `at`.
    if (o.at) {
      var d = new Date(o.at);
      if (!isNaN(d.getTime())) label += "  \u00b7  " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return el("div", { class: "mark " + (isWrap ? "--wrap" : "--compact"),
      title: isWrap
        ? "Everything before this line was rolled out of the live window. Nothing was deleted; it stays searchable."
        : "The engine summarised earlier turns to fit the window. The transcript is unchanged \u2014 only the hidden context shrank." },
      [el("span", { class: "mlbl" }, [label])]);
  }

  var API = {
    SWALLOW_PCT: SWALLOW_PCT, SWALLOW_PCT_MAX: SWALLOW_PCT_MAX, FLOOR_ROWS: FLOOR_ROWS,
    COLLAPSE_STEPS: COLLAPSE_STEPS, HYSTERESIS: HYSTERESIS,
    coreAtRest: coreAtRest, swallowCap: swallowCap, computeShell: computeShell, slotsFor: slotsFor, wrapReadiness: wrapReadiness, rollTriggers: rollTriggers, wrapSpan: wrapSpan, wrapSeedEstimate: wrapSeedEstimate, seedPlan: seedPlan,
    replyQuote: replyQuote, buildReplyPreamble: buildReplyPreamble, replyCost: replyCost,
    ROLL_MAX_TURNS: ROLL_MAX_TURNS, ROLL_MAX_BYTES: ROLL_MAX_BYTES,
    el: el, grp: grp, stack: stack, sendPresentation: sendPresentation, buildLoading: buildLoading, fillWrapGroup: fillWrapGroup, flatRowWidth: flatRowWidth, fitStackedRow: fitStackedRow, gutterEntries: gutterEntries, rowAlignPlan: rowAlignPlan, alignRowGroups: alignRowGroups,
    paintGutter: paintGutter, buildStatsChips: buildStatsChips, buildWrapControls: buildWrapControls,
    buildShellFrame: buildShellFrame, buildMark: buildMark
  };
  if (typeof module === "object" && module.exports) module.exports = API;
  root.ChatShell = API;
})(typeof window !== "undefined" ? window : globalThis);
