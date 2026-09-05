// node --test lib/exocortexMount.test.mjs
//
// The exocortex RENDERERS live in dashboard/public/app.js, which cannot be imported (it boots a DOM
// on load), so — same slice-and-eval approach as lib/coldLoadStatus.test.mjs — the sentinel-marked
// EXOCORTEX block is cut out and evaluated against a deliberately tiny DOM shim plus the real
// `window.EXO` bundle. That combination is what makes this test worth having: it exercises the
// ACTUAL shipped render path (shaper → view model → nodes), not a re-description of it.
//
// Every assertion below is one of the honesty rules the feature exists for:
//   T3.1  "unavailable" must never render as "0%".
//   T3.2  hasData:false must read differently from count:0, and a stalled agent must be loud AND
//         labelled a heuristic.
//   T3.3  a client-inferred cue is hedged; tier ADVICE and real action buttons are rendered.
//   T3.4  "N earlier turns" above (exact), "more below" with NO number.
//   T3.5  a not-found renders an honest "nothing matched" and the cue is OFF, not spinning.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const bundleSrc = readFileSync(join(__dir, "..", "dashboard", "public", "exocortex.js"), "utf8");

const BEGIN = "// ===== EXOCORTEX — the Phase-2 client surface";
const END = "// ===== end EXOCORTEX ====";
const a = appSrc.indexOf(BEGIN), b = appSrc.indexOf(END);
assert.ok(a >= 0 && b > a, "EXOCORTEX block markers must exist in app.js");
const block = appSrc.slice(a, appSrc.indexOf("\n", b));

// --- the smallest DOM that `el()` and the renderers actually touch -----------------------------
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.className = "";
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.title = "";
    this.value = "";
    this.isConnected = true;
    this._listeners = {};
    this._text = "";
    this.classList = {
      add: (c) => { if (!this.className.split(/\s+/).includes(c)) this.className = (this.className + " " + c).trim(); },
      remove: (c) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
      contains: (c) => this.className.split(/\s+/).includes(c),
      toggle: (c, on) => (on === undefined ? (this.classList.contains(c) ? this.classList.remove(c) : this.classList.add(c)) : (on ? this.classList.add(c) : this.classList.remove(c))),
    };
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  set innerHTML(v) { this._text = String(v); }
  append(...kids) { for (const k of kids) if (k !== "" && k != null) this.childNodes.push(k); }
  appendChild(k) { this.append(k); return k; }
  replaceChildren(...kids) { this.childNodes = []; this.append(...kids); }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  fire(type, ev = {}) { for (const fn of this._listeners[type] || []) fn(Object.assign({ preventDefault() {}, stopPropagation() {} }, ev)); }
  set textContent(v) { this._text = String(v); this.childNodes = []; }
  get textContent() { return this._text + this.childNodes.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); }
  scrollIntoView() {}
}
const documentShim = { createElement: (tag) => new FakeNode(tag) };
const el = (tag, props = {}, kids = []) => {
  const n = documentShim.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) n.append(c);
  return n;
};

const windowShim = {};
new Function("window", bundleSrc)(windowShim);

const posted = [];
const EXPORTS = [
  "exoState", "exoIngestEvent", "exoNoteAgents", "exoNoteContext", "exoIsPinned", "exoResyncArgs",
  "exoAbsorbWindow", "exoJumpTo", "exoResolveJump", "exoExtend", "exoBackToLatest", "exoRecall",
  "exoMountBar", "exoEdgeNodes", "exoRecallNode", "exoRenderContextPanel", "exoRenderAgentsPanel",
];
const H = new Function(
  "window", "document", "el", "wsPost", "prettyModel", "requestAnimationFrame",
  block + "\nreturn { " + EXPORTS.join(", ") + " };"
)(windowShim, documentShim, el, (kind, body) => posted.push({ kind, body }), (m) => String(m), (fn) => fn());

const ctxFor = (conv, over = {}) => Object.assign({
  rows: () => conv.transcript || [],
  repaint: () => { conv._painted = (conv._painted || 0) + 1; },
  adopt: (w) => { conv.transcript = w.rows; conv._promptOffset = w.promptOffset; conv._responseOffset = w.responseOffset; },
  caps: { compact: true, newChat: true },
  compact: () => { conv._compacted = true; },
  newChat: () => { conv._newChat = true; },
  onLatest: () => { conv._backToLatest = true; },
}, over);
const txt = (n) => (n ? n.textContent : "");
const newConv = (key = "Repo@main") => ({ sessionKey: key, transcript: [] });

