/* @ancientpantheon/claude-chat-shell — THE DROP-IN CHAT BOX.
 *
 *   <link rel="stylesheet" href="/chat-shell/chat-shell.css">
 *   <script src="/chat-shell/chat-shell.js"></script>      <!-- geometry maths + primitives -->
 *   <script src="/chat-shell/chat-shell-ui.js"></script>   <!-- this file -->
 *
 *   const view = ChatShellUI.mount(hostEl, { kind: "core", on: { send(text) { ... } } });
 *   view.setState({ identity: { label: "myrepo" }, compose: { placeholder: "Message Claude..." } });
 *   view.core.appendChild(myTranscriptNode);
 *
 * That is the whole contract. `mount()` builds EVERY pixel of the chat box — header identity row,
 * live conversation stats, the transcript region, the seam Live/Held marker, attachments, reply
 * quotes, the compose field with its line-number gutter, the action row, and the model row with
 * effort / ultracode / permission / context / auto-wrap / Compact-Wrap. The host supplies data and
 * callbacks and nothing else. There is no second implementation to keep in sync, which is the
 * entire reason this package exists: the design lab and the live app are the same code, so a change
 * to either is a change to both — by construction, not by discipline.
 *
 * WHAT THE HOST STILL OWNS, on purpose: `view.core`. That is a real, empty region this package
 * sizes, scrolls and themes — and never writes into. Rendering a live agentic transcript
 * (incremental append, node caching, tool-call blocks, images, token streaming, scroll anchoring
 * across thousands of turns) is a genuinely app-specific performance problem, and a package that
 * pretended to solve it generically would be worse than one that hands you a correctly-behaved box.
 *
 * STATE IS A PATCH, NOT A SNAPSHOT. `setState(partial)` applies only the keys you pass, so a host
 * can push `{ stats }` on every token without touching the model row. Nodes are built once at
 * mount and updated in place — never rebuilt — so the compose field never loses focus or caret,
 * and the transcript never loses scroll position.
 */
