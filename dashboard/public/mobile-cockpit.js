/* MOBILE COCKPIT — the Core workspace, rebuilt for a phone.
 *
 *   <link rel="stylesheet" href="/mobile-cockpit.css">
 *   <script src="/mobile-cockpit.js"></script>
 *
 *   const mc = MobileCockpit.mount(paneRoot, { transcript: view.core, on: { send(t) { ... } } });
 *   mc.setState({ title: "Claudstermind · Main", running: { model: "Opus 5" }, busy: false });
 *
 * Design: docs/work/mobile-cockpit/design.md. Reference implementation and the argument for every
 * decision here: dashboard/public/mobile-lab.html (live at /mobile-lab.html, pinned by
 * lib/mobileLab.test.mjs). Measured at 412x915 on the live dashboard, the pane header took 191px and
 * the footer 239px, leaving the CONVERSATION — the only thing you opened the app for — 284px, 31% of
 * the screen. The header and the footer stop being ROWS here and become SURFACES you open: what is
 * left on screen is one 40px head row, the transcript, and a three-strip footer.
 *
 * IT KNOWS NOTHING ABOUT CORE. Every number arrives through `setState`, every action leaves through
 * `opts.on.*`, and the transcript is the host's own element — this module never writes into it.
 * dashboard/public/app.js supplies the adapter. That is the same split the chat-shell package uses
 * (packages/claude-chat-shell/src/chat-shell-ui.js) and the reason that migration worked: there is
 * one implementation of each surface, so a change to it is a change everywhere it is used.
 *
 * NODES ARE BUILT ONCE AND PATCHED, never re-rendered. The lab re-renders the whole page on every
 * state change, which is free for a mock and fatal here: `setState` runs on every streamed token, and
 * rebuilding the compose row would take the caret out of the field mid-sentence. Surfaces that are
 * transient (sheets, overlays) are the exception — they are built when opened and dropped when closed,
 * because nothing in them holds a caret across a state change except their own search field, which
 * lives for as long as the surface does.
 */