const BREAKDOWN_OK = {
  ok: true, totalTokens: 316000, maxTokens: 1000000, percentage: 31.6, model: "claude-opus-4-6",
  categories: [
    { name: "Messages", tokens: 210000, color: "#7aa2f7", pct: 21 },
    { name: "System tools", tokens: 42000, color: "#9ece6a", pct: 4.2 },
    { name: "Autocompact buffer", tokens: 20000, color: "#565f89", pct: 2, isDeferred: true },
  ],
  grid: [], free: { tokens: 684000, pct: 68.4 },
  memoryFiles: [{ path: "CLAUDE.md", type: "project", tokens: 12000 }],
  mcpTools: [], systemTools: [{ name: "Bash", tokens: 1400 }], systemPromptSections: [],
};
const BREAKDOWN_UNAVAILABLE = { ok: false, totalTokens: 0, maxTokens: 0, percentage: 0, categories: [], grid: [], free: { tokens: 0, pct: 0 }, memoryFiles: [], mcpTools: [], systemTools: [], systemPromptSections: [] };

// --- T3.1 ---------------------------------------------------------------------------------------

test("T3.1 the context panel renders the breakdown, and sums the INTEGER tenths", () => {
  const p = newConv();
  H.exoNoteContext(p, { kind: "contextUsage", usage: null, contextBreakdown: BREAKDOWN_OK });
  const node = H.exoRenderContextPanel(p);
  const t = txt(node);
  assert.match(t, /Messages/);
  assert.match(t, /Autocompact buffer \(deferred\)/, "a deferred category must be labelled as such");
  assert.match(t, /Free space/);
  assert.match(t, /account for 100\.0% of the window/, "the apportionment must total exactly 100.0%");
  assert.match(t, /Memory files \(1\)/);
  assert.ok(!/unavailable/i.test(t), "an available breakdown must not say unavailable");
});

test("T3.1 ok:false renders as UNAVAILABLE and never as 0% used", () => {
  const p = newConv();
  H.exoNoteContext(p, { kind: "contextUsage", usage: null, contextBreakdown: BREAKDOWN_UNAVAILABLE });
  const t = txt(H.exoRenderContextPanel(p));
  assert.match(t, /unavailable/i);
  assert.match(t, /NOT “0% used”/, "the difference has to be stated in words — this is the whole point");
  assert.ok(!/\b0%/.test(t.replace(/“0% used”/g, "")), "no bare 0% anywhere in the unavailable state");
  assert.match(t, /Ask again/, "poll-only means the user needs a way to re-ask");
});

test("T3.1 a conversation that has never answered is unavailable, not empty", () => {
  const t = txt(H.exoRenderContextPanel(newConv()));
  assert.match(t, /unavailable/i);
});

// --- T3.2 ---------------------------------------------------------------------------------------

const PANEL_EVENT = (agents) => ({ kind: "background", tasks: agents, panel: { count: agents.length, running: agents.filter((x) => x.status === "running").length, done: agents.filter((x) => x.status === "done").length, totalTokens: agents.reduce((s, x) => s + (x.tokens || 0), 0), agents } });

test("T3.2 hasData:false reads DIFFERENTLY from count:0", () => {
  const noData = txt(H.exoRenderAgentsPanel(newConv(), 1000));
  assert.match(noData, /No fleet data/);
  assert.match(noData, /NOT the same as “no agents are running”/);

  const p = newConv();
  H.exoNoteAgents(p, PANEL_EVENT([]), 1000);
  const empty = txt(H.exoRenderAgentsPanel(p, 1000));
  assert.match(empty, /No background agents/);
  assert.match(empty, /live set and it is empty/);
  assert.notEqual(noData, empty, "the two states must not render the same words");
});