(function (root) {
  "use strict";

  var doc = root && root.document;
  var CS = root.ChatShell;
  var el = CS.el;

  function txt(node, s) { if (node && node.textContent !== s) node.textContent = s; }
  function show(node, on) { if (node) node.classList.toggle("--gone", !on); }
  function nn(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  /** A <select> whose options are declarative. Rebuilt only when the option list actually changed —
   *  re-creating options on every paint closes the native dropdown mid-interaction. */
  function syncSelect(sel, options, value) {
    if (options) {
      var sig = options.map(function (o) { return (o.group || "") + "|" + o.value + "|" + o.label; }).join("~");
      if (sel._sig !== sig) {
        sel._sig = sig;
        sel.replaceChildren();
        var groups = {};
        options.forEach(function (o) {
          var opt = el("option", { value: String(o.value) }, [o.label]);
          if (o.title) opt.title = o.title;
          if (!o.group) { sel.appendChild(opt); return; }
          if (!groups[o.group]) { groups[o.group] = el("optgroup", { label: o.group }, []); sel.appendChild(groups[o.group]); }
          groups[o.group].appendChild(opt);
        });
      }
    }
    if (value == null) return;
    sel.value = String(value);
    // A <select> whose value matches no option silently renders BLANK (selectedIndex -1) — the
    // "no model shown, cannot pick Opus" class of bug. Fall back to the first real option instead.
    if (sel.selectedIndex < 0 && sel.options.length) sel.selectedIndex = 0;
  }

  function mount(host, opts) {
    opts = opts || {};
    var on = opts.on || {};
    var slots = opts.slots || {};
    var kind = opts.kind === "pact" ? "pact" : "core";
    function call(name) {
      var fn = on[name];
      if (typeof fn !== "function") return undefined;
      return fn.apply(null, Array.prototype.slice.call(arguments, 1));
    }

    /* ======================= HEADER ROW 1 — identity / conversation tabs ======================= */
    // Tabs and identity chips occupy the SAME slot: a workspace either addresses one conversation
    // (a chip naming it) or several (medallions you switch between). Same construction, same height,
    // same padding and radius — so the header never jumps between the two shapes.
    var identitySlot = el("div", { class: "cs-inline" }, []);
    var multiCb = el("input", { type: "checkbox" }, []);
    var multiLabel = el("label", { class: "autolbl" }, [multiCb, "multi-chat"]);
    multiCb.addEventListener("change", function () { call("multiChat", multiCb.checked); });
    var statusSlot = el("span", { class: "cs-inline" }, []);
    var headExtra = el("span", { class: "cs-inline" }, slots.headExtra || []);
    var savedChip = el("span", { class: "chip --ok" }, ["\u2713 Saved"]);
    // THE ACTIVITY CHIP \u2014 "what is happening right now", in words: sending, thinking, streaming, a
    // tool running, waiting for permission, done, a connection hiccup. A chip, never its own row: a
    // full-width row costs header height permanently to report something true for two seconds. The
    // wrapper is positioned so a host can dock its own expanded log under it (`els.activityWrap`)
    // without the package having to own a log format it cannot know.
    var activityChip = el("button", { class: "chip cs-activity", type: "button" }, ["Idle"]);
    var activityWrap = el("span", { class: "cs-activity-wrap" }, [activityChip]);
    activityChip.addEventListener("click", function () { call("activity"); });
    // CLOSE \u2014 "this shell is one of several and can be dismissed". Last in the row on purpose: a
    // destructive control never sits between two things you click all day.
    var closeBtn = el("button", { class: "cs-close", type: "button", title: "Close" }, ["\u00d7"]);
    closeBtn.addEventListener("click", function () { call("close"); });

    /* ======================= FOOTER PARTS ===================================================== */
    var seamBulb = el("div", { class: "seambulb --live" }, []);

    // THE EARLIER-TURNS MEDALLION. "This conversation is longer than what is rendered" is a fact
    // worth one glance, not a permanent header row — a full-width row spends a line of chrome
    // forever to carry a number you act on once (reported: "it is sitting in the header, wasting
    // one line"). It floats INSIDE the core region instead: a zero-height sticky strip pinned to
    // the top of the scroll viewport, so it overlays the transcript rather than displacing it, and
    // it stays reachable however far down you have scrolled.
    //
    // It is a CHILD OF THE CORE, which means a host whose own renderer rebuilds the core's children
    // must re-include `els.coreTop` at the head of that list (Core's renderTranscriptInto and Pact's
    // pactChatPaint both do). It is a stable node on purpose — Core's transcript renderer keys its
    // untouched-prefix fast path on node identity, so a rebuilt medallion would invalidate the whole
    // prefix on every paint.
    var earlierBtn = el("button", { class: "cs-earlier", type: "button" }, []);
    earlierBtn.addEventListener("click", function () { call("earlier"); });
    var coreTop = el("div", { class: "cs-coretop" }, [earlierBtn]);

    var attachErr = el("div", { class: "frow" }, [el("span", { class: "chip --bad" }, [])]);
    var attachRow = el("div", { class: "frow" }, []);
    var replyRow = el("div", { class: "frow replyrow" }, []);

    // THE TYPE BOX. The gutter is absolutely positioned on purpose: as a flex sibling it stretched
    // the textarea to the row's height — which was itself derived from the textarea — so the box
    // could never shrink back after you deleted text. Out of the sizing path, that circular
    // dependency is gone and the height is driven by content alone.
    var gutter = el("div", { class: "gutter" }, []);
    var typebox = el("textarea", { rows: "1", class: "rg-typebox" }, []);
    var ghost = el("div", { class: "cs-ghost" }, []);
    var searchBtn = el("button", { class: "fieldbtn", type: "button", title: "Jump to a turn, or search the archive" }, ["⌒"]);
    var taWrap = el("div", { class: "tawrap" }, [gutter, typebox, ghost, searchBtn]);
    var taRow = el("div", { class: "frow" }, [taWrap]);
    var searchDrawer = el("div", { class: "frow searchrow" }, slots.searchExtra || []);

    /* ------- action row: the never-collapsing one. Send/Stop can never be collapsed away. ------ */
    var attachBtn = el("button", { type: "button", title: "Attach" }, ["📎"]);
    attachBtn.addEventListener("click", function () { call("attach"); });
    var linesChip = el("span", { class: "chip", title: "How long this prompt has become" }, ["1 line"]);
    var repoSel = el("select", { class: "sel", title: "Repository this conversation runs in" }, []);
    var wtSel = el("select", { class: "sel", title: "Worktree this conversation runs in" }, []);
    repoSel.addEventListener("change", function () { call("repo", repoSel.value); });
    wtSel.addEventListener("change", function () { call("worktree", wtSel.value); });
    var metaGroup = el("span", { class: "cs-meta" }, [repoSel, wtSel]);
    var histBtn = el("button", { type: "button", title: "Conversations in this repository" }, ["🕐"]);
    histBtn.addEventListener("click", function () { call("history"); });
    // Empty star when there are none; FILLED star + the count when there are. "Are there any, and
    // how many" is the question you ask BEFORE clicking, so the answer belongs on the button.
    var bmBtn = el("button", { type: "button" }, [el("span", {}, ["☆"])]);
    bmBtn.addEventListener("click", function () { call("bookmarks"); });
    var expandBtn = el("button", { type: "button", title: "How much of the conversation the type box may take" }, ["⇕ Full"]);
    var actionExtra = el("span", { class: "cs-inline" }, slots.actionExtra || []);
    var autoCb = el("input", { type: "checkbox" }, []);
    var autoLbl = el("label", { class: "autolbl", title: "Auto-continue: send the next prompt automatically when idle" }, [autoCb, "auto"]);
    var roundsEl = el("span", { class: "rounds" }, ["—"]);
    autoCb.addEventListener("change", function () { call("autoContinue", autoCb.checked); });
    var stopBtn = el("button", { class: "btn-stop", type: "button", title: "Stop the current response (keeps the conversation)" }, ["■ Stop"]);
    var sendBtn = el("button", { class: "btn-send", type: "button" }, ["Send"]);
    stopBtn.addEventListener("click", function () { call("stop"); });
    sendBtn.addEventListener("click", function () { submit(); });
    // Stop, Send and auto-continue are ONE bordered object: they are three halves of the same
    // decision about the turn in flight, not three unrelated buttons that happen to be adjacent.
    var sendGrp = el("div", { class: "sendgrp" }, [autoLbl, roundsEl, stopBtn, sendBtn]);

    /* ------- model row: collapse step 1, so nothing here may be load-bearing mid-turn ---------- */
    var modelSel = el("select", { class: "sel", title: "Model for this conversation" }, []);
    modelSel.addEventListener("change", function () { call("model", modelSel.value); });
    var modelNow = el("span", { class: "chip --far", title: "What is actually running right now" }, []);
    // The SDK's ModelInfo.supportedEffortLevels is exactly (low|medium|high|xhigh|max). There is no
    // "default" level — an invented entry there would map to nothing.
    var effortSel = el("select", { class: "sel", title: "Reasoning effort (low | medium | high | xhigh | max)" }, []);
    effortSel.addEventListener("change", function () { call("effort", effortSel.value); });
    // ULTRACODE is not an effort level — the SDK declares it as its own boolean ("xhigh effort plus
    // standing dynamic-workflow orchestration"). Listing it among the levels would misrepresent both
    // what it does and what it requires, so it is a checkbox that FORCES effort to xhigh.
    var ultraCb = el("input", { type: "checkbox", title: "Ultracode: xhigh effort + standing dynamic-workflow orchestration. Forces effort to xhigh." }, []);
    var ultraLbl = el("label", { class: "autolbl" }, [ultraCb, "ultracode"]);
    ultraCb.addEventListener("change", function () {
      effortSel.disabled = ultraCb.checked;
      if (ultraCb.checked) { effortSel.value = "xhigh"; call("effort", "xhigh"); }
      call("ultracode", ultraCb.checked);
    });
    var fastCb = el("input", { type: "checkbox" }, []);
    var fastLbl = el("label", { class: "autolbl" }, [fastCb, "fast"]);
    fastCb.addEventListener("change", function () { call("fast", fastCb.checked); });
    // Permission mode is the control most often changed in an agentic cockpit (Bypass is the working
    // default), and it is COLOURED when it is the dangerous one — read at a glance rather than by
    // opening the dropdown.
    var permSel = el("select", { class: "sel", title: "Permission mode for this conversation" }, []);
    permSel.addEventListener("change", function () { paintPerm(permSel.value); call("permission", permSel.value); });
    var ctxBtn = el("button", { class: "chip --acc", type: "button" }, ["—"]);
    ctxBtn.addEventListener("click", function () { call("context"); });
    var modelExtra = el("span", { class: "cs-inline" }, slots.modelExtra || []);
    // The wrap controls are a STACKED pair (see CS.stack): the auto-wrap tick and its meter say what
    // the window is doing on its own; Compact│Wrap are the two things you can do about it. `wrapWrap`
    // stays the handle a host shows/hides — it is now the stacked GROUP rather than a flat span, so
    // `els.wrapWrap` keeps meaning "the wrap controls" for anyone already holding it.
    var wrapTop = el("span", { class: "cs-inline" }, []);
    var wrapBot = el("span", { class: "cs-inline" }, []);
    var wrapWrap = CS.stack([wrapTop], [wrapBot]);

    // Exposed on `els` (below) because a host WILL need to put its own identity bits — Core's status
    // dot and repo label — beside the package's. That has to land inside the group, not loose in the
    // row: a bare row child cannot declare a side, and inserting against a group member from the row
    // throws outright now that rows are made of groups.
    var identityGroup = CS.grp([identitySlot, multiLabel]);

    /* ------- role substitution ------------------------------------------------------------------
     * A host whose control for one of these roles is genuinely richer than the package's — Pact's
     * worktree menu (bind / migrate / merge back), its routing-aware model picker, or its own
     * per-response bookmark popup — passes its OWN element for that role, and the package mounts it
     * AT THAT ROLE'S POSITION. The native element is then simply never mounted.
     *
     * This exists because the alternative was tried and is what you can see go wrong: mount the
     * native control, hide it with a class, and append the host's own copy to a TRAILING slot. The
     * row then reads in the wrong order (repo/branch after ⇕Full; the model picker after effort),
     * and the trailing slot wraps as one indivisible block, so a narrow pane collapses into ragged
     * part-empty rows instead of the Lab's tidy ones. A role belongs at its role's position. Pact's
     * bookmark star used to be exactly this anti-pattern one layer up: hidden here entirely
     * (`bookmarks: { shown: false }`) and re-appended in its OWN separate row above the compose box
     * — which is why that row existed at all. */
    function role(name, native) { return slots[name] || native; }

    /* ======================= ASSEMBLE — the shared three-region frame ==========================
     * Every row is built from LOGICAL GROUPS (CS.grp), not a flat list of controls with a spacer
     * somewhere in the middle. Each group declares the side of the row it belongs on, and
     * CS.alignRowGroups (run from layoutNow) then aligns them PER LINE — so a row that wraps to two
     * lines has left-hand groups packed left and right-hand groups packed right on BOTH lines,
     * instead of only on whichever line the single spacer happened to land on. A group also never
     * splits across a break: its members are one idea. */
    var frame = CS.buildShellFrame({
      headerClass: "rg-header", identityRowClass: "hrow --r1", statsRowClass: "hrow hright",
      footerClass: "rg-footer", actionRowClass: "frow", modelRowClass: "frow --modelbar",
      identityContent: [identityGroup, CS.grp([statusSlot, activityWrap, headExtra, savedChip, closeBtn])],
      // `composeExtra` sits between the package's own attachment/reply rows and the type box: the
      // slot for a host that already has its own attachment previews or reply chips (with their own
      // upload/render plumbing) and needs them in this exact position without handing that plumbing
      // over. Hosts with neither simply do not pass it.
      footerLeadContent: [seamBulb, attachErr, attachRow, replyRow]
        .concat(slots.composeExtra || []).concat([taRow, searchDrawer]),
      actionRowContent: [CS.grp([attachBtn, linesChip]),
                         CS.grp([role("meta", metaGroup)]),
                         CS.grp([histBtn, role("bookmarks", bmBtn), expandBtn, actionExtra]),
                         CS.grp([sendGrp])],
      // The context readout is NOT here any more — it moved to the header's stats row (see ctxGroup
      // below), where the same figure's neighbours already live and where there was spare width. On
      // the model row it was competing for the one line that also has to hold the model picker, the
      // effort controls and the permission mode, which pushed the auto-wrap meter and Compact│Wrap
      // onto a second line ("the compact wrap button is using extra vertical space, whereas the
      // header still has room").
      // THE MODEL ROW IS FOUR STACKED PAIRS (CS.stack — see its comment for the reasoning). Each pair
      // is a control over its own caption: the model you picked over the one actually running, the
      // effort level over the permission mode it runs under, ultracode over fast, the auto-wrap tick
      // and meter over the Compact│Wrap buttons acting on that same window. They are ordinary groups,
      // so they wrap and align by exactly the same captured-side rule every other row uses.
      modelRowContent: [CS.stack([role("modelPick", modelSel)], [role("modelNow", modelNow)]),
                        CS.stack([effortSel], [role("permission", permSel), modelExtra]),
                        CS.stack([ultraLbl], [fastLbl]),
                        wrapWrap],
      existingCore: opts.core || null, coreClass: "rg-core",
    });
    var core = frame.core;
    // THE CONTEXT READOUT LIVES IN THE HEADER, as its own right-hand group on the stats row — beside
    // the turn/size/compacted/wrapped figures it belongs with, rather than wedged into the model row
    // among the controls that CHANGE the conversation. (It is a readout, not a setting.)
    //
    // It is a STABLE node, created once, and it is the one thing in that row a repaint must not
    // rebuild: it carries a click handler, and both workspaces alias their own class onto it
    // (`.pc-usage`) and point the breakdown popover's anchor at it. buildStatsChips rebuilds the
    // rest of the row wholesale on every stats patch, so setState re-appends THIS node rather than
    // minting a new one — see the `stats` branch of setState.
    var ctxGroup = CS.grp([role("context", ctxBtn)]);
    if (frame.statsRow) frame.statsRow.appendChild(ctxGroup);
    host.classList.add("cs-shell");
    host.setAttribute("data-cs-kind", kind);
    host.replaceChildren(frame.header, core, frame.footer);
    // appendChild, not insertBefore: the core is empty at mount in every real caller (the Lab builds
    // a fresh one; Core and Pact both hand over a just-created container their own renderer has yet
    // to fill), so this IS the first child. Order matters — a sticky element pins relative to its own
    // position in the flow, so a medallion mounted last would only appear at the BOTTOM of the scroll.
    // Hosts that rebuild the core's children put it back at the head; see `els.coreTop`.
    core.appendChild(coreTop);
    show(coreTop, false);   // nothing above the window until a host says otherwise

    /* ======================= BEHAVIOUR ======================================================== */
    var state = { expanded: false, live: true, autoWrap: true, tokens: 0, ceiling: 1000000,
                  searchOpen: false, prevLevel: 0, suggest: "" };

    function submit() {
      // The host may veto (empty prompt, disconnected, still opening a session) by returning false —
      // in which case the text stays put rather than being silently eaten.
      if (call("send", typebox.value) === false) return;
      typebox.value = "";
      paintGhost();
      relayout();
    }
    typebox.addEventListener("input", function () {
      paintGhost();
      call("input", typebox.value);
      relayout(false);          // the box resizes; the header/footer rows cannot have changed
    });
    typebox.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); return; }
      // Tab accepts the ghost suggestion, but ONLY when the box is empty — it must never overwrite
      // what you were in the middle of typing.
      if (e.key === "Tab" && !typebox.value && state.suggest) {
        e.preventDefault();
        typebox.value = state.suggest;
        paintGhost();
        call("input", typebox.value);
        relayout();
      }
    });
    typebox.addEventListener("paste", function (e) { call("paste", e); });
    expandBtn.addEventListener("click", function () {
      state.expanded = !state.expanded;
      // The label is the ACTION the click performs, not the current state — as a status it left you
      // guessing what pressing it would actually do.
      txt(expandBtn, state.expanded ? "⇕ 40%" : "⇕ Full");
      call("expand", state.expanded);
      relayout();
    });
    searchBtn.addEventListener("click", function () {
      state.searchOpen = !state.searchOpen;
      show(searchDrawer, state.searchOpen);
      txt(searchBtn, state.searchOpen ? "✕" : "⌒");
      searchBtn.title = state.searchOpen ? "Hide the jump / recall bar" : "Jump to a turn, or search the archive";
      call("search", state.searchOpen);
      relayout();
    });
    // Drag-drop, paste and the clip button all funnel to host callbacks rather than three
    // near-identical internal paths, so an attachment lands in one place however it arrived.
    taRow.addEventListener("dragover", function (e) { e.preventDefault(); taRow.classList.add("cs-drag"); });
    taRow.addEventListener("dragleave", function () { taRow.classList.remove("cs-drag"); });
    taRow.addEventListener("drop", function (e) {
      e.preventDefault(); taRow.classList.remove("cs-drag");
      call("drop", e.dataTransfer && e.dataTransfer.files ? [].slice.call(e.dataTransfer.files) : []);
    });
    // Live/Held is OBSERVED from the real scroll position, never set as a mode. Clicking it only
    // ever means "take me back to live" — as a toggle it could claim Held while you sat at the
    // bottom, which is a lie about what the view is doing.
    core.addEventListener("scroll", function () {
      var atBottom = (core.scrollHeight - core.scrollTop - core.clientHeight) < 24;
      if (atBottom !== state.live) { state.live = atBottom; paintBulb(); call("live", atBottom); }
    });
    seamBulb.addEventListener("click", function () { core.scrollTop = core.scrollHeight; });

    // GHOST SUGGESTION. The overlay sits ON TOP of the textarea, so while it shows, the browser's own
    // placeholder renders underneath it and the two strings overlap into mush. Only one may be
    // visible: the ghost is the more useful, so it wins and the placeholder is suspended.
    function paintGhost() {
      var showGhost = !typebox.value && !!state.suggest;
      if (showGhost) {
        ghost.replaceChildren(doc.createTextNode(state.suggest + "  "), el("kbd", {}, ["Tab"]));
        if (typebox.placeholder) { typebox.dataset.ph = typebox.placeholder; typebox.placeholder = ""; }
      } else {
        ghost.replaceChildren();
        if (!typebox.placeholder && typebox.dataset.ph) typebox.placeholder = typebox.dataset.ph;
      }
    }

    function paintBulb() {
      seamBulb.classList.toggle("--live", state.live);
      seamBulb.classList.toggle("--held", !state.live);
      seamBulb.replaceChildren(el("i", {}, []), doc.createTextNode(state.live ? "Live" : "Held"));
      seamBulb.title = state.live
        ? "Live — following the newest turn. Click to hold your position."
        : "Held — your scroll position is pinned; new turns are arriving below. Click to jump back to live.";
    }
    // THE PERMISSION MODE IS COLOUR-CODED, and it paints whatever element actually OCCUPIES the role —
    // not the package's native select, which a host may have substituted its own control for.
    //
    // Measured live before this: the Lab showed `sel --danger` (red on #2a1114, 700 weight) while
    // BOTH workspaces showed a plain grey box on Bypass. Core carried the class `danger` (its own
    // spelling, which no rule in the package matches) and Pact's substituted select carried no state
    // class at all, because paintPerm was painting a native node Pact never mounts. Two hosts, two
    // private vocabularies, and the one control whose whole job is to look dangerous did not.
    var permNode = role("permission", permSel);
    function paintPerm(v) {
      permNode.classList.toggle("--danger", v === "bypassPermissions");
      permNode.classList.toggle("--plan", v === "plan");
      // Production's own long-standing spelling, kept in step so its existing rules (and the tests
      // keyed to them) still apply wherever a host has them.
      permNode.classList.toggle("danger", v === "bypassPermissions");
    }
    function paintWrap() {
      var wc = CS.buildWrapControls({
        autoWrap: state.autoWrap, tokens: state.tokens, ceiling: state.ceiling,
        onToggleAutoWrap: function (v) { state.autoWrap = v; call("autoWrap", v); },
        onCompact: function () { call("compact"); },
        onWrap: function () { call("wrap"); },
      });
      CS.fillWrapGroup(wrapWrap, wc);
    }

    /* ------- geometry: the ONE place the shell's heights are decided ---------------------------
     * Driven by chat-shell.js's pure maths from MEASURED input, never from CSS luck. Percentages
     * are of CORE's height — never the viewport, never the container — which is the rule two
     * separately hand-written implementations of this used to get differently wrong. */
    var LINE_H = 18, MIN_TYPE_H = LINE_H + 16, _raf = 0;
    // DOES THE ROW ALIGNMENT NEED REDOING? Measuring it is a WRITE-then-READ on every group, which
    // forces a synchronous layout — and layoutNow runs on every keystroke. Profiled on a real Core
    // pane: that one measure pass was 52% of all script time while typing, for an answer that cannot
    // have changed, because TYPING DOES NOT ALTER THE HEADER OR FOOTER ROWS. Only three things can:
    // a state change, a resize, and the compose box's own "N lines" chip changing width. So the pass
    // is gated on those, rather than run speculatively 60 times a second.
    var _alignDirty = true;
    function relayout(alsoAlign) {
      if (alsoAlign !== false) _alignDirty = true;
      if (_raf) return;
      _raf = (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
        _raf = 0; layoutNow();
      });
    }
    function layoutNow() {
      var n = typebox.value ? typebox.value.split("\n").length : 1;
      // The chip's TEXT is the one thing typing can change that affects the rows' own layout (its
      // width grows at "9 lines" -> "10 lines"), so a change here is what re-arms the alignment pass.
      // Writing the same string back every keystroke also dirtied layout for nothing.
      var linesLabel = n + (n === 1 ? " line" : " lines");
      if (linesLabel !== state._linesLabel) { state._linesLabel = linesLabel; txt(linesChip, linesLabel); _alignDirty = true; }
      typebox.style.height = "auto";
      typebox.style.overflowY = "hidden";
      var contentH = Math.max(MIN_TYPE_H, typebox.scrollHeight);
      var footerBaseH = frame.footer.offsetHeight - typebox.offsetHeight + MIN_TYPE_H;
      var r = CS.computeShell({
        shellH: host.clientHeight, headerH: frame.header.offsetHeight, footerBaseH: footerBaseH,
        contentH: contentH, minTypeH: MIN_TYPE_H, lineH: LINE_H,
        expanded: state.expanded, prevLevel: state.prevLevel,
        // A step that frees no row height must declare 0 rather than a plausible-looking number —
        // guessing here is what clipped the footer in the first implementation of this maths.
        steps: [{ id: "imageStrip", frees: attachRow.classList.contains("--gone") ? 0 : attachRow.offsetHeight },
                { id: "meta", frees: 0 }],
      });
      state.prevLevel = r.collapseLevel;
      state.geometry = r;
      typebox.style.height = r.typeH + "px";
      typebox.style.overflowY = r.typeScrolls ? "auto" : "hidden";
      CS.paintGutter(typebox, gutter);
      // PER-LINE GROUP ALIGNMENT. Which groups share a line is a fact about the CURRENT width, so it
      // can only be decided here, after layout — never in CSS, which has no way to ask "did this
      // item wrap?". Cheap (a handful of nodes per row) and stable: auto margins are treated as zero
      // when flex line-breaking is computed, so applying the plan cannot change the line breaks it
      // was computed from.
      // STACK ONLY WHEN IT IS NEEDED. The model row's pairs read best stacked when the row is tight,
      // and waste a whole row of height when it is not — a wide Core pane had room for everything on
      // one line and spent a second one anyway. Decided from the CONTROLS' widths (CS.fitStackedRow),
      // which are identical stacked or flat, so the decision cannot oscillate.
      //
      // It runs when the row's WIDTH changed, not only when state did: a resize is exactly the event
      // that flips it, and it carries no state patch. Re-aligning after it is required, because
      // unstacking changes which groups share a line.
      var mw = frame.modelRow ? frame.modelRow.clientWidth : 0;
      if (frame.modelRow && (mw !== state._modelRowW || _alignDirty)) {
        state._modelRowW = mw;
        var wasFlat = frame.modelRow.classList.contains("--flat");
        if (CS.fitStackedRow(frame.modelRow) !== wasFlat) _alignDirty = true;
      }
      if (_alignDirty) {
        _alignDirty = false;
        [frame.identityRow, frame.statsRow, frame.actionRow, frame.modelRow].forEach(function (r2) {
          if (r2) CS.alignRowGroups(r2);
        });
      }
      core.classList.toggle("--gone", r.coreHidden);
      // When Core has vanished there is no transcript to be live against, so the marker goes with it.
      show(seamBulb, !r.coreHidden);
      if (state.live && !r.coreHidden) core.scrollTop = core.scrollHeight;
      paintGhost();
      // The full geometry result is handed back so a host can render it (the design lab shows it as
      // a live readout) or assert on it — the maths is not a black box the host has to re-derive.
      call("layout", r);
    }
    var ro = root.ResizeObserver ? new root.ResizeObserver(function () { relayout(); }) : null;
    if (ro) ro.observe(host);

    function mkIdentityChip(c) {
      if (c && c.nodeType) return c;
      var o = typeof c === "string" ? { label: c } : (c || {});
      return el("span", { class: "chip " + (o.tone ? "--" + o.tone : "--acc"), title: o.title || o.label || "" },
                [(o.icon ? o.icon + " " : "") + (o.label == null ? "" : String(o.label))]);
    }

    /* ======================= setState — a PATCH, not a snapshot =============================== */
    function setState(s) {
      if (!s) return view;
      if ("identity" in s) {
        var id = s.identity;
        var chips = id == null || id === false ? [] : (Array.isArray(id) ? id : [id]).map(mkIdentityChip);
        identitySlot.replaceChildren.apply(identitySlot, chips);
      }
      if ("tabs" in s) {
        identitySlot.replaceChildren.apply(identitySlot, (s.tabs || []).map(function (t) {
          var inner = [String(t.label)];
          if (t.master) inner.unshift(el("span", { class: "star", title: "Master conversation" }, ["★"]));
          var tab = el("span", { class: "tab" + (t.active ? " --act" : ""), title: t.title || t.label }, inner);
          tab.addEventListener("click", function () { call("tab", t.id); });
          if (t.closable) {
            var x = el("button", { class: "rx", type: "button", title: "Close this conversation" }, ["✕"]);
            x.addEventListener("click", function (e) { e.stopPropagation(); call("tabClose", t.id); });
            tab.appendChild(x);
          }
          return tab;
        }));
      }
      if ("multiChat" in s) {
        var mc = s.multiChat || {};
        show(multiLabel, mc.shown !== false);
        multiCb.checked = !!mc.checked;
        multiLabel.title = mc.checked
          ? "Several conversations in this repository. They were always stored separately — this only stops merging them for display."
          : "One conversation per repository. Switch on to work on two things at once; nothing is created or split, the store already keeps them apart.";
      }
      // TRANSIENT STATUS IS A CHIP, NEVER ITS OWN ROW. A full-width row for "reconnecting..." costs
      // header height permanently to report something that is true for two seconds.
      if ("status" in s) {
        statusSlot.replaceChildren.apply(statusSlot, (s.status || []).map(function (c) {
          if (c && c.nodeType) return c;
          var chip = el(c.onClick ? "button" : "span",
            { class: "chip" + (c.tone ? " --" + c.tone : ""), title: c.title || "" }, [String(c.text)]);
          if (c.onClick) chip.addEventListener("click", c.onClick);
          return chip;
        }));
      }
      if ("saved" in s) { show(savedChip, !!s.saved); if (typeof s.saved === "string") txt(savedChip, s.saved); }
      if ("activity" in s) {
        var ac2 = s.activity;
        if (ac2 === false || ac2 == null) show(activityWrap, false);
        else {
          if (typeof ac2 === "string") ac2 = { text: ac2 };
          show(activityWrap, ac2.shown !== false);
          txt(activityChip, ac2.text == null ? "Idle" : String(ac2.text));
          // Tone rides as a modifier so the chip reads the same as every other chip in the row —
          // one vocabulary of chips, not a lookalike with its own colours.
          activityChip.className = "chip cs-activity" + (ac2.tone ? " --" + ac2.tone : "");
          activityChip.title = ac2.title || "What this conversation is doing right now — click for the full log";
        }
      }
      // The count says what it COUNTS, or it reads as an error rather than an affordance ("i dont
      // know what are those 7146 earlier turns"). `text` is the host's own phrasing of the number;
      // the framing around it belongs here so every surface words it identically.
      if ("earlier" in s) {
        var ea = s.earlier;
        if (!ea) show(coreTop, false);
        else {
          if (typeof ea === "number") ea = { text: ea + " earlier turns" };
          else if (typeof ea === "string") ea = { text: ea };
          show(coreTop, ea.shown !== false);
          txt(earlierBtn, (ea.loading ? "\u27f3 " : "\u25b2 ") + (ea.text == null ? "earlier turns" : String(ea.text))
                          + (ea.loading ? "  \u00b7  loading\u2026" : "  \u00b7  load earlier"));
          earlierBtn.disabled = !!ea.loading;
          earlierBtn.title = ea.title || ("This conversation is longer than what is rendered right now. These turns sit above "
            + "the top of the transcript \u2014 nothing is lost, they are stored and searchable. Click to load the next block into view.");
        }
      }
      if ("close" in s) {
        var cl = s.close;
        if (cl && typeof cl === "object") { show(closeBtn, cl.shown !== false); if (cl.title) closeBtn.title = cl.title; }
        else show(closeBtn, !!cl);
      }
      // The chip groups are rebuilt wholesale (they are pure functions of the numbers); the context
      // group is re-appended, never rebuilt — it is a live control with a handler and host aliases
      // on it, and `replaceChildren` would otherwise drop it on the first repaint after mount.
      if ("stats" in s) {
        if (!s.stats) frame.statsRow.replaceChildren(ctxGroup);
        else frame.statsRow.replaceChildren.apply(frame.statsRow, CS.buildStatsChips(s.stats).concat([ctxGroup]));
      }
      if ("attachments" in s) {
        var atts = s.attachments || [];
        show(attachRow, atts.length > 0);
        attachRow.replaceChildren.apply(attachRow, atts.map(function (a) {
          var chip = el("span", { class: "chip" }, a.node ? [] : ["🖼 " + a.label]);
          if (a.node) chip.appendChild(a.node);
          if (a.onRemove) {
            var x = el("button", { class: "rx", type: "button", title: "Remove" }, ["✕"]);
            x.addEventListener("click", a.onRemove);
            chip.appendChild(x);
          }
          return el("span", { class: "imgthumb" }, [chip]);
        }));
      }
      if ("attachError" in s) { show(attachErr, !!s.attachError); txt(attachErr.firstChild, s.attachError || ""); }
      // Pending reply references sit ABOVE the type box because they are part of the message you are
      // composing — and they carry their token cost, because quoting is not free.
      if ("replies" in s) {
        var refs = s.replies || [];
        show(replyRow, refs.length > 0);
        var chips2 = refs.map(function (ref, i) {
          var q = CS.replyQuote(ref);
          var c = el("span", { class: "replychip" + (q.archived ? " --arch" : ""),
            title: q.who + " · " + (q.archived ? "from the archive, not in the current window" : "in this window") + "\n\n" + q.text },
            [el("b", { class: q.kind === "R" ? "tR" : "tP" }, ["↩ " + q.label]),
             el("span", { class: "rq" }, [q.text])]);
          var x = el("button", { class: "rx", type: "button", title: "Remove this reference" }, ["✕"]);
          x.addEventListener("click", function () { call("replyRemove", i, ref); });
          c.appendChild(x);
          return c;
        });
        if (refs.length) {
          // "See exactly what will be sent" — a bare "R#219" would not be enough on the wire, because
          // absolute turn numbers are OUR addressing scheme and after a wrap the referenced turn may
          // not be in the window at all, so the reference carries the turn's own words with it. The
          // host renders the dialog (it owns its own dialog system); the package supplies the button
          // and the exact preamble text via CS.buildReplyPreamble.
          if (on.replyPreview) {
            var pv = el("button", { type: "button", title: "See exactly what will be sent" }, ["preview"]);
            pv.addEventListener("click", function () { call("replyPreview", refs, CS.buildReplyPreamble(refs)); });
            chips2.push(pv);
          }
          chips2.push(el("span", { class: "chip", title: "Quoting costs context — this is what these references will add to the prompt" },
            ["≈ " + CS.replyCost(refs).approxTokens.toLocaleString() + " tok"]));
        }
        replyRow.replaceChildren.apply(replyRow, chips2);
      }
      if ("compose" in s) {
        var cp = s.compose || {};
        if (typeof cp.value === "string" && cp.value !== typebox.value) typebox.value = cp.value;
        if (cp.placeholder != null) typebox.placeholder = cp.placeholder;
        if (cp.disabled != null) typebox.disabled = !!cp.disabled;
        if (cp.expanded != null && !!cp.expanded !== state.expanded) {
          state.expanded = !!cp.expanded;
          txt(expandBtn, state.expanded ? "⇕ 40%" : "⇕ Full");
        }
        if ("suggest" in cp) { state.suggest = cp.suggest || ""; paintGhost(); }
      }
      if ("repo" in s) { var rp = s.repo || {}; show(repoSel, rp.shown !== false); syncSelect(repoSel, rp.options, rp.value); }
      if ("worktree" in s) { var wt = s.worktree || {}; show(wtSel, wt.shown !== false); syncSelect(wtSel, wt.options, wt.value); }
      if ("history" in s) show(histBtn, s.history !== false);
      if ("attach" in s) show(attachBtn, s.attach !== false);
      if ("bookmarks" in s) {
        // `{ shown: false }` is how a host that already implements its own bookmark affordance turns
        // this one off, rather than hiding it from the outside in its own CSS.
        var bmv = s.bookmarks;
        if (bmv && typeof bmv === "object") { show(bmBtn, bmv.shown !== false); bmv = bmv.count; }
        var nb = nn(bmv, 0);
        bmBtn.classList.toggle("--on", nb > 0);
        bmBtn.title = nb ? nb + " bookmarked answer" + (nb === 1 ? "" : "s") + " — click to list"
                         : "No bookmarks yet — star an answer to add one";
        bmBtn.replaceChildren.apply(bmBtn, nb
          ? [el("span", {}, ["★"]), el("span", { class: "bmn" }, [String(nb)])]
          : [el("span", {}, ["☆"])]);
      }
      if ("autoContinue" in s) {
        var ac = s.autoContinue || {};
        show(autoLbl, ac.shown !== false);
        show(roundsEl, ac.shown !== false);
        autoCb.checked = !!ac.on;
        sendGrp.classList.toggle("--auto", !!ac.on);
        // THE COUNTDOWN BELONGS HERE, on the control that owns the loop — not in some other bar. A
        // ticker that lives away from its switch means the thing about to happen and the thing that
        // stops it are in two different places, and the switch reads as inert while it is counting.
        var secs = ac.in == null ? null : Math.max(0, Math.ceil(nn(ac.in, 0)));
        var rounds = nn(ac.n, 0) + "/" + nn(ac.max, 10);
        txt(roundsEl, !ac.on ? "—" : secs != null ? rounds + " · " + secs + "s" : rounds);
        roundsEl.classList.toggle("--arm", !!ac.on && secs != null);
        autoLbl.title = !ac.on
          ? "Auto-continue: send the next prompt automatically when idle"
          : (secs != null ? "Sending the next prompt in " + secs + "s. " : "")
            + "Round " + nn(ac.n, 0) + " of " + nn(ac.max, 10) + " in this batch"
            + (ac.note ? " — " + ac.note : "") + ". Untick to stop.";
      }
      if ("sending" in s) {
        var sd = s.sending || {};
        show(stopBtn, sd.stopShown !== false);
        stopBtn.disabled = !!sd.stopDisabled;
        // A pressed Stop must read as pressed: the engine's interrupt can take seconds, and without
        // an acknowledgement the click looks like it did nothing. The label and the dimmed state are
        // the shell's, not a host's, so both workspaces say the same thing.
        if ("stopLabel" in sd) txt(stopBtn, sd.stopLabel || "\u25a0 Stop");
        stopBtn.classList.toggle("--pending", !!sd.stopPending);
        stopBtn.classList.toggle("pc-stop--pending", !!sd.stopPending);   // production's own spelling, kept in step
        txt(sendBtn, sd.sendLabel || "Send");
        sendBtn.disabled = !!sd.sendDisabled;
        // WORK STATE. The Send button is the shell's loudest indicator: amber while a turn is
        // running, red for deep work (the visible turn ended but the agent is still producing), and
        // a blinking ring whenever ANY work is live — including background work while the chat
        // itself is idle, which is the case a host cannot signal any other way. Kept as one `state`
        // string rather than two booleans so "busy AND deep" can't be expressed: deep work IS busy,
        // and the old two-class encoding is exactly where production's red went missing.
        var st = sd.state === "deep" || sd.state === "busy" ? sd.state : null;
        sendBtn.classList.toggle("--busy", st === "busy");
        sendBtn.classList.toggle("--deep", st === "deep");
        sendBtn.classList.toggle("--pulse", "pulse" in sd ? !!sd.pulse : !!st);
      }
      if ("model" in s) {
        var m = s.model || {};
        show(modelSel, m.shown !== false);
        syncSelect(modelSel, m.options, m.value);
        if ("activeLabel" in m) { show(modelNow, !!m.activeLabel); txt(modelNow, m.activeLabel ? "· " + m.activeLabel : ""); }
      }
      if ("effort" in s) {
        var ef = s.effort || {};
        show(effortSel, ef.shown !== false);
        effortSel.disabled = !!ef.disabled;
        syncSelect(effortSel, ef.options, ef.value);
      }
      if ("ultracode" in s) { var uc = s.ultracode || {}; show(ultraLbl, uc.shown !== false); ultraCb.checked = !!uc.checked; }
      if ("fast" in s) { var ft = s.fast || {}; show(fastLbl, ft.shown !== false); fastCb.checked = !!ft.checked; }
      if ("permission" in s) {
        var pm = s.permission || {};
        show(permNode, pm.shown !== false);
        syncSelect(permSel, pm.options, pm.value);
        paintPerm(permSel.value);
      }
      // THE CEILING, SPELLED OUT. "16%" alone never said 16% of what — and this is the only context
      // figure in the shell, so it is also the way into the breakdown.
      if ("context" in s) {
        var cx = s.context || {};
        show(ctxBtn, cx.shown !== false);
        if (cx.tokens != null) {
          var tk = nn(cx.tokens, 0), cap = nn(cx.ceiling, 1000000);
          txt(ctxBtn, tk.toLocaleString() + " / " + cap.toLocaleString() + " tok · " + Math.round(tk / cap * 100) + "%");
          ctxBtn.title = "Context window: " + tk.toLocaleString() + " of " + cap.toLocaleString()
            + " tokens used — click for the breakdown";
        } else txt(ctxBtn, cx.text || "—");
      }
      if ("wrap" in s) {
        var wr = s.wrap || {};
        show(wrapWrap, wr.shown !== false);
        if (wr.autoWrap != null) state.autoWrap = !!wr.autoWrap;
        if (wr.tokens != null) state.tokens = nn(wr.tokens, 0);
        if (wr.ceiling != null) state.ceiling = nn(wr.ceiling, 1000000);
        paintWrap();
      }
      if ("live" in s && !!s.live !== state.live) { state.live = !!s.live; paintBulb(); }
      relayout();
      return view;
    }

    var view = {
      root: host, header: frame.header, identityRow: frame.identityRow, statsRow: frame.statsRow,
      core: core, footer: frame.footer, actionRow: frame.actionRow, modelRow: frame.modelRow,
      els: { typebox: typebox, gutter: gutter, ghost: ghost, taWrap: taWrap, taRow: taRow,
             coreTop: coreTop, earlierBtn: earlierBtn,
             searchDrawer: searchDrawer, searchBtn: searchBtn, seamBulb: seamBulb,
             attachBtn: attachBtn, attachRow: attachRow, replyRow: replyRow, linesChip: linesChip,
             repoSel: repoSel, wtSel: wtSel, metaGroup: metaGroup, historyBtn: histBtn,
             bookmarkBtn: bmBtn, expandBtn: expandBtn, sendBtn: sendBtn, stopBtn: stopBtn,
             sendGrp: sendGrp, modelSel: modelSel, modelNow: modelNow, effortSel: effortSel,
             ultracodeCb: ultraCb, fastCb: fastCb, permissionSel: permSel, contextBtn: ctxBtn,
             contextGroup: ctxGroup,
             wrapWrap: wrapWrap, wrapTop: wrapTop, wrapBot: wrapBot, headExtra: headExtra, actionExtra: actionExtra,
             modelExtra: modelExtra, identitySlot: identitySlot, identityGroup: identityGroup,
             statusSlot: statusSlot,
             savedChip: savedChip, multiChatCb: multiCb,
             activityChip: activityChip, activityWrap: activityWrap, closeBtn: closeBtn },
      setState: setState,
      relayout: relayout,
      submit: submit,
      focus: function () { typebox.focus(); },
      isLive: function () { return state.live; },
      geometry: function () { return state.geometry || null; },
      destroy: function () { if (ro) ro.disconnect(); host.replaceChildren(); host.classList.remove("cs-shell"); },
    };

    // First paint: the defaults that are true of every consumer, so a host that sets nothing still
    // gets a correct, complete chat box rather than a half-built one.
    setState({
      saved: false, status: [], multiChat: { shown: kind === "core", checked: false },
      permission: { options: [{ value: "default", label: "Default" }, { value: "acceptEdits", label: "Accept edits" },
                              { value: "plan", label: "Plan" }, { value: "bypassPermissions", label: "Bypass" }],
                    value: "default" },
      // The SDK's five levels, plus an explicit "no pick yet" entry. Without it, a host that has not
      // chosen a level passes "" — which matches no option, so the fallback in syncSelect selects the
      // FIRST one and the control silently claims "low". "Unset" and "low" are different answers.
      effort: { options: [{ value: "", label: "Default effort" }].concat(
                  ["low", "medium", "high", "xhigh", "max"].map(function (x) { return { value: x, label: "effort: " + x }; })),
                value: "" },
      wrap: { autoWrap: true, tokens: 0, ceiling: 1000000 },
      compose: { placeholder: "Message the agent… (⌘/Ctrl+Enter to send)" },
      context: {},
      model: { activeLabel: "" },
      // Both OFF unless the host asks for them: a shell with nothing to narrate must not show an
      // "Idle" chip forever, and a shell that is the only one on the page must not offer to close.
      activity: false, close: false,
    });
    show(searchDrawer, false);
    show(attachRow, false);
    show(attachErr, false);
    show(replyRow, false);
    paintBulb();
    return view;
  }

  var API = { mount: mount, version: "1.0.0" };
  if (typeof module === "object" && module.exports) module.exports = API;
  root.ChatShellUI = API;
})(typeof window !== "undefined" ? window : globalThis);