(function (root) {
  "use strict";

  var doc = root && root.document;

  /* No `html:` escape hatch, unlike the package's `el`: everything this module renders is host data,
     and a module that can be handed markup by its host is one XSS away from a workspace. */
  function el(tag, attrs, kids) {
    var e = doc.createElement(tag);
    for (var k in (attrs || {})) {
      if (attrs[k] == null) continue;
      if (k === "class") e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      e.appendChild(typeof c === "string" ? doc.createTextNode(c) : c);
    });
    return e;
  }
  function txt(node, s) { if (node && node.textContent !== s) node.textContent = s; }
  /* Hiding is an inline `display`, not a class: mobile-cockpit.css is a port of the lab's stylesheet,
     which has no hiding vocabulary of its own, and inventing a `.--gone` here would put half of that
     vocabulary in a file the other half cannot see. Restoring "" gives the stylesheet its value back
     rather than pinning a `display` this module guessed. */
  function show(node, on) { if (node) node.style.display = on ? "" : "none"; }
  function nn(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function raf(fn) { return (root.requestAnimationFrame || function (f) { return root.setTimeout(f, 16); })(fn); }

  /* A tap that survives a scroll — the disambiguation Pact mobile already uses (app.js `onTap`). On a
     phone a touch that drifted more than 8px vertically was a SCROLL, and firing the click as well
     opens a panel every time you flick the transcript. */
  function onTap(node, fn, guard) {
    var moved = false, y0 = 0;
    node.addEventListener("click", function (e) { if (guard && !guard(e)) return; fn(e); });
    node.addEventListener("touchstart", function (e) { moved = false; y0 = e.touches[0] ? e.touches[0].clientY : 0; }, { passive: true });
    node.addEventListener("touchmove", function (e) { var y = e.touches[0] ? e.touches[0].clientY : y0; if (Math.abs(y - y0) > 8) moved = true; }, { passive: true });
    /* `guard` is consulted BEFORE preventDefault, not inside `fn`: on a delegated listener the
       preventDefault is what suppresses the synthetic click, so calling it for a tap this listener
       is going to ignore silently kills whatever the tap was actually for. */
    node.addEventListener("touchend", function (e) { if (moved) return; if (guard && !guard(e)) return; e.preventDefault(); fn(e); });
  }

  /* A pick is `{ value, label, options }` however the host spells it — a bare string is a value that
     is its own label. The wheels below settle on a VALUE and hand that back: the label is what a phone
     reads ("Bypass"), the value is what the engine takes ("bypassPermissions"), and the lab's wheel,
     which reported `textContent`, would have sent the wrong one of the two. */
  function normPick(v) {
    if (v == null) return { value: "", label: "", options: [] };
    if (typeof v === "string") return { value: v, label: v, options: [] };
    var options = (v.options || []).map(function (o) {
      return typeof o === "string" ? { value: o, label: o }
                                   : { value: String(o.value), label: String(o.label == null ? o.value : o.label) };
    });
    var value = v.value == null ? "" : String(v.value);
    var label = v.label != null ? String(v.label) : value;
    if (v.label == null) {
      for (var i = 0; i < options.length; i++) if (options[i].value === value) { label = options[i].label; break; }
    }
    return { value: value, label: label, options: options };
  }

  function mount(host, opts) {
    opts = opts || {};
    var on = opts.on || {};
    var slots = opts.slots || {};
    /* The host callback, or nothing at all. A cockpit whose host has not wired a surface yet must be
       inert rather than broken — the switch this ships behind is flipped surface by surface. */
    function call(name) {
      var fn = on[name];
      if (typeof fn !== "function") return undefined;
      return fn.apply(null, Array.prototype.slice.call(arguments, 1));
    }
    /* ROLE SUBSTITUTION, as the chat-shell package does it: a host whose control for a role is the
       real one — the package's own <select>, with every listener already on it — passes that node and
       it is mounted AT THAT ROLE'S POSITION, instead of the cockpit's native control. The alternative
       (mount both, hide one) is what puts two implementations of the same setting on one screen. */
    function roleOr(name, make) { return slots[name] || make(); }

    /* ======================= STATE =========================================================== *
     * Everything here arrives from the host except `panel` / `sheet` / `overlay` / `openTurn` /
     * `histScope`, which are what this surface is DOING — no host can know them and none needs to.
     * Nothing derived is stored: counts and percentages are functions, because two copies of one
     * number drift the moment one of the two paints. */
    var state = {
      title: "", star: false,
      connection: { text: "", tone: "ok", note: "" },
      running: { model: normPick(null), effort: normPick(null), permission: normPick(null),
                 ultracode: false, autoWrap: true, autoContinue: false },
      context: { tokens: 0, ceiling: 1000000, parts: [] },
      stats: [], agents: [], repos: [], history: [], marks: [],
      conversations: [],   // the threads of ONE repository
      chats: [],           // the chat BOXES, one per repository — see chatsSheet
      busy: false, sending: null, stick: true, multiChat: false, worktree: "",
      panel: null, sheet: null, overlay: null, histScope: "repo", openTurn: null,
    };
    var ctxPct = function () { return Math.round(nn(state.context.tokens, 0) / Math.max(1, nn(state.context.ceiling, 1000000)) * 100); };
    var activeConvo = function () {
      var list = state.conversations;
      for (var i = 0; i < list.length; i++) if (list[i].active) return list[i];
      return null;
    };
    /* The repository this chat box points at is a FACT ABOUT THE OPEN CONVERSATION, not a second
       field the host has to keep in step with it — one of the two would eventually be stale, and it
       would be the one the repository chooser highlights. */
    var repoNow = function () { var c = activeConvo(); return c ? String(c.repo || "") : ""; };
    var repoTail = function () { return repoNow().split("/").pop(); };
    var runningAgents = function () {
      return state.agents.filter(function (a) { return a.state === "run"; }).length;
    };

    /* ======================= HEAD BAR ======================================================== *
     * ONE row. Everything the pane header used to say lives behind the left rail now — except the
     * two things a reveal must never hide, because you cannot decide to open a panel about a state
     * you cannot see: whether this is connected, and how full the window is. */
    var titleEl = el("span", { class: "mc-ttl", title: "This conversation — tap for the chat's own panel" }, []);
    var connEl = el("span", { class: "mc-hmed" }, []);
    var noteEl = el("span", { class: "mc-hmed --ok --fade" }, []);
    var medBar = el("span", { class: "mc-meds" }, [connEl, noteEl]);
    var ctxFill = el("i", {}, []);
    var ctxNum = el("b", {}, []);
    var ctxMed = el("div", { class: "mc-ctx", title: "Context window — tap for the breakdown" },
                    [el("div", { class: "mc-bar" }, [ctxFill]), ctxNum]);
    var head = el("div", { class: "mc-head" }, [titleEl, medBar, ctxMed]);

    /* ======================= THE TRANSCRIPT ================================================== *
     * The host's own element, adopted rather than rebuilt: Core's transcript renderer holds a
     * reference to it, caches turn nodes inside it, and keys an untouched-prefix fast path on their
     * identity. Rebuilding it here would invalidate all of that on every mount. */
    var adopted = !!opts.transcript;
    var core = opts.transcript || el("div", {}, []);
    core.classList.add("mc-core");
    core.classList.add("rg-core");   // the package's scrollbar; there is exactly one design of it

    /* ======================= THE FOOTER, in three strips ===================================== */
    /* 3. THE TYPE BOX, FULL WIDTH. An attach button beside it is precisely what made the field
       narrow enough to be worth reporting. */
    var box = el("textarea", { class: "mc-box rg-typebox", rows: "1", placeholder: "Message Claude…" }, []);
    /* THE SEAM BULB. On the desktop this sits ON the boundary between the transcript and the footer
       (components.css .seambulb, top:-11px, zero flow height) — it belongs to the core's lower edge,
       which is the line it reports on. Same here: absolutely placed on the compose row's top border,
       so it costs the button row nothing and the right-hand group keeps the width it needs. */
    var bulb = el("span", { class: "mc-med" }, []);
    var compose = el("div", { class: "mc-compose" }, [bulb].concat(slots.composeExtra || []).concat([box]));

    /* 2. THE BUTTON ROW. NO ☰: on the desktop it opens the tree column, which on a phone IS the
       repository chooser — already one button away in the left pane, which is itself reachable from
       its rail and from the Chats riser. Three doors to one room, in a row where every slot is width
       taken from Send. Pact keeps its ☰ (app.js .pactm-cbar): there it moves between BOXES — tree,
       editor groups, REPL — which is navigation this pane has no equivalent of. */
    var attachBtn = el("button", { class: "mc-ico", type: "button", title: "Attach" }, ["📎"]);
    var autoBtn = el("div", { class: "mc-auto", title: "Auto-continue: send the next prompt automatically when idle" },
                     [el("div", { class: "mc-sw" }, [el("i", {}, [])]), "auto"]);
    /* Stop ALWAYS occupies its slot and switches enabled/disabled, exactly as it does on the desktop:
       a button that appears and vanishes makes Send jump sideways under your thumb the moment a turn
       starts or ends, which is how you press the wrong one. */
    var stopBtn = el("button", { class: "mc-stp", type: "button", title: "Stop the current response" }, ["■"]);
    var sendBtn = el("button", { class: "mc-snd", type: "button" }, ["➤"]);
    /* `slots.buttons` — extra HOST buttons at the left of the row, beside attach. Core needs none:
       everything its ☰ opened is reachable from the rails and the risers. PACT needs exactly one —
       its ☰ moves between BOXES (the file tree, the editor groups, the REPL), which this pane has no
       equivalent of, so dropping it from Core was never a reason to drop it there. A slot rather than
       a second row, because the row is the scarcest space on the screen. */
    var btnrow = el("div", { class: "mc-btnrow" }, (slots.buttons || []).concat(
      [attachBtn, el("div", { class: "mc-mid" }, []), autoBtn, stopBtn, sendBtn]));

    /* THE LOW ZONE — compose + buttons, and the rails hang off its TOP edge. That edge is the seam
       between the transcript and the footer, so a rail centred on it (translateY(-50%), the same
       trick the bulb uses) straddles the boundary rather than belonging to either side. AND THEY
       RESERVE NOTHING: the zone has no side padding for them, they are drawn OVER its corners — the
       type box's rounded ends and the gap beside the outermost button, the emptiest pixels on the
       screen. Reserving 24px a side was 48px taken from the field you type into, to protect two
       corners that had nothing in them. */
    var railL = el("div", { class: "mc-rail --l --arc", title: "This chat" },
                   [el("div", { class: "mc-grip" }, []), el("span", { class: "mc-rlbl" }, ["Chat"])]);
    var railRMark = el("div", { class: "mc-grip" }, []);
    var railR = el("div", { class: "mc-rail --r --arc", title: "This conversation" },
                   [railRMark, el("span", { class: "mc-rlbl" }, ["Stats"])]);
    var low = el("div", { class: "mc-low" }, [compose, btnrow, railL, railR]);

    /* 1. THE STRIP GLUED TO THE NAV. Its middle is a READOUT of what is RUNNING, never a selector:
       a strip saying "Opus 5" beside a dropdown saying "Opus 5" made the difference between the model
       you picked and the model answering you invisible. The selector lives in the sheet it pulls up. */
    var chatsTab = el("div", { class: "mc-riser", title: "Conversations" }, []);
    var marksTab = el("div", { class: "mc-riser --bm", title: "Marked turns" }, []);
    var runLabel = el("span", {}, []);   // a patch target held by reference; no rule keys off it
    var runMeta = el("em", {}, []);
    var runningTab = el("div", { class: "mc-running" }, [el("span", { class: "mc-pull" }, ["▲▲"]), runLabel, runMeta]);
    var risers = el("div", { class: "mc-risers" }, [chatsTab, runningTab, marksTab]);

    /* ======================= THE PRIMITIVES THE SURFACES ARE MADE OF ========================= */
    function section(title, kids) { return el("div", { class: "mc-sec" }, [el("b", {}, [title])].concat(kids.filter(Boolean))); }
    function row(label, meta, fn, on) {
      var r = el("div", { class: "mc-row" + (on ? " --on" : "") }, [el("span", {}, [label]), meta ? el("em", {}, [meta]) : null]);
      if (fn) onTap(r, fn);
      return r;
    }
    function toggle(label, isOn, fn) {
      var t = el("div", { class: "mc-tog" + (isOn ? " on" : "") }, [el("span", {}, [label]), el("div", { class: "mc-sw" }, [el("i", {}, [])])]);
      onTap(t, function () { fn(!isOn); });
      return t;
    }
    function btn(label, cls, fn) {
      var b = el("button", { class: "mc-btn" + (cls ? " " + cls : ""), type: "button" }, [label]);
      if (fn) onTap(b, fn);
      return b;
    }
    function btns(kids) { return el("div", { class: "mc-btns" }, kids.filter(Boolean)); }
    function closeX(fn) {
      var x = el("button", { class: "mc-px", type: "button", title: "Close" }, ["✕"]);
      onTap(x, fn);
      return x;
    }
    function meter(pct) { return el("div", { class: "mc-meter" }, [el("i", { style: "width:" + pct + "%" }, [])]); }
    function find(placeholder, paint) {
      var input = el("input", { type: "search", placeholder: placeholder, autocomplete: "off" }, []);
      var count = el("b", {}, [""]);
      input.addEventListener("input", paint);
      return { node: el("div", { class: "mc-find" }, [input, count]), input: input, count: count };
    }

    /* ======================= THE WHEEL ======================================================= *
     * The one mechanic here that is not already in the repo. A scroll-snap column with a fixed
     * selection band: whatever sits under the band is the value. Rows are 44px — a thumb — and the
     * column is masked at both ends so it reads as a dial rather than a list. A value you change ten
     * times a day deserves better than a native select popup with a 12px hit target.
     *
     * It settles on the option's VALUE, not on the text it shows. The lab reported `textContent`,
     * which is the label — "Bypass" where the engine takes "bypassPermissions" — and a host given the
     * label would set nothing while reporting success. A tap also commits IMMEDIATELY rather than
     * waiting for the smooth scroll it starts to settle: `scrollTo` fires no scroll event when the
     * row is already where it is going, so the tap that needed no movement was the tap that did
     * nothing. Commits are de-duplicated against the last value, so the settle after a tap — and a
     * drag that lands back where it started — sends nothing. */
    function wheel(label, pick, onPick) {
      var options = pick.options.length ? pick.options : [{ value: pick.value, label: pick.label }];
      var nodes = options.map(function (o) { return el("div", { class: "mc-opt" }, [o.label]); });
      var view = el("div", { class: "mc-view" }, [el("div", { class: "mc-pad" }, [])].concat(nodes, [el("div", { class: "mc-pad" }, [])]));
      var dial = el("div", { class: "mc-wheel" }, [el("b", {}, [label]), view, el("div", { class: "mc-band" }, [])]);
      var last = pick.value;
      var centreOn = function (n, smooth) {
        view.scrollTo({ top: n.offsetTop - (view.clientHeight - n.offsetHeight) / 2, behavior: smooth ? "smooth" : "auto" });
      };
      var nearest = function () {
        var mid = view.scrollTop + view.clientHeight / 2, best = 0, bd = 1e9;
        nodes.forEach(function (n, i) {
          var d = Math.abs(n.offsetTop + n.offsetHeight / 2 - mid);
          if (d < bd) { bd = d; best = i; }
        });
        return best;
      };
      var markOnly = function (i) { nodes.forEach(function (n, j) { n.classList.toggle("on", i === j); }); };
      var commit = function (i) {
        markOnly(i);
        if (options[i].value === last) return;
        last = options[i].value;
        onPick(last);
      };
      var settle = null;
      view.addEventListener("scroll", function () {
        var i = nearest();
        markOnly(i);
        root.clearTimeout(settle);
        settle = root.setTimeout(function () { commit(i); }, 90);
      }, { passive: true });
      nodes.forEach(function (n, i) { onTap(n, function () { centreOn(n, true); commit(i); }); });
      var start = 0;
      options.forEach(function (o, i) { if (o.value === pick.value) start = i; });
      markOnly(start);
      raf(function () { if (nodes[start]) centreOn(nodes[start], false); });
      return dial;
    }

    /* ======================= THE TWO EDGE PANES ============================================== *
     * The same slide + backdrop mechanic Pact mobile's drawer already uses (.pactm-drawer),
     * mirrored for the right edge. They are built once and their BODIES are repainted, because a
     * pane that is rebuilt loses the scroll position of the conversation list inside it every time
     * a token arrives. */
    var scrim = el("div", { class: "mc-scrim" }, []);
    function pane(side, title) {
      var body = el("div", { class: "mc-pbody rg-core" }, []);
      var node = el("div", { class: "mc-panel --" + side }, [
        el("div", { class: "mc-phd" }, [el("b", {}, [title]), closeX(function () { setPanel(null); })]), body]);
      return { node: node, body: body };
    }
    var paneL = pane("l", "This chat");
    var paneR = pane("r", "This conversation");

    /* `ws-mobile2` is the switch's own class and every rule in mobile-cockpit.css is scoped under it,
       so the stylesheet applies exactly where this is mounted and nowhere else — including on a
       desktop page that happens to have the file linked. */
    host.classList.add("ws-mobile2");
    host.classList.add("mc-root");
    /* NO WRAPPER. These four ARE the pane's rows, and the pane root is already the flex column that
       stacks them — the chat shell's own header / core / footer stack in exactly that place. A
       wrapper would need a `display:flex; flex-direction:column` rule of its own, and the stylesheet
       (ported from the lab, where the column was the mock's device frame) has none for it. */
    host.appendChild(head);
    host.appendChild(core);      // appendChild MOVES an adopted transcript into the cockpit's order
    host.appendChild(low);
    host.appendChild(risers);
    host.appendChild(scrim);
    host.appendChild(paneL.node);
    host.appendChild(paneR.node);

    /* ======================= BEHAVIOUR ======================================================= */
    function grow() {
      box.style.height = "40px";
      var cap = Math.round(0.40 * (host.clientHeight || 915));
      box.style.height = Math.min(box.scrollHeight, cap) + "px";
      /* PUSH, DON'T COVER: the core is the only flexing region, so a taller box shrinks it — but the
         transcript then has to be re-pinned or the bottom slides out of view, which is what reads as
         "it went over the chat". Only while the bulb says Live, though: re-pinning a transcript you
         deliberately scrolled up in is the same bug from the other side. */
      if (state.stick) core.scrollTop = core.scrollHeight;
    }
    box.addEventListener("input", function () { call("input", box.value); grow(); });
    function submit() {
      /* The host may veto — no session yet, socket down, empty prompt — by returning false, and then
         the text stays put instead of being silently eaten. */
      if (call("send", box.value) === false) return;
      box.value = "";
      grow();
    }
    onTap(sendBtn, submit);
    onTap(stopBtn, function () { if (state.busy) call("stop"); });
    onTap(attachBtn, function () { call("attach"); });
    onTap(autoBtn, function () { call("autoContinue", !state.running.autoContinue); });
    /* THE BULB IS THE SCROLL STATE, not the turn state: "Live" means the transcript is pinned to the
       bottom and new turns push into view, "Held" means you scrolled up and it is staying put.
       Tapping it goes back to the bottom — and tells the host, which owns whether it stays there. */
    onTap(bulb, function () { core.scrollTop = core.scrollHeight; call("jumpBottom"); });
    core.addEventListener("scroll", function () {
      var atEnd = core.scrollHeight - core.scrollTop - core.clientHeight < 24;
      if (atEnd !== state.stick) { state.stick = atEnd; paintBulb(); }
    }, { passive: true });
    onTap(railL, function () { setPanel("left"); });
    onTap(railR, function () { setPanel("right"); });
    onTap(scrim, function () { setPanel(null); });
    onTap(titleEl, function () { setPanel("left"); });
    onTap(medBar, function () { setPanel("left"); });   // the full sentence behind the state lives there
    onTap(ctxMed, function () { setOverlay("context"); });
    onTap(chatsTab, function () { setSheet("convos"); });
    onTap(marksTab, function () { setSheet("marks"); });
    onTap(runningTab, function () { setSheet("model"); });
    /* A REAL PULL, not only a tap — the gesture the ▲▲ promises. A strip that says it can be pulled
       and only answers to taps trains you to stop believing the arrow. */
    (function pullUp(node) {
      var y0 = null;
      node.addEventListener("touchstart", function (e) { y0 = e.touches[0] ? e.touches[0].clientY : null; }, { passive: true });
      node.addEventListener("touchmove", function (e) {
        if (y0 == null) return;
        var y = e.touches[0] ? e.touches[0].clientY : y0;
        if (y0 - y > 24) { y0 = null; setSheet("model"); }
      }, { passive: true });
    })(runningTab);

    /* ======================= PER-BUBBLE ACTIONS ============================================== *
     * Copy, reply, share, star — one tap away instead of four buttons on every bubble, which is
     * ~30px times every turn on a phone. Tapping a bubble opens ITS row and closes whichever was
     * open before.
     *
     * The turns are the HOST's nodes: Core renders the transcript, caches turn containers and keys
     * an untouched-prefix fast path on their identity, so the cockpit never builds one. It is given
     * the region and a way to ask which turn a tap landed on — `opts.turnAt(target)` returning
     * `{ node, address }`, or, by default, the nearest ancestor carrying `data-mc-turn`. Every
     * button then leaves through its callback with that address, because the clipboard, the reply
     * quote and the mark all belong to the host and none of them can find a turn it was not told
     * about. */
    var turnAt = typeof opts.turnAt === "function" ? opts.turnAt : function (node) {
      for (var n = node; n && n !== core; n = n.parentNode) {
        var a = n.getAttribute && n.getAttribute("data-mc-turn");
        if (a) return { node: n, address: String(a) };
      }
      return null;
    };
    /* A mark's identity is the ADDRESS of the turn it was made on, not the handle the host uses to
       find it again — those became two different fields the moment `at` turned out to be a timestamp.
       Compared with punctuation stripped so "R#7,281" and "R7281" are the same turn, because the host
       formats for a reader and the transcript stamps for a machine. */
    var markAddr = function (v) { return String(v == null ? "" : v).replace(/[^A-Za-z0-9]/g, ""); };
    var isMarked = function (addr) {
      var a = markAddr(addr);
      return state.marks.some(function (m) { return markAddr(m.addr || m.note || m.at) === a; });
    };
    var openTurnNode = null, actsNode = null;
    function tapTarget(e) {
      var target = e && e.target;
      if (!target) return null;
      var t = turnAt(target);
      if (!t) return null;
      /* Core renders its OWN controls inside a bubble — the ⧉ copy button, the ★ bookmark, tool-call
         disclosures — and this row's four buttons live in there too. One delegated listener over the
         whole transcript would swallow every one of them, and on touch worse than swallow: the
         preventDefault that suppresses this listener's synthetic click suppresses theirs as well. */
      for (var n = target; n && n !== t.node; n = n.parentNode) {
        var tag = String(n.tagName || "").toLowerCase();
        if (tag === "button" || tag === "a" || tag === "input" || tag === "select" || tag === "textarea" || tag === "summary") return null;
      }
      return t;
    }
    function closeActs() {
      if (actsNode) actsNode.remove();
      actsNode = null; openTurnNode = null; state.openTurn = null;
    }
    function paintActs() {
      if (!openTurnNode) return;
      var addr = state.openTurn;
      var act = function (label, title, name, on) {
        var b = el("button", { class: "mc-act" + (on ? " --on" : ""), type: "button", title: title }, [label]);
        onTap(b, function () { call(name, addr); });
        return b;
      };
      var next = el("div", { class: "mc-acts" }, [
        /* copy is the one this exists for — showing another agent what this one said — so it is first. */
        act("⧉", "Copy this turn", "copyTurn"),
        act("↩", "Reply to this turn", "replyTurn"),
        act("⤴", "Share — hand this turn to another agent as " + addr, "shareTurn"),
        /* The star reports the host's marks, not its own memory: it writes a mark server-side, and a
           locally toggled star would claim one that may never have been written — against a riser
           that selects between the marks that were. */
        act("★", "Mark this turn", "starTurn", isMarked(addr))]);
      if (actsNode) actsNode.remove();
      actsNode = next;
      openTurnNode.appendChild(next);
    }
    var tapped = null;
    onTap(core, function () {
      var t = tapped;
      tapped = null;
      if (!t) return;
      var same = openTurnNode === t.node;
      closeActs();
      if (same) return;
      openTurnNode = t.node;
      state.openTurn = t.address;
      paintActs();
    }, function (e) { tapped = tapTarget(e); return !!tapped; });

    /* Which surface is open is a mode, and only one of them may be — a sheet over a pane leaves two
       dismissal targets stacked and neither of them where your thumb is. */
    function setPanel(which) {
      state.panel = which;
      paneL.node.classList.toggle("open", which === "left");
      paneR.node.classList.toggle("open", which === "right");
      scrim.classList.toggle("on", !!which);
      if (which === "left") paintPaneL();
      if (which === "right") paintPaneR();
    }
    function setOverlay(which) {
      state.overlay = which;
      if (overlayNode) { overlayNode.remove(); overlayNode = null; }
      if (!which) return;
      setPanel(null);
      overlayNode = buildOverlay(which);
      if (overlayNode) host.appendChild(overlayNode); else state.overlay = null;
    }
    var overlayNode = null, sheetNode = null;
    function setSheet(which) {
      state.sheet = which;
      if (sheetNode) { sheetNode.remove(); sheetNode = null; }
      if (!which) return;
      setPanel(null);
      sheetNode = buildSheet(which);
      if (sheetNode) host.appendChild(sheetNode); else state.sheet = null;
    }
    /* A sheet is Pact mobile's primitive (openSheet/closeSheet): a panel anchored to the bottom over
       a backdrop, dismissed by the grip, the ✕ or the backdrop. Nothing here re-invents that shape. */
    function sheet(title, kids) {
      var back = el("div", { class: "mc-sheet-back" }, []);
      onTap(back, function () { setSheet(null); });
      return el("div", { class: "mc-sheet" }, [back, el("div", { class: "mc-sheet-panel" }, [
        el("div", { class: "mc-sheet-grip" }, []),
        el("div", { class: "mc-sheet-hd" }, [el("b", {}, [title]), closeX(function () { setSheet(null); })]),
        el("div", { class: "mc-sheet-body rg-core" }, kids)])]);
    }
    /* THE MODEL SHEET — four zones, in this order, and nothing else: the two selectors that decide
       the answer, the permission that decides what it may do, the two switches that belong to those,
       and the window it all runs in. No auto-continue (it belongs beside Send, where the turn it
       continues is) and no Full / Star / History — those are pane furniture, not things you tell the
       agent, and grouping them here teaches that they are. */
    function modelSheet() {
      var r = state.running;
      return sheet("Model", [
        section("Model and effort", [el("div", { class: "mc-wheels" }, [
          roleOr("model", function () { return wheel("Model", r.model, function (v) { call("model", v); }); }),
          roleOr("effort", function () { return wheel("Effort", r.effort, function (v) { call("effort", v); }); })])]),
        section("Permission", [el("div", { class: "mc-wheels" }, [
          roleOr("permission", function () { return wheel("Mode", r.permission, function (v) { call("permission", v); }); })])]),
        section("Switches", [
          roleOr("ultracode", function () { return toggle("ultracode", r.ultracode, function (v) { call("ultracode", v); }); }),
          roleOr("autoWrap", function () { return toggle("auto-wrap", r.autoWrap, function (v) { call("autoWrap", v); }); })]),
        section("Window", [
          meter(ctxPct()),
          roleOr("context", function () {
            return row("Context", nn(state.context.tokens, 0).toLocaleString() + " / "
                       + nn(state.context.ceiling, 1000000).toLocaleString() + " · " + ctxPct() + "%",
                       function () { setSheet(null); setOverlay("context"); });
          }),
          roleOr("wrap", function () {
            return btns([btn("🗜 Compact", "", function () { call("compact"); }),
                         btn("↺ Wrap", "--acc", function () { call("wrap"); })]);
          })])
      ]);
    }
    /* CHATS ARE NOT CONVERSATIONS, and this sheet used to render the wrong one of the two.
     *   A CHAT is a whole chat box — one per repository, several open at once. This sheet, and the
     *     "Chats N" tab that opens it, count and switch between THOSE.
     *   A CONVERSATION is one of several threads inside a single repository (the ★ main and any
     *     others multi-chat has added). Those live in the left pane, under the repository they
     *     belong to.
     * Rendering `state.conversations` here made "Chats 1" while two chat boxes were open — it was
     * counting the threads of one repository and calling them chats. */
    function chatsSheet() {
      return sheet("Chats", [
        section("Open chat boxes", (state.chats.length ? state.chats : []).map(function (c) {
          return row((c.star ? "★ " : "") + (c.name || c.id), c.sub || "",
                     function () { setSheet(null); call("pickChat", c.id); }, !!c.active);
        }).concat([btns([btn("＋ New chat", "--acc", function () { call("newChat"); })])]))
      ]);
    }
    /* Marks are made ON turns — that is what makes each row an address rather than a label. */
    function marksSheet() {
      return sheet("Marks", [
        /* A mark's POINT is that it takes you back to the turn. Rendered as the turn's address with
           its first line underneath, and tapping one asks the host to scroll there — a row that shows
           a raw timestamp and does nothing is a worse answer than no list at all. */
        section("Marked turns", state.marks.length
          ? state.marks.map(function (m) {
              return row(String(m.note || "marked"), String(m.text || ""),
                         function () { setSheet(null); call("pickMark", m.at); });
            })
          : [row("No marks yet — star a turn to make one")])
      ]);
    }
    function buildSheet(which) {
      if (which === "model") return modelSheet();
      if (which === "convos") return chatsSheet();
      if (which === "marks") return marksSheet();
      return null;
    }
    /* A full page, not a popover: these are the readouts you open to STUDY — a breakdown, thirty
       repositories, an archive — and a popover on a phone is a postage stamp with a scrollbar. */
    function overlay(title, kids) {
      return el("div", { class: "mc-over" }, [
        el("div", { class: "mc-over-hd" }, [el("b", {}, [title]), closeX(function () { setOverlay(null); })]),
        el("div", { class: "mc-over-body rg-core" }, kids)]);
    }
    /* THE CONTEXT BREAKDOWN. A context window is not one number, it is a stack, and "21%" tells you
       there is a problem and nothing about what is causing it. Shares are of the CEILING, so they
       read against the same 100% the header medallion shows, and the free space is a row of its own
       — a breakdown that omits what is left does not add up to a window. */
    function contextOverlay() {
      var ceiling = Math.max(1, nn(state.context.ceiling, 1000000));
      var parts = (state.context.parts || []).map(function (p) {
        return { name: String(p.name || ""), tokens: nn(p.tokens, 0), colour: p.colour || p.col || "var(--accent)" };
      });
      var total = parts.reduce(function (a, p) { return a + p.tokens; }, 0);
      var free = Math.max(0, ceiling - total);
      var pct = function (t) { return Math.round(t / ceiling * 1000) / 10; };
      var ctxRow = function (name, tokens, colour) {
        return el("div", { class: "mc-ctxrow" }, [el("u", { style: "background:" + colour }, []),
          el("span", {}, [name]), el("em", {}, [tokens.toLocaleString() + " · " + pct(tokens) + "%"])]);
      };
      return overlay("Context breakdown", [
        section(total.toLocaleString() + " of " + ceiling.toLocaleString() + " tokens · " + pct(total) + "%",
          [el("div", { class: "mc-ctxbar" }, parts.map(function (p) {
            return el("i", { style: "width:" + pct(p.tokens) + "%;background:" + p.colour }, []);
          }))]),
        section("What is in the window", parts.map(function (p) { return ctxRow(p.name, p.tokens, p.colour); })
          .concat([ctxRow("Free", free, "var(--line)")])),
        section("What would change it", [btns([
          btn("🗜 Compact", "", function () { call("compact"); }),
          btn("↺ Wrap", "--acc", function () { call("wrap"); })])])
      ]);
    }
    /* THE REPOSITORY CHOOSER — grouped by ORGANISATION exactly as the Overview groups them, because
       that grouping is how this workspace is actually organised and a phone has no room to invent a
       second one. The field FILTERS rather than searches-and-jumps: it narrows the same grouped list
       in place, so the grouping you are learning to read stays put, and an organisation with no match
       disappears rather than showing an empty card. */
    function orgsOf(repos) {
      var order = [], by = {};
      repos.forEach(function (r) {
        var name = String(r.org || "Other");
        if (!by[name]) { by[name] = { name: name, scope: r.scope || "", colour: r.colour || r.col || "var(--line)", repos: [] }; order.push(by[name]); }
        by[name].repos.push(r);
      });
      return order;
    }
    function repoOverlay() {
      var body = el("div", { class: "mc-over-body rg-core" }, []);
      var f = find("Filter repositories…", function () { paint(); });
      function paint() {
        var q = String(f.input.value || "").trim().toLowerCase();
        var shown = 0;
        var cards = orgsOf(state.repos).map(function (o) {
          var hits = o.repos.filter(function (r) {
            return !q || (o.name + " " + r.name + " " + r.path + " " + (r.kind || "")).toLowerCase().indexOf(q) >= 0;
          });
          shown += hits.length;
          if (!hits.length) return null;
          return el("div", { class: "mc-org" }, [
            el("div", { class: "mc-org-hd" }, [el("i", { style: "background:" + o.colour }, []),
              el("b", {}, [o.name]), el("em", {}, [o.scope])]),
            el("div", { class: "mc-org-body" }, hits.map(function (r) {
              var node = el("div", { class: "mc-repo" + (r.path === repoNow() ? " --on" : "") },
                [el("span", {}, [String(r.name || r.path)]), el("u", { class: "mc-kind --" + (r.kind || "") }, [String(r.kind || "")])]);
              onTap(node, function () { setOverlay(null); call("pickRepo", r.path); });
              return node;
            }))]);
        }).filter(Boolean);
        txt(f.count, shown + " of " + state.repos.length);
        body.replaceChildren.apply(body, cards.length ? cards
          : [row("Nothing matches “" + q + "”.")]);
      }
      paint();
      return el("div", { class: "mc-over" }, [
        el("div", { class: "mc-over-hd" }, [el("b", {}, ["Repositories"]), closeX(function () { setOverlay(null); })]),
        f.node, body]);
    }
    /* HISTORY — every conversation that has ever existed, which is a different question from "which
       of this repository's conversations do I want open" (that is the left pane). It is its own page
       because it carries what a list of open chats does not: a search, a SCOPE (this repository or
       all of them), and the difference between OPEN and RESUME — a conversation whose worktree is
       gone can still be resumed, and has to say so before you pick it rather than after it fails. */
    function historyOverlay() {
      var body = el("div", { class: "mc-over-body rg-core" }, []);
      var f = find("Search conversations and archived turns…", function () { paint(); });
      function scopeBtn(label, scope) {
        return btn(label, state.histScope === scope ? "--acc" : "", function () { state.histScope = scope; paint(); });
      }
      function paint() {
        var q = String(f.input.value || "").trim().toLowerCase();
        var rows = state.history.filter(function (h) {
          if (state.histScope === "repo" && String(h.repo || "") !== repoNow()) return false;
          return !q || (String(h.name || "") + " " + String(h.first || "") + " " + String(h.repo || "")).toLowerCase().indexOf(q) >= 0;
        });
        txt(f.count, rows.length + " of " + state.history.length);
        body.replaceChildren(
          btns([scopeBtn("This repository", "repo"), scopeBtn("All repositories", "all")]),
          el("div", { class: "mc-sec" }, rows.length ? rows.map(function (h) {
            return el("div", { class: "mc-hist" + (h.gone ? " --gone" : "") }, [
              el("div", { class: "mc-hist-1" }, [el("span", {}, [String(h.name || h.id)]), el("em", {}, [String(h.when || "")])]),
              el("div", { class: "mc-hist-2" }, [String(h.first || "")]),
              h.gone ? el("div", { class: "mc-hist-warn" }, ["⚠ worktree removed — Resume recreates it"]) : null,
              btns([btn(h.gone ? "Open read-only" : "Open", "", function () { setOverlay(null); call("openConversation", h.id); }),
                    btn("Resume here", "--acc", function () { setOverlay(null); call("resumeConversation", h.id); })])
            ].filter(Boolean));
          }) : [row("Nothing matches.")]));
      }
      paint();
      return el("div", { class: "mc-over" }, [
        el("div", { class: "mc-over-hd" }, [el("b", {}, ["History"]), closeX(function () { setOverlay(null); })]),
        f.node, body]);
    }
    function buildOverlay(which) {
      if (which === "context") return contextOverlay();
      if (which === "repos") return repoOverlay();
      if (which === "history") return historyOverlay();
      return null;
    }

    /* ======================= THE LEFT PANE — this chat ======================================= *
     * The chat box's controls in the two levels the model actually has: this box points at a
     * REPOSITORY, and a repository can hold several CONVERSATIONS, each with its own workspace. The
     * same arrangement as the desktop cockpit — repo, then conversation, then worktree — stacked
     * instead of laid out in a row. */
    function paintPaneL() {
      var mine = state.conversations.filter(function (c) { return String(c.repo || "") === repoNow(); });
      /* ONE conversation until you ask for more. A repository MEANS its ★ main conversation;
         multi-chat is the switch that says "I want more than one open here", and only then is there a
         list to pick from or add to. An empty list and a ＋ under a switch that is off invites the
         question "what are these for". */
      var visible = state.multiChat ? mine : mine.filter(function (c) { return c.star || c.active; });
      var list = el("div", { class: "mc-list rg-core" }, visible.map(function (c) {
        return row((c.star ? "★ " : "") + (c.name || c.id), [c.worktree, c.sub].filter(Boolean).join(" · "),
                   function () { call("pickConversation", c.id); }, !!c.active);
      }));
      var active = activeConvo();
      paneL.body.replaceChildren(
        /* ONE repository and ONE button to change it: a list of thirty repositories is not a section
           of a panel, it is its own page, grouped the way the Overview groups them. */
        section("1 · Repository", [
          row(repoNow() || "No repository", "current", null, true),
          btns([btn("⇄ Change repository", "--acc", function () { setOverlay("repos"); })])]),
        section("2 · Conversations in " + (repoTail() || "this repository"), [
          list,
          toggle("multi-chat — more than one at once", state.multiChat, function (v) { call("multiChat", v); }),
          state.multiChat ? btns([
            btn("＋ Add conversation", "--acc", function () { call("newConversation"); }),
            btn("★ Make main", "", function () { call("makeMain", active ? active.id : null); })]) : null]),
        section("History", [
          /* Every conversation that has ever existed is a different question from "which of this
             repository's conversations do I want open", so it is its own page — and the host is asked
             for it as the page opens, because the cockpit keeps no archive. */
          row("🕐 All conversations", state.history.length + " · searchable", function () {
            call("openHistory");
            setOverlay("history");
          })]),
        section("Workspace for this conversation", [
          row("Workspace", (state.worktree || "—") + "  ⌄", function () { call("pickWorktree"); }),
          btns([btn("Select worktree", "", function () { call("pickWorktree"); })])])
      );
    }

    /* ======================= THE RIGHT PANE — this conversation ============================== *
     * What this conversation has COST: the chips that used to sit in the pane header, the context
     * meter, and the agents running underneath it. All three are readouts you consult; none of them
     * is something you set, which is why they are together and why the things you SET moved to the
     * model sheet. */
    function paintPaneR() {
      var running = runningAgents();
      paneR.body.replaceChildren(
        /* The host's OWN chips, re-homed. Rebuilding them here would be a second implementation of a
           row the package already renders, and the two would drift on the first change to either. */
        section("Size and ceilings", [el("div", { class: "mc-chips" }, state.stats)]),
        section("Context", [
          meter(ctxPct()),
          row("Breakdown", nn(state.context.tokens, 0).toLocaleString() + " · " + ctxPct() + "%",
              function () { setOverlay("context"); })]),
        section("Agents · " + running + " running, " + (state.agents.length - running) + " done",
          state.agents.map(function (a) {
            return el("div", { class: "mc-agent --" + (a.state === "run" ? "run" : "done") },
                      [el("i", {}, []), el("span", {}, [String(a.name || "")]), el("em", {}, [String(a.meta || "")])]);
          }))
      );
    }

    /* ======================= PAINT =========================================================== */
    var NOTE_MS = 6000, noteTimer = null;
    function paintHead() {
      txt(titleEl, (state.star ? "★ " : "") + (state.title || "This conversation"));
      var tone = state.connection.tone;
      connEl.className = "mc-hmed" + (tone && tone !== "ok" ? " --" + tone : "");
      connEl.replaceChildren(el("i", {}, []), doc.createTextNode(state.connection.text || ""));
      /* A RECONNECTION IS AN EVENT, not a state: it says so in words and then leaves. A permanent ↻
         reads as a reload button — it was read as one — and a thing that has finished happening does
         not deserve a chip forever. The clearing is the cockpit's, not the host's: a host that pushes
         the notice and forgets to retract it is exactly how the chip became furniture the first time. */
      txt(noteEl, state.connection.note || "");
      show(noteEl, !!state.connection.note);
      root.clearTimeout(noteTimer);
      if (state.connection.note) noteTimer = root.setTimeout(function () {
        state.connection.note = "";
        txt(noteEl, "");
        show(noteEl, false);
      }, NOTE_MS);
      ctxFill.style.width = ctxPct() + "%";
      txt(ctxNum, ctxPct() + "%");
    }
    function paintBulb() {
      bulb.className = "mc-med" + (state.stick ? "" : " --held");
      bulb.replaceChildren(el("i", {}, []), doc.createTextNode(state.stick ? "⇣ Live" : "⏸ Held"));
      bulb.title = state.stick ? "Live — following the newest turn." : "Held — tap to jump back to the newest turn.";
    }
    function paintButtons() {
      /* Auto-continue is a state, and the host owns it: the toggle asks, and shows what came back. A
         button that flipped its own class would claim an armed loop the host never started. */
      autoBtn.classList.toggle("on", state.running.autoContinue);
      /* SEND AND STOP ARE THE SHARED DECISION, not a local reading of `busy`. The desktop paints them
         from ChatShell.sendPresentation — amber while a turn runs, RED for deep work, a pulsing ring
         when a backgrounded agent is still going, "Stopping…" the moment Stop is pressed. This
         painted `busy ? amber : accent` and nothing else, so on a phone the same session showed a
         plain Send button while the desktop showed deep work: "they seem not to be wired on the same
         thing". They are now — the host passes the presentation through, and `busy` remains only as
         the fallback for a host that has no such function. */
      var pres = state.sending || {};
      var mode = pres.state || (state.busy ? "busy" : "idle");
      var running = mode === "busy" || mode === "deep";
      stopBtn.disabled = pres.stopDisabled != null ? !!pres.stopDisabled : !running;
      stopBtn.setAttribute("aria-disabled", stopBtn.disabled ? "true" : "false");
      stopBtn.className = "mc-stp" + (pres.stopPending ? " --pending" : "");
      txt(stopBtn, pres.stopLabel || "■");
      sendBtn.className = "mc-snd" + (mode === "deep" ? " --deep" : mode === "busy" ? " --busy" : "")
        + (pres.pulse ? " --pulse" : "");
      txt(sendBtn, pres.sendLabel || (running ? "…" : "➤"));
      railR.className = "mc-rail --r --arc" + (runningAgents() ? " --busy" : "");
      if (runningAgents()) {
        railRMark.className = "mc-rail-n";
        txt(railRMark, String(runningAgents()));
      } else {
        railRMark.className = "mc-grip";
        txt(railRMark, "");
      }
    }
    var lastFit = "";
    function paintRisers() {
      var chats = "💬 Chats " + state.chats.length, marks = "★ Marks " + state.marks.length;
      txt(chatsTab, chats);
      txt(marksTab, marks);
      var r = state.running;
      txt(runLabel, r.model.label || "—");
      txt(runMeta, " · " + String(r.effort.label || "").replace(" effort", "") + " · " + (r.permission.label || ""));
      /* Re-measured only when a LABEL changed. `setState` runs on every streamed token, and fitRisers
         is a write-then-read on both tabs — a forced synchronous layout, sixty times a second, for an
         answer that cannot have changed. The chat-shell package profiled exactly this pass at 52% of
         all script time while typing before it gated it the same way. */
      if (chats + "\u0001" + marks !== lastFit) { lastFit = chats + "\u0001" + marks; raf(fitRisers); }
    }
    /* BOTH RISERS TO THE SAME WIDTH, and that width to the wider of their two natural widths —
       measured after the labels exist, because a label's width is a fact about the font and the
       count in it, not a number to pick. Everything left over is the readout's, because that is the
       one with something to say. */
    function fitRisers() {
      var tabs = [chatsTab, marksTab], w = 0;
      tabs.forEach(function (t) { t.style.width = "auto"; });
      tabs.forEach(function (t) { w = Math.max(w, t.offsetWidth); });
      tabs.forEach(function (t) { t.style.width = w + "px"; });
    }

    /* ======================= setState — a PATCH, not a snapshot ============================== */
    function setState(s) {
      if (!s) return view;
      if ("title" in s) state.title = s.title == null ? "" : String(s.title);
      if ("star" in s) state.star = !!s.star;
      if ("connection" in s) {
        var c = s.connection;
        state.connection = typeof c === "string" ? { text: c, tone: "ok", note: "" }
                                                 : { text: String((c || {}).text || ""), tone: (c || {}).tone || "ok", note: String((c || {}).note || "") };
      }
      if ("running" in s) {
        var r = s.running || {};
        if ("model" in r) state.running.model = normPick(r.model);
        if ("effort" in r) state.running.effort = normPick(r.effort);
        if ("permission" in r) state.running.permission = normPick(r.permission);
        if ("ultracode" in r) state.running.ultracode = !!r.ultracode;
        if ("autoWrap" in r) state.running.autoWrap = !!r.autoWrap;
        if ("autoContinue" in r) state.running.autoContinue = !!r.autoContinue;
      }
      if ("context" in s) {
        var cx = s.context || {};
        state.context = { tokens: nn(cx.tokens, 0), ceiling: nn(cx.ceiling, 1000000), parts: cx.parts || [] };
      }
      if ("stats" in s) state.stats = s.stats == null || s.stats === false ? [] : (Array.isArray(s.stats) ? s.stats : [s.stats]);
      if ("agents" in s) state.agents = s.agents || [];
      if ("conversations" in s) state.conversations = s.conversations || [];
      if ("repos" in s) state.repos = s.repos || [];
      if ("history" in s) state.history = s.history || [];
      if ("marks" in s) state.marks = s.marks || [];
      // The chat BOXES, distinct from `conversations` (the threads of one repository) — see chatsSheet.
      if ("chats" in s) state.chats = s.chats || [];
      if ("busy" in s) state.busy = !!s.busy;
      // The whole presentation, as ChatShell.sendPresentation returns it — see paintRisers' send/stop.
      if ("sending" in s) state.sending = s.sending || null;
      if ("stick" in s) state.stick = !!s.stick;
      if ("multiChat" in s) state.multiChat = !!s.multiChat;
      if ("worktree" in s) state.worktree = s.worktree == null ? "" : String(s.worktree);
      paintHead();
      paintBulb();
      paintButtons();
      paintRisers();
      /* A pane repaints only while it is OPEN. `setState` runs on every streamed token, and painting
         four sections of a panel nobody is looking at is work done sixty times a second for nothing. */
      if (state.panel === "left") paintPaneL();
      if (state.panel === "right") paintPaneR();
      if (actsNode) paintActs();   // so the ★ follows the host's marks while the row is open
      /* An open SHEET or OVERLAY is deliberately not repainted. They are built when opened, and a
         `setState` arriving mid-token would rebuild the wheel your thumb is on — resetting the dial
         under the drag — or replace the search field you are typing into. A token count that is a
         few seconds old in a surface you opened a moment ago is the cheaper of the two errors. */
      return view;
    }

    /* Escape / the phone's back gesture closes the innermost surface first, in the order they stack.
       Bound to the document because a surface covers the whole pane and the key never reaches it. */
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (state.overlay) setOverlay(null);
      else if (state.sheet) setSheet(null);
      else if (state.panel) setPanel(null);
    }
    doc.addEventListener("keydown", onKey);

    var view = {
      root: host,
      els: { head: head, title: titleEl, connection: connEl, contextMedallion: ctxMed,
             core: core, low: low, compose: compose, box: box, seamBulb: bulb, buttonRow: btnrow,
             attachBtn: attachBtn, autoBtn: autoBtn, stopBtn: stopBtn, sendBtn: sendBtn,
             railLeft: railL, railRight: railR, risers: risers, chatsTab: chatsTab,
             marksTab: marksTab, runningTab: runningTab, scrim: scrim,
             leftPane: paneL.node, leftPaneBody: paneL.body, rightPane: paneR.node, rightPaneBody: paneR.body },
      setState: setState,
      destroy: function () {
        setOverlay(null);
        setSheet(null);
        root.clearTimeout(noteTimer);
        doc.removeEventListener("keydown", onKey);
        /* The transcript was the HOST's element before it was ours; leaving with it would take the
           conversation off the screen and leave the host holding a detached node. It is handed back
           as a child of the host — not to the position it was in, which only its owner knows. */
        if (adopted) { core.classList.remove("mc-core"); core.classList.remove("rg-core"); }
        else core.remove();
        head.remove();
        low.remove();
        risers.remove();
        scrim.remove();
        paneL.node.remove();
        paneR.node.remove();
        host.classList.remove("ws-mobile2");
        host.classList.remove("mc-root");
      },
    };

    setState({});
    return view;
  }

  var API = { mount: mount, version: "1.0.0" };
  if (typeof module === "object" && module.exports) module.exports = API;
  root.MobileCockpit = API;
})(typeof window !== "undefined" ? window : globalThis);