test("T3.2 a silent running agent is loudly flagged AND labelled a heuristic", () => {
  const p = newConv();
  const ev = PANEL_EVENT([
    { id: "t1", label: "Explore", description: "audit the roll path", startedAt: 1000, tokens: 0, status: "running" },
    { id: "t2", label: "local_workflow", description: "phase 2", startedAt: 1000, tokens: 4200, status: "done" },
  ]);
  H.exoNoteAgents(p, ev, 1000);
  const now = 1000 + 6 * 60 * 1000;
  H.exoNoteAgents(p, ev, now);   // unchanged fingerprint → lastChangeAt is PRESERVED, which is the point
  const node = H.exoRenderAgentsPanel(p, now);
  const t = txt(node);
  assert.match(t, /possibly stalled/);
  assert.match(t, /Heuristic/, "the guess must be labelled as a guess (staleNote), never stated as death");
  assert.match(t, /may simply be working quietly/);
  const rows = node.childNodes.filter((c) => c.className && c.className.includes("exo-agent-row"));
  assert.equal(rows.length, 2);
  assert.ok(rows[0].className.includes("--stale"), "the stalled row carries its own class so CSS can shout");
  assert.ok(!rows[1].className.includes("--stale"), "a finished agent is not 'stalled'");
});

test("T3.2 an agent with no usable start time renders 'unknown', never a fake 0s", () => {
  const p = newConv();
  H.exoNoteAgents(p, PANEL_EVENT([{ id: "t1", label: "Explore", status: "running" }]), 5000);
  const t = txt(H.exoRenderAgentsPanel(p, 5000));
  assert.match(t, /unknown/);
  assert.ok(!/\b0s\b/.test(t), "a frozen '0s' is the exact symptom that made the fleet look dead");
});

test("T3.2 tracking is per conversation — two sessions never merge fleets", () => {
  const p1 = newConv("A@main"), p2 = newConv("B@main");
  H.exoIngestEvent(p1, PANEL_EVENT([{ id: "t1", label: "Explore", startedAt: 1, status: "running" }]));
  H.exoIngestEvent(p2, PANEL_EVENT([{ id: "z9", label: "Other", startedAt: 1, status: "running" }]));
  assert.match(txt(H.exoRenderAgentsPanel(p1, Date.now())), /Explore/);
  assert.ok(!/Other/.test(txt(H.exoRenderAgentsPanel(p1, Date.now()))), "conversation A must not show B's agents");
  assert.match(txt(H.exoRenderAgentsPanel(p2, Date.now())), /Other/);
});

test("T3.2 changing sessionKey RESETS the surface (a repointed pane inherits nothing)", () => {
  const p = newConv("A@main");
  H.exoIngestEvent(p, PANEL_EVENT([{ id: "t1", label: "Explore", startedAt: 1, status: "running" }]));
  assert.match(txt(H.exoRenderAgentsPanel(p, Date.now())), /Explore/);
  p.sessionKey = "B@main";
  assert.match(txt(H.exoRenderAgentsPanel(p, Date.now())), /No fleet data/);
});

// --- T3.3 ---------------------------------------------------------------------------------------

test("T3.3 the cue strip shows server cues verbatim and hedges the client's own guess", () => {
  const p = newConv();
  const bar = H.exoMountBar(p, ctxFor(p));
  H.exoIngestEvent(p, { kind: "rolling", segment: 2, sourceRef: "Repo@main#seg2", at: Date.now() });
  bar.sync();
  let t = txt(bar.root);
  assert.match(t, /Rolling to a fresh window/);
  assert.ok(!/Possibly: Rolling/.test(t), "an engine-reported cue must NOT be hedged");

  // Past the critical threshold the client infers "compaction likely" — that one MUST be hedged.
  H.exoNoteContext(p, { kind: "contextUsage", contextBreakdown: Object.assign({}, BREAKDOWN_OK, { totalTokens: 950000, percentage: 95 }) });
  bar.sync();
  t = txt(bar.root);
  assert.match(t, /Possibly: Context 95% full/);
  assert.match(t, /guess/i);
});

test("T3.3 the tier shows its ADVICE with a working button — and `roll` as a note, not a dead button", () => {
  const p = newConv();
  const ctx = ctxFor(p);
  const bar = H.exoMountBar(p, ctx);
  H.exoNoteContext(p, { kind: "contextUsage", contextBreakdown: Object.assign({}, BREAKDOWN_OK, { totalTokens: 950000, percentage: 95 }) });
  bar.sync();
  const t = txt(bar.root);
  assert.match(t, /Critical/);
  assert.match(t, /Auto-compaction is imminent/, "the tier's advice must be shown, not just a number");
  assert.match(t, /Compact now/);
  assert.match(t, /Rolling to a fresh window is done by the engine itself/, "roll has no control action — say so");
  assert.ok(!/＋ New chat/.test(t), "the critical tier advises roll+compact, not a new chat");

  // The button is real.
  const findBtn = (node, label) => {
    if (node.tagName === "BUTTON" && node.textContent.includes(label)) return node;
    for (const c of node.childNodes) if (typeof c !== "string") { const f = findBtn(c, label); if (f) return f; }
    return null;
  };
  const btn = findBtn(bar.root, "Compact now");
  assert.ok(btn, "the compact affordance must be a real button");
  btn.fire("click");
  assert.equal(p._compacted, true);
});

test("T3.3 a comfortable window shows no advice block at all (no nagging)", () => {
  const p = newConv();
  const bar = H.exoMountBar(p, ctxFor(p));
  H.exoNoteContext(p, { kind: "contextUsage", contextBreakdown: Object.assign({}, BREAKDOWN_OK, { totalTokens: 100000, percentage: 10 }) });
  bar.sync();
  const t = txt(bar.root);
  assert.ok(!/Comfortable/.test(t), "severity 0 must not occupy the cue strip");
  assert.match(t, /10% ctx/, "…but the chip still reports the number");
});

// --- T3.4 ---------------------------------------------------------------------------------------

const bandPayload = (start, len, total, po, ro) => ({
  transcript: Array.from({ length: len }, (_, i) => ({ role: (start + i) % 2 ? "assistant" : "user", text: "row " + (start + i) })),
  transcriptTotal: total, transcriptTruncated: true, promptOffset: po, responseOffset: ro,
  windowStart: start, windowEnd: start + len, windowMode: "around",
});

test("T3.4 a band is absorbed, cached, and drives EXACT above / COUNTLESS below affordances", () => {
  const p = newConv();
  const w = H.exoAbsorbWindow(p, bandPayload(350, 40, 1200, 175, 175));
  assert.ok(w && w.isBand, "windowStart/windowEnd present ⇒ this is a band, not the tail");
  assert.equal(w.promptOffset, 175);
  assert.equal(H.exoIsPinned(p), true, "a band parks the reader on history");

  p.transcript = w.rows;
  const edges = H.exoEdgeNodes(p, ctxFor(p));
  assert.ok(edges.above && edges.below);
  assert.match(txt(edges.above), /350 earlier turns/, "175 prompts + 175 responses, counted by the server");
  assert.match(txt(edges.below), /more below/);
  assert.ok(!/\d/.test(txt(edges.below).replace(/load newer/, "")), "the below affordance must carry NO count");
});

test("T3.4 a pinned reader is not yanked back to the tail by the periodic self-heal resync", () => {
  const p = newConv();
  H.exoAbsorbWindow(p, bandPayload(350, 40, 1200, 175, 175));
  const args = H.exoResyncArgs(p, { sessionKey: "Repo@main", full: true, limit: 400 });
  // 370 is the band's own CENTRE (rows 350..389) — re-asking `around` there returns the same band.
  assert.equal(args.around, 370, "the self-heal must re-ask for the SAME band");
  assert.equal(args.full, undefined);
  assert.equal(args.limit, undefined);

  // …and a tail payload releases the pin, so "Latest" genuinely returns to live.
  H.exoAbsorbWindow(p, { transcript: [{ role: "user" }], transcriptTotal: 1201, promptOffset: 0, responseOffset: 0 });
  assert.equal(H.exoIsPinned(p), false);
  assert.equal(H.exoResyncArgs(p, { sessionKey: "Repo@main", limit: 400 }).around, undefined);
});

test("T3.4 a jump sends BOTH aroundTurn and around, and shows progress while it searches", () => {
  const p = newConv();
  H.exoAbsorbWindow(p, bandPayload(0, 40, 1200, 0, 0));
  posted.length = 0;
  const ctx = ctxFor(p);
  const bar = H.exoMountBar(p, ctx);
  H.exoJumpTo(p, "prompt", 900, ctx);
  assert.equal(posted.length, 1);
  const args = posted[0].body.args;
  assert.deepEqual(args.aroundTurn, { kind: "prompt", number: 900 }, "a current engine resolves the TURN in one hop");
  assert.equal(typeof args.around, "number", "…and an older engine still gets a row index to work with");
  bar.sync();
  assert.match(txt(bar.root), /Finding P#900/, "an in-flight jump must never look frozen");
  assert.match(txt(bar.root), /probe 1 of/);
});

test("T3.4 the engine's own `turn` answer is believed — found lands, not-found offers recall", () => {
  const p = newConv();
  H.exoAbsorbWindow(p, bandPayload(0, 40, 1200, 0, 0));
  const ctx = ctxFor(p);
  const bar = H.exoMountBar(p, ctx);

  posted.length = 0;
  H.exoJumpTo(p, "prompt", 99999, ctx);
  const w = H.exoAbsorbWindow(p, bandPayload(1160, 40, 1200, 580, 580));
  w.turn = { kind: "prompt", number: 99999, resolved: 600, index: 1198, found: false, reason: "above-range", count: 600 };
  H.exoResolveJump(p, ctx, w);
  bar.sync();
  const t = txt(bar.root);
  assert.match(t, /600 prompts/, "say how many turns actually exist");
  assert.match(t, /Recall P#99,999/, "a clamped/not-found answer must offer the archive");
  assert.equal(posted.filter((x) => x.body.args && x.body.args.aroundTurn).length, 1, "it must NOT keep probing after an exact answer");
});

test("T3.4 a jump to a turn already on screen costs no round-trip", () => {
  const p = newConv();
  p.transcript = [{ role: "user", _pnum: 12, _node: new FakeNode("div") }];
  posted.length = 0;
  const ctx = ctxFor(p);
  H.exoJumpTo(p, "prompt", 12, ctx);
  assert.equal(posted.length, 0);
  assert.equal(p._exo.jump.status, "landed");
});

test("T3.4 a second visit to a cached band is served from the LRU, not the network", () => {
  const p = newConv();
  H.exoAbsorbWindow(p, bandPayload(0, 40, 1200, 0, 0));          // rows 0..39 → P#1.. / R#1..
  const ctx = ctxFor(p);
  H.exoAbsorbWindow(p, bandPayload(600, 40, 1200, 300, 300));     // cache a far band
  posted.length = 0;
  H.exoBackToLatest(p, ctx);                                      // leave it
  posted.length = 0;
  H.exoJumpTo(p, "prompt", 320, ctx);                             // sits inside the cached band
  assert.equal(posted.length, 0, "the cached band answers without asking the server");
  assert.equal(p._exo.jump.status, "cached");
});

// --- T3.5 ---------------------------------------------------------------------------------------

test("T3.5 a recall hit renders inline with its provenance", () => {
  const p = newConv();
  H.exoIngestEvent(p, { kind: "lookingUp", mode: "number", kindOf: "response", number: 1237, at: 1 });
  const spinning = H.exoRecallNode(p, ctxFor(p));
  assert.match(txt(spinning), /Looking up R#1237/);

  H.exoIngestEvent(p, {
    kind: "recall", mode: "number", kindOf: "response", number: 1237, ok: true, error: null, at: 2,
    hit: { segmentRef: "Repo@main#seg1", workspaceId: "Repo@main", kind: "response", number: 1237, text: "the archived answer", images: [{ path: "images/x.png", hash: "x", mediaType: "image/png" }] },
  });
  const node = H.exoRecallNode(p, ctxFor(p));
  const t = txt(node);
  assert.match(t, /R#1237/);
  assert.match(t, /Repo@main#seg1/, "provenance: WHICH segment it came from");
  assert.match(t, /the archived answer/);
  assert.equal(p._exo.recall.active, false, "the cue is off — never a stuck spinner");
});

test("T3.5 a miss says 'nothing matched' out loud and turns the cue off", () => {
  const p = newConv();
  H.exoIngestEvent(p, { kind: "lookingUp", mode: "query", query: "kadena", at: 1 });
  H.exoIngestEvent(p, { kind: "recall", mode: "query", query: "kadena", ok: false, hits: [], error: "", at: 2 });
  const t = txt(H.exoRecallNode(p, ctxFor(p)));
  assert.match(t, /Nothing archived matches that|Nothing matched/i);
  assert.match(t, /Only ARCHIVED \(rolled-off\) turns are searchable/, "explain WHY, so a miss is not read as a bug");
  assert.equal(p._exo.recall.active, false);
});

test("T3.5 a REFUSED recall (no lookingUp at all) still turns the cue off", () => {
  const p = newConv();
  H.exoIngestEvent(p, { kind: "recall", mode: "query", ok: false, hits: [], error: "give a turn number or a query", at: 2 });
  assert.equal(p._exo.recall.active, false, "CONTRACT §3b: a refusal emits `recall` with no `lookingUp`");
  assert.ok(txt(H.exoRecallNode(p, ctxFor(p))).length > 0);
});

test("T3.5 an image with no workspaceId is reported as unlocatable, not linked to a 404", () => {
  const p = newConv();
  H.exoIngestEvent(p, {
    kind: "recall", mode: "number", kindOf: "prompt", number: 5, ok: true, at: 2,
    hit: { segmentRef: "S#1", workspaceId: "", kind: "prompt", number: 5, text: "t", images: [{ path: "images/x.png" }] },
  });
  assert.match(txt(H.exoRecallNode(p, ctxFor(p))), /cannot be located/);
});

test("T3.5 the jump box doubles as an archive search when the input is not a turn number", () => {
  const p = newConv();
  posted.length = 0;
  const bar = H.exoMountBar(p, ctxFor(p));
  const input = bar.root.childNodes[0].childNodes[2].childNodes[0];
  input.value = "kadena pact";
  bar.root.childNodes[0].childNodes[2].childNodes[1].fire("click");   // "Go"
  assert.equal(posted.length, 1);
  assert.equal(posted[0].body.action, "recall");
  assert.equal(posted[0].body.args.query, "kadena pact");
  assert.equal(p._exo.recall.active, true, "the cue goes on optimistically so the press is visible");
});

// --- routing ------------------------------------------------------------------------------------

test("cues are keyed per conversation — two open chats never share an indicator", () => {
  const p1 = newConv("A@main"), p2 = newConv("B@main");
  H.exoIngestEvent(p1, { kind: "lookingUp", mode: "number", kindOf: "prompt", number: 7, at: 1 });
  assert.equal(p1._exo.recall.active, true);
  assert.equal(H.exoRecallNode(p2, ctxFor(p2)), null, "the other conversation shows nothing");
  H.exoIngestEvent(p2, { kind: "recall", mode: "number", ok: false, error: "", at: 2 });
  assert.equal(p1._exo.recall.active, true, "…and resolving B must not clear A's cue");
});

test("T3.4 `scoped` comes from the surface — a Pact tab must never window the merged history", () => {
  const core = newConv();
  H.exoAbsorbWindow(core, bandPayload(0, 40, 1200, 0, 0));
  posted.length = 0;
  H.exoJumpTo(core, "prompt", 900, ctxFor(core, { scoped: false }));
  assert.equal(posted[0].body.args.scoped, undefined, "the Core cockpit reads the MERGED workspace history");

  const tab = newConv("Pact@main");
  H.exoAbsorbWindow(tab, bandPayload(0, 40, 1200, 0, 0));
  posted.length = 0;
  H.exoJumpTo(tab, "prompt", 900, ctxFor(tab, { scoped: true }));
  assert.equal(posted[0].body.args.scoped, true, "a Pact tab is ONE saved session inside a shared workspace id");
});

test("T3.4 leaving a band undoes the render concessions it required", () => {
  const p = newConv();
  H.exoAbsorbWindow(p, bandPayload(350, 40, 1200, 175, 175));
  assert.equal(H.exoIsPinned(p), true);
  const ctx = ctxFor(p);
  posted.length = 0;
  H.exoBackToLatest(p, ctx);
  assert.equal(p._backToLatest, true, "the workspace must be told to stop rendering the whole band");
  assert.equal(H.exoIsPinned(p), false);
  assert.equal(posted[0].body.args.around, undefined, "…and to ask for the TAIL");
});
