// Claudstermind Dashboard — renders the master map from /api/map.
let MAP = null;
let TOKENS = null;
let ME = { mode: "local", authenticated: true, canExecute: true, localActionsAvailable: true, localConnected: true, roles: [] };

// May this page offer an ACTION control? True when the viewer can execute AND the
// action can actually run — on the local dashboard always (local machine); on the
// online relay only for an `ancient` admin while the local bridge is connected.
// One helper so every action surface (git buttons, token renew, ops) agrees.
const canAct = () => ME.canExecute && ME.localActionsAvailable;
let VIEW = "overview";
let ORGMODE = "target"; // 'current' | 'target'

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) n.append(c);
  return n;
};

function orgColor(org) { return (MAP && MAP.orgs && MAP.orgs[org] && MAP.orgs[org].color) || "#64748b"; }
function roleOf(id) { return MAP.roles[id] || { label: id, color: "#64748b", glyph: "•" }; }
function repoOrg(r) { return r.org[ORGMODE] || r.org.current || r.org.target; }
function isMoving(r) { return r.org.current !== r.org.target || (r.movement && r.movement.length); }

/* ---------- shared org-grouped card layout ----------
   Map, Brain and Git-state all lay repos out the SAME way: organisations in the
   Map's order, each a "greater cardboard" holding its repo cards in the Map's
   within-org order. So a repo is always in the same spot, and you learn the shape
   once. These helpers are the single source of that order. */
const normPath = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Join an endpoint's repo list onto MAP repos by localPath (then name/id). */
function repoIndex(items, pathOf, nameOf) {
  const byPath = new Map(), byName = new Map();
  for (const it of items || []) {
    const p = normPath(pathOf(it));
    if (p) byPath.set(p, it);
    const n = (nameOf(it) || "").toLowerCase();
    if (n && !byName.has(n)) byName.set(n, it);
  }
  return {
    get: (r) => byPath.get(normPath(r.localPath)) || byName.get((r.name || "").toLowerCase()) || byName.get((r.id || "").toLowerCase()),
    all: items || [],
  };
}

/** The tracked repos of one org, in Map order. Excludes non-repo placeholders ("no repo yet")
 *  and embedded pseudo-entries, but NOT annotated real repos like "stoa-js (pre-split)". */
function orgRepos(org) {
  return MAP.repos.filter((r) => repoOrg(r) === org && r.localPath && !/no repo|embedded/i.test(r.localPath));
}

/** Walk orgs in Map order; call cb(org, meta, repos) for each non-empty org. */
function eachOrg(cb) {
  for (const [org, meta] of Object.entries(MAP.orgs)) {
    const repos = orgRepos(org);
    if (repos.length) cb(org, meta, repos);
  }
}

/** The "greater cardboard": an org container wrapping its repo cards. */
function orgGroup(org, meta, repoCards, tagEl) {
  return el("div", { class: "orggroup", style: `--org:${meta.color}` }, [
    el("div", { class: "orggroup-hd" }, [
      el("span", { class: "dot", style: `background:${meta.color}` }),
      el("b", {}, [org]),
      el("span", { class: "scope" }, [meta.scope || ""]),
      tagEl ? el("span", { class: "grouptag" }, [tagEl]) : "",
    ]),
    el("div", { class: "orggroup-body" }, repoCards),
  ]);
}

/** A repo "cardboard" — shared shell; callers fill sub-lines + the left stripe colour. */
function repoCard(r, { stripe, branch, sublines = [], muted = false, extra = [] }) {
  const role = roleOf(r.role);
  // The name lives in an inner span so a too-long name can "train" (scroll) on hover to
  // reveal the full text; the title carries the full name + path as a fallback tooltip.
  const nameInner = el("span", { class: "rc-name-inner" }, [r.name]);
  const nameEl = el("span", { class: "rc-name", title: `${r.name}\n${r.localPath || ""}`.trim() }, [nameInner]);
  nameEl.addEventListener("mouseenter", () => {
    const over = nameInner.scrollWidth - nameEl.clientWidth;
    if (over > 2) { nameEl.style.setProperty("--marq", `-${over + 10}px`); nameInner.classList.add("train"); }   // only long names move
  });
  nameEl.addEventListener("mouseleave", () => nameInner.classList.remove("train"));
  return el("div", { class: "repocard" + (muted ? " is-muted" : ""), style: `--stripe:${stripe || role.color}` }, [
    el("div", { class: "rc-hd" }, [
      el("span", { class: "glyph", style: `color:${role.color}` }, [role.glyph]),
      nameEl,
      branch ? el("span", { class: "rc-branch", title: branch }, [branch]) : "",
    ]),
    ...sublines.map((s) => (typeof s === "string" ? el("div", { class: "rc-sub" }, [s]) : s)),
    ...extra,
  ]);
}

/* ---------- Pantheonic navigation: Tier-1 sections, Tier-2 sub-views, and the admin space ----------
   The URL hash is the source of truth (§3.7). `#section`, `#section/sub`, and `#admin[/section]`. */
const SECTIONS = [
  { id: "overview", label: "Overview", view: "overview" },
  { id: "map", label: "Map", subs: [
    { id: "tree", label: "Tree", view: "tree" },
    { id: "matrix", label: "Org × Role", view: "matrix" },
    { id: "graph", label: "Dependency graph", view: "graph" },
    { id: "movements", label: "Movements", view: "movements" },
    { id: "packages", label: "Packages", view: "packages" },
  ] },
  { id: "activity", label: "Activity", view: "activity" },
  { id: "pipeline", label: "Pipeline", subs: [
    { id: "cascade", label: "Cascade", view: "cascade" },
    { id: "git", label: "Git state", view: "git" },
  ] },
  { id: "brain", label: "Brain", view: "brain" },
  { id: "workspace", label: "Workspace", view: "workspace", gate: () => ME.canExecute && (ME.mode === "live" || ME.mode === "local") },
  { id: "mirror", label: "Mirror", view: "mirror", gate: () => ME.canExecute && (ME.mode === "live" || ME.mode === "local") },
  { id: "localhost", label: "LocalHost", view: "localhost", gate: () => ME.canExecute && (ME.mode === "live" || ME.mode === "local") },
];
const ADMIN_SECTIONS = [
  { id: "deploy", icon: "🚀", label: "Deploy & Version", enabled: true },
  { id: "ops", icon: "⚙", label: "Ops", enabled: true },
  { id: "relay", icon: "🔌", label: "Relay", enabled: true },
  { id: "tokens", icon: "🔑", label: "Tokens", enabled: true },
];
const sectionById = (id) => SECTIONS.find((s) => s.id === id);
const subViewOf = (sec, subId) => { const sub = (sec.subs || []).find((x) => x.id === subId) || (sec.subs || [])[0]; return sub ? sub.view : sec.view; };
let ROUTE = { admin: false, section: "overview", sub: null };
let ADMIN_SECTION = null;    // when VIEW==="admin": the selected section id, or null (unselected prompt)
let LAST_MAIN = "#overview"; // where the admin "back" returns to

function parseHash(h) {
  const parts = (h || "").replace(/^#/, "").split("/");
  if (parts[0] === "admin") return { admin: true, section: parts[1] || null, sub: null };
  const section = sectionById(parts[0]) ? parts[0] : "overview";
  return { admin: false, section, sub: parts[1] || null };
}
function applyRoute() {
  ROUTE = parseHash(location.hash);
  if (ROUTE.admin) { VIEW = "admin"; ADMIN_SECTION = ROUTE.section; }
  else {
    let sec = sectionById(ROUTE.section) || SECTIONS[0];
    if (sec.gate && !sec.gate()) {
      // A gated section (e.g. Workspace for a non-ancient viewer) reached by URL → rewrite the
      // address to overview so the URL matches the view; the replace re-enters applyRoute.
      if (location.hash && location.hash !== "#overview") { location.replace("#overview"); return; }
      sec = SECTIONS[0]; ROUTE = { admin: false, section: "overview", sub: null };
    }
    if (sec.subs && sec.subs.length) { const sub = sec.subs.find((x) => x.id === ROUTE.sub) || sec.subs[0]; ROUTE.sub = sub.id; VIEW = sub.view; }  // normalize so L3 highlight matches
    else VIEW = sec.view;
    LAST_MAIN = location.hash && location.hash !== "#admin" ? location.hash : "#overview";   // set only for a passing route
  }
  renderHeader();
  render();
}
function roleBadge(role) { const b = el("span", { class: "role-badge" + (role === "ancient" ? " is-ancient" : "") }); b.textContent = role; return b; }
function renderIdentity() {
  const host = $("#phIdentity"); if (!host) return;
  const adminLink = (enabled) => enabled
    ? el("a", { class: "ph-btn --ghost --sm", href: "#admin" }, ["Admin"])
    : (() => { const s = el("span", { class: "ph-btn --ghost --sm is-disabled", title: "requires the ancient role", "aria-disabled": "true" }, ["Admin"]); return s; })();
  if (ME.mode === "local") { host.replaceChildren(roleBadge("local"), adminLink(true)); return; }
  if (!ME.authenticated) { host.replaceChildren(el("a", { class: "ph-btn --primary --sm", href: "/auth/login" }, ["Login with AncientHub"])); return; }
  const isAncient = (ME.roles || []).includes("ancient");
  const nameB = el("b", {}); nameB.textContent = ME.name || ME.sub || "signed in";
  host.replaceChildren(el("span", { class: "ph-id-name" }, ["Signed in as ", nameB]), roleBadge(isAncient ? "ancient" : ((ME.roles || [])[0] || "member")), adminLink(isAncient), el("a", { class: "ph-btn --ghost --sm", href: "/auth/logout" }, ["Log out"]));
}
function renderHeader() {
  const phSections = $("#phSections"), phSubnav = $("#phSubnav"), phL2 = $("#phL2"), phBack = $("#phBack"), phAction = $("#phAction");
  if (!phSections) return;
  // L2 — Tier-1 sections (gated ones filtered out)
  const secs = SECTIONS.filter((s) => !s.gate || s.gate());
  phSections.replaceChildren(...secs.map((s) => el("a", { class: "ph-btn " + (!ROUTE.admin && ROUTE.section === s.id ? "--active" : "--ghost"), href: "#" + s.id }, [s.label])));
  // L3 — the active section's Tier-2 sub-views (reserved-height zone, empty when none)
  const sec = !ROUTE.admin ? sectionById(ROUTE.section) : null;
  const subs = (sec && sec.subs) ? sec.subs : [];
  const activeSub = ROUTE.sub || (subs[0] && subs[0].id);
  phSubnav.replaceChildren(...subs.map((sub) => el("a", { class: "ph-btn --sm " + (activeSub === sub.id ? "--active" : "--ghost"), href: `#${sec.id}/${sub.id}` }, [sub.label])));
  // Admin variant (§3.6) — only Level 1; the sidebar is the nav
  phL2.hidden = ROUTE.admin;
  phSubnav.hidden = ROUTE.admin;
  phBack.hidden = !ROUTE.admin;
  phBack.onclick = () => { location.hash = LAST_MAIN; };
  // One memorable action — the cockpit when it's available, else the login/overview
  const wsOn = ME.canExecute && (ME.mode === "live" || ME.mode === "local");
  // The memorable action is the cockpit — but it's redundant when you're already in it.
  phAction.hidden = ROUTE.admin || !wsOn || ROUTE.section === "workspace";
  phAction.textContent = "Workspace ↗"; phAction.setAttribute("href", "#workspace");
  renderIdentity();
  renderConnBanner();
  renderLinkPill();
}

async function boot() {
  // Who am I, and therefore what may this page even offer? In local mode the answer
  // is "everything" and nothing below changes. On the live deployment it decides
  // whether the Ops tab exists at all.
  try { ME = await (await fetch("/api/me")).json(); ME._fetchedAt = Date.now(); } catch { /* keep the local default */ }

  // On the live site, gate the WHOLE app behind login + an admin role. Nothing but the
  // branded login screen renders until you're signed in; a signed-in non-admin gets the
  // "admins only" notice; only an ancient/modern admin reaches the dashboard below.
  if (ME.mode === "live" && !ME.authenticated) return renderPublic();
  if (ME.mode === "live" && !ME.canRead) return renderDenied();

  // Version chip in the medallion (§10) — public, so it shows on every surface.
  try { const v = await (await fetch("/api/version", { cache: "no-store" })).json(); const vc = $("#phVer"); if (vc) { vc.textContent = "v" + v.version; vc.title = `v${v.version}${v.gitSha ? " · " + v.gitSha : ""}${v.builtAt ? " · " + v.builtAt : ""}`; } } catch {}

  renderHeader();

  MAP = await (await fetch("/api/map")).json();
  try { TOKENS = await (await fetch("/api/tokens")).json(); } catch { TOKENS = { tokens: [] }; }
  $("#modelPill").textContent = "model: " + MAP.meta.model;
  $("#genPill").textContent = "generated " + MAP.meta.generated;
  buildLegend();

  // Navigation is URL-driven (§3.7): header buttons are real <a href="#…"> links, so a click
  // updates the hash; parse the hash on load + on every hashchange and render from it.
  window.addEventListener("hashchange", applyRoute);

  // On the online relay, the tunnel can come up or drop while the page is open. Poll
  // /api/me so the banner and action buttons track the live connection state; when it
  // flips, re-render the current view so buttons appear/disappear accordingly.
  if (ME.mode === "live") {
    setInterval(async () => {
      let next; try { next = await (await fetch("/api/me", { cache: "no-store" })).json(); } catch { return; }
      const flipped = next.localConnected !== ME.localConnected || next.localActionsAvailable !== ME.localActionsAvailable;
      next._fetchedAt = Date.now();
      ME = next;
      renderHeader();
      if (flipped) render();
    }, 10_000);
    // A faster tick just for the "updated Xs ago" freshness on the receiving-end pill.
    setInterval(renderLinkPill, 2_000);
  }

  $("#themeBtn").addEventListener("click", () => {
    const b = document.body;
    b.dataset.theme = b.dataset.theme === "dark" ? "light" : "dark";
    if (VIEW === "graph") render();
  });
  renderStatbar();
  // Render the view named in the URL hash (deep link / bookmark), else the default.
  applyRoute();
}

// Strip the dashboard chrome down to just the medallion for the login / denied / public gates.
function gateChrome() {
  for (const id of ["#phL2", "#phSubnav", "#statbar"]) { const e = $(id); if (e) e.style.display = "none"; }
  const foot = document.querySelector("footer.foot"); if (foot) foot.style.display = "none";
  for (const id of ["#modelPill", "#genPill"]) { const e = $(id); if (e) e.hidden = true; }
  // The identity block still renders the login button on the public/denied gates.
  renderIdentity();
}

// Unauthenticated on the live site → the branded login screen. Nothing else is shown.
function renderLogin() {
  gateChrome();
  $("#view").replaceChildren(el("div", { class: "gate" }, [
    el("img", { src: "/brand/claudstermind-hero.png", width: "260", alt: "Claudstermind", class: "gate-mark", style: "max-width:80vw;height:auto" }),
    el("h2", { class: "gate-title" }, ["Claudstermind"]),
    el("p", { class: "gate-sub" }, ["Overseer of everything under Ancient Holdings."]),
    el("a", { href: "/auth/login", class: "loginbtn" }, ["Sign in with AncientHub"]),
    el("p", { class: "gate-note" }, ["Access is limited to Ancient Holdings admins. Sign in to continue."]),
  ]));
}

// The PUBLIC showcase — shown to any visitor without a login on the live site. Proves
// the ecosystem is being actively built (daily activity), with a sign-in for admins.
// Only non-sensitive, message-stripped data is fetched here (/api/public/*).
async function renderPublic() {
  gateChrome();
  MAP = MAP || { orgs: {}, repos: [] };   // safety: orgColor() reads MAP even in public mode
  const v = $("#view");
  v.replaceChildren(el("div", { class: "hint" }, ["Loading…"]));
  let stats = {}; try { stats = await (await fetch("/api/public/stats", { cache: "no-store" })).json(); } catch {}
  const stat = (label, n) => el("div", { class: "stat" }, [el("div", { class: "n" }, [n == null ? "—" : String(n)]), el("div", { class: "l" }, [label])]);
  v.replaceChildren(
    el("div", { class: "gate", style: "min-height:auto;padding:26px 12px 6px;gap:10px" }, [
      el("img", { src: "/brand/claudstermind-hero.png", width: "116", alt: "Claudstermind", class: "gate-mark" }),
      el("h2", { class: "gate-title" }, ["Ancient Holdings — live build activity"]),
      el("p", { class: "gate-sub" }, ["What's being built across the ecosystem, day by day, straight from the work machine."]),
      el("a", { href: "/auth/login", class: "loginbtn" }, ["Sign in with AncientHub"]),
    ]),
    el("div", { class: "statbar", style: "margin-top:14px" }, [
      stat("Repositories", stats.repos), stat("Organisations", stats.orgs),
      stat("Published packages", stats.publishedPackages),
      stat("Commits · 30d", stats.activity30d && stats.activity30d.commits),
      stat("Active repos · 30d", stats.activity30d && stats.activity30d.activeRepos),
    ]),
    el("h3", { style: "margin:18px 0 8px" }, ["Daily activity"]),
    viewActivity(),
  );
}

// Signed in, but without an admin role → say so plainly, offer a way to switch accounts.
function renderDenied() {
  gateChrome();
  const roles = (ME.roles || []).length ? ME.roles.join(", ") : "none";
  $("#view").replaceChildren(el("div", { class: "gate" }, [
    el("img", { src: "/brand/claudstermind-mark.png?v=2", width: "92", height: "92", alt: "Claudstermind", class: "gate-mark" }),
    el("h2", { class: "gate-title" }, ["Admins only"]),
    el("p", { class: "gate-sub" }, [
      "You're signed in to AncientHub, but Claudstermind is visible only to ",
      el("b", {}, ["ancient"]), " or ", el("b", {}, ["modern"]), " admins. Use an admin account to view it.",
    ]),
    el("p", { class: "gate-note" }, ["Your roles: " + roles]),
    el("a", { href: "/auth/logout", class: "loginbtn secondary" }, ["Sign out"]),
  ]));
}

const agoText = (ms) => {
  if (ms == null || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};

/**
 * The receiving-end indicator — ONLY on the live site (mode "live"). The online relay
 * doesn't initiate anything; it reports what it's receiving from the local machine. A
 * green "● Local host connected · updated Xs ago" when the tunnel is up, muted when not.
 * (The local dashboard IS the machine, so it shows nothing here — its outbound status
 * lives in the Ops → Relay panel instead.)
 */
function renderLinkPill() {
  if (ME.mode !== "live" || !ME.authenticated) return;
  let pill = $("#linkPill");
  if (!pill) {
    pill = el("span", { id: "linkPill", class: "model-pill" });
    $("#phIdentity")?.insertAdjacentElement("beforebegin", pill);
  }
  pill.hidden = false;
  if (ME.localConnected) {
    // freshness = server-reported age at fetch + elapsed since (avoids client/server clock skew)
    const age = ME.snapshotAgeMs != null ? ME.snapshotAgeMs + (Date.now() - (ME._fetchedAt || Date.now())) : null;
    pill.style.color = "#34d399";
    pill.textContent = `● Local host connected${age != null ? " · updated " + agoText(age) : " · receiving"}`;
  } else {
    pill.style.color = "var(--ink-dim)";
    pill.textContent = "○ Local host offline";
  }
}

/**
 * The online site's connection state. On the relay (mode "live") the dashboard is only
 * live when the local bridge is connected; otherwise every action is disabled and this
 * banner says so. On the local dashboard (mode "local") there is no banner — you ARE the
 * local machine.
 */
function renderConnBanner() {
  let bar = $("#connBanner");
  if (!bar) {
    bar = el("div", { id: "connBanner", class: "conn-banner", hidden: true });
    document.querySelector("header.top")?.insertAdjacentElement("afterend", bar);
  }
  const disconnected = ME.mode === "live" && ME.authenticated && !ME.localConnected;
  bar.hidden = !disconnected;
  if (disconnected) {
    bar.replaceChildren(
      el("span", { class: "conn-dot" }, []),
      el("span", {}, ["Local Claudstermind not connected — showing the last data received. Start the dashboard (and bridge) on your work machine to go live."]),
    );
  }
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function renderStatbar() {
  const repos = MAP.repos;
  const orgs = new Set(repos.map((r) => r.org.target).filter(Boolean));
  const pubPkgs = repos.flatMap((r) => r.packages || []).filter((p) => !p.private);
  const moving = repos.filter(isMoving);
  const cards = [
    ["Repositories", repos.length],
    ["Organisations", orgs.size],
    ["Published packages", pubPkgs.length],
    ["Repos with movements", moving.length],
    ["Constructors", repos.filter((r) => r.role === "constructor").length],
    ["Automatons", repos.filter((r) => r.role === "automaton").length],
    ["Daimons", repos.filter((r) => r.role === "daimon").length],
    ["Seers", repos.filter((r) => r.role === "seer").length],
  ];
  $("#statbar").replaceChildren(
    ...cards.map(([l, n]) => el("div", { class: "stat" }, [el("div", { class: "n" }, [String(n)]), el("div", { class: "l" }, [l])]))
  );
}

function buildLegend() {
  const items = [];
  for (const [k, r] of Object.entries(MAP.roles))
    items.push(el("span", { class: "li" }, [el("span", { class: "sw", style: `background:${r.color}` }), r.glyph + " " + r.label]));
  items.push(el("span", { class: "li" }, [el("span", { class: "sw", style: "background:var(--accent)" }), "cross-org edge"]));
  $("#legend").replaceChildren(...items);
}

function render() {
  const v = $("#view");
  // Kill the pollers belonging to whichever tab we just left. Leaving one running does
  // not merely waste requests: its refresh() dereferences nodes that replaceChildren()
  // has already torn out of the document, and throws on every tick forever after.
  if (VIEW !== "cascade" && CASCADE_TIMER) { clearInterval(CASCADE_TIMER); CASCADE_TIMER = null; }
  if (VIEW !== "ops" && OPS_TIMER) { clearInterval(OPS_TIMER); OPS_TIMER = null; }
  if (VIEW !== "relay" && RELAY_TIMER) { clearInterval(RELAY_TIMER); RELAY_TIMER = null; }
  if (VIEW !== "workspace" && WS_ES) { try { WS_ES.close(); } catch {} WS_ES = null; }
  if (!(VIEW === "admin" && ADMIN_SECTION === "deploy") && DEPLOY_ES) { try { DEPLOY_ES.close(); } catch {} DEPLOY_ES = null; }
  if (!(VIEW === "admin" && ADMIN_SECTION === "deploy") && RESTART_ES) { try { RESTART_ES.close(); } catch {} RESTART_ES = null; }
  if (VIEW !== "git" && GIT_TIMER) { clearInterval(GIT_TIMER); GIT_TIMER = null; }
  if (VIEW !== "localhost" && LH_TIMER) { clearInterval(LH_TIMER); LH_TIMER = null; }
  document.body.classList.toggle("ws-full", VIEW === "workspace");   // Workspace breaks out to full width
  if (VIEW === "cascade") v.replaceChildren(viewCascade());
  else if (VIEW === "activity") v.replaceChildren(viewActivity());
  else if (VIEW === "git") v.replaceChildren(viewGit());
  else if (VIEW === "overview") v.replaceChildren(viewOverview());
  else if (VIEW === "matrix") v.replaceChildren(viewMatrix());
  else if (VIEW === "graph") v.replaceChildren(viewGraph());
  else if (VIEW === "movements") v.replaceChildren(viewMovements());
  else if (VIEW === "packages") v.replaceChildren(viewPackages());
  else if (VIEW === "tokens") v.replaceChildren(viewTokens());
  else if (VIEW === "ops") v.replaceChildren(viewOps());
  else if (VIEW === "relay") v.replaceChildren(viewRelay());
  else if (VIEW === "workspace") v.replaceChildren(viewWorkspace());
  else if (VIEW === "brain") v.replaceChildren(viewBrain());
  else if (VIEW === "tree") v.replaceChildren(viewTree());
  else if (VIEW === "admin") v.replaceChildren(viewAdmin(ADMIN_SECTION));
  else if (VIEW === "mirror") v.replaceChildren(viewMirror());
  else if (VIEW === "localhost") v.replaceChildren(viewLocalHost());
}

/* ---------- LocalHost: the aggregator, embedded ----------
   LocalHost stays its own repository beside Claudstermind and is never vendored here —
   the dashboard holds a path and supervises the process, so edits in that repo show up
   on a refresh with no sync step.

   Two render paths, because the browser's location decides what's reachable:
     • LOCAL  — frame the aggregator's real origin (http://localhost:<port>). Same HTML,
                CSS and JS the standalone panel serves, so it is the panel AS IS.
     • LIVE   — the remote browser cannot reach the work machine's port, so the same data
                is drawn here from JSON relayed through the tunnel. Proxying its HTML
                instead would break: the aggregator fetches root-absolute /api/status,
                which would resolve against THIS server, not against itself. */
function viewLocalHost() {
  const root = el("div", { class: "lh" }, []);
  const strip = el("div", { class: "lh-strip" }, [el("span", { class: "hint" }, ["Checking the aggregator…"])]);
  const body = el("div", { class: "lh-body" }, []);
  const isLocal = ME.mode === "local";

  const act = async (action, key) => {
    try {
      await fetch("/api/localhost/action", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, key }),
      });
    } catch {}
    setTimeout(refresh, 600);
  };

  // LOCAL: one iframe, pointed at the aggregator's own origin. Nothing is re-implemented.
  function renderLocalFrame(s) {
    if (body.dataset.src === s.url) return;          // don't reload the frame on every poll tick
    body.dataset.src = s.url;
    const frame = el("iframe", { class: "lh-frame", src: s.url, title: "LocalHost Aggregator" });
    body.replaceChildren(frame);
  }

  // LIVE: the aggregator's data, drawn in Claudstermind's chrome.
  function renderRemoteList(s) {
    const live = new Map((s.live?.projects || []).map((p) => [p.key, p]));
    const rows = (s.projects || []).map((p) => {
      const st = live.get(p.key) || {};
      const up = !!st.up;
      const buttons = p.managed
        ? [
            (() => { const b = el("button", { class: "ghost" }, ["▶ start"]); b.addEventListener("click", () => act("start", p.key)); return b; })(),
            (() => { const b = el("button", { class: "ghost" }, ["■ stop"]); b.addEventListener("click", () => act("stop", p.key)); return b; })(),
            (() => { const b = el("button", { class: "ghost" }, ["⟳"]); b.addEventListener("click", () => act("restart", p.key)); return b; })(),
          ]
        : [el("span", { class: "hint" }, ["live-only"])];
      return el("tr", {}, [
        el("td", {}, [el("span", { class: "lh-dot " + (up ? "--up" : "--down") }, []), p.name]),
        el("td", {}, [el("code", {}, [":" + p.port])]),
        el("td", {}, [p.group || "—"]),
        el("td", {}, [up ? "running" : (st.procStatus || "stopped")]),
        el("td", { class: "lh-actions" }, buttons),
      ]);
    });
    const startAll = el("button", { class: "ghost" }, ["▶ Start all"]); startAll.addEventListener("click", () => act("start-all"));
    const stopAll = el("button", { class: "ghost" }, ["■ Stop all"]); stopAll.addEventListener("click", () => act("stop-all"));
    body.replaceChildren(
      el("div", { class: "lh-bulk" }, [startAll, stopAll]),
      el("div", { style: "overflow-x:auto" }, [
        el("table", { class: "pkgtable" }, [
          el("thead", {}, [el("tr", {}, ["Project", "Port", "Group", "State", ""].map((h) => el("th", {}, [h])))]),
          el("tbody", {}, rows),
        ]),
      ]),
      el("div", { class: "hint" }, [
        "Drawn from the work machine's registry over the tunnel. The aggregator's own look-and-feel is only available on the local dashboard, where the browser can reach its port directly.",
      ]),
    );
  }

  function renderAbsent(s) {
    body.replaceChildren(el("div", { class: "lh-empty" }, [
      el("h3", {}, ["LocalHost isn't where Claudstermind expected"]),
      el("p", {}, ["It should sit beside Claudstermind in the workspace root, as its own repository:"]),
      el("pre", {}, ["<root>/\n├── Claudstermind/\n└── LocalHost/registry.json"]),
      el("p", {}, ["If it lives elsewhere, set ", el("code", {}, ["CLAUDSTERMIND_LOCALHOST_DIR"]), " to its path and restart the dashboard."]),
      s.error ? el("p", { class: "hint" }, [s.error]) : "",
    ]));
  }

  async function refresh() {
    let s = {};
    try { s = await (await fetch("/api/localhost/status", { cache: "no-store" })).json(); } catch { s = { error: "dashboard unreachable" }; }

    if (s.reason === "local-not-connected") {
      strip.replaceChildren(el("span", { class: "lh-dot --down" }, []), el("b", {}, ["Work machine offline"]),
        el("span", { class: "hint" }, ["  the tunnel isn't connected, so there's nothing to control"]));
      body.replaceChildren(el("div", { class: "lh-empty" }, [el("h3", {}, ["Not connected"]),
        el("p", {}, ["The LocalHost aggregator runs on the work machine. Bring its dashboard up and this reconnects."])]));
      return;
    }

    const restart = el("button", { class: "ghost" }, ["⟳ restart aggregator"]);
    restart.addEventListener("click", async () => {
      restart.disabled = true;
      try {
        if (isLocal) await fetch("/api/localhost/restart", { method: "POST" });
        else await act("aggregator-restart");
        delete body.dataset.src;                    // force the frame to reload against the fresh process
      } catch {}
      setTimeout(refresh, 1200);
    });

    strip.replaceChildren(
      el("span", { class: "lh-dot " + (s.running ? "--up" : "--down") }, []),
      el("b", {}, ["LocalHost Aggregator"]),
      el("span", { class: "hint" }, [s.running ? `  running on :${s.port}${s.owned ? " · started by Claudstermind" : " · started outside Claudstermind"}` : "  not running"]),
      el("span", { class: "ws-spacer" }, []),
      s.present ? restart : "",
      s.running && isLocal ? el("a", { class: "ghost", href: s.url, target: "_blank", rel: "noreferrer" }, ["Open standalone ↗"]) : "",
    );

    if (!s.present) return renderAbsent(s);
    if (!s.running) {
      body.replaceChildren(el("div", { class: "lh-empty" }, [
        el("h3", {}, ["The aggregator isn't running"]),
        el("p", {}, ["Claudstermind starts it automatically on boot. Use ⟳ to try again."]),
        s.error ? el("pre", {}, [s.error]) : "",
      ]));
      delete body.dataset.src;
      return;
    }
    if (isLocal) renderLocalFrame(s); else renderRemoteList(s);
  }

  refresh();
  clearInterval(LH_TIMER);
  // Slow poll: this only drives the status strip (and the remote table). The framed
  // aggregator does its own refreshing, exactly as it does standalone.
  LH_TIMER = setInterval(refresh, isLocal ? 10000 : 5000);
  root.replaceChildren(strip, body);
  return root;
}

/* ---------- LocalHost mirror: view a dev server on the work machine through the tunnel ---------- */
function viewMirror() {
  const root = el("div", {}, []);
  const list = el("div", { class: "mirror-list" }, [el("div", { class: "hint" }, ["Loading local servers…"])]);
  const frame = el("iframe", { class: "mirror-frame", title: "mirror" });
  const bar = el("div", { class: "mirror-bar" }, []);
  const openMirror = (port, name) => {
    bar.replaceChildren(el("b", {}, [name || ("port " + port)]), el("span", { class: "hint" }, ["  /mirror/" + port + "/"]), el("span", { class: "ws-spacer" }, []),
      (() => { const a = el("a", { class: "ghost", href: "/mirror/" + port + "/", target: "_blank" }, ["Open in new tab ↗"]); return a; })());
    frame.setAttribute("src", "/mirror/" + port + "/");
  };
  (async () => {
    let d = {}; try { d = await (await fetch("/api/mirror/list", { cache: "no-store" })).json(); } catch {}
    const projects = d.projects || [];
    if (!projects.length) { list.replaceChildren(el("div", { class: "hint" }, [d.reason === "local-not-connected" ? "The work machine isn't connected." : "No local servers registered (LocalHost/registry.json)."])); return; }
    list.replaceChildren(...projects.map((p) => {
      const b = el("button", { class: "ghost" }, [`${p.name} · :${p.port}`]);
      b.addEventListener("click", () => openMirror(p.port, p.name));
      return b;
    }));
    openMirror(projects[0].port, projects[0].name);
  })();
  root.replaceChildren(
    el("div", { class: "hint" }, ["View a dev server running on the work machine, here in your browser (proxied through the tunnel). Root-absolute assets, API calls and form posts are routed by provenance, so SPAs work. Live-reload (HMR) still won't — that needs a WebSocket, which the proxy doesn't carry."]),
    list, bar, frame,
  );
  return root;
}

/* ---------- Admin: sidebar + content pane (§5), behind the AdminGate (§5.3) ---------- */
function adminGateCard(title, sub, href, cta) {
  return el("div", { class: "gate", style: "min-height:40vh" }, [
    el("h2", { class: "gate-title" }, [title]), el("p", { class: "gate-sub" }, [sub]),
    href ? el("a", { href, class: "loginbtn" }, [cta]) : "",
  ]);
}
function viewAdmin(sectionId) {
  // AdminGate — four states from /api/me. Local mode is implicitly ancient.
  if (ME.mode === "live") {
    if (!ME.authenticated) return adminGateCard("Sign in", "The admin surface is for the ancient admin.", "/auth/login", "Login with AncientHub");
    if (!(ME.roles || []).includes("ancient")) return adminGateCard("Ancient only", "Your account isn't ancient — admin is limited to the ancient role.", "/auth/logout", "Sign out");
  }
  const side = el("aside", { class: "admin-side" }, ADMIN_SECTIONS.map((s) => {
    const a = el("a", { class: "admin-item" + (s.id === sectionId ? " on" : "") + (s.enabled ? "" : " disabled"), href: s.enabled ? "#admin/" + s.id : "#admin" }, [
      el("span", { class: "admin-ic" }, [s.icon]), el("span", { class: "admin-label" }, [s.label]),
      s.enabled ? "" : el("span", { class: "admin-soon" }, ["soon"]),
    ]);
    if (!s.enabled) a.addEventListener("click", (e) => e.preventDefault());
    return a;
  }));
  const pane = el("div", { class: "admin-pane" }, []);
  const s = ADMIN_SECTIONS.find((x) => x.id === sectionId);
  if (!sectionId) pane.replaceChildren(el("div", { class: "admin-empty" }, ["Select a section from the left to begin."]));
  else if (!s || !s.enabled) pane.replaceChildren(el("div", { class: "admin-empty" }, ["That section is planned — coming later."]));
  else if (sectionId === "ops") pane.replaceChildren(viewOps());
  else if (sectionId === "relay") pane.replaceChildren(viewRelay());
  else if (sectionId === "tokens") pane.replaceChildren(viewTokens());
  else if (sectionId === "deploy") pane.replaceChildren(viewDeploy());
  else pane.replaceChildren(el("div", { class: "admin-empty" }, ["Unknown section."]));
  return el("div", { class: "admin-layout" }, [side, pane]);
}
/* ---------- Admin → Deploy & Version (§10 + the §3 deploy button) ---------- */
let DEPLOY_ES = null;
let RESTART_ES = null;   // the self-restart pre-flight+restart log stream (dashboard-self-restart-safety)

/** Shared by Deploy's and Restart's log streams: both emit bare JSON-string lines over SSE,
 *  terminated by a "__DONE_OK__"/"__DONE_FAIL__" sentinel (see dashboard/server.mjs's
 *  deployLog/restartLog, and relay/server.mjs's matching deploy-done/restart-done translation
 *  for the tunnel-forwarded path) — one parser for both so a stream only differs by its URL
 *  and what happens on the terminal sentinel.
 *
 *  `opts.timeoutMs` + `opts.onFallback` are optional and only used by the restart stream
 *  (see openRestartStream below): a real remote restart severs the work-machine↔relay tunnel
 *  as a side effect, so the terminal sentinel — written from the dying process over that same
 *  socket — can simply never arrive, and critically the browser↔relay SSE connection itself
 *  stays healthy (only the relay↔work-machine hop broke), so `onerror` never fires either.
 *  A timeout is the only fallback that reliably closes that gap; `onerror` still fires (and
 *  resolves faster) for the local case where the TCP connection genuinely drops. Both paths
 *  are guarded so at most one of onDone/onFallback ever runs, and a normal sentinel always
 *  cancels the pending timeout. */
function openLogStream(url, term, onDone, opts) {
  term.textContent = "";
  const es = new EventSource(url);
  let settled = false;
  let timer = null;
  const clearFallbackTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  es.onmessage = (e) => {
    let line; try { line = JSON.parse(e.data); } catch { return; }
    if (line === "__DONE_OK__" || line === "__DONE_FAIL__") {
      settled = true; clearFallbackTimer();
      try { es.close(); } catch {}
      onDone(line === "__DONE_OK__");
      return;
    }
    term.textContent += line + "\n"; term.scrollTop = term.scrollHeight;
  };
  es.onerror = () => {
    try { es.close(); } catch {}
    if (settled) return;
    if (opts && opts.onFallback) { settled = true; clearFallbackTimer(); opts.onFallback("error"); }
  };
  if (opts && opts.timeoutMs && opts.onFallback) {
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { es.close(); } catch {}
      opts.onFallback("timeout");
    }, opts.timeoutMs);
  }
  return es;
}

/** After a real restart is triggered (restart-done ok:true), the dashboard process drops and
 *  comes back — the SSE stream itself dies with it, so there is nothing left to listen to.
 *  Poll the cheap, unauthenticated /api/version endpoint (the same one lib/deploy.mjs's
 *  blue-green verification trusts) until it answers again, and report success or a clear
 *  "still unreachable" failure — never silence (design's Wave-close acceptance §5). */
async function pollBackUp(noteEl, { attempts = 40, delayMs = 1500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      const v = await (await fetch("/api/version", { cache: "no-store", signal: AbortSignal.timeout(2000) })).json();
      if (v && v.version) { noteEl.textContent = "✓ Back up — v" + v.version + " reconnected."; return; }
    } catch { /* still down or unreachable through the tunnel — keep polling */ }
  }
  noteEl.textContent = "⚠ Restart triggered, but the dashboard hasn't answered again after a minute — check it manually.";
}

/** Deploy's zero-downtime blue-green swap (lib/deploy.mjs) keeps the OLD container alive and
 *  serving until the NEW one is health-checked — but stops the old one at the very end, exactly
 *  when a SUCCESSFUL deploy's final confirmation would be written. Viewed via the live site (the
 *  relay-forwarded stream — see relay/server.mjs's /api/deploy/stream, which has no buffered
 *  replay the way the local dashboard's own DEPLOY.log does), that connection dying is the worst
 *  possible moment for silence: it looks identical to a hang, right when the deploy actually
 *  succeeded. Poll /api/deploy/status until Live genuinely matches what was deployed, rather than
 *  trusting the stream alone to ever confirm it — the same "never silence" principle the restart
 *  path already has (pollBackUp above) and the automaton blueprint's §3 calls for explicitly. */
async function pollDeploySucceeded(noteEl, expectedVersion, { attempts = 60, delayMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      const st = await (await fetch("/api/deploy/status", { cache: "no-store", signal: AbortSignal.timeout(4000) })).json();
      if (st?.live?.version === expectedVersion) { noteEl.textContent = "✓ Deploy finished — live is now v" + expectedVersion + "."; return; }
    } catch { /* still mid-swap, or briefly unreachable — keep polling */ }
  }
  noteEl.textContent = "⚠ No confirmation received — check the version chip manually.";
}

function viewDeploy() {
  const root = el("div", { class: "deploy-wrap" }, []);
  // Wraps/contains both targets below it — visually the one number a Reload OR a Deploy each
  // converge on, per the admin-panel refinement this replaces the old side-by-side Live/Pending
  // cards with.
  const pendingBanner = el("div", { class: "deploy-pending" }, [el("div", { class: "hint" }, ["Loading version state…"])]);
  const term = el("pre", { class: "deploy-term" }, ["(no deploy run yet)"]);
  const actions = el("div", { class: "deploy-actions" }, []);
  const note = el("div", { class: "hint" }, []);

  // Self-restart safety: a sandboxed pre-flight, then (only on ok:true) the real restart —
  // gated identically to Deploy above (same canDeploy/canRestart condition) rather than a
  // new auth path, and reusing this same log-terminal rendering (openLogStream) rather than
  // building a second terminal widget. "Reload" is this button's user-facing name — it's the
  // local host's half of the same "pick up what's on disk" action Deploy is for the container.
  const rterm = el("pre", { class: "deploy-term" }, ["(no restart run yet)"]);
  const rActions = el("div", { class: "deploy-actions" }, []);
  const rNote = el("div", { class: "hint" }, []);
  let restarting = !!RESTART_ES;   // a stream from a previous mount of this section is still live
  let canRestart = true;           // updated by refresh() every poll; read by refreshRestartBtn()

  const verLine = (v) => v ? (v.gitSha || "") + (v.builtAt ? " · " + new Date(v.builtAt).toLocaleString() : "") : "unreachable";

  function openStream(expectedVersion) {
    try { DEPLOY_ES && DEPLOY_ES.close(); } catch {}
    DEPLOY_ES = openLogStream("/api/deploy/stream", term, (ok) => {
      note.textContent = ok ? "✓ Deploy finished — refresh version state." : "✗ Deploy failed — see the log.";
      refresh();
    }, expectedVersion ? {
      // ~2x a typical ~1min deploy's headroom — long enough that a merely-slow rebuild doesn't
      // trip it, short enough that a genuinely silent stream doesn't leave "Deploying…" stuck.
      timeoutMs: 90000,
      onFallback: () => {
        DEPLOY_ES = null;
        note.textContent = "No confirmation received — checking if it actually deployed…";
        pollDeploySucceeded(note, expectedVersion);
      },
    } : undefined);
  }

  function openRestartStream() {
    try { RESTART_ES && RESTART_ES.close(); } catch {}
    RESTART_ES = openLogStream("/api/dashboard/restart/stream", rterm, (ok) => {
      restarting = false;
      RESTART_ES = null;
      if (ok) {
        rNote.textContent = "Restarting… reconnecting";
        pollBackUp(rNote);
      } else {
        // The refusal reason (timeout / crashed / port bind failure / spawn-failed / …) is
        // written into the log itself by runSelfRestart's onLog (already prefixed "✗ "), not
        // carried as structured data over the stream — so the specific reason is the log's
        // last line verbatim, not a generic "restart failed".
        const lines = rterm.textContent.trim().split("\n");
        rNote.textContent = lines[lines.length - 1] || "✗ Restart refused — see the log.";
      }
      refreshRestartBtn();
    }, {
      // 40s: pre-flight's own runSelfRestart budget is up to 15s (dashboard/server.mjs's
      // timeoutMs default), plus the real `systemctl restart` round-trip (process teardown +
      // the unit coming back up) — 40s leaves comfortable headroom over that combined path
      // without leaving the button stuck on "Restarting…" for anywhere near a minute when the
      // sentinel is genuinely never coming (the remote/live-site restart case, where the
      // tunnel drop kills the sentinel's only carrier without ever erroring the browser's SSE
      // connection to the relay).
      timeoutMs: 40000,
      onFallback: () => {
        restarting = false;
        RESTART_ES = null;
        rNote.textContent = "No confirmation received — checking if it's back up…";
        refreshRestartBtn();
        pollBackUp(rNote);
      },
    });
  }

  async function refresh() {
    let st = {}; try { st = await (await fetch("/api/deploy/status", { cache: "no-store" })).json(); } catch {}
    const remote = !!st.remote;   // live site: the deploy runs on the work machine over the tunnel
    const pending = st.pending, live = st.live && st.live.version ? st.live : null;
    // "Local host: running" — what code this process actually has loaded, frozen at ITS OWN start
    // (pending.runningVersion — see lib/version.mjs), as opposed to `pending.version` (read live
    // off disk every call, so it's what a Reload would produce, not necessarily what's running
    // right now). Only the local host can have these diverge — a long-running process where files
    // can change without a restart; the container has no such gap, it's atomic rebuild-and-swap.
    const localRunning = pending ? { version: pending.runningVersion, gitSha: pending.gitSha, builtAt: pending.builtAt } : null;
    const localStale = !!(pending && localRunning && pending.version !== localRunning.version);
    const same = pending && live && pending.version === live.version && pending.gitSha === live.gitSha;

    // Deploy is available locally (direct) or on the live site when the work machine is connected.
    const canDeploy = !remote || st.localConnected;
    const deployBtn = el("button", { class: "loginbtn" + (same ? " secondary" : "") }, [st.running ? "Deploying…" : (same ? "Redeploy" : "Deploy ↗")]);
    if (st.running || !canDeploy) deployBtn.disabled = true;
    deployBtn.addEventListener("click", async () => {
      if (!confirm("Deploy the current build to brain.ancientholdings.eu? The relay rebuilds (~1 min).")) return;
      note.textContent = "Starting deploy…"; openStream(pending?.version);
      const r = await wsPost2("/api/deploy", {});
      if (!r.ok) { try { DEPLOY_ES.close(); } catch {} DEPLOY_ES = null; note.textContent = "⚠ " + (r.message || "could not start"); }
    });
    // No "show log" button: the log opens itself while a deploy is running (below) and the
    // tail is replayed after one finishes. There is nothing to show at any other time.
    actions.replaceChildren(deployBtn);
    if (remote && !st.localConnected) actions.append(el("span", { class: "hint" }, ["  (the work machine is offline)"]));
    if (st.running && !DEPLOY_ES) openStream(pending?.version);
    if (st.logTail && st.logTail.length && term.textContent === "(no deploy run yet)") term.textContent = st.logTail.join("\n");

    // Restart local dashboard: no dedicated status endpoint exists (unlike Deploy's
    // /api/deploy/status), so it is gated by the exact same remote/localConnected condition
    // Deploy just computed above rather than inventing a second one.
    canRestart = !remote || st.localConnected;
    refreshRestartBtn();

    pendingBanner.replaceChildren(
      el("div", { class: "deploy-card-t" }, ["Pending — what Reload or Deploy would produce"]),
      el("div", { class: "deploy-ver-lg" }, [pending ? "v" + pending.version : "—"]),
      el("div", { class: "deploy-sha" }, [verLine(pending)]),
      el("div", { class: "deploy-targets" }, [
        el("div", { class: "deploy-card" + (localStale ? " stale" : pending ? " ok" : "") }, [
          el("div", { class: "deploy-card-t" }, [remote ? "Local host · the work machine" : "Local host · this machine"]),
          el("div", { class: "deploy-ver" }, [localRunning ? "v" + localRunning.version : "—"]),
          el("div", { class: "deploy-sha" }, [remote && !st.localConnected ? "offline" : verLine(localRunning)]),
          localStale ? el("div", { class: "deploy-stale-note" }, ["⚠ running code is behind Pending — Reload to pick it up"]) : "",
          el("div", { class: "deploy-actions-row" }, [rActions, rNote]),
        ]),
        el("div", { class: "deploy-card" + (live ? (same ? " ok" : " stale") : "") }, [
          el("div", { class: "deploy-card-t" }, ["Live container · brain.ancientholdings.eu"]),
          el("div", { class: "deploy-ver" }, [live ? "v" + live.version : "—"]),
          el("div", { class: "deploy-sha" }, [verLine(live)]),
          live && !same ? el("div", { class: "deploy-stale-note" }, ["⚠ behind Pending — Deploy to update"]) : "",
          el("div", { class: "deploy-actions-row" }, [actions, note]),
        ]),
      ]),
    );
  }

  function refreshRestartBtn() {
    const restartBtn = el("button", { class: "loginbtn secondary" }, [restarting ? "Reloading…" : "⟳ Reload"]);
    if (restarting || !canRestart) restartBtn.disabled = true;
    restartBtn.addEventListener("click", async () => {
      if (!confirm("Run a sandboxed pre-flight and, only if it passes, reload the local dashboard now?")) return;
      restarting = true; rNote.textContent = "Starting reload pre-flight…"; openRestartStream();
      refreshRestartBtn();
      const r = await wsPost2("/api/dashboard/restart", {});
      if (!r.ok) { try { RESTART_ES.close(); } catch {} RESTART_ES = null; restarting = false; rNote.textContent = "⚠ " + (r.message || "could not start"); refreshRestartBtn(); }
    });
    rActions.replaceChildren(restartBtn);
    if (!canRestart) rActions.append(el("span", { class: "hint" }, ["  (the work machine is offline)"]));
  }

  root.replaceChildren(
    el("h2", { class: "deploy-h" }, ["Deploy & Version"]),
    el("div", { class: "hint" }, ["The version + changelog are cut by the agent when a change is built (Pantheonic §10). Reload picks up the local host's own on-disk code; Deploy ships it to the live container."]),
    pendingBanner,
    el("h3", { style: "margin:14px 0 4px" }, ["Deploy log"]), term,
    el("h3", { style: "margin:14px 0 4px" }, ["Reload log"]), rterm,
  );
  refresh();
  return root;
}
// A tiny POST helper for the admin (deploy/release) endpoints.
const wsPost2 = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then((r) => r.json()).catch(() => ({ ok: false }));

/* ---------- tree: the folder map of everything Claudstermind tracks ---------- */
function viewTree() {
  // build a nested tree from each repo's localPath
  const root = { children: {} };
  for (const r of MAP.repos) {
    const parts = (r.localPath || "").split(/[\\/]/).filter(Boolean);
    if (!parts.length || /no repo|embedded/i.test(r.localPath)) continue;
    let node = root;
    parts.forEach((p, i) => {
      node.children = node.children || {};
      node.children[p] = node.children[p] || { name: p, children: {} };
      node = node.children[p];
      if (i === parts.length - 1) node.repo = r;
    });
  }
  // non-tracked top-level folders shown for completeness
  const extras = { "_Archive": "archived husks/dupes (kept)", "Miscellaneous": "_Codices — your working codex", ".wasp": "master-pollinate.yml", ".ssh": "centralized keys", ".claude": "hooks + activity" };
  for (const [k, note] of Object.entries(extras)) if (!root.children[k]) root.children[k] = { name: k, note, children: {} };

  const lines = [];
  function walk(node, depth) {
    const keys = Object.keys(node.children || {}).sort((a, b) => {
      // folders (no repo) before repos, then alpha
      const ar = node.children[a].repo ? 1 : 0, br = node.children[b].repo ? 1 : 0;
      return ar - br || a.localeCompare(b);
    });
    keys.forEach((k) => {
      const c = node.children[k];
      const indent = "  ".repeat(depth);
      if (c.repo) {
        const r = c.repo, role = roleOf(r.role), org = repoOrg(r);
        const pub = (r.packages || []).find((p) => !p.private);
        lines.push(el("div", { class: "repo", style: `margin-left:${depth * 18}px` }, [
          el("span", { class: "glyph", style: `color:${role.color}` }, [role.glyph]),
          el("span", { class: "rn" }, [k]),
          el("span", { style: `color:${orgColor(org)};font-size:11px` }, [" ● " + org]),
          pub ? el("span", { class: "ver" }, ["  " + pub.name + "@" + pub.version]) : "",
          isMoving(r) ? el("span", { class: "move" }, ["  ⇄"]) : "",
        ]));
        attachTip(lines[lines.length - 1], r);
      } else {
        lines.push(el("div", { style: `margin-left:${depth * 18}px;padding:5px 8px;font-weight:600;font-size:13px` }, [
          el("span", { style: "color:var(--ink-dim)" }, ["▸ "]), k,
          c.note ? el("span", { class: "was", style: "font-weight:400" }, ["  — " + c.note]) : "",
        ]));
        walk(c, depth + 1);
      }
    });
  }
  walk(root, 0);
  return el("div", {}, [
    el("div", { class: "hint" }, ["The live folder map of everything Claudstermind tracks — ecosystem → role subfolder → repo. ", el("b", {}, [String(MAP.repos.length) + " repos"]), ". ● = GitHub org · glyph = Pantheonic role · ⇄ = pending movement. Hover a repo for detail."]),
    el("div", { class: "graphwrap", style: "padding:14px;font-family:ui-monospace,monospace" }, lines),
  ]);
}

/* ---------- brain: auto-captured cross-repo work state ---------- */
/* ---------- Learning loop: distil raw conversations → brain knowledge ---------- */
function learningPanel() {
  const box = el("div", { class: "learn-panel" }, [el("div", { class: "hint" }, ["Loading learning state…"])]);
  const local = ME.mode === "local";
  async function refresh() {
    let st = {}; try { st = await (await fetch("/api/distill/status", { cache: "no-store" })).json(); } catch { box.replaceChildren(el("div", { class: "hint" }, ["Distillation status unavailable."])); return; }
    const u = st.usage || {}, cfg = st.config || {};
    const usageText = `Claude distill usage: ${u.runs || 0} run(s) · ${((u.inputTokens || 0) + (u.outputTokens || 0)).toLocaleString()} tok · ~${fmtUsd(u.costUsd)}`;
    const note = el("span", { class: "hint", style: "margin-left:8px" }, []);
    const run = async (mode) => {
      note.textContent = mode === "claude" ? "Distilling with Claude…" : "Distilling…";
      const r = await fetch("/api/distill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) }).then((x) => x.json()).catch(() => ({ ok: false }));
      note.textContent = r.ok ? `✓ ${mode} distilled ${r.repos?.length || 0} repo(s) into the brain.` : "⚠ " + (r.message || "failed");
      refresh();
    };
    const heurBtn = el("button", { class: "ghost" }, ["Distil now (heuristic)"]);
    heurBtn.addEventListener("click", () => run("heuristic"));
    const toggle = el("input", { type: "checkbox" }); toggle.checked = !!cfg.claudeEnabled;
    toggle.addEventListener("change", async () => { await fetch("/api/distill/toggle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: toggle.checked }) }); refresh(); });
    const claudeBtn = el("button", { class: "ghost" }, ["Distil with Claude"]);
    claudeBtn.disabled = !cfg.claudeEnabled || !st.hasToken;
    claudeBtn.addEventListener("click", () => run("claude"));
    box.replaceChildren(
      el("div", { class: "learn-hd" }, [el("b", {}, ["Learning loop"]), el("span", { class: "hint" }, ["— distil raw conversations into per-repo knowledge (", el("code", {}, ["_distilled.md"]), ")"])]),
      local
        ? el("div", { class: "learn-row" }, [heurBtn, el("label", { class: "ws-trust" }, [toggle, "Claude distillation"]), claudeBtn, note])
        : el("div", { class: "hint" }, ["Distillation runs on the work machine (local dashboard). Toggle + trigger it there."]),
      el("div", { class: "learn-usage" }, [usageText]),
    );
  }
  refresh();
  return box;
}

function viewBrain() {
  const wrap = el("div", {}, [el("div", { class: "hint" }, ["Auto-captured by ", el("b", {}, ["brain-sync"]), " on every prompt (Stop hook) — the always-on cross-repo memory. Fresh sessions get this injected via the SessionStart hook, so any repo's session already knows what's been worked on everywhere."])]);
  wrap.append(learningPanel());
  const body = el("div", { id: "brainBody" }, [el("div", { class: "hint" }, ["Loading brain…"])]);
  wrap.append(body);
  (async () => {
    let d; try { d = await (await fetch("/api/brain")).json(); } catch { body.replaceChildren(el("div", { class: "hint" }, ["brain not reachable"])); return; }
    const fmtB = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? (n / 1024).toFixed(1) + " KB" : (n || 0) + " B";
    const base = (p) => (p || "").split(/[\\/]/).pop();
    // Join brain data onto MAP repos by local path (fallback: folder key / name).
    const idx = repoIndex(d.repos, (r) => r.repo, (r) => r.key);
    const maxCtx = Math.max(1, ...(d.repos || []).map((r) => r.contextBytes || 0));

    // Org "greater cardboards" in Map order, each holding its repo brain-cards.
    const grid = el("div", {});
    eachOrg((org, meta, repos) => {
      let orgBytes = 0, withBrain = 0;
      const cards = repos.map((r) => {
        const b = idx.get(r) || {};
        orgBytes += b.contextBytes || 0;
        if (b.hasState) withBrain++;
        const pct = Math.round(100 * (b.contextBytes || 0) / maxCtx);
        const stateLine = b.hasState
          ? `${(b.branch || "").split("  ")[0]} · ${b.dirty || "clean"}`
          : (b.contextBytes ? "curated only — not worked in yet" : "no brain yet");
        return repoCard(r, {
          stripe: b.hasState ? roleOf(r.role).color : "var(--line)",
          branch: b.updated ? b.updated.slice(5, 16).replace("T", " ") : "",
          muted: !b.hasState && !b.contextBytes,
          sublines: [
            stateLine,
            `${fmtB(b.contextBytes || 0)} · ${b.curatedFiles || 0} docs · ${b.worklogCount || 0} log`,
            ...(b.raw && b.raw.conversations ? [el("div", { class: "rc-sub", style: "color:#34d399" }, [`⌗ raw chat: ${fmtB(b.raw.bytes)} · ${b.raw.conversations} conv · ${b.raw.turns} turns`])] : []),
          ],
          extra: [el("div", { style: "height:5px;border-radius:4px;background:var(--chip);overflow:hidden;margin-top:2px" },
            [el("div", { style: `height:100%;width:${pct}%;background:${roleOf(r.role).color}` })])],
        });
      });
      grid.append(orgGroup(org, meta, cards,
        el("span", { class: "was", style: "font-size:11px" }, [`${withBrain}/${repos.length} active · ${fmtB(orgBytes)}`])));
    });
    const tracked = MAP.repos.filter((r) => r.localPath && !/no repo|embedded|\(/i.test(r.localPath));
    // daily knowledge log
    const days = Object.keys(d.daily || {}).sort();
    const dailyStrip = el("div", { class: "statbar" }, days.slice(-14).map((day) => {
      const e = d.daily[day];
      return el("div", { class: "stat", style: "min-width:104px" }, [
        el("div", { class: "n", style: "font-size:15px;color:var(--accent)" }, [fmtB(e.kb)]),
        el("div", { class: "l" }, [day.slice(5) + " · " + e.changes + " chg"]),
        el("div", { class: "was", style: "font-size:10px" }, [(e.repos || []).map(base).slice(0, 3).join(", ")]),
      ]);
    }));
    const T = d.totals || {};
    const log = el("table", { class: "pkgtable" }, [
      el("thead", {}, [el("tr", {}, ["When", "Work log (newest first)"].map((h) => el("th", {}, [h])))]),
      el("tbody", {}, (d.worklog || []).map((l) => {
        const m = l.match(/^- (\S+) · \*\*(.*?)\*\* · (.*)$/);
        return el("tr", {}, m ? [el("td", { class: "was" }, [m[1].slice(0, 16).replace("T", " ")]), el("td", {}, [el("b", {}, [m[2]]), el("span", { class: "was" }, [" — " + m[3]])])] : [el("td", {}, [""]), el("td", {}, [l])]);
      })),
    ]);
    body.replaceChildren(
      el("div", { class: "statbar" }, [
        el("div", { class: "stat" }, [el("div", { class: "n" }, [String(tracked.length)]), el("div", { class: "l" }, ["tracked repos"])]),
        el("div", { class: "stat" }, [el("div", { class: "n" }, [String(T.withState || 0)]), el("div", { class: "l" }, ["with auto-state"])]),
        el("div", { class: "stat" }, [el("div", { class: "n", style: "color:var(--accent)" }, [fmtB(T.contextBytes || 0)]), el("div", { class: "l" }, ["total knowledge base"])]),
        el("div", { class: "stat" }, [el("div", { class: "n" }, [String((d.worklog || []).length)]), el("div", { class: "l" }, ["worklog entries"])]),
      ]),
      days.length ? el("div", { class: "hint", style: "margin-top:4px" }, [el("b", {}, ["📅 Daily knowledge log"]), " — brain size + activity per day (your work diary):"]) : "",
      days.length ? dailyStrip : "",
      el("div", { class: "hint", style: "margin-top:12px" }, ["Every tracked repo, in Map order. Bar = knowledge size relative to the largest. \"no brain yet\" = never worked in."]), grid,
      el("div", { class: "hint", style: "margin-top:16px" }, ["Chronological work log:"]), log,
    );
  })();
  return wrap;
}

/* ---------- cascade: live master-pollinate progress ----------
   Reads .wasp state files through /api/cascade. The dashboard does not own a run:
   a cascade fired from the Ops button and one an agent runs in a terminal write the
   SAME files, so both light this tab up identically. */
let CASCADE_TIMER = null;
const GATE_GLYPH = { done: "✅", running: "⏳", failed: "❌", skipped: "⏭️", pending: "•" };
const GATE_COLOR = { done: "#34d399", running: "#fbbf24", failed: "#f87171", skipped: "#64748b", pending: "#94a3b8" };

// Same glyph-first rule the server-side parser uses: the marker wins over the words.
function classifyPin(v) {
  const s = String(v).toLowerCase();
  if (s.includes("❌") || s.includes("fail")) return "failed";
  if (s.includes("⏳") || s.includes("pending")) return "running";
  if (s.includes("✅") || s.includes("applied")) return "done";
  return "pending";
}

function gateRow(g) {
  return el("div", { class: "repo" }, [
    el("span", { class: "glyph", style: `color:${GATE_COLOR[g.gate]}` }, [GATE_GLYPH[g.gate] || "•"]),
    el("span", { class: "rn" }, [g.name || "(unnamed)"]),
    el("span", { class: "ver" }, [
      [g.repo && g.repo !== g.name ? g.repo : "", g.transition, g.tag].filter(Boolean).join(" · ") || g.status,
    ]),
  ]);
}

function runCard(s, { title, sub }) {
  const c = s.counts || {};
  const total = s.gates.length;
  const done = c.done || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const kids = [
    el("div", { class: "desc" }, [
      el("b", {}, [title]),
      el("span", { class: "ver" }, [
        `  ${s.command || "—"} · ${s.status}${s.mode ? " · " + s.mode : ""}${s.runId ? " · run " + s.runId : ""}`,
      ]),
    ]),
  ];

  if (total) {
    kids.push(
      el("div", { style: "height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin:6px 0" }, [
        el("div", { style: `height:100%;width:${pct}%;background:${s.failed ? GATE_COLOR.failed : GATE_COLOR.done};transition:width .4s` }),
      ]),
      el("div", { class: "hint" }, [
        `${done}/${total} published` +
        (c.running ? ` · ${c.running} in flight` : "") +
        (c.failed ? ` · ${c.failed} failed` : "") +
        (c.skipped ? ` · ${c.skipped} skipped` : ""),
      ]),
      ...s.gates.map(gateRow),
    );
  } else {
    kids.push(el("div", { class: "hint" }, ["No package gates recorded yet — the run is still scanning."]));
  }

  // The consumer pin updates — for a master run this is the most interesting table in
  // the file: it is the cross-workspace hops, the edges no single cross-pollinate.yml
  // owns. Column names differ per tier (Consumer Repo / Target workspace / …), so render
  // whatever headers the file actually used rather than assuming a fixed shape.
  if (s.pins && s.pins.length) {
    const cols = [...new Set(s.pins.flatMap((p) => Object.keys(p)))];
    kids.push(
      el("div", { class: "hint", style: "margin-top:10px" }, [`Consumer pin updates (${s.pins.length})`]),
      el("table", { class: "pkgtable" }, [
        el("thead", {}, [el("tr", {}, cols.map((c) => el("th", {}, [c])))]),
        el("tbody", {}, s.pins.map((p) => el("tr", {}, cols.map((c) => {
          const v = p[c] || "";
          // The "Applied?" cell carries the ✅/⏳ — colour it like a gate.
          const g = /applied|status/i.test(c) ? classifyPin(v) : null;
          return el("td", {}, [g ? el("span", { style: `color:${GATE_COLOR[g]}` }, [v]) : v]);
        })))),
      ]),
    );
  }

  if (sub) kids.push(sub);

  if (s.failure) {
    kids.push(el("div", {
      class: "movecard",
      style: `border-color:${GATE_COLOR.failed};white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;margin-top:8px`,
    }, [el("b", { style: `color:${GATE_COLOR.failed}` }, ["Failure context\n"]), s.failure]));
  }

  if (s.history && s.history.length) {
    kids.push(el("details", { style: "margin-top:8px" }, [
      el("summary", { class: "hint", style: "cursor:pointer" }, [`Run history (${s.history.length})`]),
      el("div", { style: "font-family:ui-monospace,monospace;font-size:11px;color:var(--ink-dim);padding-top:6px;white-space:pre-wrap" },
        [s.history.slice().reverse().join("\n")]),
    ]));
  }

  return el("div", { class: "orgcard", style: "padding:10px;margin-bottom:10px" }, kids);
}

function viewCascade() {
  if (CASCADE_TIMER) { clearInterval(CASCADE_TIMER); CASCADE_TIMER = null; }
  const box = el("div", { id: "cascadeBox" }, [el("div", { class: "hint" }, ["Reading .wasp state…"])]);

  const banner = (msg) => box.replaceChildren(
    el("div", { class: "movecard", style: `border-color:${GATE_COLOR.failed}` }, [
      el("div", { class: "desc" }, [el("b", { style: `color:${GATE_COLOR.failed}` }, ["Cascade unavailable"])]),
      el("div", { class: "hint" }, [msg]),
    ]));

  async function refresh() {
    let d;
    try {
      const r = await fetch("/api/cascade");
      // A 401/403 body is valid JSON, so it would sail past a bare .json() and then
      // blow up on d.workspaces — freezing the tab on "Reading .wasp state…" forever
      // and throwing every 2s. Check the status, not just the parse.
      if (!r.ok) return banner(r.status === 401 ? "Your session expired — sign in again." : `HTTP ${r.status} from /api/cascade.`);
      d = await r.json();
    } catch (e) { return banner(`Could not reach the dashboard server: ${e}`); }

    // The server answers 200 with an `error` field when it could not read the state
    // files at all. Rendering that as "no run in progress" would be a false negative on
    // the highest-blast-radius operation in the suite.
    if (d.error) return banner(`Could not read the .wasp state files: ${d.error}`);
    d.workspaces = d.workspaces || [];
    d.repos = d.repos || [];

    const head = el("div", { class: "statbar" }, [
      el("div", { class: "stat" }, [
        // A run can be in flight AND already have a broken package gate — say both,
        // rather than a reassuring "RUNNING" over a failed publish.
        el("div", { class: "n", style: `color:${d.failed ? GATE_COLOR.failed : d.running ? GATE_COLOR.running : "#34d399"}` },
          [d.running && d.failed ? "RUNNING ⚠" : d.running ? "RUNNING" : d.failed ? "FAILED" : d.everRun ? "IDLE" : "—"]),
        el("div", { class: "l" }, ["cascade"]),
      ]),
      el("div", { class: "stat" }, [
        el("div", { class: "n" }, [String(d.workspaces.filter((w) => w.state).length) + "/" + d.workspaces.length]),
        el("div", { class: "l" }, ["workspaces with runs"]),
      ]),
      el("div", { class: "stat" }, [el("div", { class: "n" }, [String(d.repos.length)]), el("div", { class: "l" }, ["repo pollinate runs"])]),
      el("div", { class: "stat" }, [
        el("div", { class: "n", style: "font-size:13px" }, [d.lastUpdate ? d.lastUpdate.slice(0, 16).replace("T", " ") : "never"]),
        el("div", { class: "l" }, ["last state update"]),
      ]),
    ]);

    if (!d.everRun) {
      box.replaceChildren(head, el("div", { class: "movecard" }, [
        el("div", { class: "desc" }, [el("b", {}, ["No cascade run in progress"])]),
        el("div", { class: "hint" }, [
          "Nothing has written a .wasp state file yet. Start one from the Ops tab (dry-run), or run ",
          el("code", {}, ["/wasp:master-pollinate"]),
          " in a terminal — either way its progress appears here live.",
        ]),
      ]));
      return;
    }

    const cards = [];
    if (d.master) cards.push(runCard(d.master, { title: "Suite — master-pollinate" }));

    for (const w of d.workspaces) {
      if (!w.state) {
        cards.push(el("div", { class: "orgcard", style: `padding:10px;margin-bottom:10px;opacity:.55${w.missing ? `;border-color:${GATE_COLOR.failed}` : ""}` }, [
          el("div", { class: "desc" }, [el("b", {}, [w.name]), el("span", { class: "ver" }, [w.missing ? "  MISSING" : "  no run"])]),
          el("div", { class: "hint" }, [
            w.missing ? `⚠ declared in master-pollinate.yml as "${w.path}", but that folder is not on disk — this workspace is invisible to the cascade.`
              : w.configured ? "cross-pollinate configured, never run."
              : "⚠ no .wasp/cross-pollinate.yml — cannot join a suite cascade.",
          ]),
        ]));
        continue;
      }
      const repos = d.repos.filter((r) => r.workspace === w.name);
      const sub = repos.length
        ? el("div", { style: "margin-top:8px;padding-left:10px;border-left:2px solid var(--line)" }, [
            el("div", { class: "hint" }, ["Repo runs (tier 3 — pollinate)"]),
            ...repos.map((r) => {
              // Never default to ✅. A repo sitting at `ci-waiting` with no gates parsed
              // would otherwise render as a green tick over an unfinished publish.
              const g = r.failed ? "failed" : r.running ? "running" : r.status === "complete" ? "done" : "pending";
              return el("div", { class: "repo" }, [
                el("span", { class: "glyph", style: `color:${GATE_COLOR[g]}` }, [GATE_GLYPH[g]]),
                el("span", { class: "rn" }, [r.label]),
                el("span", { class: "ver" }, [`${r.status} · ${(r.counts.done || 0)}/${r.gates.length} gates`]),
              ]);
            }),
          ])
        : null;
      cards.push(runCard(w.state, { title: `${w.name} — cross-pollinate`, sub }));
    }

    box.replaceChildren(head, ...cards);
  }

  refresh();
  CASCADE_TIMER = setInterval(refresh, 2000);

  return el("div", {}, [
    el("div", { class: "hint" }, [
      "Live cascade progress, read straight from the ",
      el("code", {}, [".wasp"]),
      " state files — so a run an agent started in a terminal shows here exactly like one fired from Ops. Polls every 2s.",
    ]),
    box,
  ]);
}

/* ---------- git state: uncommitted + unpushed, per repo ----------
   The question this answers: across dozens of repos, what have I NOT saved? Two
   distinct hazards, coloured distinctly:
     • never-pushed branch  → RED    (work that exists ONLY on this disk — the scariest)
     • unpushed commits     → BLUE   (committed, but not on the remote yet)
     • uncommitted changes  → AMBER  (dirty working tree)
   A full sweep spawns a git process per repo (~3-4s), so this does NOT poll fast:
   it loads on open, offers a manual refresh, and re-checks every 25s. */
let GIT_TIMER = null;
let LH_TIMER = null;
const GIT_COLOR = { never: "#f87171", unpushed: "#60a5fa", dirty: "#fbbf24", clean: "#34d399" };

function badge(text, color, title) {
  return el("span", {
    title: title || "",
    style: `display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin:2px 4px 2px 0;` +
      `color:${color};border:1px solid ${color}55;background:${color}18`,
  }, [text]);
}

// A git repo cardboard, built on the shared repoCard shell so it lines up with Brain.
// `mr` is the MAP repo (for name/role/order); `g` is the git-status data (may be absent).
function gitRepoCard(mr, g) {
  if (!g) {
    // In the map, but no git data — the folder is missing or isn't a git repo.
    return repoCard(mr, { stripe: "var(--line)", muted: true, sublines: ["not a git repo on disk"] });
  }
  const u = g.uncommitted, s = g.summary;
  const badges = [];
  for (const b of s.neverPushedBranches) {
    badges.push(badge(`⚠ ${b}: never pushed`, GIT_COLOR.never, "This branch exists only on your disk — no remote copy at all."));
  }
  for (const b of s.aheadBranches) {
    badges.push(badge(`↑ ${b.name}: ${b.ahead} unpushed`, GIT_COLOR.unpushed, "Commits that exist locally but not on the remote."));
  }
  if (s.dirty) {
    const parts = [];
    if (u.staged) parts.push(`${u.staged} staged`);
    if (u.unstaged) parts.push(`${u.unstaged} unstaged`);
    if (u.untracked) parts.push(`${u.untracked} untracked`);
    if (u.conflicted) parts.push(`${u.conflicted} conflicted`);
    badges.push(badge(`✎ ${u.total} uncommitted`, GIT_COLOR.dirty, parts.join(" · ")));
  }
  for (const b of s.behindBranches) {
    badges.push(badge(`↓ ${b.name}: ${b.behind} behind`, "#a78bfa", "The remote has commits you don't — a pull would fetch them."));
  }
  if (!badges.length) badges.push(badge("✓ clean & pushed", GIT_COLOR.clean));

  const fileList = s.dirty && u.files.length
    ? el("details", {}, [
        el("summary", { class: "hint", style: "cursor:pointer;font-size:11px" }, [`show ${u.total} changed file${u.total > 1 ? "s" : ""}`]),
        el("div", { style: "font-family:ui-monospace,monospace;font-size:11px;color:var(--ink-dim);padding-top:5px;white-space:pre-wrap;max-height:200px;overflow:auto" },
          [u.files.join("\n") + (u.total > u.files.length ? `\n… +${u.total - u.files.length} more` : "")]),
      ])
    : null;

  const stripe = s.neverPushedBranches.length ? GIT_COLOR.never
    : s.hasUnpushed ? GIT_COLOR.unpushed
    : s.dirty ? GIT_COLOR.dirty
    : GIT_COLOR.clean;

  // Act, don't just observe: commit the dirty tree / pull remote work / push the branch.
  // Only when the viewer may actually act (ancient + — on the relay — bridge connected);
  // a modern/read-only or disconnected viewer sees the state without dead buttons.
  const actions = [];
  if (canAct()) {
    if (s.dirty) {
      actions.push(el("button", { class: "gitbtn", title: "Stage everything and commit", onclick: (e) => gitCommit(g, e.currentTarget) }, ["✎ Commit"]));
    }
    const behind = (s.behindBranches || []).reduce((n, b) => n + (b.behind || 0), 0);
    if (behind) {
      actions.push(el("button", { class: "gitbtn", title: "Pull the remote commits (from another machine) and rebase your work on top", onclick: (e) => gitPull(g, e.currentTarget) }, [`↓ Pull ${behind}`]));
    }
    if (s.hasUnpushed) {
      const label = s.neverPushedBranches.length ? "⚠ Push (first push)" : `↑ Push ${s.unpushedCommits || ""}`.trim();
      actions.push(el("button", { class: "gitbtn", title: "Push the current branch to origin", onclick: (e) => gitPush(g, e.currentTarget) }, [label]));
    }
  }
  const msg = el("div", { class: "rc-sub gitmsg", hidden: true });

  return repoCard(mr, {
    stripe,
    branch: g.branch,
    muted: !s.attention,
    extra: [
      el("div", { style: "display:flex;flex-wrap:wrap;margin-top:2px" }, badges),
      ...(actions.length ? [el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-top:2px" }, actions)] : []),
      msg,
      ...(fileList ? [fileList] : []),
    ],
  });
}

// Report an action's result on the card, then refresh JUST THAT CARD — not the whole
// workspace — so the rest of the view stays put instead of blanking during a re-scan.
async function gitActionDone(btn, result, g) {
  const card = btn.closest(".repocard");
  const msg = card && card.querySelector(".gitmsg");
  if (msg) { msg.hidden = false; msg.textContent = result.message || (result.ok ? "done" : "failed"); msg.style.color = result.ok ? GIT_COLOR.clean : GIT_COLOR.never; }
  if (!result.ok || !card || !g) return;
  try {
    const fresh = await (await fetch("/api/git/repo?path=" + encodeURIComponent(g.localPath))).json();
    if (fresh && !fresh.error) {
      const mr = (MAP.repos || []).find((r) => r.id === fresh.id) || { name: fresh.name, localPath: fresh.localPath, role: "infra", org: { target: "" } };
      card.replaceWith(gitRepoCard(mr, fresh));   // swap only this card in place
    }
  } catch { /* leave the card; the periodic 25s scan will reconcile */ }
}
async function gitPost(pathq, body, btn, g) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = "…";
  try {
    const r = await (await fetch(pathq, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
    await gitActionDone(btn, r, g);
  } catch (e) { await gitActionDone(btn, { ok: false, message: String(e) }, g); }
  btn.disabled = false; btn.textContent = old;
}
/* ---------- themed modal — replaces window.prompt/confirm ---------- */
// A promise-based dialog matching the dashboard theme. `editable` shows a textarea
// (returns its text on confirm); otherwise it's a confirm dialog (returns true).
function showModal({ title, sub, value = "", editable = false, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let ta = null;
    const finish = (result) => { document.removeEventListener("keydown", onKey); overlay.remove(); resolve(result); };
    const onKey = (e) => {
      if (e.key === "Escape") finish(editable ? null : false);
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) finish(editable ? (ta ? ta.value : "") : true);
    };
    if (editable) { ta = el("textarea", { spellcheck: "false" }); ta.value = value; }
    const confirmBtn = el("button", { class: "ghost btn-primary", style: danger ? "background:#f87171;border-color:#f87171" : "" },
      [confirmLabel]);
    confirmBtn.addEventListener("click", () => finish(editable ? ta.value : true));
    const cancelBtn = el("button", { class: "ghost" }, ["Cancel"]);
    cancelBtn.addEventListener("click", () => finish(editable ? null : false));

    const overlay = el("div", { class: "modal-overlay" }, [
      el("div", { class: "modal" }, [
        el("div", { class: "modal-hd" }, [el("span", { class: "dot" }), title]),
        el("div", { class: "modal-bd" }, [
          sub ? el("div", { class: "modal-sub" }, [sub]) : "",
          ...(editable ? [ta] : []),
        ]),
        el("div", { class: "modal-ft" }, [
          editable ? el("span", { class: "modal-hint" }, ["⌘/Ctrl+Enter to confirm · Esc to cancel"]) : "",
          cancelBtn, confirmBtn,
        ]),
      ]),
    ]);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) finish(editable ? null : false); });
    document.body.append(overlay);
    document.addEventListener("keydown", onKey);
    if (ta) { ta.focus(); ta.select(); } else confirmBtn.focus();
  });
}

/* ---------- folder browser — picks an absolute server-side path (e.g. backup location)
   without the user ever typing/pasting one. Server-driven (GET /api/fs/browse), local-only:
   it lists directories the work machine can actually see, so there's no risk of a mistyped
   or badly-quoted path (spaces and all) landing in a config field. ---------- */
function showFolderBrowser(startPath) {
  return new Promise((resolve) => {
    const finish = (result) => { document.removeEventListener("keydown", onKey); overlay.remove(); resolve(result); };
    const onKey = (e) => { if (e.key === "Escape") finish(null); };

    const pathInput = el("input", { type: "text", spellcheck: "false",
      style: "flex:1;background:var(--chip);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:5px 9px;font-family:ui-monospace,monospace;font-size:12px" });
    const goBtn = el("button", { class: "ghost" }, ["Go"]);
    const list = el("div", { style: "max-height:320px;overflow:auto;margin-top:10px;display:flex;flex-direction:column;gap:2px" });
    const errBox = el("div", { class: "modal-sub" }, []);
    const selectBtn = el("button", { class: "ghost btn-primary" }, ["Select this folder"]);
    const cancelBtn = el("button", { class: "ghost" }, ["Cancel"]);

    const rowStyle = "display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px";
    let current = startPath || "";

    async function load(p) {
      let d;
      try { d = await (await fetch("/api/fs/browse?path=" + encodeURIComponent(p || ""))).json(); }
      catch (e) { errBox.textContent = "Could not reach the dashboard: " + e; return; }
      if (!d.ok) { errBox.textContent = d.message || "Cannot read that folder."; return; }
      errBox.textContent = "";
      current = d.path;
      pathInput.value = d.path;
      const rows = [];
      if (d.parent) {
        const up = el("div", { style: rowStyle }, ["⬆  .. (up)"]);
        up.addEventListener("click", () => load(d.parent));
        rows.push(up);
      }
      for (const dir of d.dirs) {
        const row = el("div", { style: rowStyle }, ["📁  " + dir.name]);
        row.addEventListener("mouseenter", () => row.style.background = "var(--chip)");
        row.addEventListener("mouseleave", () => row.style.background = "");
        row.addEventListener("click", () => load(dir.path));
        rows.push(row);
      }
      if (!rows.length) rows.push(el("div", { class: "hint" }, ["No subfolders here — “Select this folder” still works."]));
      list.replaceChildren(...rows);
    }

    goBtn.addEventListener("click", () => load(pathInput.value));
    pathInput.addEventListener("keydown", (e) => { if (e.key === "Enter") load(pathInput.value); });
    selectBtn.addEventListener("click", () => finish(current));
    cancelBtn.addEventListener("click", () => finish(null));

    const overlay = el("div", { class: "modal-overlay" }, [
      el("div", { class: "modal", style: "max-width:560px" }, [
        el("div", { class: "modal-hd" }, [el("span", { class: "dot" }), "Choose backup folder"]),
        el("div", { class: "modal-bd" }, [
          el("div", { style: "display:flex;gap:6px" }, [pathInput, goBtn]),
          errBox,
          list,
        ]),
        el("div", { class: "modal-ft" }, [
          el("span", { class: "modal-hint" }, ["Click a folder to open it · Esc to cancel"]),
          cancelBtn, selectBtn,
        ]),
      ]),
    ]);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) finish(null); });
    document.body.append(overlay);
    document.addEventListener("keydown", onKey);
    load(startPath);
  });
}

/* ---------- suggest a commit message from the actual changes ----------
   No AI: a heuristic over the porcelain file list. Picks a conventional-commit type
   when confident (ci/test/docs/style/deps), an action verb from the change kinds, a
   scope from the common directory, and names the files — a solid first draft to edit. */
function suggestCommitMessage(porcelainLines) {
  const files = (porcelainLines || []).map((l) => {
    let path = l.slice(3).trim();
    if (path.includes(" -> ")) path = path.split(" -> ").pop().trim();   // rename → the new name
    return { x: l[0], y: l[1], path: path.replace(/^"|"$/g, "") };
  }).filter((f) => f.path);
  if (!files.length) return "";

  const paths = files.map((f) => f.path);
  const base = (p) => p.split("/").pop();
  const added = files.filter((f) => f.x === "A" || (f.x === "?" && f.y === "?"));
  const deleted = files.filter((f) => f.x === "D" || f.y === "D");
  const all = (re) => paths.every((p) => re.test(p));

  let type = null;
  if (all(/^\.github\/workflows\//)) type = "ci";
  else if (all(/(\.test\.|\.spec\.|(^|\/)(tests?|__tests__)\/)/)) type = "test";
  else if (all(/((^|\/)docs\/|\.md$)/i)) type = "docs";
  else if (all(/(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml)$/)) type = "chore(deps)";
  else if (all(/\.css$/)) type = "style";

  const verb = deleted.length === files.length ? "remove"
    : added.length === files.length ? "add"
    : "update";

  // common directory across the changed files → the scope
  const dirs = paths.map((p) => p.split("/").slice(0, -1));
  let common = dirs[0] || [];
  for (const d of dirs) { let i = 0; while (i < common.length && common[i] === d[i]) i++; common = common.slice(0, i); }
  const scope = common.join("/");

  const names = [...new Set(files.map((f) => base(f.path)))];
  const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3} more` : "");
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  if (type) return `${type}: ${verb} ${shown}`;
  return scope ? `${cap(verb)} ${scope}: ${shown}` : `${cap(verb)} ${shown}`;
}

async function gitPush(g, btn) {
  const ok = await showModal({
    title: `Push to origin — ${g.name}`,
    sub: `Push ${g.branch}${g.summary?.neverPushedBranches?.includes(g.branch) ? " (first push — sets upstream)" : ""} to origin.`,
    confirmLabel: "↑ Push",
  });
  if (ok) gitPost("/api/git/push", { localPath: g.localPath }, btn, g);
}
async function gitPull(g, btn) {
  const behind = (g.summary?.behindBranches || []).reduce((n, b) => n + (b.behind || 0), 0);
  const ok = await showModal({
    title: `Pull from origin — ${g.name}`,
    sub: `Bring in ${behind} commit(s) the remote has (likely from another machine) and rebase your local work on top — keeps history linear. Needs a clean tree; if it conflicts, it reverts and asks you to resolve in a terminal.`,
    confirmLabel: "↓ Pull (rebase)",
  });
  if (ok) gitPost("/api/git/pull", { localPath: g.localPath }, btn, g);
}
async function gitCommit(g, btn) {
  const suggestion = suggestCommitMessage(g.uncommitted && g.uncommitted.files);
  const msg = await showModal({
    title: `Commit changes — ${g.name}`,
    sub: `Stages every change in ${g.name} (${g.branch}) with git add -A and commits. Edit the suggested message or accept it.`,
    value: suggestion,
    editable: true,
    confirmLabel: "✓ Commit",
  });
  if (msg == null || !msg.trim()) return;
  gitPost("/api/git/commit", { localPath: g.localPath, message: msg }, btn, g);
}
let GIT_REFRESH = null;   // set by viewGit so a card action can trigger a rescan

function viewGit() {
  if (GIT_TIMER) { clearInterval(GIT_TIMER); GIT_TIMER = null; }
  const box = el("div", { id: "gitBox" }, [el("div", { class: "hint" }, ["Scanning every tracked repo (git status + push state)…"])]);
  const refreshBtn = el("button", { class: "ghost" }, ["↻ Rescan"]);

  async function refresh(force) {
    if (force) box.replaceChildren(el("div", { class: "hint" }, ["Rescanning…"]));
    let d;
    try { d = await (await fetch("/api/git" + (force ? "?refresh=1" : ""))).json(); }
    catch (e) { return box.replaceChildren(el("div", { class: "hint" }, [`Could not reach the server: ${e}`])); }
    if (d.error) return box.replaceChildren(el("div", { class: "movecard", style: `border-color:${GIT_COLOR.never}` }, [String(d.error)]));

    const t = d.totals || {};
    const idx = repoIndex(d.repos, (r) => r.localPath, (r) => r.name);

    const head = el("div", { class: "statbar" }, [
      el("div", { class: "stat" }, [el("div", { class: "n" }, [String(t.repos || 0)]), el("div", { class: "l" }, ["tracked repos"])]),
      el("div", { class: "stat" }, [el("div", { class: "n", style: `color:${t.needAttention ? GIT_COLOR.dirty : GIT_COLOR.clean}` }, [String(t.needAttention || 0)]), el("div", { class: "l" }, ["need attention"])]),
      el("div", { class: "stat" }, [el("div", { class: "n", style: `color:${t.neverPushedBranches ? GIT_COLOR.never : "inherit"}` }, [String(t.neverPushedBranches || 0)]), el("div", { class: "l" }, ["never-pushed branches"])]),
      el("div", { class: "stat" }, [el("div", { class: "n", style: `color:${t.withUnpushed ? GIT_COLOR.unpushed : "inherit"}` }, [String(t.withUnpushed || 0)]), el("div", { class: "l" }, ["repos with unpushed"])]),
      el("div", { class: "stat" }, [el("div", { class: "n", style: `color:${t.dirty ? GIT_COLOR.dirty : "inherit"}` }, [String(t.dirty || 0)]), el("div", { class: "l" }, ["dirty working trees"])]),
    ]);

    const kids = [head];
    if (d.cachedAgeMs > 500) kids.push(el("div", { class: "hint" }, [`as of ${Math.round(d.cachedAgeMs / 1000)}s ago · click Rescan to refresh`]));

    // Org "greater cardboards" in Map order, each holding its repo git-cards.
    eachOrg((org, meta, repos) => {
      const cards = repos.map((r) => gitRepoCard(r, idx.get(r)));
      const att = repos.filter((r) => idx.get(r)?.summary.attention).length;
      const tag = att
        ? badge(`${att} need attention`, GIT_COLOR.dirty)
        : badge("all clean", GIT_COLOR.clean);
      kids.push(orgGroup(org, meta, cards, tag));
    });
    box.replaceChildren(...kids);
  }

  refreshBtn.addEventListener("click", () => refresh(true));
  GIT_REFRESH = refresh;                 // let a card's commit/push button trigger a rescan
  refresh(false);
  GIT_TIMER = setInterval(() => refresh(false), 25000);

  return el("div", {}, [
    el("div", { class: "hint" }, [
      "Across every tracked repo: what is ", el("b", { style: `color:${GIT_COLOR.dirty}` }, ["uncommitted"]),
      ", what is ", el("b", { style: `color:${GIT_COLOR.unpushed}` }, ["committed but not pushed"]),
      ", and — loudest — any ", el("b", { style: `color:${GIT_COLOR.never}` }, ["branch that lives only on this disk"]),
      ". Local git only, so it's a snapshot of what your machine knows.",
    ]),
    el("div", { class: "graph-controls" }, [refreshBtn]),
    box,
  ]);
}

/* ---------- ops: activity + backup + master-pollinate ---------- */
let OPS_TIMER = null;
let RELAY_TIMER = null;
let WS_ES = null;   // the Workspace EventSource (SSE stream of Claude session output)
let WS_LAST_MSG_AT = 0;    // Date.now() of the last message (real event OR heartbeat) this stream delivered
let WS_STALE_TIMER = null;   // polls WS_LAST_MSG_AT; force-reconnects a stream that's gone quiet too long
let WS_EVER_CONNECTED = false;   // true after the FIRST successful "hello" — so only a later hello logs as a "reconnect"
// Comfortably above the 25s server heartbeat: two missed pulses plus slack, not one, so an
// ordinary single slow tick over a mobile link never triggers a needless reconnect.
const WS_STALE_MS = 65_000;
/* ---------- relay: the tunnel between this LocalHost and the online site ----------
   Symmetric tab. On the LOCAL dashboard it CONTROLS the bridge (enable/disable, address,
   device secret) and shows whether the remote is online + receiving. On the ONLINE relay
   it is READ-ONLY: it shows whether the local host is connected and sending data, or not
   running at all. */
function relayStatusCard(tone, title, detail) {
  const c = tone === "on" ? "#34d399" : tone === "wait" ? "#fbbf24" : "#94a3b8";
  return el("div", { class: "movecard", style: `border-left:3px solid ${c};padding-left:13px` }, [
    el("div", { style: "display:flex;align-items:center;gap:9px" }, [
      el("span", { style: `color:${c};font-size:16px;line-height:1` }, [tone === "off" ? "○" : "●"]),
      el("div", { style: "font-weight:700;font-size:15px" }, [title]),
    ]),
    el("div", { class: "hint", style: "margin-top:5px" }, [detail]),
  ]);
}

function viewRelay() {
  if (RELAY_TIMER) { clearInterval(RELAY_TIMER); RELAY_TIMER = null; }
  const statusBox = el("div", {}, [el("div", { class: "hint" }, ["Loading relay status…"])]);

  // ---- ONLINE relay: read-only receiving-end view of the local host ----
  if (ME.mode === "live") {
    async function loadRemote() {
      let s; try { s = await (await fetch("/api/me", { cache: "no-store" })).json(); } catch { return; }
      const connected = s.localConnected;
      const age = connected && s.snapshotAgeMs != null ? s.snapshotAgeMs + 0 : null;
      statusBox.replaceChildren(connected
        ? relayStatusCard("on", "Local host connected", `Receiving data from your work machine${age != null ? " · last update " + agoText(age) : ""}. The dashboard is live.`)
        : relayStatusCard("off", "Local host not connected", "Your local Claudstermind isn't reaching this server — its dashboard isn't running, or the relay is switched off there. The dashboard stays empty until it connects."));
    }
    loadRemote(); RELAY_TIMER = setInterval(loadRemote, 3000);
    return el("div", {}, [
      el("div", { class: "hint" }, ["The relay tunnel — this online site receives a live mirror of the work machine's Claudstermind. It can't initiate the link; it only reports what arrives."]),
      statusBox,
    ]);
  }

  // ---- LOCAL dashboard: controls + remote-online status ----
  const INPUT = "flex:1;min-width:220px;background:var(--chip);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:6px 10px;font-family:ui-monospace,monospace;font-size:12px";
  const ROW = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0";
  const controls = el("div", { class: "movecard", style: "margin-top:10px" }, [el("div", { class: "hint" }, ["Loading relay settings…"])]);
  async function updateStatus() {
    let s; try { s = await (await fetch("/api/relay", { cache: "no-store" })).json(); } catch { return; }
    statusBox.replaceChildren(
      !s.enabled ? relayStatusCard("off", "Relay is off", "The online site shows “not connected”. Enable it below to stream this dashboard to the web.")
      : s.connected ? relayStatusCard("on", "Connected — remote online", `Streaming to ${s.url}. The online site is up and receiving your data.`)
      : relayStatusCard("wait", "Connecting…", `Trying to reach ${s.url || "the relay"} — the remote is unreachable or still starting, retrying automatically.${s.error ? " (" + s.error + ")" : ""}`));
  }
  async function buildControls() {
    let s; try { s = await (await fetch("/api/relay", { cache: "no-store" })).json(); } catch { return; }
    const urlInput = el("input", { type: "text", value: s.url || "", placeholder: "brain.ancientholdings.eu", style: INPUT });
    const secretInput = el("input", { type: "password", placeholder: s.hasSecret ? "•••••• saved — leave blank to keep" : "paste the relay's device secret", style: INPUT });
    const toggle = el("input", { type: "checkbox" }); if (s.enabled) toggle.setAttribute("checked", "checked");
    const saveBtn = el("button", { class: "ghost" }, ["Save & connect"]);
    const msg = el("span", { class: "was", style: "font-size:11px" });
    async function save(patch) {
      const body = { url: urlInput.value, enabled: toggle.checked, ...patch };
      if (secretInput.value.trim()) body.deviceSecret = secretInput.value;   // sent once, saved to .secrets, never shown again
      msg.textContent = "saving…";
      try {
        const r = await (await fetch("/api/relay/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
        secretInput.value = "";
        msg.textContent = r.ok ? "✓ saved" : (r.message || r.reason || "failed");
        msg.style.color = r.ok ? "#34d399" : "#f87171";
      } catch (e) { msg.textContent = String(e); }
      updateStatus();
    }
    toggle.addEventListener("change", () => save({ enabled: toggle.checked }));
    saveBtn.addEventListener("click", () => save({}));
    controls.replaceChildren(
      el("div", { class: "desc" }, [el("b", {}, ["Connection"])]),
      el("div", { style: ROW }, [el("span", { class: "was", style: "min-width:92px" }, ["address"]), urlInput]),
      el("div", { style: ROW }, [el("span", { class: "was", style: "min-width:92px" }, ["device secret"]), secretInput]),
      el("div", { style: "display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:8px 0 2px" }, [
        el("label", { style: "display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600" }, [toggle, "Relay enabled"]),
        saveBtn, msg,
      ]),
      el("div", { class: "hint", style: "margin-top:4px" }, ["The address is your online site; the device secret must match the relay's ", el("code", {}, ["AGENT_DEVICE_SECRET"]), ". It's stored locally in .secrets and never shown again."]),
    );
  }
  buildControls(); updateStatus();
  RELAY_TIMER = setInterval(updateStatus, 3000);
  return el("div", {}, [
    el("div", { class: "hint" }, ["The relay tunnel — mirror this dashboard to the web so you can view and drive your workspace from the online site."]),
    statusBox, controls,
  ]);
}

/* ---------- Activity: weekly build activity — org heatmap + per-day cards + time charts
   Paginated one ISO week at a time (shared nav). Heatmap = repos grouped by org × the
   week's 7 days. Per-day = each day's repos (commits + lines) plus a time-of-day chart
   showing WHEN the commits landed. Same data admin + public (public strips messages,
   which these views don't show anyway). */
let ACT_VIEW = "heatmap";
let ACT_WEEK = null;   // "YYYY-Www" being viewed; null → latest
const fmtChurn = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n || 0));
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isoWeek(dateStr) {
  const dt = new Date(dateStr + "T00:00:00Z");
  const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);            // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
function weekDates(key) {                                // "YYYY-Www" → [Mon..Sun]
  const [y, wn] = key.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (wn - 1) * 7);
  const out = [];
  for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i); out.push(d.toISOString().slice(0, 10)); }
  return out;
}
const shortDay = (dateStr) => { const d = new Date(dateStr + "T00:00:00Z"); return `${DOW[(d.getUTCDay() || 7) - 1]} ${d.getUTCDate()}`; };
const fullDay = (dateStr) => { try { return new Date(dateStr + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }); } catch { return dateStr; } };

// Time-of-day chart: 24 hourly bars, height ∝ commits that hour — the "worked all night" view.
function dayHoursChart(hours) {
  const hrs = hours || new Array(24).fill(0);
  const max = Math.max(1, ...hrs);
  const bars = hrs.map((c, h) => el("div", { class: "hbar" + (c ? " on" : ""), title: `${String(h).padStart(2, "0")}:00 — ${c} commit${c !== 1 ? "s" : ""}`, style: `height:${c ? Math.round(14 + 86 * c / max) : 3}%` }));
  return el("div", { class: "hchart-wrap" }, [
    el("div", { class: "hchart" }, bars),
    el("div", { class: "hbar-labels" }, ["0h", "6h", "12h", "18h", "24h"].map((t) => el("span", {}, [t]))),
  ]);
}

function weekHeatmap(d, dates) {
  const active = (d.repos || []).filter((r) => dates.some((day) => r.byDay[day]));
  if (!active.length) return el("div", { class: "hint" }, ["No commits this week."]);
  const byOrg = {};
  for (const r of active) (byOrg[r.org] = byOrg[r.org] || []).push(r);
  let maxC = 1;
  for (const r of active) for (const day of dates) { const c = (r.byDay[day] || {}).commits || 0; if (c > maxC) maxC = c; }
  const head = el("tr", {}, [el("th", { class: "hmrepo" }, ["repo"]), ...dates.map((day) => el("th", { class: "hmday2" }, [shortDay(day)]))]);
  const rows = [];
  for (const org of Object.keys(byOrg).sort()) {
    rows.push(el("tr", {}, [el("td", { class: "hmorg-hd", colspan: "8", style: `border-left:3px solid ${orgColor(org)}` }, [el("span", { class: "hmorg", style: `background:${orgColor(org)}` }), org])]));
    for (const r of byOrg[org].sort((a, b) => b.total.commits - a.total.commits)) {
      rows.push(el("tr", {}, [
        el("td", { class: "hmrepo", title: `${r.org}/${r.name}` }, [r.name]),
        ...dates.map((day) => {
          const v = r.byDay[day]; const c = (v && v.commits) || 0;
          const inten = c ? (0.16 + 0.84 * Math.min(1, c / maxC)) : 0;
          return el("td", { class: "hmcell2", title: c ? `${r.name} · ${shortDay(day)}\n${c} commit${c !== 1 ? "s" : ""} · ${fmtChurn(v.churn)} lines` : `${shortDay(day)} — none`,
            style: c ? `background:rgba(52,211,153,${inten.toFixed(3)});color:${inten > 0.5 ? "#04211a" : "#a7f3d0"}` : "" }, [c ? String(c) : ""]);
        }),
      ]));
    }
  }
  return el("div", { style: "overflow-x:auto" }, [el("table", { class: "heatmap2" }, [el("thead", {}, [head]), el("tbody", {}, rows)])]);
}

function weekDaysView(d, dates) {
  const daysWithActivity = dates.filter((day) => (d.repos || []).some((r) => r.byDay[day]));
  if (!daysWithActivity.length) return el("div", { class: "hint" }, ["No commits this week."]);
  return el("div", { style: "display:flex;flex-direction:column;gap:14px" }, daysWithActivity.slice().reverse().map((day) => {
    const t = (d.totals && d.totals.byDay[day]) || { commits: 0, churn: 0, repos: 0 };
    const reposToday = (d.repos || []).filter((r) => r.byDay[day]).sort((a, b) => b.byDay[day].commits - a.byDay[day].commits);
    return el("div", { class: "orggroup", style: "--org:#34d399" }, [
      el("div", { class: "orggroup-hd" }, [
        el("span", { class: "dot", style: "background:#34d399" }),
        el("b", {}, [fullDay(day)]),
        el("span", { class: "was", style: "margin-left:auto" }, [`${t.commits} commits · ${fmtChurn(t.churn)} lines · ${reposToday.length} repos`]),
      ]),
      el("div", { style: "padding:10px 12px 2px" }, [dayHoursChart((d.dayHours || {})[day])]),
      el("div", { class: "orggroup-body", style: "grid-template-columns:repeat(auto-fill,minmax(178px,1fr))" }, reposToday.map((r) => {
        const v = r.byDay[day];
        return el("div", { class: "repocard", style: `--stripe:${orgColor(r.org)}` }, [
          el("div", { class: "rc-hd" }, [
            el("span", { class: "hmorg", style: `background:${orgColor(r.org)};width:8px;height:8px;border-radius:2px;flex:0 0 auto` }),
            el("span", { class: "rc-name", title: `${r.org}/${r.name}` }, [r.name]),
          ]),
          el("div", { class: "rc-sub" }, [el("b", { style: "color:#34d399" }, [String(v.commits)]), " commits · ", el("b", {}, [fmtChurn(v.churn)]), " lines"]),
        ]);
      })),
    ]);
  }));
}

function viewActivity() {
  const isPublic = ME.mode === "live" && !ME.authenticated;
  const box = el("div", { id: "actBox" }, [el("div", { class: "hint" }, ["Loading activity…"])]);
  let DATA = null;

  function paint() {
    if (!DATA) return;
    const weeks = [...new Set((DATA.days || []).map(isoWeek))].sort().reverse();
    if (!weeks.length) { box.replaceChildren(el("div", { class: "hint" }, ["No commit activity in the window yet."])); return; }
    if (!ACT_WEEK || !weeks.includes(ACT_WEEK)) ACT_WEEK = weeks[0];
    const idx = weeks.indexOf(ACT_WEEK);
    const dates = weekDates(ACT_WEEK);
    let wc = 0, wl = 0;
    for (const r of DATA.repos) for (const day of dates) { const v = r.byDay[day]; if (v) { wc += v.commits; wl += v.churn; } }

    const prev = el("button", { class: "ghost", onclick: () => { if (idx < weeks.length - 1) { ACT_WEEK = weeks[idx + 1]; paint(); } } }, ["◀"]);
    const next = el("button", { class: "ghost", onclick: () => { if (idx > 0) { ACT_WEEK = weeks[idx - 1]; paint(); } } }, ["▶"]);
    prev.disabled = idx >= weeks.length - 1; next.disabled = idx <= 0;
    const vBtn = (key, label) => { const b = el("button", { class: "ghost" + (ACT_VIEW === key ? " active" : ""), onclick: () => { ACT_VIEW = key; paint(); } }, [label]); return b; };

    box.replaceChildren(
      el("div", { class: "actnav" }, [
        prev,
        el("div", { class: "actweek" }, [el("b", {}, [ACT_WEEK.replace("-W", " · week ")]), el("span", { class: "was" }, [`${shortDay(dates[0])} – ${shortDay(dates[6])}`])]),
        next,
        el("div", { class: "actweektot" }, [
          el("span", { class: "big" }, [String(wc)]), el("span", { class: "lbl" }, ["commits"]),
          el("span", { class: "big" }, [fmtChurn(wl)]), el("span", { class: "lbl" }, ["lines"]),
        ]),
      ]),
      el("div", { class: "graph-controls", style: "margin-top:8px" }, [vBtn("heatmap", "Heatmap"), vBtn("days", "Per-day")]),
      ACT_VIEW === "heatmap" ? weekHeatmap(DATA, dates) : weekDaysView(DATA, dates),
    );
  }

  (async () => {
    const url = isPublic ? "/api/public/activity" : "/api/activity/daily";
    try { DATA = await (await fetch(url, { cache: "no-store" })).json(); } catch { box.replaceChildren(el("div", { class: "hint" }, ["Activity not reachable."])); return; }
    paint();
  })();

  return el("div", {}, [
    el("div", { class: "hint" }, ["Weekly build activity across the ecosystem. ", el("b", {}, ["Heatmap"]), " = commits per repo per day, grouped by organisation; ", el("b", {}, ["Per-day"]), " = each day's repos + a chart of when the commits landed."]),
    box,
  ]);
}

/* ---------- Workspace: drive Claude Code on the work machine, from the web ----------
   Online + ancient only. A repo-scoped chat: prompts go down, the session streams back
   over SSE (assistant text, tool-uses, results). Each risky tool pops approve/deny unless
   trusted mode is on. Usage + cost shown; new folder/repo creation; session switching. */
const wsPost = (action, body) => fetch("/api/workspace/" + action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then((r) => r.json()).catch(() => ({ ok: false }));
const wsUuid = () => (crypto.randomUUID ? crypto.randomUUID() : "s-" + Date.now() + "-" + Math.random().toString(36).slice(2));
// The workspace id a pane attaches to: repo + worktree. TWO terminals selecting the same repo
// (and worktree) derive the SAME key, so they drive — and watch — the one shared conversation.
const wsWorkspaceId = (repo, worktree) => (repo ? repo + "@" + (worktree || "main") : null);
// This browser's stable identity for presence — kept across reloads so a refresh doesn't read as
// a new terminal. A human label (editable) rides along so the roster is legible.
const WS_CONN_KEY = "cm.conn.v1";
function connIdentity() {
  let v = null; try { v = JSON.parse(localStorage.getItem(WS_CONN_KEY) || "null"); } catch {}
  if (!v || !v.id) {
    v = { id: "t-" + Math.random().toString(36).slice(2) + Date.now().toString(36),
      label: (navigator.platform || "terminal").split(" ")[0] + " · " + (navigator.userAgent.includes("Mobile") ? "mobile" : "desktop") };
    try { localStorage.setItem(WS_CONN_KEY, JSON.stringify(v)); } catch {}
  }
  return v;
}
const fmtUsd = (n) => "$" + (Number(n) || 0).toFixed(2);

// Pane grid limits. 8 across is sized for an ultrawide (5120px ⇒ ~600px a pane); narrower
// screens keep the panes readable and scroll the grid sideways instead of crushing them.
const WS_MAX_COLS = 8, WS_MAX_ROWS = 2;
// How long a reopen/resume ("control open") waits for a "transcript" or error reply before giving
// up and surfacing an explicit note — covers a disconnected bridge, which otherwise never answers
// at all and would leave the UI (and the pendingOpens entry) waiting forever.
const WS_OPEN_TIMEOUT_MS = 8000;
// A pane repaints on every streamed event; only re-snap the transcript scroll to the bottom when
// it was already within this many px of it — otherwise someone scrolled up to read history keeps
// their spot instead of being yanked back down mid-turn.
const WS_SCROLL_NEAR_BOTTOM_PX = 48;
const WS_STORE_KEY = "cm.workspace.v1";
// Mirrors PERMISSION_MODES in lib/claudeSession.mjs — the browser can't import it, so the
// ids must stay in step with that list (the server ignores any it doesn't recognise).
const WS_MODES = [
  { id: "default", label: "Manual", short: "Manual" },
  { id: "acceptEdits", label: "Accept edits", short: "Edits" },
  { id: "plan", label: "Plan", short: "Plan" },
  { id: "auto", label: "Auto", short: "Auto" },
  { id: "bypassPermissions", label: "Bypass permissions", short: "Bypass" },
];
const WS_MODE_IDS = new Set(WS_MODES.map((m) => m.id));
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));

function viewWorkspace() {
  // The workspace runs on the local dashboard (direct, this machine) and on the online relay
  // (via the bridge tunnel). Only bail for a mode that has neither backend.
  if (ME.mode !== "live" && ME.mode !== "local") return el("div", { class: "gate", style: "min-height:40vh" }, [
    el("h2", { class: "gate-title" }, ["Workspace unavailable"]),
    el("p", { class: "gate-sub" }, ["Drive Claude from the local dashboard on the work machine, or remotely from ", el("b", {}, ["brain.ancientholdings.eu"]), "."]),
  ]);

  // ---- view state ----------------------------------------------------------------
  const st = {
    repos: [], tree: null, defaultMode: "default", hasToken: true,
    sidebarMode: "tree",           // tree | repos — tree is the default (Windows-style, collapsible)
    treeExpanded: new Set(),       // folder paths currently expanded
    cols: 1, rows: 1,              // pane grid — up to WS_MAX_COLS × WS_MAX_ROWS
    panes: [],                     // [{ id, sessionKey, repo, mode, transcript, usage, status, readonly, resume }]
    activeId: null,
    history: [], historyRepo: null,
    permQueue: [],                 // pending tool-permission requests — FIFO so two panes never clobber
    pendingOpens: new Map(),       // savedSessionKey -> Map<paneId, { paneId, mode, gen, timer }> — reopens
                                    // in flight, correlated; a Map-of-Map so N panes legitimately waiting on
                                    // the SAME shared sessionKey each get their own entry (and timeout)
                                    // instead of clobbering one another (see beginPendingOpen).
    dataSizes: {},                 // localPath -> { bytes, conversations, turns } — collected raw volume
    collapsedOrgs: new Set(),      // org names collapsed in the Repositories sidebar
    searchQuery: "", searchResults: null,   // full-text search over saved conversations
    presence: [],                  // connected terminals (this one + others), from the server
    worktrees: {},                 // repo -> [{ name, branch, isMain, needsInstall }]
    _pendingHistoryResume: null,   // { repo, worktree, sessionKey, timer } — a "resume a missing worktree" in flight
  };
  const CONN = connIdentity();
  let searchTimer = null;
  const fmtBytes = (n) => { n = n || 0; if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(0) + " KB"; return (n / 1048576).toFixed(1) + " MB"; };
  function dataBadge(localPath) {
    const d = st.dataSizes[localPath]; if (!d || !d.conversations) return "";
    return el("span", { class: "ws-databadge", title: `${d.conversations} conversation(s) · ${d.turns} turn(s) · ${fmtBytes(d.bytes)} of raw history` }, [`${fmtBytes(d.bytes)} · ${d.conversations}`]);
  }
  // org for a workspace-relative path — the curated map value when known, else the top folder.
  const ORG_BY_PATH = new Map((MAP?.repos || []).map((r) => [normPath(r.localPath), repoOrg(r)]));
  const orgOfPath = (rel) => ORG_BY_PATH.get(normPath(rel)) || (rel.split("/")[0] || "Other");
  // Flatten the bridge tree into the repo list (a folder is a repo iff it carries `.iz.md`).
  function flattenRepos(node, rel, out) {
    if (node.isRepo && rel) out.push({ name: node.name, localPath: rel, org: orgOfPath(rel) });
    for (const c of node.children || []) flattenRepos(c, rel ? rel + "/" + c.name : c.name, out);
    return out;
  }
  // `_gen` is a per-pane monotonic counter, bumped every time the pane's identity is
  // deliberately abandoned (cleared, or repointed to a different repo/worktree) — a
  // pendingOpens entry captures the pane's gen at request time, so a reply that arrives
  // after the pane moved on can tell it no longer applies (see beginPendingOpen).
  const newPane = () => ({ id: wsUuid(), sessionKey: wsUuid(), repo: "", worktree: "main", mode: st.defaultMode, transcript: [], usage: {}, status: "idle", readonly: false, resume: null, _gen: 0, _expandedGroups: new Set() });
  // Every pane with a repo runs under a shared, deterministic key (repo@worktree). Panes still
  // waiting for a repo keep their random placeholder so they never collide before use.
  function keyForPane(p) { return p.repo ? wsWorkspaceId(p.repo, p.worktree) : p.sessionKey; }
  function assignKey(p) { if (p.repo) p.sessionKey = wsWorkspaceId(p.repo, p.worktree); }

  // ---- layout + pane persistence -------------------------------------------------
  // Panes are views; conversations are files on the work machine. Without this, a refresh
  // minted fresh session keys and silently detached every pane from its thread — the thread
  // survived on disk but you had to go dig it out of History. We remember the arrangement
  // (grid, repo, mode, session key) and re-attach on boot.
  let bootRestorePending = true;
  function saveLayout() {
    try {
      localStorage.setItem(WS_STORE_KEY, JSON.stringify({
        v: 1, cols: st.cols, rows: st.rows, sidebarMode: st.sidebarMode, defaultMode: st.defaultMode, activeId: st.activeId,
        panes: st.panes.map((p) => ({ id: p.id, sessionKey: p.sessionKey, repo: p.repo, worktree: p.worktree || "main", mode: p.mode })),
      }));
    } catch { /* private mode / quota — the workspace still works, it just forgets */ }
  }
  function loadLayout() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(WS_STORE_KEY) || "null"); } catch { s = null; }
    if (!s || s.v !== 1 || !Array.isArray(s.panes) || !s.panes.length) return false;
    st.cols = clampInt(s.cols, 1, WS_MAX_COLS); st.rows = clampInt(s.rows, 1, WS_MAX_ROWS);
    if (s.sidebarMode === "repos" || s.sidebarMode === "tree") st.sidebarMode = s.sidebarMode;
    if (WS_MODE_IDS.has(s.defaultMode)) st.defaultMode = s.defaultMode;
    st.panes = s.panes.slice(0, st.cols * st.rows).map((p) => ({
      ...newPane(),
      id: p.id || wsUuid(), sessionKey: p.sessionKey || wsUuid(), repo: p.repo || "", worktree: p.worktree || "main",
      mode: WS_MODE_IDS.has(p.mode) ? p.mode : st.defaultMode,
    }));
    while (st.panes.length < st.cols * st.rows) st.panes.push(newPane());
    st.activeId = st.panes.some((p) => p.id === s.activeId) ? s.activeId : st.panes[0].id;
    return true;
  }
  /** Re-attach restored panes to their saved threads — but only for keys history actually
   *  knows, so a pane that never got a prompt doesn't trigger a "could not be opened" error. */
  function restorePanes() {
    // `st.history` now holds one row per WORKSPACE (`workspaceId`), not one per past session —
    // a restored pane's own `sessionKey` is that same workspace id once a repo is assigned
    // (see `assignKey`), so this still finds it.
    const known = new Set(st.history.map((h) => h.workspaceId));
    let n = 0;
    for (const p of st.panes) {
      if (!known.has(p.sessionKey) || p.transcript.length) continue;
      // Two panes sharing one sessionKey (a real, designed-for state — see assignKey/
      // wsWorkspaceId) both need to be reattached; beginPendingOpen tracks each pane's own
      // request independently under the shared key instead of one clobbering the other's.
      beginPendingOpen(p.sessionKey, p, "restore");
      wsPost("control", { action: "open", args: { sessionKey: p.sessionKey } });
      n++;
    }
    if (n) note(`Reattached ${n} pane(s) to their conversations — your next message continues where you left off.`);
  }
  /** Track one in-flight "control open" reply for one PANE, correlated by the saved
   *  session/workspace key the server echoes back — success (transcript) and failure (error)
   *  both resolve it, and a bounded client-side timer resolves it too if neither ever arrives
   *  (e.g. the local bridge is disconnected and the request never reaches anything that could
   *  answer). Whichever fires first wins; the others become no-ops because the entry is already
   *  gone/replaced.
   *
   *  Keyed sessionKey -> Map<paneId, entry> (not sessionKey -> entry) so N panes legitimately
   *  waiting on the SAME shared sessionKey (two terminals on one repo@worktree) are each tracked
   *  and resolved/timed-out independently — a reply resolves every pane waiting on that key (fan
   *  out, mirroring how live state/event frames already fan out via panesOf(sessionKey)), while a
   *  pane whose own reply never comes still gets its own timeout note.
   *
   *  `gen` snapshots the pane's `_gen` at request time — if the pane's identity has since moved on
   *  (cleared, or repointed to a different repo/worktree bumps `_gen`; see clearPane and the
   *  repoSel/wtSel change handlers) a late reply is discarded rather than applied to the pane's
   *  new state.
   *
   *  `priorKey` snapshots the pane's `sessionKey` at request time — it's how the transcript
   *  handler tells a genuine key ADOPTION (the pane is switching to a different past conversation's
   *  key, e.g. clicking Resume on another history row) from a pane simply reattaching to a key it
   *  already held (restorePanes re-opening two panes that legitimately share one key — see
   *  assignKey/wsWorkspaceId). Only the former can silently fork another pane's live conversation
   *  and needs the clash check; the latter is just reconnecting and must never be flagged merely
   *  because a legitimate twin also holds that same key. */
  function beginPendingOpen(sessionKey, p, mode) {
    let bucket = st.pendingOpens.get(sessionKey);
    if (!bucket) { bucket = new Map(); st.pendingOpens.set(sessionKey, bucket); }
    const prior = bucket.get(p.id); if (prior) clearTimeout(prior.timer);
    const entry = { paneId: p.id, mode, gen: p._gen || 0, priorKey: p.sessionKey, timer: null };
    entry.timer = setTimeout(() => {
      const b = st.pendingOpens.get(sessionKey);
      if (!b || b.get(p.id) !== entry) return;   // already resolved or superseded
      b.delete(p.id);
      if (!b.size) st.pendingOpens.delete(sessionKey);
      note("Could not open — local bridge may be disconnected.");
    }, WS_OPEN_TIMEOUT_MS);
    bucket.set(p.id, entry);
  }
  const paneUI = new Map();        // paneId -> { root, transcriptEl, promptEl, repoSel, usageEl, dot, sendBtn, badge }
  const paneOf = (key) => st.panes.find((p) => p.sessionKey === key);
  // With shared keys, more than one pane in this window can hold the same session — fan updates
  // to ALL of them so a session opened twice stays in lockstep.
  const panesOf = (key) => st.panes.filter((p) => p.sessionKey === key);
  const activePane = () => st.panes.find((p) => p.id === st.activeId) || st.panes[0];

  const root = el("div", { class: "ws-root" }, []);
  const bridgeNote = el("div", { class: "hint" }, ["Connecting to the work machine…"]);
  const grid = el("div", { class: "ws-grid" }, []);
  const sideList = el("div", { class: "ws-side-list" }, []);
  const histList = el("div", { class: "ws-hist" }, []);
  const usageEl = el("span", { class: "ws-usage-total" }, ["—"]);
  const defaultModeSel = el("select", { class: "wsel wsel-sm ws-defmode" }, []);
  const permHost = el("div", {});

  const shortRepo = (p) => (p || "").split(/[\\/]/).filter(Boolean).pop() || "repo";
  function note(msg) { bridgeNote.hidden = false; bridgeNote.textContent = msg; }

  // ---- presence: which terminals are connected, and what they're viewing ----------
  const presenceBar = el("div", { class: "ws-presence" }, []);
  // Tell the server which workspace THIS terminal is looking at (its active pane's repo@worktree),
  // so the roster shows who is on what. Debounced implicitly — it's cheap and only fires on change.
  let lastAttached = null;
  function reportAttach() {
    const p = activePane();
    const wsId = p && p.repo ? wsWorkspaceId(p.repo, p.worktree) : null;
    if (wsId === lastAttached) return;
    lastAttached = wsId;
    wsPost("attach", { conn: CONN.id, workspaceId: wsId });
  }
  function renderPresence() {
    const others = st.presence.filter((c) => c.id !== CONN.id);
    if (!others.length) { presenceBar.hidden = true; presenceBar.replaceChildren(); return; }
    presenceBar.hidden = false;
    presenceBar.replaceChildren(
      el("span", { class: "ws-presence-lbl" }, [`${others.length + 1} terminals`]),
      ...others.map((c) => el("span", { class: "ws-term", title: (c.origin === "relay" ? "via the live site" : "local") + (c.workspaceId ? " · on " + shortRepo(c.workspaceId.split("@")[0]) + "@" + c.workspaceId.split("@")[1] : "") },
        [el("span", { class: "ws-term-dot " + (c.origin === "relay" ? "--relay" : "--local") }, []), c.label || "terminal",
          c.workspaceId ? el("span", { class: "ws-term-on" }, [" · " + shortRepo(c.workspaceId.split("@")[0]) + "@" + c.workspaceId.split("@")[1]]) : ""])),
    );
  }
  // When a pane picks a repo, ask what's already live on it — so a second terminal learns "this
  // is also open elsewhere" and can decide to share or (Phase 5) branch a new worktree.
  function onRepoChosen(p) {
    if (!p.repo) return;
    wsPost("control", { action: "workspacesOn", args: { repo: p.repo } });
  }

  // ---- repo <select> options (shared shape across panes) -------------------------
  function fillRepoSelect(sel, value) {
    const opts = [el("option", { value: "" }, ["— pick a repository —"]),
      ...st.repos.map((r) => el("option", { value: r.localPath }, [r.name + (r.org ? "  ·  " + r.org : "")]))];
    // A repo picked from the Tree may not be a tracked repo — inject an option so the
    // dropdown can still show it (the bridge resolves any path under the workspace root).
    if (value && !st.repos.some((r) => r.localPath === value)) opts.push(el("option", { value }, [shortRepo(value) + "  ·  (tree)"]));
    sel.replaceChildren(...opts);
    sel.value = value || "";
  }

  // ---- worktree <select> for a pane -------------------------------------------------
  function fillWorktreeSelect(sel, p) {
    const list = st.worktrees[p.repo] || [{ name: "main", isMain: true }];
    const names = list.map((w) => w.name);
    if (!names.includes(p.worktree)) names.unshift(p.worktree || "main");   // keep the pane's own value shown
    const opts = [...new Set(names)].map((n) => {
      const w = list.find((x) => x.name === n);
      return el("option", { value: n }, [n + (w?.needsInstall ? "  ⚠ needs install" : "")]);
    });
    opts.push(el("option", { value: "__new__" }, ["+ new worktree…"]));
    sel.replaceChildren(...opts);
    sel.value = p.worktree || "main";
    sel.hidden = !p.repo;   // only meaningful once a repo is picked
  }

  // ---- transcript rendering (handles both live {kind} and saved {role} items) ----
  function line(cls, kids) { return el("div", { class: "ws-line " + cls }, kids); }
  // A small always-visible (not hover-only — this has to work on touch) copy button, matching
  // the copy affordance on every Claude response elsewhere. `getText` is a thunk rather than a
  // plain string so it's evaluated at click time, not render time.
  function copyBtn(getText) {
    const b = el("button", { class: "ws-copy", type: "button", title: "Copy" }, ["⧉"]);
    const flash = (ok) => {
      b.textContent = ok ? "✓" : "✗"; b.classList.toggle("copied", ok);
      setTimeout(() => { b.textContent = "⧉"; b.classList.remove("copied"); }, 1200);
    };
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const text = getText();
      if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).then(() => flash(true), () => wsFallbackCopy(text, flash)); }
      else wsFallbackCopy(text, flash);
    });
    return b;
  }
  function wsFallbackCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand("copy"); document.body.removeChild(ta);
      done(ok);
    } catch { done(false); }
  }
  // Splits assistant text on ```fenced``` code blocks: prose stays plain text, each code block
  // becomes its own bordered, monospaced box with a copy button for JUST that block — not the
  // whole message. This is specifically what was asked for (a "copy paste window" per code
  // block, matching Claude's own rendering), not a copy button glued onto every reply.
  const WS_FENCE_RE = /```([\w+-]*)\n?([\s\S]*?)```/g;
  function renderAssistantText(text) {
    if (typeof text !== "string" || !text.includes("```")) return [text];
    const parts = []; let last = 0, mtch;
    WS_FENCE_RE.lastIndex = 0;
    while ((mtch = WS_FENCE_RE.exec(text))) {
      if (mtch.index > last) parts.push(text.slice(last, mtch.index));
      const lang = mtch[1] || "";
      const code = mtch[2].replace(/\n$/, "");
      parts.push(el("div", { class: "ws-codeblock" }, [
        el("div", { class: "ws-codeblock-hd" }, [el("span", {}, [lang || "code"]), copyBtn(() => code)]),
        el("pre", { class: "ws-codeblock-body" }, [code]),
      ]));
      last = WS_FENCE_RE.lastIndex;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }
  function renderItem(m) {
    if (m.role === "user" || m.kind === "user") return line("ws-user", [el("b", {}, ["you  "]), m.text]);
    if (m.role === "assistant" || m.kind === "assistant") return line("ws-assistant", renderAssistantText(m.text));
    if (m.kind === "tool_use") return line("ws-tool", [el("i", { class: "ti ti-tool" }, []), " ", (m.tools || []).map((t) => t.name).join(", ")]);
    if (m.kind === "tool_result") return line("ws-toolres", ["✓ tool result"]);
    if (m.kind === "result") return line("ws-result", [`— done · ${(m.usage?.output_tokens || 0)} out tok · ~${fmtUsd(m.costUsd)}`]);
    if (m.kind === "error") return line("ws-err", ["⚠ " + (m.text || m.message || "Unknown error")]);
    if (m.kind === "created") return line("ws-note", [`created ${m.what}: ${m.path}`]);
    return null;
  }
  const isToolEvent = (m) => m.kind === "tool_use" || m.kind === "tool_result";
  const isTurnBoundary = (m) => m.role === "user" || m.kind === "user";
  // A turn with several tool calls otherwise renders one "✓ tool result" line per event, burying
  // the assistant's actual answer in noise. Collapse every tool_use/tool_result event within ONE
  // turn into one expandable summary line — even when interim assistant commentary interrupts the
  // tool rounds — expanding reveals the same per-event detail renderItem always produced, just
  // hidden by default.
  //
  // `key` is a stable id for this group across repaints (the index, within the full transcript,
  // of the group's first event — transcript items are only ever appended, never reordered/removed,
  // so the index stays valid) and `expandedGroups` is the pane's own `Set` of currently-open group
  // keys (see `p._expandedGroups`); this is how an expanded group survives the frequent
  // paintPane() full re-renders that happen while a turn streams in, instead of re-collapsing on
  // every event.
  function renderToolGroup(group, key, expandedGroups) {
    const calls = group.reduce((n, m) => n + (m.kind === "tool_use" ? Math.max((m.tools || []).length, 1) : 0), 0);
    const isOpen = !!(expandedGroups && expandedGroups.has(key));
    const props = {
      class: "ws-line ws-toolgroup",
      ontoggle: (e) => { if (!expandedGroups) return; if (e.target.open) expandedGroups.add(key); else expandedGroups.delete(key); },
    };
    if (isOpen) props.open = true;
    return el("details", props, [
      el("summary", { class: "ws-toolgroup-summary" }, [el("i", { class: "ti ti-tool" }, []), ` ${calls} tool call${calls === 1 ? "" : "s"}`]),
      ...group.map(renderItem).filter(Boolean),
    ]);
  }
  // Renders a full transcript, grouping every tool_use/tool_result event within one TURN into a
  // single collapsed summary — a turn boundary is the next `user` item, not mere array adjacency,
  // so interim assistant commentary between two tool-call rounds of the same turn doesn't split
  // them into two summaries. Everything else still renders exactly as renderItem produces, inline,
  // in its natural chronological position (the tool-group's own position is reserved at its first
  // event and filled in once the group closes, so later-arriving tool events in the same turn still
  // land in the one group even though other items were emitted in between).
  function renderTranscript(items, expandedGroups) {
    const out = [];
    let group = null, groupSlot = null, groupKey = null;
    const closeGroup = () => {
      if (!group) return;
      out[groupSlot] = renderToolGroup(group, groupKey, expandedGroups);
      group = null; groupSlot = null; groupKey = null;
    };
    items.forEach((m, i) => {
      if (isTurnBoundary(m)) closeGroup();   // a new turn starts here — flush the prior turn's group first
      if (isToolEvent(m)) {
        if (!group) { group = []; groupKey = i; groupSlot = out.length; out.push(null); }
        group.push(m);
      } else {
        const node = renderItem(m); if (node) out.push(node);
      }
    });
    closeGroup();
    return out.filter(Boolean);
  }

  // ---- image attach ---------------------------------------------------------------
  // One image per pane, riding the existing `prompt` payload (no new upload route/control
  // action) as `{ mediaType, base64Data }` — see lib/workspace.mjs `_prompt`/`_saveImage` and
  // lib/workspaceStore.mjs `saveImage`'s IMAGE_EXT for the closed list this must match.
  const WS_IMG_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
  // "roughly 3 MB" per design — measured on the ENCODED (base64) string, since that's what
  // actually rides the WS control frame; base64 chars ≈ bytes (ASCII), so string length is a
  // fine proxy without decoding back to bytes just to check.
  const WS_IMG_MAX_ENCODED_BYTES = 3 * 1024 * 1024;
  // Recompression ladder: try full-size-but-lower-quality first (cheapest to look at), only
  // downscaling resolution once quality alone can't get under the cap.
  const WS_IMG_COMPRESS_STEPS = [[1, 0.92], [1, 0.7], [0.75, 0.6], [0.5, 0.5], [0.35, 0.4]];

  function wsReadFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error("could not read file"));
      r.readAsDataURL(file);
    });
  }
  /** Length of the base64 payload after the `data:...;base64,` prefix — the part that actually
   *  travels in the prompt payload. */
  function wsDataUrlEncodedSize(dataUrl) { const i = dataUrl.indexOf(","); return i < 0 ? 0 : dataUrl.length - i - 1; }
  function wsDataUrlToAttachment(dataUrl) {
    const m = /^data:([^;,]+)(?:;[^,]*)?,([\s\S]*)$/.exec(dataUrl || "");
    if (!m || !m[2]) return null;
    return { mediaType: m[1], base64Data: m[2], dataUrl };
  }
  /** Decode a File into something <canvas> can draw — `createImageBitmap` where available
   *  (works off-thread, no DOM node needed), falling back to a plain `Image` for browsers
   *  without it. */
  async function wsLoadDrawable(file) {
    if (window.createImageBitmap) { try { return await createImageBitmap(file); } catch { /* fall through to Image */ } }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("could not decode image"));
        img.src = url;
      });
    } finally { URL.revokeObjectURL(url); }
  }
  /** Downscale/recompress via <canvas>, always re-encoding as JPEG (in WS_IMG_ALLOWED_TYPES
   *  regardless of the source format) — walks WS_IMG_COMPRESS_STEPS until the encoded result
   *  fits under the cap, or returns null if it still doesn't after the whole ladder. */
  async function wsCompressImage(file) {
    let drawable;
    try { drawable = await wsLoadDrawable(file); } catch { return null; }
    const srcW = drawable.width || drawable.naturalWidth || 0, srcH = drawable.height || drawable.naturalHeight || 0;
    if (!srcW || !srcH) return null;
    for (const [scale, quality] of WS_IMG_COMPRESS_STEPS) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(srcW * scale));
      canvas.height = Math.max(1, Math.round(srcH * scale));
      canvas.getContext("2d").drawImage(drawable, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (wsDataUrlEncodedSize(dataUrl) <= WS_IMG_MAX_ENCODED_BYTES) { if (drawable.close) drawable.close(); return wsDataUrlToAttachment(dataUrl); }
    }
    if (drawable.close) drawable.close();
    return null;
  }
  /** Entry point for all three attach paths (file-picker, paste, drag-drop) — same file-in,
   *  same attached-state-out, so they're functionally equivalent per the design. Skips
   *  recompression for an already-under-cap PNG/JPEG/WebP (keeps a small screenshot crisp);
   *  anything else (oversized, or an unsupported clipboard/drop type) goes through
   *  wsCompressImage, which always emits an allowed mediaType. */
  async function wsAttachImageFile(p, file) {
    wsShowImgErr(p, "");
    if (!file || !/^image\//.test(file.type || "")) { wsShowImgErr(p, "That isn't an image file."); return; }
    let attachment = null;
    try {
      if (WS_IMG_ALLOWED_TYPES.includes(file.type)) {
        const dataUrl = await wsReadFileAsDataUrl(file);
        attachment = wsDataUrlEncodedSize(dataUrl) <= WS_IMG_MAX_ENCODED_BYTES ? wsDataUrlToAttachment(dataUrl) : await wsCompressImage(file);
      } else {
        attachment = await wsCompressImage(file);
      }
    } catch { attachment = null; }
    if (!attachment) { wsShowImgErr(p, "That image is too large to attach, even after compression — try a smaller one."); return; }
    p.attachedImage = attachment;
    wsPaintAttachment(p);
  }
  function wsShowImgErr(p, msg) {
    const ui = paneUI.get(p.id); if (!ui) return;
    ui.imgErr.textContent = msg || ""; ui.imgErr.hidden = !msg;
  }
  /** Sync the preview thumbnail + remove control to p.attachedImage — called after every
   *  attach, remove, and a successful/failed send (see wsAttachImageFile, the remove button,
   *  and send()). */
  function wsPaintAttachment(p) {
    const ui = paneUI.get(p.id); if (!ui) return;
    const img = p.attachedImage;
    ui.imgPreviewWrap.hidden = !img;
    if (img) ui.imgThumb.src = img.dataUrl; else ui.imgThumb.removeAttribute("src");
  }

  // ---- one pane ------------------------------------------------------------------
  function buildPane(p) {
    const repoSel = el("select", { class: "wsel wsel-sm" }, []); fillRepoSelect(repoSel, p.repo);
    const wtSel = el("select", { class: "wsel wsel-sm wsel-wt", title: "Worktree — a separate checkout for a parallel workspace on this repo" }, []);
    fillWorktreeSelect(wtSel, p);
    const modeSel = el("select", { class: "wsel wsel-mode", title: "Permission mode for this pane" },
      WS_MODES.map((m) => el("option", { value: m.id }, [m.short])));
    modeSel.value = p.mode;
    // The pane's turn-lock status icon — a plain CSS spinner (no glyph, no dependency):
    // a bordered ring that rotates while the pane's session is busy, and sits still
    // (idle/done) otherwise. Driven by paintPane() from p.status, which onPayload keeps
    // in sync with the existing busy/status/result/error event stream (see onPayload).
    const dot = el("span", { class: "ws-status" });
    const badge = el("span", { class: "ws-usage" }, ["—"]);
    const closeBtn = el("button", { class: "ws-x", title: "Clear this pane (ends its session)" }, ["×"]);
    const histBtn = el("button", { class: "ws-ico", title: "History for this repo" }, ["⏱"]);
    const transcriptEl = el("div", { class: "ws-transcript" }, []);
    const promptEl = el("textarea", { class: "ws-prompt", rows: "2", placeholder: "Message Claude… (Ctrl+Enter)" });
    const sendBtn = el("button", { class: "loginbtn ws-send" }, ["Send"]);
    // Attach affordance: a file-picker button (hidden native <input type=file>) plus paste and
    // drag-drop straight onto the compose row — all three funnel into wsAttachImageFile, so they
    // end up in the exact same attached/preview state (see design's "functionally equivalent
    // entry points").
    const imgFileInput = el("input", { type: "file", accept: WS_IMG_ALLOWED_TYPES.join(","), class: "ws-img-input" });
    const attachBtn = el("button", { class: "ws-ico ws-attach", type: "button", title: "Attach an image — click, paste, or drag onto the box" }, ["📎"]);
    const imgThumb = el("img", { class: "ws-img-thumb", alt: "attached image" });
    const imgRemoveBtn = el("button", { class: "ws-img-x", type: "button", title: "Remove attached image" }, ["×"]);
    const imgPreviewWrap = el("div", { class: "ws-img-preview" }, [imgThumb, imgRemoveBtn]);
    imgPreviewWrap.hidden = true;
    const imgErr = el("div", { class: "ws-img-err" }, []);
    imgErr.hidden = true;
    const composeRow = el("div", { class: "ws-compose" }, [attachBtn, imgFileInput, promptEl, sendBtn]);
    const composeExtras = el("div", { class: "ws-compose-extras" }, [imgPreviewWrap, imgErr]);
    // A slim, ALWAYS-visible identity readout — plain text, not a control — so which
    // repo@worktree this pane is actually showing is never in doubt regardless of scroll
    // position or which conversation was just resumed into it. Kept separate from the
    // interactive controls below, which move to the bottom (see next block) to sit near the
    // compose row the way Claude's own UI keeps its controls near the input, not in a fixed
    // header far from where you're actually typing.
    const identityLabel = el("span", { class: "ws-identity" }, ["—"]);
    const topBar = el("div", { class: "ws-pane-hd" }, [dot, identityLabel, el("span", { class: "ws-spacer" }), closeBtn]);
    const controlsBar = el("div", { class: "ws-pane-controls" }, [repoSel, wtSel, modeSel, histBtn, el("span", { class: "ws-spacer" }), badge]);
    // The live "what's happening right now" feed — a single always-visible line (tap to expand
    // the full scrolling log) narrating every state transition: sending, thinking, streaming,
    // running a tool, waiting for permission, done, a connection hiccup — everything the orange
    // button alone couldn't tell you. See logActivity()/renderActivityLog().
    const activityLine = el("div", { class: "ws-activity", title: "Tap for the full activity log" }, ["Idle"]);
    const activityLog = el("div", { class: "ws-activity-log" }, []);
    activityLog.hidden = true;
    activityLine.addEventListener("click", () => { activityLog.hidden = !activityLog.hidden; if (!activityLog.hidden) renderActivityLog(p); });
    const paneRoot = el("div", { class: "ws-pane" }, [topBar, activityLine, activityLog, transcriptEl, controlsBar, composeExtras, composeRow]);

    paneRoot.addEventListener("mousedown", () => setActive(p.id));
    // Repointing a pane to a different repo/worktree abandons its OLD identity — bump `_gen` so
    // an open/resume reply still in flight for that old identity is discarded, not applied, when
    // it eventually arrives (see beginPendingOpen), and reset `status` to idle: the new workspace
    // never started a turn, so a stale "thinking" carried over from the old identity would spin
    // the busy indicator forever (no event for the OLD session can ever arrive to correct it once
    // sessionKey has moved on).
    repoSel.addEventListener("change", () => { p.repo = repoSel.value; p.worktree = "main"; p.readonly = false; p.resume = null; p.status = "idle"; p._queue = null; p._gen = (p._gen || 0) + 1; assignKey(p); paintPane(p); saveLayout(); reportAttach(); onRepoChosen(p); if (p.repo) wsPost("control", { action: "worktrees", args: { repo: p.repo } }); });
    wtSel.addEventListener("change", () => {
      const v = wtSel.value;
      if (v === "__new__") {   // "+ new worktree…" — create one, then switch this pane to it
        wtSel.value = p.worktree;
        const name = window.prompt(`New worktree for ${shortRepo(p.repo)} (a separate checkout):`);
        if (name == null || !name.trim()) return;
        p._pendingWorktree = name.trim();
        wsPost("control", { action: "worktreeAdd", args: { repo: p.repo, name: name.trim() } });
        return;
      }
      // A different worktree is a different session — anything queued for the OLD one must
      // never fire into it (see clearPane's same _queue reset).
      p.worktree = v || "main"; p.readonly = false; p.resume = null; p.status = "idle"; p._queue = null; p._gen = (p._gen || 0) + 1; assignKey(p);
      paintPane(p); saveLayout(); reportAttach(); onRepoChosen(p);
    });
    // Applies live: the server calls the SDK's setPermissionMode on a running session, so
    // switching mid-conversation behaves the same as switching it in the Claude Code UI.
    modeSel.addEventListener("change", () => { p.mode = modeSel.value; wsPost("control", { action: "setMode", args: { sessionKey: p.sessionKey, mode: p.mode } }); paintPane(p); saveLayout(); });
    histBtn.addEventListener("click", (e) => { e.stopPropagation(); loadHistory(p.repo || null); });
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); clearPane(p); });
    sendBtn.addEventListener("click", () => send(p));
    promptEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(p); } });
    // Attach path 1: file-picker button opens the hidden native input; its change event is the
    // one place ALL browsers report the chosen file.
    attachBtn.addEventListener("click", (e) => { e.stopPropagation(); imgFileInput.click(); });
    imgFileInput.addEventListener("change", () => {
      const f = imgFileInput.files && imgFileInput.files[0];
      imgFileInput.value = "";   // reset so re-picking the SAME file still fires change next time
      if (f) wsAttachImageFile(p, f);
    });
    // Attach path 2: paste an image straight into the textarea — mirrors Claude Desktop.
    // Only intercepted when the clipboard actually carries an image; a text paste (the common
    // case) is left completely alone.
    promptEl.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items; if (!items) return;
      for (const item of items) {
        if (item.kind === "file" && /^image\//.test(item.type)) {
          e.preventDefault();
          const f = item.getAsFile();
          if (f) wsAttachImageFile(p, f);
          return;
        }
      }
    });
    // Attach path 3: drag-and-drop an image file onto the compose row.
    composeRow.addEventListener("dragover", (e) => { e.preventDefault(); composeRow.classList.add("ws-drag"); });
    composeRow.addEventListener("dragleave", () => composeRow.classList.remove("ws-drag"));
    composeRow.addEventListener("drop", (e) => {
      e.preventDefault(); composeRow.classList.remove("ws-drag");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) wsAttachImageFile(p, f);
    });
    imgRemoveBtn.addEventListener("click", (e) => { e.stopPropagation(); p.attachedImage = null; wsShowImgErr(p, ""); wsPaintAttachment(p); });

    paneUI.set(p.id, { root: paneRoot, transcriptEl, promptEl, repoSel, wtSel, modeSel, usageEl: badge, dot, sendBtn, attachBtn, imgThumb, imgPreviewWrap, imgErr, identityLabel, activityLine, activityLog });
    return paneRoot;
  }

  // ---- live activity feed: "what's happening right now", separate from the chat transcript ----
  const WS_ACTIVITY_CAP = 60;   // bounded so a long session's log can't grow without limit
  function logActivity(p, text, tone) {
    p._activity = p._activity || [];
    p._activity.push({ at: Date.now(), text, tone: tone || "" });
    if (p._activity.length > WS_ACTIVITY_CAP) p._activity.shift();
    const ui = paneUI.get(p.id); if (!ui) return;
    ui.activityLine.textContent = text;
    ui.activityLine.className = "ws-activity" + (tone ? " " + tone : "");
    if (!ui.activityLog.hidden) renderActivityLog(p);
  }
  function renderActivityLog(p) {
    const ui = paneUI.get(p.id); if (!ui) return;
    const items = (p._activity || []).slice().reverse().map((a) =>
      el("div", { class: "ws-activity-item" + (a.tone ? " " + a.tone : "") }, [
        el("span", { class: "ws-activity-time" }, [new Date(a.at).toLocaleTimeString()]),
        a.text,
      ]));
    ui.activityLog.replaceChildren(...(items.length ? items : [el("div", { class: "hint" }, ["Nothing yet."])]));
  }
  // Connection-level events (a drop, a reconnect) aren't scoped to one pane's session — every
  // pane watching this stream is equally affected, so it goes to all of them.
  function logActivityAll(text, tone) { for (const p of st.panes) logActivity(p, text, tone); }

  function paintPane(p) {
    const ui = paneUI.get(p.id); if (!ui) return;
    ui.root.classList.toggle("on", p.id === st.activeId);
    ui.root.classList.toggle("ro", !!p.readonly);
    // Keep the dropdown showing the pane's repo, injecting an option for a tree-picked
    // path that isn't a tracked repo.
    if (!Array.from(ui.repoSel.options).some((o) => o.value === (p.repo || ""))) fillRepoSelect(ui.repoSel, p.repo);
    else if (ui.repoSel.value !== (p.repo || "")) ui.repoSel.value = p.repo || "";
    if (ui.wtSel) fillWorktreeSelect(ui.wtSel, p);
    // The always-visible identity readout — the single source of truth for "what is this pane
    // actually showing," kept in lockstep with the SAME p.repo/p.worktree the controls below
    // read from, so the two can never disagree the way the header label used to.
    if (ui.identityLabel) {
      ui.identityLabel.textContent = p.repo
        ? shortRepo(p.repo) + (p.worktree && p.worktree !== "main" ? " @ " + p.worktree : "")
        : "Pick a repository";
    }
    if (ui.modeSel.value !== p.mode) ui.modeSel.value = p.mode;
    ui.modeSel.classList.toggle("danger", p.mode === "bypassPermissions");
    ui.modeSel.classList.toggle("plan", p.mode === "plan");
    const busy = paneBusy(p);
    ui.dot.classList.toggle("spinning", busy);
    ui.dot.title = busy ? "Claude is working this turn…" : "Idle";
    // Busy is a visual-only signal on the Send button (color + label), distinct from `disabled`:
    // the button stays clickable while busy so a prompt typed mid-turn still round-trips to the
    // server's `busy` refusal (see send()), which is what restores the typed text today. Turning
    // it fully unclickable is a bigger behavior change (queuing) that hasn't landed yet.
    ui.sendBtn.classList.toggle("busy", busy);
    ui.sendBtn.textContent = busy ? "Working…" : "Send";
    ui.sendBtn.title = busy ? "Claude is still working this turn — sending now will be held until it finishes." : "";
    ui.promptEl.disabled = !!p.readonly;
    ui.sendBtn.disabled = !!p.readonly;
    ui.attachBtn.disabled = !!p.readonly;
    ui.promptEl.placeholder = p.readonly ? "Read-only — pick the repo above or Resume from history to continue" : (p.resume ? "Resuming saved session — your next message continues it" : "Message Claude… (Ctrl+Enter)");
    const u = p.usage || {};
    ui.usageEl.textContent = (u.inputTokens || u.outputTokens) ? `${((u.inputTokens || 0) + (u.outputTokens || 0)).toLocaleString()} tok · ~${fmtUsd(u.costUsd)}` : "—";
    // paintPane fires on every streamed event during a turn — a full replaceChildren() would
    // otherwise (a) blow away any tool-group a user just expanded (fixed by handing the pane's
    // persisted `_expandedGroups` into renderTranscript) and (b) yank the scroll position back to
    // the bottom even for someone who deliberately scrolled up to read earlier history. Snap to
    // the bottom only when the pane was already there (or is short enough to be there already) —
    // someone actively watching a live response keeps following it either way.
    const wasNearBottom = ui.transcriptEl.scrollHeight - ui.transcriptEl.scrollTop - ui.transcriptEl.clientHeight < WS_SCROLL_NEAR_BOTTOM_PX;
    const hasQueue = p._queue && p._queue.length;
    if (!p.transcript.length && !p._liveText && !hasQueue) ui.transcriptEl.replaceChildren(el("div", { class: "hint" }, [p.repo ? "Send a message — Claude runs in " + shortRepo(p.repo) + " on your machine." : "Pick a repository (dropdown, or the sidebar) to start."]));
    else {
      const nodes = renderTranscript(p.transcript, p._expandedGroups);
      // The live-typing preview — text streamed so far this turn, not yet the authoritative
      // complete line (that replaces it the moment the real "assistant" event lands; see
      // onPayload's assistant_delta handling). Appended after the real transcript, never IN it.
      if (p._liveText) nodes.push(line("ws-assistant ws-live", [p._liveText]));
      // Queued messages — typed while Claude was still working, "frozen in cache" until this
      // turn finishes (see send()/drainQueue()). Rendered distinctly (orange) so it's obvious
      // these haven't actually been sent yet, in the order they'll go out. Several queued at once
      // are shown individually here but drainQueue() merges them into ONE prompt on release —
      // the tag says so whenever there's more than one, so it's clear before it happens.
      const queuedTag = hasQueue && p._queue.length > 1
        ? "queued — will be merged with the other" + (p._queue.length - 1 > 1 ? "s" : "") + " into one message once this turn finishes"
        : "queued — sending once this turn finishes";
      if (hasQueue) for (const q of p._queue) nodes.push(line("ws-user ws-queued", [el("b", {}, ["you  "]), q.text, el("span", { class: "ws-queued-tag" }, [queuedTag])]));
      ui.transcriptEl.replaceChildren(...nodes);
    }
    if (wasNearBottom) ui.transcriptEl.scrollTop = ui.transcriptEl.scrollHeight;
  }

  function setActive(id) {
    if (st.activeId === id) return;
    st.activeId = id;
    for (const p of st.panes) paneUI.get(p.id)?.root.classList.toggle("on", p.id === id);
    renderSidebar();
    saveLayout();
    reportAttach();   // presence follows the active pane's workspace
  }

  function rebuildGrid() {
    grid.dataset.cols = String(st.cols);
    grid.dataset.rows = String(st.rows);
    grid.style.setProperty("--ws-cols", st.cols);
    grid.style.setProperty("--ws-rows", st.rows);
    paneUI.clear();
    grid.replaceChildren(...st.panes.map(buildPane));
    for (const p of st.panes) paintPane(p);
  }

  /** Tell the work machine a session is finished with. Without this a pane that goes away
   *  (trimmed by the grid, or cleared) left its SDK session running there forever, streaming
   *  into a pane that no longer exists. */
  function endSessions(keys) {
    const live = keys.filter(Boolean);
    if (live.length) wsPost("control", { action: "delete", args: { sessionKeys: live } });
  }
  const paneBusy = (p) => p.status === "thinking" || p.status === "awaiting-permission";

  /** × on a pane: end its session and give the pane a clean key, so the next message starts a
   *  genuinely new conversation rather than appending to the one you just cleared. */
  function clearPane(p) {
    if (paneBusy(p) && !window.confirm("This pane is still working. Clear it and end that session?")) return;
    endSessions([p.sessionKey]);
    p.sessionKey = wsUuid(); p.transcript = []; p.usage = {}; p.status = "idle"; p.readonly = false; p.resume = null;
    p._expandedGroups = new Set();   // a cleared pane starts a fresh transcript — stale group keys don't apply
    p._queue = null;   // anything queued for the OLD session must never fire into the fresh one
    p._gen = (p._gen || 0) + 1;   // invalidate any in-flight open still targeting the OLD identity
    paintPane(p); setUsageTotal(); saveLayout();
  }

  function setLayout(cols, rows) {
    const c = clampInt(cols, 1, WS_MAX_COLS), r = clampInt(rows, 1, WS_MAX_ROWS);
    const want = c * r;
    if (st.panes.length > want) {
      const dropped = st.panes.slice(want);
      if (dropped.some(paneBusy) && !window.confirm(`${dropped.filter(paneBusy).length} pane(s) being dropped are still working. End those sessions?`)) return;
      endSessions(dropped.map((p) => p.sessionKey));
      st.panes.length = want;
    }
    st.cols = c; st.rows = r;
    while (st.panes.length < want) st.panes.push(newPane());
    if (!st.panes.some((p) => p.id === st.activeId)) st.activeId = st.panes[0]?.id;
    rebuildGrid();
    renderLayoutPicker();
    setUsageTotal();
    saveLayout();
  }

  function setUsageTotal() {
    let cost = 0, tok = 0;
    for (const p of st.panes) { cost += p.usage?.costUsd || 0; tok += (p.usage?.inputTokens || 0) + (p.usage?.outputTokens || 0); }
    usageEl.textContent = `${st.cols}×${st.rows} = ${st.panes.length} pane(s) · ${tok.toLocaleString()} tok · ~${fmtUsd(cost)} (covered by subscription)`;
  }

  // ---- sidebar: Repositories | Tree ----------------------------------------------
  function repoBadge() { return el("span", { class: "ws-repobadge", title: "repository (.iz.md)" }, ["repo"]); }
  function renderSidebar() {
    if (st.sidebarMode === "repos") {
      if (!st.repos.length) { sideList.replaceChildren(el("div", { class: "hint" }, ["No repositories found (a folder is a repo when it has a .iz.md marker)."])); return; }
      // Group into org "cardboards", in the Map's org order (unknown orgs after), like the Brain page.
      const groups = new Map();
      for (const r of st.repos) { if (!groups.has(r.org)) groups.set(r.org, []); groups.get(r.org).push(r); }
      const known = Object.keys(MAP?.orgs || {}).filter((o) => groups.has(o));
      const rest = [...groups.keys()].filter((o) => !known.includes(o)).sort();
      sideList.replaceChildren(...[...known, ...rest].map((org) => {
        const meta = (MAP?.orgs || {})[org] || { color: "#64748b" };
        const cards = groups.get(org).sort((a, b) => a.name.localeCompare(b.name)).map((r) => {
          const b = el("button", { class: "ws-side-item", title: r.localPath }, [el("span", { class: "ws-side-name" }, [r.name]), dataBadge(r.localPath)]);
          b.addEventListener("click", () => pickRepoForActive(r.localPath));
          return b;
        });
        const collapsed = st.collapsedOrgs.has(org);
        const hd = el("div", { class: "ws-orggroup-hd", role: "button" }, [
          el("span", { class: "ws-org-chev" }, [collapsed ? "▸" : "▾"]),
          el("span", { class: "ws-org-dot" }, []), el("b", {}, [org]), el("span", { class: "ws-org-count" }, [String(cards.length)]),
        ]);
        hd.addEventListener("click", () => { if (collapsed) st.collapsedOrgs.delete(org); else st.collapsedOrgs.add(org); renderSidebar(); });
        return el("div", { class: "ws-orggroup" + (collapsed ? " collapsed" : ""), style: `--org:${meta.color}` }, [
          hd, collapsed ? "" : el("div", { class: "ws-orggroup-body" }, cards),
        ]);
      }));
    } else {
      sideList.replaceChildren(st.tree ? treeNode(st.tree, "", 0) : el("div", { class: "hint" }, ["Loading the folder tree…"]));
    }
  }
  function toggleExpand(key) { if (st.treeExpanded.has(key)) st.treeExpanded.delete(key); else st.treeExpanded.add(key); renderSidebar(); }
  function treeNode(node, path, depth) {
    const here = path ? path + "/" + node.name : node.name;
    const rel = depth === 0 ? "" : here.split("/").slice(1).join("/");   // path relative to the workspace root
    const hasKids = (node.children || []).length > 0;
    const expanded = st.treeExpanded.has(here);
    const chev = el("span", { class: "ws-chev" + (hasKids ? "" : " ghost") }, [hasKids ? (expanded ? "▾" : "▸") : ""]);
    const row = el("div", { class: "ws-tree-row" + (node.isRepo ? " is-repo" : "") + (hasKids ? " has-kids" : ""), style: `padding-left:${6 + depth * 13}px`, title: node.isRepo ? rel : "" }, [
      chev,
      el("span", { class: "ws-tree-ic" }, [node.isRepo ? "📦" : (hasKids ? (expanded ? "📂" : "📁") : "·")]),
      el("span", { class: "ws-tree-name" }, [depth === 0 ? "workspace" : node.name]),
      node.isRepo ? repoBadge() : "",
      node.isRepo ? dataBadge(rel) : "",
    ]);
    chev.addEventListener("click", (e) => { e.stopPropagation(); if (hasKids) toggleExpand(here); });
    row.addEventListener("click", () => { if (node.isRepo && depth > 0) pickRepoForActive(rel); else if (hasKids) toggleExpand(here); });
    const container = el("div", { class: "ws-tree-node" }, [row]);
    if (expanded) for (const c of node.children) container.append(treeNode(c, here, depth + 1));
    return container;
  }
  function pickRepoForActive(localPath) {
    const p = activePane(); if (!p) return;
    p.repo = localPath; p.readonly = false; p.resume = null;
    paintPane(p); saveLayout(); note("Active pane → " + shortRepo(localPath));
  }

  // ---- per-repo history ----------------------------------------------------------
  function loadHistory(repo) { st.historyRepo = repo || null; wsPost("control", { action: "history", args: { repo: repo || undefined } }); histList.replaceChildren(el("div", { class: "hint" }, ["Loading history…"])); }
  // `onAction`, if given, fires after Open/Resume is clicked — used by the expanded full-page
  // history view to close itself once you've actually picked a conversation, without changing
  // the normal sidebar's behavior (there, it's simply omitted).
  function histItem(h, snippet, onAction) {
    const when = h.updatedAt ? new Date(h.updatedAt).toLocaleString() : "";
    // Search results (`snippet != null`) are still one row per saved SESSION (`h.sessionKey`,
    // from `searchSessions`). The plain history list is now one row per WORKSPACE — every past
    // session file for a repo+worktree merged into a single row (`h.workspaceId`) — so opening it
    // must key off that instead.
    const key = snippet != null ? h.sessionKey : h.workspaceId;
    const label = shortRepo(h.repo) || "—";
    // A row whose worktree no longer exists (removed, or this box never had it) is real, permanent
    // history — just not something "Resume" can casually continue, since there's no checkout left
    // to run in. Marked distinctly so that's obvious at a glance, not discovered via a confusing
    // refusal after clicking Resume.
    const missing = !!h.missingWorktree;
    const openB = el("button", { class: "ws-ico", title: "Reopen read-only" }, ["👁"]);
    const resumeB = el("button", { class: "ws-ico", title: missing ? "This worktree was removed — resume recreates it" : "Resume live" }, ["▶"]);
    openB.addEventListener("click", () => { reopen(key, "open"); onAction?.(); });
    resumeB.addEventListener("click", () => {
      if (!missing) { reopen(key, "resume"); onAction?.(); return; }
      const ok = window.confirm(
        `The worktree "${h.worktree}" for ${label} was removed.\n\n` +
        `Resuming will RECREATE it (reattaching to its original branch, which git keeps even after ` +
        `a worktree is removed) and continue this conversation there.\n\nRecreate "${h.worktree}" and resume?`
      );
      if (!ok) return;
      resumeAfterRecreatingWorktree(h.repo, h.worktree, key);
      onAction?.();
    });
    return el("div", { class: "ws-hist-item" + (missing ? " missing-worktree" : "") }, [
      el("div", { class: "ws-hist-line1" }, [
        el("b", {}, [label + (h.worktree && h.worktree !== "main" ? "@" + h.worktree : "")]),
        el("span", { class: "ws-hist-meta" }, [snippet != null ? `${h.matchCount} match(es)` : `${h.turns || 0} turn(s)`]),
      ]),
      missing ? el("div", { class: "ws-hist-missing" }, ["⚠ worktree removed — historical; Resume recreates it"]) : "",
      el("div", { class: "ws-hist-first" }, [snippet != null ? "…" + snippet + "…" : (h.firstPrompt || "(no prompt)")]),
      el("div", { class: "ws-hist-actions" }, [el("span", { class: "ws-hist-when" }, [when]), el("span", { class: "ws-spacer" }, []), openB, resumeB]),
    ]);
  }
  // Recreate-then-resume: the confirmed common case for a history row whose worktree is gone.
  // worktreeAdd's actual confirmation arrives asynchronously over the stream (the `data.worktrees`
  // state update — see onPayload), not from this POST's immediate response, so this just records
  // intent and a safety-net timeout; the stream handler below completes the resume once the
  // worktree genuinely exists.
  function resumeAfterRecreatingWorktree(repo, worktree, sessionKey) {
    clearTimeout(st._pendingHistoryResume?.timer);
    const timer = setTimeout(() => {
      if (st._pendingHistoryResume?.sessionKey === sessionKey) { note(`⚠ Could not recreate worktree "${worktree}" — resume cancelled.`); st._pendingHistoryResume = null; }
    }, 8000);
    st._pendingHistoryResume = { repo, worktree, sessionKey, timer };
    wsPost("control", { action: "worktreeAdd", args: { repo, name: worktree } });
  }
  function renderHistory() {
    const searchBox = el("input", { class: "ws-search", type: "search", placeholder: "Search conversations…", value: st.searchQuery });
    searchBox.addEventListener("input", () => {
      st.searchQuery = searchBox.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (st.searchQuery.trim()) wsPost("control", { action: "search", args: { query: st.searchQuery.trim(), repo: st.historyRepo || undefined } });
        else { st.searchResults = null; renderHistory(); }
      }, 280);
    });
    const expandBtn = el("button", { class: "ws-ico", title: "Expand — full page, grouped by organisation/repo" }, ["⤢"]);
    expandBtn.addEventListener("click", () => openHistoryExpanded());
    const title = el("div", { class: "ws-hist-hd" }, ["History", el("span", { class: "ws-hist-scope" }, [st.historyRepo ? shortRepo(st.historyRepo) : "all repos"]), expandBtn, (() => { const b = el("button", { class: "ws-ico", title: "Refresh" }, ["⟳"]); b.addEventListener("click", () => { st.searchQuery = ""; st.searchResults = null; loadHistory(st.historyRepo); }); return b; })()]);
    const searching = st.searchResults !== null && st.searchQuery.trim();
    const rows = searching
      ? (st.searchResults.length ? st.searchResults.map((h) => histItem(h, h.snippet)) : [el("div", { class: "hint" }, [`No conversation matches “${st.searchQuery.trim()}”.`])])
      : (st.history.length ? st.history.map((h) => histItem(h)) : [el("div", { class: "hint" }, ["No saved conversations yet."])]);
    histList.replaceChildren(title, searchBox, ...rows);
    if (searchBox.value) { searchBox.focus(); searchBox.setSelectionRange(searchBox.value.length, searchBox.value.length); }
    // Keep the expanded full-page view (if currently open) in lockstep — same trigger points
    // renderHistory() itself runs from (onPayload's data.history/data.search handling), so both
    // views refresh together without duplicating that plumbing.
    if (historyExpandedRepaint) historyExpandedRepaint();
  }
  // Set only while the expanded view is open; renderHistory() calls it (see above) so the
  // full-page view stays live without its own separate update wiring.
  let historyExpandedRepaint = null;
  // repo -> its org, reusing the EXACT same classification the Repositories sidebar already uses
  // (curated MAP.orgs first, else the path's own top folder) — one org taxonomy, everywhere.
  function groupHistoryByOrgRepo(rows) {
    const byOrg = new Map();
    for (const h of rows) {
      const org = orgOfPath(h.repo || "");
      if (!byOrg.has(org)) byOrg.set(org, new Map());
      const byRepo = byOrg.get(org);
      const repoKey = h.repo || "—";
      if (!byRepo.has(repoKey)) byRepo.set(repoKey, []);
      byRepo.get(repoKey).push(h);
    }
    const known = Object.keys(MAP?.orgs || {}).filter((o) => byOrg.has(o));
    const rest = [...byOrg.keys()].filter((o) => !known.includes(o)).sort();
    return [...known, ...rest].map((org) => ({ org, repos: byOrg.get(org) }));
  }
  // The full-page expanded history — same data as the cramped sidebar list, but with room to
  // actually navigate: grouped by organisation, then by repository, sortable/scrollable, with
  // the same search box. Picking a conversation (Open/Resume) closes it automatically.
  function openHistoryExpanded() {
    const searchBox = el("input", { class: "ws-search", type: "search", placeholder: "Search conversations…", value: st.searchQuery });
    const body = el("div", { class: "ws-hexp-body" }, []);
    const closeBtn = el("button", { class: "ghost" }, ["Close"]);
    const overlay = el("div", { class: "modal-overlay ws-hexp-overlay" }, [
      el("div", { class: "modal ws-hexp-modal" }, [
        el("div", { class: "ws-hexp-hd" }, [el("h2", { class: "ws-hexp-title" }, ["History — every repository"]), searchBox, closeBtn]),
        body,
      ]),
    ]);
    const closeFn = () => { historyExpandedRepaint = null; overlay.remove(); };
    // Local to this one modal instance — resets each time it's reopened, which is fine (unlike
    // the Repositories sidebar's collapse state, this doesn't need to persist across sessions).
    const collapsedOrgs = new Set();
    function paintExpanded() {
      const searching = st.searchResults !== null && st.searchQuery.trim();
      if (searching) {
        const items = st.searchResults.length
          ? st.searchResults.map((h) => histItem(h, h.snippet, closeFn))
          : [el("div", { class: "hint" }, [`No conversation matches “${st.searchQuery.trim()}”.`])];
        body.replaceChildren(el("div", { class: "ws-hexp-flat" }, items));
        return;
      }
      if (!st.history.length) { body.replaceChildren(el("div", { class: "hint" }, ["No saved conversations yet."])); return; }
      body.replaceChildren(...groupHistoryByOrgRepo(st.history).map(({ org, repos }) => {
        const meta = (MAP?.orgs || {})[org] || { color: "#64748b" };
        const totalCount = [...repos.values()].reduce((n, arr) => n + arr.length, 0);
        const collapsed = collapsedOrgs.has(org);
        const hd = el("div", { class: "ws-orggroup-hd" }, [
          el("span", { class: "ws-org-chev" }, [collapsed ? "▸" : "▾"]),
          el("span", { class: "ws-org-dot" }, []), el("b", {}, [org]), el("span", { class: "ws-org-count" }, [String(totalCount)]),
        ]);
        hd.addEventListener("click", () => { if (collapsed) collapsedOrgs.delete(org); else collapsedOrgs.add(org); paintExpanded(); });
        if (collapsed) return el("div", { class: "ws-orggroup collapsed", style: `--org:${meta.color}` }, [hd]);
        const repoSections = [...repos.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([repo, items]) => {
          items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          return el("div", { class: "ws-hexp-repo" }, [
            el("div", { class: "ws-hexp-repo-hd" }, [shortRepo(repo) || "—", el("span", { class: "ws-org-count" }, [String(items.length)])]),
            el("div", { class: "ws-hexp-repo-body" }, items.map((h) => histItem(h, null, closeFn))),
          ]);
        });
        return el("div", { class: "ws-orggroup", style: `--org:${meta.color}` }, [
          hd,
          el("div", { class: "ws-orggroup-body ws-hexp-repos" }, repoSections),
        ]);
      }));
    }
    searchBox.addEventListener("input", () => {
      st.searchQuery = searchBox.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (st.searchQuery.trim()) wsPost("control", { action: "search", args: { query: st.searchQuery.trim(), repo: st.historyRepo || undefined } });
        else { st.searchResults = null; paintExpanded(); }
      }, 280);
    });
    closeBtn.addEventListener("click", closeFn);
    // Click the dimmed backdrop (not the panel itself) to close, same as the permission modal's
    // convention elsewhere in this app.
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeFn(); });
    document.body.appendChild(overlay);
    historyExpandedRepaint = paintExpanded;
    paintExpanded();
    searchBox.focus();
  }
  function reopen(sessionKey, mode) {
    const p = activePane(); if (!p) { note("Open a pane first."); return; }
    beginPendingOpen(sessionKey, p, mode);
    wsPost("control", { action: "open", args: { sessionKey } });
  }

  // ---- SSE handling --------------------------------------------------------------
  function onPayload({ kind, sessionKey, data }) {
    // A real (not comment-only) pulse from the server — see the matching server-side comment.
    // No pane state to update here; `WS_ES.onmessage` (below) already stamped `lastStreamMsgAt`
    // for EVERY message including this one, which is this event's entire purpose.
    if (kind === "heartbeat") return;
    if (kind === "presence") { st.presence = Array.isArray(data.connections) ? data.connections : []; renderPresence(); return; }
    if (kind === "state") {
      if (Array.isArray(data.worktrees)) {
        st.worktrees[data.worktreesRepo] = data.worktrees;
        // A worktree we just asked to create arrived — switch the requesting pane onto it.
        for (const p of st.panes) {
          if (p.repo === data.worktreesRepo && p._pendingWorktree && data.worktrees.some((w) => w.name === p._pendingWorktree)) {
            // Same identity-change rule as the repoSel/wtSel handlers: this pane just abandoned
            // its prior worktree's key, so any open/resume reply still in flight for that old
            // key must be discarded, not applied, when it eventually arrives.
            p.worktree = p._pendingWorktree; p._pendingWorktree = null; p._gen = (p._gen || 0) + 1; assignKey(p); reportAttach();
          }
          if (p.repo === data.worktreesRepo) paintPane(p);
        }
        // A history "resume" that recreated its missing worktree first (see
        // resumeAfterRecreatingWorktree) — this state update, listing the worktree as real again,
        // is the actual confirmation (worktreeAdd's own POST reply isn't; the create happens
        // async over the stream). Complete the resume now that there's genuinely something to
        // resume INTO.
        if (st._pendingHistoryResume?.repo === data.worktreesRepo && data.worktrees.some((w) => w.name === st._pendingHistoryResume.worktree)) {
          clearTimeout(st._pendingHistoryResume.timer);
          const { sessionKey: resumeKey } = st._pendingHistoryResume;
          st._pendingHistoryResume = null;
          reopen(resumeKey, "resume");
        }
        return;
      }
      if (Array.isArray(data.workspacesOn)) {
        // Another terminal may already be on this repo. Surface it on the panes that picked it,
        // so "join the live one or start a worktree" is an informed choice, not a surprise.
        const others = data.workspacesOn.filter((w) => true);
        for (const p of st.panes) {
          if (p.repo !== data.workspacesOnRepo) continue;
          const mine = wsWorkspaceId(p.repo, p.worktree);
          const sharing = others.filter((w) => w.workspaceId === mine).length > 1;
          const otherWts = [...new Set(others.map((w) => w.worktree))].filter((w) => w !== p.worktree);
          if (sharing || otherWts.length) {
            note(`${shortRepo(p.repo)} is live in ${others.length} workspace(s)` + (otherWts.length ? ` · other worktrees: ${otherWts.join(", ")}` : "") + (sharing ? " · you're sharing this one" : ""));
          }
        }
        return;
      }
      // The repo list is derived from the TREE (the `.iz.md` markers), not the map.json list —
      // that's the single source of truth and fixes over-counting. `list` still carries
      // trusted/hasToken below.
      if (data.tree) {
        st.tree = data.tree;
        st.repos = flattenRepos(data.tree, "", []);
        if (!st.treeExpanded.size) st.treeExpanded.add(data.tree.name);   // start with the root expanded
        for (const p of st.panes) { const ui = paneUI.get(p.id); if (ui) fillRepoSelect(ui.repoSel, p.repo); }
        renderSidebar();
      }
      if (Array.isArray(data.history)) {
        st.history = data.history; renderHistory();
        // First history payload after boot — now we know which saved keys exist, so restored
        // panes can re-attach without guessing.
        if (bootRestorePending) { bootRestorePending = false; restorePanes(); }
      }
      if (Array.isArray(data.search)) { st.searchResults = data.search; renderHistory(); }
      if (Array.isArray(data.dataSizes)) { st.dataSizes = Object.fromEntries(data.dataSizes.map((d) => [d.repo, d])); renderSidebar(); }
      if (Array.isArray(data.sessions)) for (const s of data.sessions) for (const p of panesOf(s.sessionKey)) { p.status = s.status || p.status; if (s.mode) p.mode = s.mode; if (s.usage) p.usage = s.usage; paintPane(p); }
      if (data.session) for (const p of panesOf(data.session.sessionKey)) { Object.assign(p, { status: data.session.status ?? p.status, mode: data.session.mode ?? p.mode, usage: data.session.usage ?? p.usage }); paintPane(p); }
      // NOTE: the server's own defaultMode is deliberately NOT mirrored here. Every pane sends
      // its mode with each prompt, so the toolbar picker is a local "mode for new panes"
      // preference — echoing the server's would clobber it on every list refresh.
      if (typeof data.hasToken === "boolean") st.hasToken = data.hasToken;
      if (data.bridgeDisconnected) note("The work machine disconnected — reconnect it to resume.");
      if (data.bridgeReconnected) { bridgeNote.hidden = true; bridgeNote.textContent = ""; }
      setUsageTotal();
      return;
    }
    if (kind === "permission") { st.permQueue.push({ sessionKey, ...data }); if (st.permQueue.length === 1) renderPerm(); return; }
    if (kind === "transcript") {
      // A reopen/resume we requested arrived. Correlate by the SAVED session key (echoed in
      // the frame) so a stray/duplicate frame can never clobber a live pane — drop if unmatched.
      // One reply resolves EVERY pane still waiting on this key (fan out — two panes can share
      // a sessionKey and both be waiting; see beginPendingOpen), each independently discarding
      // the reply if its own pane has since moved on (cleared or repointed — stale `gen`).
      const bucket = st.pendingOpens.get(sessionKey); if (!bucket || !bucket.size) return;
      st.pendingOpens.delete(sessionKey);
      for (const req of bucket.values()) {
        clearTimeout(req.timer);
        const p = st.panes.find((x) => x.id === req.paneId); if (!p) continue;   // its pane was trimmed away
        if ((p._gen || 0) !== req.gen) continue;   // this pane has moved on since the request — discard, don't apply
        p.transcript = data.transcript || [];
        p._expandedGroups = new Set();   // a freshly-(re)opened transcript has no expand state yet
        p.repo = data.repo || p.repo;
        // `repo` was already updated here but `worktree` never was — a pane resuming a conversation
        // on a DIFFERENT worktree than whatever it happened to be showing kept the OLD worktree's
        // label/dropdown forever, even though the content, sessionKey, and repo all correctly
        // switched. This is exactly what "resumed Romania but the header still says main" was.
        p.worktree = data.worktree || p.worktree;
        p.usage = data.usage || {};
        // A session can still be live (mid-turn) when its pane is reattached — see
        // `_liveOrSavedState` server-side. Without this, a pane reopened while Claude is still
        // working would show "idle" (normal Send button, still spinner) despite a turn genuinely
        // in progress underneath it.
        if (data.status) p.status = data.status;
        if (req.mode === "resume" || req.mode === "restore") {
          // Adopt the saved conversation's key. The pane's own key would make the work machine
          // persist the continuation to a SECOND file holding only the new turns — Claude would
          // remember everything while the stored history silently forked in two.
          // The clash check only applies when this pane is genuinely ADOPTING a key it didn't
          // hold coming in (req.priorKey !== sessionKey) — a pane reattaching to a key it already
          // held (restorePanes re-opening two panes that legitimately share one key) is just
          // reconnecting, not adopting, and must not be flagged just because its legitimate twin
          // holds the same key too (see beginPendingOpen).
          const clash = req.priorKey !== sessionKey && st.panes.find((x) => x !== p && x.sessionKey === sessionKey);
          if (clash) { p.readonly = true; p.resume = null; note("That conversation is already open in another pane — reopened read-only here."); }
          else {
            p.sessionKey = sessionKey; p.readonly = false; p.resume = data.sessionId || null;
            if (req.mode === "resume") note("Resuming — your next message continues this session.");
          }
        } else { p.readonly = true; p.resume = null; note("Reopened read-only. Pick the repo or Resume to continue."); }
        paintPane(p); setUsageTotal(); saveLayout();
      }
      return;
    }
    if (kind === "event") {
      // A reopen/resume's failure (e.g. "not found") must resolve its pendingOpens entry too —
      // independent of whether any pane currently holds this key. Without this, a stale/never-
      // attached history row's error reply matches no pane below (`targets.length` stays 0, the
      // routing exits early) and the pending entry leaks forever, even though the server DID
      // answer and even though the sessionKey is no longer null (it's echoed back — see
      // `_openTranscript`) — this is a distinct leak from the "no reply at all" case the client
      // timeout in `beginPendingOpen` covers.
      if (data.kind === "error" && sessionKey && st.pendingOpens.has(sessionKey)) {
        const bucket = st.pendingOpens.get(sessionKey);
        st.pendingOpens.delete(sessionKey);
        for (const req of bucket.values()) clearTimeout(req.timer);   // resolves every pane waiting on this key
        note("Could not open — " + (data.message || "that conversation could not be opened."));
      }
      // Workspace-level notices (create/remove/note/error) carry no sessionKey.
      if (!sessionKey && (data.kind === "created" || data.kind === "removed" || data.kind === "note" || data.kind === "error")) {
        if (data.kind === "note") note(data.message);
        else if (data.kind === "removed") note(`Removed ${data.what}: ${data.path}`);
        else note(data.kind === "created" ? `Created ${data.what}: ${data.path}` : ("⚠ " + data.message));
        // A new folder/repo changes the tree; a worktree does not (it's a dot-dir), so only refresh
        // the tree for folder/repo creation.
        if (data.kind === "created" && data.what !== "worktree") { wsPost("control", { action: "list" }); wsPost("control", { action: "tree" }); }
        return;
      }
      // A streamed event ALWAYS carries its session's key. Route strictly by it; drop frames
      // for a pane that no longer exists (e.g. trimmed by the layout picker) rather than
      // spilling another session's output into the active pane. Shared keys → fan to every pane.
      const targets = sessionKey ? panesOf(sessionKey) : [activePane()].filter(Boolean); if (!targets.length) return;
      // The turn lock refused this prompt (another terminal, or another pane, is mid-turn).
      // Restore the typed text on the pane that sent it, so nothing is lost.
      if (data.kind === "busy") {
        for (const p of targets) { const ui = paneUI.get(p.id); if (ui && p._pendingText && !ui.promptEl.value) ui.promptEl.value = p._pendingText; p._pendingText = null; logActivity(p, "⏳ Still working on the previous turn…"); }
        note("⏳ " + (data.message || "This workspace is working — wait for the current turn."));
        return;
      }
      // Reconnect catch-up reply (see `resync()` below, and `_resync` server-side): a wholesale
      // replace of this pane's transcript/status/usage with whatever's actually true right now,
      // not one more item to append. Fixes events a disconnected stream silently dropped — the
      // whole reason a resync was requested in the first place.
      if (data.kind === "resync") {
        for (const p of targets) {
          if (Array.isArray(data.transcript)) p.transcript = data.transcript;
          if (data.status) p.status = data.status;
          if (data.usage) p.usage = data.usage;
          if (data.mode) p.mode = data.mode;
          p._liveText = "";   // stale relative to whatever actually streamed before the reconnect
          paintPane(p);
          logActivity(p, "↻ Reconnected — caught up", "ws-act-ok");
        }
        return;
      }
      for (const p of targets) {
        // Live typing preview (see lib/claudeSession.mjs's `includePartialMessages`/`stream_event`
        // handling): each chunk just extends a transient, per-pane buffer — never pushed into
        // `p.transcript` itself, so it's never persisted/resynced as real history. Any OTHER event
        // kind means whatever was streaming is now either superseded by the real, complete line
        // (the "assistant" event below) or the turn moved on (a tool call, the end of the turn) —
        // either way the transient buffer's job is done, so every non-delta kind clears it.
        if (data.kind === "assistant_delta") {
          p._liveText = (p._liveText || "") + (data.text || "");
          // Logged once per turn, not once per chunk — a chunk can arrive many times a second.
          if (!p._streamingStarted) { p._streamingStarted = true; logActivity(p, "▸ Streaming reply…"); }
          paintPane(p);
          continue;
        }
        p._liveText = "";
        if (data.kind === "status") {
          p.status = data.status;
          // A shared session can go "thinking" because ANOTHER terminal sent the prompt, not this
          // one's own dispatchPrompt() — reset the streaming-logged flag here too, or this pane
          // would never log "Streaming reply…" for a turn it didn't itself start.
          if (data.status === "thinking") p._streamingStarted = false;
          const STATUS_TEXT = { thinking: "● Thinking…", "awaiting-permission": "⏸ Waiting for tool permission…", idle: "✓ Idle", ended: "✓ Turn ended", error: "⚠ Errored" };
          logActivity(p, STATUS_TEXT[data.status] || ("● " + data.status));
          paintPane(p); drainQueue(p); continue;
        }
        // A user turn echoed by the server: this pane sent it (clear the pending buffer) or a
        // shared pane in another terminal did (render it so both windows show the same thread).
        if (data.kind === "user" && data.by && data.by === CONN.id) p._pendingText = null;
        // The server refused the prompt (bad path, no token, …). The turn was never accepted, so
        // restore the typed text — exactly as the busy path does — rather than losing it.
        if (data.kind === "error" && p._pendingText) { const ui = paneUI.get(p.id); if (ui && !ui.promptEl.value) ui.promptEl.value = p._pendingText; p._pendingText = null; }
        // The turn concludes here, success or failure — stop the spinner even though the
        // server doesn't always follow a result/error with its own "status" event (it stays
        // "thinking" internally between turns). Without this the spinner would only clear on
        // the NEXT status push (e.g. the following turn), which is exactly the stuck-spinner
        // gap this pane icon exists to avoid.
        if ((data.kind === "result" || data.kind === "error") && paneBusy(p)) p.status = "idle";
        if (data.kind === "tool_use") logActivity(p, "🔧 Running: " + (data.tools || []).map((t) => t.name).join(", "));
        else if (data.kind === "tool_result") logActivity(p, "✓ Tool finished — continuing…");
        else if (data.kind === "result") logActivity(p, `✓ Reply complete — ${(data.usage?.output_tokens || 0)} out tok · ~${fmtUsd(data.costUsd)}`, "ws-act-ok");
        else if (data.kind === "error") logActivity(p, "⚠ " + (data.text || data.message || "Unknown error"), "ws-act-err");
        p.transcript.push(data);
        if (data.usageTotal) p.usage = data.usageTotal;
        paintPane(p);
        drainQueue(p);
      }
      setUsageTotal();
    }
  }
  function primeControls() { wsPost("control", { action: "list" }); wsPost("control", { action: "tree" }); wsPost("control", { action: "history", args: {} }); wsPost("control", { action: "dataSizes" }); }
  // Reconnect catch-up: ask the server for the CURRENT live state of every pane this terminal
  // still has open (see `_resync` in lib/workspace.mjs). Every hop between a real event
  // happening and it reaching this browser — the local SSE fan-out, the tunnel socket, the
  // relay's per-browser fan-out — is fire-and-forget with no backlog, so a client that was
  // disconnected for even one event's duration loses it silently and permanently. This is the
  // fix: don't try to replay what was missed, just ask what's true right now.
  function resyncOpenPanes() {
    for (const p of st.panes) if (p.sessionKey && !p.readonly) wsPost("control", { action: "resync", args: { sessionKey: p.sessionKey } });
  }
  function openStream() {
    try { WS_ES && WS_ES.close(); } catch {}
    // Identify this terminal so the server's presence roster can name it.
    const q = "?conn=" + encodeURIComponent(CONN.id) + "&label=" + encodeURIComponent(CONN.label);
    WS_ES = new EventSource("/api/workspace/stream" + q);
    WS_LAST_MSG_AT = Date.now();   // the moment we started waiting, not zero — a fresh stream isn't already stale
    WS_ES.addEventListener("hello", (e) => {
      // The stream is now subscribed — only NOW request the initial state, so the bridge's
      // reply can't race an unsubscribed stream (it would be dropped silently).
      try { const d = JSON.parse(e.data); if (d.localConnected) { bridgeNote.hidden = true; bridgeNote.textContent = ""; } else note("The work machine isn't connected — start the local dashboard + relay."); } catch {}
      primeControls();
      if (WS_EVER_CONNECTED) logActivityAll("↻ Reconnected", "ws-act-ok");   // only a RE-connect is activity-log-worthy, not the first ever connect
      WS_EVER_CONNECTED = true;
      resyncOpenPanes();   // catch up on anything the PREVIOUS connection silently missed
      lastAttached = undefined; reportAttach();   // announce what this terminal is viewing
    });
    WS_ES.onmessage = (e) => { WS_LAST_MSG_AT = Date.now(); try { onPayload(JSON.parse(e.data)); } catch {} };
    WS_ES.onerror = () => { note("Stream interrupted — retrying…"); logActivityAll("⚠ Connection interrupted — reconnecting…", "ws-act-err"); };
    // Staleness watchdog: a mobile carrier's NAT can silently drop an idle connection with no
    // FIN/RST — Node's res.write() never throws in that case, so the server keeps "sending" into
    // a connection nobody's listening on, and the browser's `onerror` never fires because nothing
    // ever fails a read or write on ITS side either (see relay/server.mjs's & dashboard/server.mjs's
    // matching heartbeat comments). Rather than trust `onerror` alone, notice the silence directly
    // and force a reconnect — which re-fires `hello` and, via resyncOpenPanes() above, catches up
    // on whatever the dead connection swallowed.
    clearInterval(WS_STALE_TIMER);
    WS_STALE_TIMER = setInterval(() => {
      if (Date.now() - WS_LAST_MSG_AT > WS_STALE_MS) { logActivityAll("⚠ Connection gone quiet — reconnecting…", "ws-act-err"); openStream(); }
    }, 10_000);
  }

  // ---- permission modal (FIFO queue — two panes can await at once) ----------------
  function renderPerm() {
    const p = st.permQueue[0];
    if (!p) { permHost.replaceChildren(); return; }
    const owner = paneOf(p.sessionKey);
    const decide = async (decision) => {
      st.permQueue.shift(); permHost.replaceChildren();
      await wsPost("permission", { requestId: p.requestId, decision });
      renderPerm();   // surface the next queued request, if any
    };
    const inputStr = typeof p.input === "object" ? JSON.stringify(p.input, null, 1).slice(0, 600) : String(p.input || "");
    permHost.replaceChildren(el("div", { class: "modal-overlay" }, [
      el("div", { class: "modal", style: "max-width:520px" }, [
        el("h3", { style: "margin:0 0 6px" }, ["Claude wants to run a tool", st.permQueue.length > 1 ? el("span", { class: "rc-sub", style: "font-weight:400" }, ["  (+" + (st.permQueue.length - 1) + " more)"]) : ""]),
        el("div", { class: "rc-sub" }, ["Tool: ", el("b", {}, [p.tool]), owner && owner.repo ? "  ·  " + shortRepo(owner.repo) : ""]),
        el("pre", { style: "background:var(--chip);border-radius:8px;padding:8px;font-size:11px;max-height:200px;overflow:auto;white-space:pre-wrap" }, [inputStr]),
        el("div", { style: "display:flex;gap:8px;justify-content:flex-end;margin-top:10px" }, [
          (() => { const b = el("button", { class: "ghost" }, ["Deny"]); b.addEventListener("click", () => decide("deny")); return b; })(),
          (() => { const b = el("button", { class: "loginbtn", style: "padding:7px 16px" }, ["Approve"]); b.addEventListener("click", () => decide("allow")); return b; })(),
        ]),
      ]),
    ]));
  }

  // ---- send --------------------------------------------------------------------
  // The actual dispatch — POSTs one prompt (with its own text/image) and handles the round-trip.
  // Split out of send() so a queued item (drainQueue, below) can be dispatched identically once
  // the pane goes idle, not just a prompt typed while already idle.
  async function dispatchPrompt(p, text, image) {
    assignKey(p);
    // Don't append optimistically. The server echoes the accepted user turn to every terminal
    // (so a SHARED session shows the prompt in both windows), and refuses it with `busy` if a
    // turn is already running — appending here would show a prompt that was never actually sent.
    p._pendingText = text;
    const body = { sessionKey: p.sessionKey, repo: p.repo, worktree: p.worktree, text, mode: p.mode, by: CONN.id };
    if (image) body.image = { mediaType: image.mediaType, base64Data: image.base64Data };
    if (p.resume) { body.resume = p.resume; p.resume = null; }
    // Optimistic busy: the real "status":"thinking" event confirms this shortly over the stream,
    // but setting it now closes a race — without it, a SECOND queued item could see paneBusy()
    // still false in the brief window before that event arrives and dispatch immediately behind
    // this one instead of waiting its turn.
    p.status = "thinking"; p._streamingStarted = false; paintPane(p);
    logActivity(p, "→ Sending your message…");
    const r = await wsPost("prompt", body);
    if (!r.ok) {
      // Couldn't even reach the work machine — restore the text (and any attached image) so
      // nothing is lost.
      if (image) { p.attachedImage = image; wsPaintAttachment(p); }
      const ui = paneUI.get(p.id);
      if (ui && ui.promptEl.value === "") ui.promptEl.value = p._pendingText || "";
      p._pendingText = null;
      p.status = "idle";
      p.transcript.push({ kind: "error", text: r.message || "Could not reach the work machine." });
      paintPane(p);
      logActivity(p, "⚠ Could not reach the work machine", "ws-act-err");
      drainQueue(p);   // this attempt failed outright — try the next queued item rather than stalling
    } else {
      logActivity(p, "✓ Message received — waiting for Claude to pick it up…");
    }
  }
  // The moment a pane genuinely stops being busy (called from every status/result/error
  // transition in onPayload), release whatever queued up while it was working — merged into ONE
  // prompt, not fired as N separate turns. Draining one-at-a-time would answer each queued
  // message in isolation, missing whatever context the LATER ones added — the opposite of how
  // typing three follow-up thoughts while someone's still talking actually works: you say all
  // three once they stop, as one turn, not as three separate interruptions.
  function drainQueue(p) {
    if (paneBusy(p) || !p._queue || !p._queue.length) return;
    const items = p._queue;
    p._queue = null;
    const text = items.map((i) => i.text).join("\n\n");
    // At most one image can ride along on a single turn — the last one queued wins, same as if
    // it had been attached to a freshly-typed message right before sending.
    const image = [...items].reverse().find((i) => i.image)?.image || null;
    paintPane(p);
    dispatchPrompt(p, text, image);
  }
  async function send(p) {
    if (p.readonly) return;
    const ui = paneUI.get(p.id); const text = ui.promptEl.value.trim(); if (!text) return;
    if (!p.repo) { note("Pick a repository for this pane first."); return; }
    // Same "clear optimistically, restore on failure" treatment either way — the attached image
    // (if any) is a one-shot per send, never left over for the next message.
    const attachedImage = p.attachedImage;
    ui.promptEl.value = ""; p.attachedImage = null; wsPaintAttachment(p);
    // While a turn is already running, don't even attempt the round-trip (the server would refuse
    // it with `busy` anyway) — queue it locally instead: shown as its own orange box in the
    // transcript, sent automatically the instant the current turn actually finishes. Mirrors
    // typing ahead in Claude's own desktop app while it's still replying.
    if (paneBusy(p)) {
      p._queue = p._queue || [];
      p._queue.push({ text, image: attachedImage || null });
      paintPane(p);
      return;
    }
    dispatchPrompt(p, text, attachedImage);
  }

  // ---- toolbar controls ----------------------------------------------------------
  // A spreadsheet-style size picker: hover to preview the grid, click to apply. 16 buttons
  // beats 16 numbered ones, and it reads as "columns × rows" at a glance.
  const layoutPicker = el("div", { class: "ws-layout" }, []);
  // The cells are built ONCE and then only re-styled. Rebuilding them on hover destroyed the
  // very button the cursor was over, so mousedown and mouseup landed on different nodes and
  // the browser never fired `click` at all — the picker previewed on hover but selecting did
  // nothing. Hover state is presentation: toggle classes, never replace nodes.
  const layoutCells = [];
  const layoutN = el("span", { class: "ws-layout-n" }, []);
  for (let r = 1; r <= WS_MAX_ROWS; r++) for (let c = 1; c <= WS_MAX_COLS; c++) {
    const b = el("button", { class: "ws-cell", title: `${c} × ${r}`, style: `grid-column:${c};grid-row:${r}` }, []);
    b.dataset.c = String(c); b.dataset.r = String(r);
    b.addEventListener("mouseenter", () => renderLayoutPicker(c, r));
    b.addEventListener("click", () => setLayout(c, r));
    layoutCells.push(b);
  }
  layoutPicker.replaceChildren(
    el("span", { class: "ws-layout-lbl" }, ["Panes"]),
    el("div", { class: "ws-cellgrid" }, layoutCells),
    layoutN,
  );
  /** Repaint selection + hover preview. No DOM replacement, so clicks survive. */
  function renderLayoutPicker(hoverC, hoverR) {
    for (const b of layoutCells) {
      const c = Number(b.dataset.c), r = Number(b.dataset.r);
      b.classList.toggle("on", c <= st.cols && r <= st.rows);
      b.classList.toggle("hov", hoverC ? (c <= hoverC && r <= hoverR) : false);
    }
    layoutN.textContent = hoverC ? `${hoverC} × ${hoverR}` : `${st.cols} × ${st.rows}`;
  }
  layoutPicker.addEventListener("mouseleave", () => renderLayoutPicker());
  const modeToggle = el("div", { class: "ws-modes" }, []);
  function renderModeToggle() {
    modeToggle.replaceChildren(...[["repos", "Repositories"], ["tree", "Tree"]].map(([m, lbl]) => {
      const b = el("button", { class: "ws-mode" + (st.sidebarMode === m ? " on" : "") }, [lbl]);
      b.addEventListener("click", () => { st.sidebarMode = m; renderModeToggle(); renderSidebar(); if (m === "tree" && !st.tree) wsPost("control", { action: "tree" }); });
      return b;
    }));
  }
  const newFolderBtn = el("button", { class: "ghost", title: "Create a new folder in the workspace" }, ["+ folder"]);
  const newRepoBtn = el("button", { class: "ghost", title: "Create a new git repo in the workspace" }, ["+ repo"]);
  // The default only seeds NEW panes — existing panes keep whatever they're set to, so
  // changing it can never silently widen permissions on a conversation already running.
  defaultModeSel.replaceChildren(...WS_MODES.map((m) => el("option", { value: m.id }, [m.label])));
  defaultModeSel.value = st.defaultMode;
  defaultModeSel.addEventListener("change", () => { st.defaultMode = defaultModeSel.value; saveLayout(); });
  const applyAllBtn = el("button", { class: "ghost", title: "Set every pane to the default mode" }, ["apply to all"]);
  applyAllBtn.addEventListener("click", () => {
    for (const p of st.panes) { p.mode = st.defaultMode; wsPost("control", { action: "setMode", args: { sessionKey: p.sessionKey, mode: p.mode } }); paintPane(p); }
    saveLayout();
  });
  newFolderBtn.addEventListener("click", () => { const name = window.prompt("New folder name:"); if (name == null) return; const parent = window.prompt("Parent path (blank = root):") || ""; wsPost("control", { action: "newFolder", args: { parent, name } }); });
  newRepoBtn.addEventListener("click", () => { const name = window.prompt("New repo name (git init):"); if (name == null) return; const parent = window.prompt("Parent path (blank = root):") || ""; wsPost("control", { action: "newRepo", args: { parent, name } }); });

  // ---- boot ----------------------------------------------------------------------
  if (!loadLayout()) { st.panes = [newPane()]; st.activeId = st.panes[0].id; }
  defaultModeSel.value = st.defaultMode;   // the picker was built before the saved layout loaded
  renderLayoutPicker(); renderModeToggle(); rebuildGrid(); renderSidebar(); renderHistory(); setUsageTotal();
  openStream();   // primeControls() fires from the hello handler once the stream is subscribed

  root.replaceChildren(
    el("div", { class: "ws-toolbar" }, [
      layoutPicker,
      el("label", { class: "ws-trust", title: "The permission mode new panes start in. Each pane can then be switched on its own." }, ["New panes:", defaultModeSel]),
      applyAllBtn,
      el("span", { class: "ws-spacer" }, []),
      usageEl, newFolderBtn, newRepoBtn,
    ]),
    presenceBar,
    bridgeNote,
    el("div", { class: "ws-body" }, [
      el("aside", { class: "ws-side" }, [modeToggle, sideList, el("div", { class: "ws-side-sep" }, []), histList]),
      grid,
    ]),
    permHost,
  );
  return root;
}

/* ---------- Ops activity: org-grouped repo cards with a live/idle blinker ----------
   At a glance: which repo has an agent working in it, and what it's doing. Grouped by
   the top-level ecosystem folder, same as the other tabs. */
function actCard(s) {
  const live = s.live;
  const name = (s.repo || s.cwd || "").split(/[\\/]/).filter(Boolean).pop() || "workspace";
  const ageTxt = s.ageSeconds < 60 ? s.ageSeconds + "s" : Math.round(s.ageSeconds / 60) + "m";
  return el("div", { class: "repocard", style: `--stripe:${live ? "#34d399" : "#64748b"}` }, [
    el("div", { class: "rc-hd" }, [
      el("span", { class: "actdot" + (live ? " on" : "") }),
      el("span", { class: "rc-name", title: s.repo }, [name]),
      el("span", { class: "was", style: "font-size:11px;margin-left:auto;white-space:nowrap" }, [ageTxt]),
    ]),
    el("div", { class: "rc-sub", style: `font-weight:600;color:${live ? "#34d399" : "var(--ink-dim)"}` }, [live ? "working" : s.status]),
    s.detail ? el("div", { class: "rc-sub", style: "font-family:ui-monospace,monospace;font-size:11px;color:var(--ink-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis", title: s.detail }, [s.detail]) : "",
  ]);
}

function sessionKey(s) { return s.repo || s.cwd || "unknown"; }
function sessionOrg(s) { return s.repo ? (s.repo.split(/[\\/]/)[0] || "workspace") : "workspace"; }

function activityView(a) {
  // Keep live sessions + recently-idle ones; drop anything idle older than 15 min
  // (old session files whose status got stuck at "active" but went stale long ago).
  const byKey = new Map();
  for (const s of (a.sessions || [])) {
    if (!s.live && s.ageSeconds > 900) continue;
    const k = sessionKey(s);
    const prev = byKey.get(k);
    if (!prev || s.ageSeconds < prev.ageSeconds) byKey.set(k, s);
  }
  const list = [...byKey.values()].sort((x, y) => (Number(y.live) - Number(x.live)) || (x.ageSeconds - y.ageSeconds));
  if (!list.length) return el("div", { class: "hint" }, ["No active sessions — no agent is working in a tracked repo right now. (Activity comes from Claude Code hooks; see orchestrator/README.)"]);
  const groups = {};
  for (const s of list) { const org = sessionOrg(s); (groups[org] = groups[org] || []).push(s); }
  const entries = Object.entries(groups).sort((x, y) => (groups[y[0]].some((s) => s.live) ? 1 : 0) - (groups[x[0]].some((s) => s.live) ? 1 : 0) || x[0].localeCompare(y[0]));
  return el("div", { style: "display:flex;flex-direction:column;gap:10px" }, entries.map(([org, ss]) => {
    const c = orgColor(org);
    const liveN = ss.filter((s) => s.live).length;
    return el("div", { class: "orggroup", style: `--org:${c}` }, [
      el("div", { class: "orggroup-hd" }, [
        el("span", { class: "dot", style: `background:${c}` }),
        el("b", {}, [org]),
        el("span", { class: "grouptag was", style: "margin-left:auto;font-size:11px" }, [liveN ? liveN + " active" : "idle"]),
      ]),
      el("div", { class: "orggroup-body", style: "grid-template-columns:repeat(auto-fill,minmax(215px,1fr))" }, ss.map(actCard)),
    ]);
  }));
}

function viewOps() {
  if (OPS_TIMER) { clearInterval(OPS_TIMER); OPS_TIMER = null; }
  if (RELAY_TIMER) { clearInterval(RELAY_TIMER); RELAY_TIMER = null; }
  const statusBox = el("div", { id: "opsStatus" }, [el("div", { class: "hint" }, ["Loading activity…"])]);
  const out = el("div", { id: "opsOut", class: "movecard", style: "display:none;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px" });
  // On-demand backup ALWAYS forces past the activity gate. The gate exists to stop the
  // unattended DAILY run from archiving mid-write; a human clicking this button has
  // already decided they want an archive now. Leaving it gated made the button appear
  // broken — the overseer dashboard itself counts as an active session, so an ungated
  // click almost always returned "Suite is active — backup skipped" and wrote nothing.
  const backupBtn = el("button", { class: "ghost", id: "btnBackup" }, ["💾 Back up now"]);
  const mpBtn = el("button", { class: "ghost", id: "btnMP" }, ["⚙ master-pollinate (dry-run)"]);
  const controls = el("div", { class: "graph-controls" }, [backupBtn, mpBtn]);

  /* --- automated daily backup: toggle, location, schedule, state --- */
  const schedBox = el("div", { class: "movecard", style: "margin-top:10px" }, [el("div", { class: "hint" }, ["Loading backup settings…"])]);
  async function loadSched() {
    let s; try { s = await (await fetch("/api/backup/config")).json(); } catch { return; }
    const c = s.config || {};
    const toggle = el("input", { type: "checkbox", id: "bkEnabled" });
    if (c.enabled) toggle.setAttribute("checked", "checked");
    const loc = el("input", { type: "text", id: "bkLoc", value: c.location || "",
      style: "flex:1;min-width:200px;background:var(--chip);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:5px 9px;font-family:ui-monospace,monospace;font-size:12px" });
    const browseBtn = el("button", { class: "ghost", title: "Pick the folder on the work machine's disk — avoids typing/pasting a path by hand" }, ["📁 Browse…"]);
    const hour = el("input", { type: "number", id: "bkHour", min: "0", max: "23", value: String(c.hour ?? 3),
      style: "width:56px;background:var(--chip);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:5px 7px" });
    const saveBtn = el("button", { class: "ghost" }, ["Save settings"]);

    async function save(patch) {
      const body = { location: loc.value, hour: Number(hour.value), enabled: toggle.checked, ...patch };
      const r = await (await fetch("/api/backup/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
      if (!r.ok) { out.style.display = "block"; out.textContent = "Could not save backup settings: " + (r.message || r.reason || "error"); }
      loadSched();
    }
    toggle.addEventListener("change", () => save({ enabled: toggle.checked }));
    saveBtn.addEventListener("click", () => save({}));
    browseBtn.addEventListener("click", async () => {
      const picked = await showFolderBrowser(loc.value || "");
      if (picked == null) return;               // cancelled
      loc.value = picked;
      save({});                                  // persist immediately — no separate "Save" step needed
    });

    const stateBits = [];
    stateBits.push(el("span", { style: `font-weight:700;color:${c.enabled ? "#34d399" : "#94a3b8"}` }, [c.enabled ? "● ON" : "○ OFF"]));
    if (c.enabled) stateBits.push(el("span", { class: "was" }, [`  runs daily at ${String(c.hour).padStart(2, "0")}:00 when the suite is idle`]));
    if (c.lastRunDate) stateBits.push(el("span", { class: "was" }, [`  · last auto-run ${c.lastRunDate}`]));
    if (s.schedule?.lastAutoRun?.deferred) stateBits.push(el("span", { style: "color:#fbbf24" }, ["  · deferred (agent active) — will catch up when idle"]));

    schedBox.replaceChildren(
      el("div", { class: "desc" }, [el("b", {}, ["Automated daily backup"])]),
      el("div", { style: "display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:6px 0" }, [
        el("label", { style: "display:inline-flex;align-items:center;gap:6px;font-size:13px" }, [toggle, "Enabled"]),
        el("div", { style: "display:flex;align-items:center;gap:6px;flex:1;min-width:220px" }, [el("span", { class: "was" }, ["location"]), loc, browseBtn]),
        el("div", { style: "display:flex;align-items:center;gap:6px" }, [el("span", { class: "was" }, ["hour"]), hour, el("span", { class: "was" }, [":00"])]),
        saveBtn,
      ]),
      el("div", { style: "font-size:12px" }, stateBits),
      el("div", { class: "hint", style: "margin-top:4px" }, ["The scheduler runs inside this dashboard, so keep it open (or auto-started) for daily backups. It writes to the location above — any drive or folder — and defers while an agent is working, catching up once idle. “Back up now” above ignores that gate and archives immediately."]),
    );
  }
  loadSched();

  async function post(pathq, btn, label) {
    btn.disabled = true; const old = btn.textContent; btn.textContent = "… running";
    out.style.display = "block"; out.textContent = `${label} — running…`;
    try { const r = await (await fetch(pathq, { method: "POST" })).json(); out.textContent = `${label} result:\n` + JSON.stringify(r, null, 2); }
    catch (e) { out.textContent = `${label} error: ${e}`; }
    btn.textContent = old; btn.disabled = false; refresh();
  }
  backupBtn.addEventListener("click", async () => {
    // force=1 unconditionally — see the note where the button is created.
    // Archiving the whole workspace takes minutes, so say so rather than looking hung,
    // and render the outcome as a sentence instead of raw JSON.
    backupBtn.disabled = true;
    const old = backupBtn.textContent;
    backupBtn.textContent = "… archiving";
    out.style.display = "block";
    out.textContent = "Backup — archiving the workspace to the configured location.\nThis takes a few minutes for a multi-GB workspace; you can leave this page open.";
    try {
      const r = await (await fetch("/api/backup?force=1", { method: "POST" })).json();
      if (r.ok) {
        // backup.mjs already composes a human sentence ("Archived 1.78 GB to <file> in 120s"),
        // so lead with it and add the full path underneath for copy-paste.
        out.textContent = "✅ " + (r.message || "Backup complete.") + (r.path ? "\n\n" + r.path : "");
      } else {
        out.textContent = "❌ Backup failed: " + (r.message || r.reason || "unknown error") + "\n\n" + JSON.stringify(r, null, 2);
      }
    } catch (e) {
      out.textContent = "❌ Backup error: " + e;
    }
    backupBtn.textContent = old;
    backupBtn.disabled = false;
    refresh();
    refreshArchives();
  });
  mpBtn.addEventListener("click", () => post("/api/master-pollinate", mpBtn, "master-pollinate dry-run"));

  /* --- the archives at the configured backup location, and restoring from one --- */
  const archiveBox = el("div", { id: "archiveBox" }, [el("div", { class: "hint" }, ["Reading backups…"])]);
  const human = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : Math.round(b / 1e6) + " MB");

  async function restore(a, btn) {
    // Restore overwrites files in place and there is no undo, so the id has to be
    // typed back — not a click-through. The server enforces the same rule; this is
    // the human-readable half of it.
    const typed = window.prompt(
      `RESTORE ${a.file}\n\n` +
      `This overwrites files in your workspace with the versions from ${a.date}. ` +
      `Any uncommitted work newer than that archive is lost for every file it contains. ` +
      `Files created since then are left alone.\n\n` +
      `Type the archive id to confirm: ${a.id}`,
    );
    if (typed !== a.id) {
      out.style.display = "block";
      out.textContent = typed === null ? "Restore cancelled." : `Restore cancelled — "${typed}" does not match the archive id "${a.id}".`;
      return;
    }
    // Lock EVERY restore button, not just this one. Two concurrent `tar -xf` runs
    // extracting different archives over the same tree is the worst state this
    // dashboard could get the workspace into.
    const all = [...archiveBox.querySelectorAll("button"), backupBtn];
    all.forEach((b) => (b.disabled = true));
    try {
      await post(`/api/restore?id=${encodeURIComponent(a.id)}&confirm=${encodeURIComponent(typed)}`, btn, `Restore ${a.file}`);
    } finally {
      all.forEach((b) => (b.disabled = false));
      refreshArchives();
    }
  }

  // Signature of the last render, so the 4s poll only touches the DOM when the folder
  // actually changed. Re-rendering unconditionally would flicker the table and yank
  // focus out of it mid-click.
  let ARCH_SIG = null;

  async function refreshArchives() {
    let d;
    try { d = await (await fetch("/api/backups")).json(); } catch { return; }
    const sig = d.available
      ? `ok:${d.archives.map((a) => `${a.id}:${a.bytes}:${a.unverified ? "u" : "v"}`).join("|")}`
      : `down:${d.message || ""}`;
    if (sig === ARCH_SIG) return;       // nothing changed — leave the DOM alone
    ARCH_SIG = sig;
    if (!d.available) {
      archiveBox.replaceChildren(el("div", { class: "hint" }, [d.message || "Backup drive unavailable."]));
      return;
    }
    if (!d.archives.length) {
      archiveBox.replaceChildren(el("div", { class: "hint" }, [`No archives yet in ${d.root}. Hit “Back up now” to write the first one.`]));
      return;
    }
    archiveBox.replaceChildren(
      el("div", { class: "hint" }, [`${d.archives.length} archive(s) · ${human(d.totalBytes)} total · ${d.root}`]),
      el("table", { class: "pkgtable" }, [
        el("thead", {}, [el("tr", {}, ["Date", "Id", "Size", "Written", ""].map((h) => el("th", {}, [h])))]),
        el("tbody", {}, d.archives.map((a, i) => el("tr", {}, [
          el("td", {}, [el("b", {}, [a.date]), i === 0 ? el("span", { class: "ver" }, ["  latest"]) : ""]),
          el("td", {}, [el("code", {}, [a.id])]),
          el("td", {}, [human(a.bytes)]),
          el("td", {}, [(a.mtime || "").slice(0, 16).replace("T", " ")]),
          el("td", {}, [
            // No verified record ⇒ we cannot vouch that tar finished writing it.
            a.unverified ? el("span", { style: "color:#fbbf24", title: "No verified backup record — this file was not written and checked by this dashboard. It may be incomplete." }, ["⚠ unverified "]) : "",
            el("button", { class: "ghost", onclick: (e) => restore(a, e.currentTarget) }, ["↩ Restore"]),
          ]),
        ]))),
      ]),
    );
  }

  async function refresh() {
    let d; try { d = await (await fetch("/api/activity")).json(); } catch { return; }
    const a = d.activity || {};
    const idle = !a.active;
    const color = idle ? "#34d399" : "#fbbf24";
    const lb = d.lastBackup;
    // The on-demand backup is NEVER disabled: it forces past the activity gate by
    // design, so greying it out while a session is live (the overseer dashboard itself
    // counts as one) is what made it look like the feature did not exist.
    // master-pollinate stays idle-gated — a cascade genuinely must not run mid-work.
    backupBtn.disabled = false;
    mpBtn.disabled = !idle;
    $("#opsStatus").replaceChildren(
      el("div", { class: "statbar" }, [
        el("div", { class: "stat" }, [el("div", { class: "n", style: `color:${color}` }, [idle ? "IDLE" : "ACTIVE"]), el("div", { class: "l" }, ["suite status"])]),
        el("div", { class: "stat" }, [el("div", { class: "n" }, [String(a.liveSessionCount || 0)]), el("div", { class: "l" }, ["live sessions"])]),
        el("div", { class: "stat" }, [el("div", { class: "n" }, [a.activeRepos && a.activeRepos.length ? a.activeRepos.join(", ") : "—"]), el("div", { class: "l" }, ["active repos"])]),
        el("div", { class: "stat" }, [el("div", { class: "n", style: "font-size:13px" }, [lb ? (lb.ok ? "✅ " : "❌ ") + (lb.finishedAt || "").slice(0, 16).replace("T", " ") : "never"]), el("div", { class: "l" }, ["last backup"])]),
      ]),
      el("div", { class: "hint" }, [idle
        ? "Suite is idle. “Back up now” writes a dated tar archive to the configured location (excludes node_modules/.next/dist; keeps .git, .secrets and uncommitted work) and verifies it is readable and complete before publishing it."
        : "An agent is working — master-pollinate is gated until idle. “Back up now” still runs: an on-demand backup deliberately ignores the activity gate."]),
      activityView(a),
    );
    // Keep the archive list honest on the same tick. The list is derived from the
    // BACKUP FOLDER, so anything deleted outside the dashboard (in a file manager, or
    // by hand) has to disappear here too — previously it only re-read on view entry,
    // after a backup, or after a restore, so a deleted archive lingered on screen and
    // could still be picked for a restore that would then fail.
    refreshArchives();
  }
  refresh(); OPS_TIMER = setInterval(refresh, 4000);
  return el("div", {}, [
    el("div", { class: "hint" }, ["Orchestration — live agent-activity detection, ", el("b", {}, ["dated archive backups"]), " with restore, and gated ", el("b", {}, ["master-pollinate"]), ". Buttons are enabled only when no agent is working."]),
    controls, out, statusBox,
    schedBox,
    el("h3", { style: "margin:18px 0 6px" }, ["Archives"]),
    el("div", { class: "hint" }, ["Each backup is an immutable point in time — a corrupted tree can only overwrite the newest archive, never the older ones. Restore rewinds the files the archive contains; anything created since is left alone."]),
    archiveBox,
  ]);
}

/* ---------- tokens: one dashboard, organised by entity × scope ----------
   GitHub and npm, each split into Account / Organisation / Repository. Account tokens
   come from the registry (metadata only) + the .secrets store; org/repo GitHub Actions
   secrets are discovered live by the scan. Values are never shown — only where each
   token lives, when it expires, and a field to paste a renewed value into the store. */
const TOK_COLOR = { active: "#34d399", expiring: "#fbbf24", expired: "#f87171", none: "#94a3b8" };
const ENTITY_META = {
  github: { label: "GitHub", color: "#8b95ff", icon: "◆" },
  npm: { label: "npm", color: "#cb3837", icon: "▲" },
};
const SCOPE_META = {
  account: { label: "Account (global)", hint: "one token, used everywhere it's granted" },
  org: { label: "Organisation", hint: "org-level Actions secrets, inherited by repos" },
  repo: { label: "Repository", hint: "secrets set on a single repo" },
};

let TOKREG = null;   // cached registry response for re-renders after a save

function tokPill(t) {
  const c = TOK_COLOR[t.status] || TOK_COLOR.none;
  const label = t.status === "none" ? "no expiry"
    : t.status === "expired" ? `expired ${-t.daysLeft}d ago`
    : t.status === "expiring" ? `expires in ${t.daysLeft}d`
    : `${t.daysLeft}d left`;
  return el("span", { style: `font-size:11px;font-weight:700;color:${c};border:1px solid ${c}55;background:${c}18;border-radius:999px;padding:2px 9px` }, [label]);
}

// One account-token card: identity, expiry, where it's deployed, manage link, renew field.
function accountTokenCard(t, onSaved) {
  const store = t.stored === true ? el("span", { style: "color:#34d399;font-size:11px" }, ["✓ stored in .secrets/" + t.secretFile])
    : t.stored === false ? el("span", { style: "color:#fbbf24;font-size:11px" }, ["⚠ not stored — paste it below to save to .secrets/" + t.secretFile])
    : el("span", { class: "was" }, ["not stored locally"]);

  const input = el("input", { type: "password", placeholder: "paste renewed token…",
    style: "flex:1;min-width:160px;background:var(--chip);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:5px 9px;font-family:ui-monospace,monospace;font-size:12px" });
  const saveBtn = el("button", { class: "gitbtn" }, ["Save to .secrets"]);
  const msg = el("span", { class: "was", style: "font-size:11px" });
  saveBtn.addEventListener("click", async () => {
    if (!input.value.trim()) { msg.textContent = "paste a value first"; return; }
    saveBtn.disabled = true; msg.textContent = "saving…";
    try {
      const r = await (await fetch("/api/tokens/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secretFile: t.secretFile, value: input.value }) })).json();
      msg.textContent = r.ok ? "✓ saved" : (r.message || "failed");
      msg.style.color = r.ok ? "#34d399" : "#f87171";
      input.value = "";
      if (r.ok && onSaved) onSaved();
    } catch (e) { msg.textContent = String(e); }
    saveBtn.disabled = false;
  });

  const stripe = TOK_COLOR[t.status] || TOK_COLOR.none;
  return el("div", { class: "repocard", style: `--stripe:${stripe}` }, [
    el("div", { class: "rc-hd" }, [
      el("span", { class: "rc-name", title: t.notes || "" }, [t.label || t.id]),
      el("span", { style: "margin-left:auto" }, [tokPill(t)]),
    ]),
    el("div", { class: "rc-sub" }, [el("code", {}, [t.kind]), t.expires ? `  ·  ${t.expires}` : "  ·  never expires"]),
    (t.deployedAs && t.deployedAs.length) ? el("div", { class: "rc-sub" }, ["deployed as: ", ...t.deployedAs.map((d) => el("code", { style: "margin-right:5px" }, [d]))]) : "",
    el("div", { class: "rc-sub" }, [store]),
    el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:3px" }, [
      el("a", { href: t.manageUrl, target: "_blank", rel: "noopener", class: "gitbtn", style: "text-decoration:none" }, ["↗ Manage / renew"]),
    ]),
    // The renew field writes a secret value to the local .secrets — only an executor
    // (ancient) with the bridge up sees it; a read-only viewer does not.
    canAct() ? el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:3px" }, [input, saveBtn, msg]) : "",
  ]);
}

function scopeSection(scope, cards, extra) {
  const m = SCOPE_META[scope];
  return el("div", { style: "margin:8px 0 4px" }, [
    el("div", { class: "hint", style: "margin-bottom:6px" }, [el("b", {}, [m.label]), "  — " + m.hint]),
    cards.length || extra ? el("div", { class: "orggroup-body", style: "padding:0" }, cards) : el("div", { class: "was", style: "font-size:12px;opacity:.7" }, ["none"]),
    extra || "",
  ]);
}

let TOK_SCAN = null;   // last scan result, merged into the org/repo scopes

function viewTokens() {
  const wrap = el("div", { id: "tokWrap" }, [el("div", { class: "hint" }, ["Loading tokens…"])]);

  async function load() {
    let d; try { d = await (await fetch("/api/tokens")).json(); } catch { wrap.replaceChildren(el("div", { class: "hint" }, ["tokens not reachable"])); return; }
    TOKREG = d;
    const T = d.totals || {};

    const summary = el("div", { class: "statbar" }, [
      el("div", { class: "stat" }, [el("div", { class: "n" }, [String(T.total || 0)]), el("div", { class: "l" }, ["account tokens"])]),
      el("div", { class: "stat" }, [el("div", { class: "n", style: `color:${T.expired ? TOK_COLOR.expired : "inherit"}` }, [String(T.expired || 0)]), el("div", { class: "l" }, ["expired"])]),
      el("div", { class: "stat" }, [el("div", { class: "n", style: `color:${T.expiring ? TOK_COLOR.expiring : "inherit"}` }, [String(T.expiring || 0)]), el("div", { class: "l" }, ["expiring ≤30d"])]),
      el("div", { class: "stat" }, [el("div", { class: "n", style: `color:${TOK_COLOR.active}` }, [String(T.stored || 0)]), el("div", { class: "l" }, ["stored in .secrets"])]),
      el("div", { class: "stat" }, [el("div", { class: "n", style: `color:${T.missing ? TOK_COLOR.expiring : "inherit"}` }, [String(T.missing || 0)]), el("div", { class: "l" }, ["not yet stored"])]),
    ]);

    // The live scan feeds the org/repo GitHub scopes — auto-run on open, cached ~5 min.
    const scanBtn = el("button", { class: "ghost" }, [TOK_SCANNING ? "… scanning secrets" : TOK_SCAN ? "↻ Re-scan repositories" : "🔎 Scan now"]);
    scanBtn.disabled = TOK_SCANNING;
    scanBtn.addEventListener("click", () => runScan(true));   // manual button = force fresh

    const g = d.grouped || { github: {}, npm: {} };
    const entities = ["github", "npm"].map((ent) => {
      const em = ENTITY_META[ent];
      const account = (g[ent]?.account || []).map((t) => accountTokenCard(t, load));

      return el("div", { class: "orggroup", style: `--org:${em.color}` }, [
        el("div", { class: "orggroup-hd" }, [
          el("span", { class: "dot", style: `background:${em.color}` }),
          el("b", {}, [em.icon + " " + em.label]),
          ent === "github" ? el("span", { class: "grouptag" }, [scanBtn]) : "",
        ]),
        el("div", { style: "padding:10px 14px" }, [
          scopeSection("account", account),
          scopeSection("org", [], scopeSecrets(ent, "org", d.tokens || [], TOK_SCAN)),
          scopeSection("repo", [], scopeSecrets(ent, "repo", d.tokens || [], TOK_SCAN)),
        ]),
      ]);
    });

    wrap.replaceChildren(
      el("div", { class: "hint" }, ["Every token and secret, organised by ", el("b", {}, ["entity × scope"]), " — detected live from your GitHub token (scans on open). Values are never shown, only where each lives and when it expires. ", el("b", {}, ["↗ open"]), " jumps to a secret's settings page so you can remove the ones you don't need."]),
      summary,
      ...entities,
    );

    // Auto-scan the first time the tab is opened this session (server-cached ~5 min,
    // so switching away and back is instant). The manual button forces a fresh scan.
    if (!TOK_SCAN && !TOK_SCANNING) runScan(false);
  }

  async function runScan(force) {
    if (TOK_SCANNING) return;
    TOK_SCANNING = true;
    // reflect the scanning state without a full reload (keeps the account cards steady)
    const btn = wrap.querySelector(".orggroup-hd .ghost");
    if (btn) { btn.disabled = true; btn.textContent = "… scanning secrets (~20s)"; }
    try { TOK_SCAN = await (await fetch("/api/tokens/scan" + (force ? "?refresh=1" : ""))).json(); }
    catch (e) { TOK_SCAN = { ok: false, message: String(e) }; }
    TOK_SCANNING = false;
    load();
  }

  load();
  return wrap;
}
let TOK_SCANNING = false;

// Direct link to a secret's GitHub management page.
function secretMgmtUrl(scope, target) {
  return scope === "org"
    ? `https://github.com/organizations/${target}/settings/secrets/actions`         // target = org name
    : `https://github.com/${target}/settings/secrets/actions`;                       // target = owner/repo
}
const mgmtLink = (scope, target) => el("a", { href: secretMgmtUrl(scope, target), target: "_blank", rel: "noopener", class: "gitbtn", style: "text-decoration:none" }, ["↗ open"]);

// Map a secret NAME to the token whose value it holds, from each token's `deployedAs`
// (a plain list of secret names). Detection finds WHERE a secret lives; this only
// annotates the "Holds" column with WHICH token feeds a detected secret — no manual
// per-location declaration to keep in sync.
function secretHolders(tokens) {
  const m = {};
  for (const t of tokens || []) for (const name of (t.deployedAs || [])) m[name.toLowerCase()] = t.label;
  return m;
}

// The "Used by a workflow?" cell — the evidence for whether a secret is dead weight.
function usageCell(r) {
  if (r.used === true) {
    const by = (r.usedBy || []).join(", ");
    return el("span", { style: "color:#34d399;font-size:11px", title: by ? "used by " + by : "" }, ["✓ used" + ((r.usedBy && r.usedBy.length) ? ` (${r.usedBy.length})` : "")]);
  }
  if (r.used === false) return el("span", { style: "color:#fbbf24;font-size:11px", title: "No workflow references this secret — safe to delete." }, ["⚠ unused — removable"]);
  return el("span", { class: "was" }, ["—"]);
}

// ONE aligned table per scope, driven purely by DETECTION (the scan). Each row: the
// detected secret, where it lives, which token it holds (matched by name), when it
// changed, whether a workflow uses it, and a management link.
function scopeSecrets(entity, scope, tokens, scan) {
  if (entity !== "github") {
    return el("div", { class: "was", style: "font-size:12px" }, ["npm tokens are account-level — nothing to set per-" + (scope === "org" ? "org" : "repo") + "."]);
  }
  if (!scan) return el("div", { class: "was", style: "font-size:12px" }, ["Scanning…"]);
  if (!scan.ok) return el("div", { class: "movecard", style: "border-color:#f87171;font-size:12px" }, [scan.message || "scan failed"]);

  const holders = secretHolders(tokens);
  const rows = [];
  for (const t of (scan.targets || []).filter((x) => (scope === "org" ? !x.repo : !!x.repo))) {
    for (const s of (t.secrets || [])) {
      const target = scope === "org" ? t.owner : `${t.owner}/${t.repo}`;
      rows.push({ secret: s.name, target, owner: t.owner, repo: t.repo, updated: s.updated, used: s.used, usedBy: s.usedBy, holds: holders[s.name.toLowerCase()] });
    }
  }
  rows.sort((a, b) => a.secret.localeCompare(b.secret) || a.target.localeCompare(b.target));

  // admin:org warning only when the token genuinely lacks the scope.
  const hasAdminOrg = (scan.identity?.scopes || []).includes("admin:org");
  const scopeBlocked = scope === "org" && !hasAdminOrg &&
    (scan.targets || []).some((t) => !t.repo && !t.reachable && /no access/.test(t.reason || ""));

  const parts = [];
  if (scopeBlocked) parts.push(el("div", { class: "movecard", style: "border-color:#fbbf24;font-size:12px;margin:2px 0 6px" }, ["⚠ The scan can't read org-level secrets — your token lacks the ", el("code", {}, ["admin:org"]), " scope. Add it and re-scan."]));

  if (!rows.length) {
    parts.push(el("div", { class: "was", style: "font-size:12px" }, ["No " + scope + "-level secrets found."]));
  } else {
    parts.push(el("div", { style: "overflow-x:auto" }, [el("table", { class: "pkgtable" }, [
      el("thead", {}, [el("tr", {}, ["Secret", scope === "org" ? "Organisation" : "Repository", "Holds", "Updated", "Used by a workflow?", ""].map((h) => el("th", {}, [h])))]),
      el("tbody", {}, rows.map((r) => el("tr", {}, [
        el("td", {}, [el("code", {}, [r.secret])]),
        el("td", { class: "was" }, [r.target]),
        el("td", { class: "was" }, [r.holds || "—"]),
        el("td", { class: "was" }, [(r.updated || "").slice(0, 10) || "—"]),
        el("td", {}, [usageCell(r)]),
        el("td", {}, [mgmtLink(scope, scope === "org" ? r.owner : `${r.owner}/${r.repo}`)]),
      ]))),
    ])]));
  }
  return el("div", {}, parts);
}

/* ---------- overview: org cards ---------- */
function viewOverview() {
  const wrap = el("div", {}, [orgModeToggle(), el("div", { class: "hint" }, ["Repos grouped by their GitHub organisation. Orange ⇄ = a proposed movement. Hover a repo for detail."])]);
  const orgCount = Object.entries(MAP.orgs).filter(([org]) => MAP.repos.some((r) => repoOrg(r) === org)).length;
  // One equal column per org, so all cardboards sit side by side on a wide screen (a media query
  // in the CSS reflows to fewer columns on narrower ones).
  const grid = el("div", { class: "grid-orgs", style: `grid-template-columns: repeat(${orgCount}, minmax(0, 1fr))` });
  for (const [org, meta] of Object.entries(MAP.orgs)) {
    const repos = MAP.repos.filter((r) => repoOrg(r) === org);
    if (!repos.length) continue;
    const card = el("div", { class: "orgcard" }, [
      el("div", { class: "hd" }, [
        el("span", { class: "dot", style: `background:${meta.color}` }),
        el("b", {}, [org]),
        el("span", { class: "scope" }, [meta.scope || "—"]),
      ]),
      el("div", { class: "desc" }, [meta.desc]),
      el("div", { class: "body" }, repos.map(repoRow)),
    ]);
    grid.append(card);
  }
  wrap.append(grid);
  return wrap;
}

function repoRow(r) {
  const role = roleOf(r.role);
  const pub = (r.packages || []).find((p) => !p.private);
  const row = el("div", { class: "repo" }, [
    el("span", { class: "glyph", style: `color:${role.color}` }, [role.glyph]),
    el("span", { class: "rn" }, [r.name]),
    pub ? el("span", { class: "ver" }, [" " + pub.version]) : "",
    isMoving(r) ? el("span", { class: "move", title: (r.movement || []).join(" · ") }, ["⇄"]) : "",
    el("span", { class: "rolechip", style: `background:${role.color}` }, [role.label]),
  ]);
  attachTip(row, r);
  return row;
}

/* ---------- matrix: org x role ---------- */
function viewMatrix() {
  const orgs = Object.keys(MAP.orgs).filter((o) => MAP.repos.some((r) => repoOrg(r) === o));
  const roles = Object.keys(MAP.roles).filter((role) => MAP.repos.some((r) => r.role === role));
  const table = el("table", { class: "matrix" });
  const head = el("tr", {}, [el("th", {}, ["role ╲ org"]), ...orgs.map((o) =>
    el("th", {}, [el("span", { style: `color:${orgColor(o)}` }, ["● "]), o]))]);
  table.append(el("thead", {}, [head]));
  const body = el("tbody");
  for (const role of roles) {
    const rr = roleOf(role);
    const tr = el("tr", {}, [el("td", { class: "rolehead" }, [rr.glyph + " " + rr.label])]);
    for (const o of orgs) {
      const cell = el("td");
      MAP.repos.filter((r) => r.role === role && repoOrg(r) === o).forEach((r) => {
        const chip = el("span", { class: "mchip" + (isMoving(r) ? " moving" : "") }, [
          el("span", { style: `color:${rr.color}` }, [rr.glyph + " "]), r.name,
        ]);
        attachTip(chip, r); cell.append(chip);
      });
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(body);
  return el("div", {}, [orgModeToggle(), el("div", { class: "hint" }, ["Every repo placed by its Pantheonic role (row) and organisation (column). Automatons + Constructors cluster in AncientPantheon under the 'shared machines' model."]), table]);
}

/* ---------- dependency graph (SVG) ---------- */
function viewGraph() {
  const layers = [
    { y: 0, label: "L0 · foundations" },
    { y: 1, label: "L1 · libraries" },
    { y: 2, label: "L2 · Constructors" },
    { y: 3, label: "L3 · consumers (Automatons / Daimons / Seers)" },
  ];
  // nodes = packages (L0-L2) + consumer repos (L3)
  const nodes = [];
  const addNode = (id, label, layer, org, meta) => nodes.push({ id, label, layer, org, meta });
  // L1/L2 published packages
  const pkgNodes = {
    "@ouronet/dalos-crypto": ["dalos-crypto", 1, "OuroborosNetwork"],
    "@stoachain/kadena-stoic-legacy": ["kadena-stoic-legacy", 1, "StoaChain"],
    "@stoachain/stoa-core": ["stoa-core", 1, "StoaChain"],
    "@ouronet/ouronet-core": ["ouronet-core", 1, "OuroborosNetwork"],
    "@ouronet/ouronet-codex": ["ouronet-codex", 1, "OuroborosNetwork"],
    "@ancientpantheon/codex": ["Codex ◈", 2, "AncientPantheon"],
    "@ancientpantheon/pythia-client": ["Pythia ◈", 2, "AncientPantheon"],
    "@ancientpantheon/khronoton-core": ["Khronoton ◈", 2, "AncientPantheon"],
  };
  for (const [id, [label, layer, org]] of Object.entries(pkgNodes)) addNode(id, label, layer, org);
  // L0 foundations
  [["stoa-chain", "StoaChain"], ["AncientHoldings Hub", "StoaChain"], ["ouronet-pact", "OuroborosNetwork"]].forEach(([l, o]) => addNode(l, l, 0, o));
  // L3 consumers (repo names referenced by edges)
  ["OuronetUI", "Caduceus", "StoaExplorer", "Mnemosyne", "StoaWallet"].forEach((rn) => {
    const r = MAP.repos.find((x) => x.name === rn);
    addNode(rn, rn, 3, r ? repoOrg(r) : "StoaChain", r);
  });

  // layout
  const W = 1080, padX = 150, colGap = (W - padX - 40);
  const byLayer = {}; nodes.forEach((n) => (byLayer[n.layer] = byLayer[n.layer] || []).push(n));
  const rowH = 120, boxW = 150, boxH = 40;
  const H = layers.length * rowH + 40;
  layers.forEach((L) => {
    const arr = byLayer[L.y] || [];
    arr.forEach((n, i) => {
      const gap = colGap / (arr.length + 1);
      n.x = padX + gap * (i + 1);
      n.y = 40 + (layers.length - 1 - L.y) * rowH + rowH / 2; // L0 at bottom
    });
  });
  const pos = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%"); svg.style.minWidth = "760px"; svg.style.height = H + "px";

  // layer bands + labels
  layers.forEach((L) => {
    const yTop = 40 + (layers.length - 1 - L.y) * rowH;
    const band = document.createElementNS(svgNS, "rect");
    band.setAttribute("x", 0); band.setAttribute("y", yTop); band.setAttribute("width", W); band.setAttribute("height", rowH);
    band.setAttribute("class", "laybar"); band.setAttribute("opacity", L.y % 2 ? ".35" : ".15"); svg.append(band);
    const t = document.createElementNS(svgNS, "text");
    t.setAttribute("x", 10); t.setAttribute("y", yTop + 16); t.setAttribute("class", "laylabel"); t.textContent = L.label; svg.append(t);
  });

  // edges
  const edgeEls = [];
  MAP.edges.forEach((e) => {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) return;
    const p = document.createElementNS(svgNS, "path");
    const midY = (a.y + b.y) / 2;
    p.setAttribute("d", `M ${a.x} ${a.y - boxH / 2} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y + boxH / 2}`);
    p.setAttribute("class", "edge" + (e.cross ? " cross" : ""));
    p.dataset.from = e.from; p.dataset.to = e.to;
    svg.append(p); edgeEls.push(p);
  });

  // nodes
  nodes.forEach((n) => {
    const g = document.createElementNS(svgNS, "g"); g.setAttribute("class", "node");
    const rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("x", n.x - boxW / 2); rect.setAttribute("y", n.y - boxH / 2);
    rect.setAttribute("width", boxW); rect.setAttribute("height", boxH); rect.setAttribute("rx", 9);
    rect.setAttribute("fill", "var(--panel)"); rect.setAttribute("stroke", orgColor(n.org));
    const t = document.createElementNS(svgNS, "text");
    t.setAttribute("x", n.x); t.setAttribute("y", n.y + 4); t.setAttribute("text-anchor", "middle");
    t.setAttribute("fill", "var(--ink)"); t.setAttribute("font-size", "12"); t.textContent = n.label;
    g.append(rect, t); svg.append(g);
    g.addEventListener("mouseenter", (ev) => {
      edgeEls.forEach((p) => {
        const hot = p.dataset.from === n.id || p.dataset.to === n.id;
        p.classList.toggle("hot", hot); p.classList.toggle("dim", !hot);
      });
      if (n.meta) attachTipShow(ev, n.meta);
      else showTip(ev, `<b>${n.label}</b><div class="row">${n.id}</div><div class="row">org: ${n.org}</div>`);
    });
    g.addEventListener("mousemove", moveTip);
    g.addEventListener("mouseleave", () => { edgeEls.forEach((p) => p.classList.remove("hot", "dim")); hideTip(); });
  });

  const wrap = el("div", {}, [
    orgModeToggle(),
    el("div", { class: "hint" }, ["Bottom-up dependency stack. Solid = same-org edge; dashed magenta = cross-org edge (what master-pollinate must track). Hover a node to isolate its edges."]),
    el("div", { class: "graphwrap" }, [svg]),
  ]);
  return wrap;
}

/* ---------- movements ---------- */
function viewMovements() {
  const moving = MAP.repos.filter(isMoving);
  const list = el("div", { class: "movelist" });
  moving.forEach((r) => {
    const role = roleOf(r.role);
    list.append(el("div", { class: "movecard" }, [
      el("h4", {}, [
        el("span", { style: `color:${role.color}` }, [role.glyph + " "]), r.name,
        el("span", { class: "tag", style: `background:${orgColor(r.org.target)}; margin-left:8px` }, [r.org.current || "—", " → ", r.org.target || "—"]),
      ]),
      el("div", { class: "was" }, [r.notes || ""]),
      el("ul", {}, (r.movement || []).map((m) => el("li", {}, [m]))),
    ]));
  });
  return el("div", {}, [el("div", { class: "hint" }, [`${moving.length} repositories carry a movement (org change, rename, split, dedupe, or new remote). These are the concrete execution steps.`]), list]);
}

/* ---------- packages ---------- */
function viewPackages() {
  const wrap = el("div", {}, [el("div", { class: "hint" }, ["Live scan of every package.json across the ecosystems — real published npm packages, their internal sub-packages, and app packages, grouped by the repo they live in. Auto-reflects Phase-4 renames."])]);
  const body = el("div", {}, [el("div", { class: "hint" }, ["Scanning packages…"])]);
  wrap.append(body);
  const scopeColor = { "@stoachain": "#38bdf8", "@ancientpantheon": "#c084fc", "@ouronet": "#34d399", "@caduceus": "#f472b6", "@stoawallet": "#fbbf24" };
  (async () => {
    let d; try { d = await (await fetch("/api/packages")).json(); } catch { body.replaceChildren(el("div", { class: "hint" }, ["scan failed"])); return; }
    const stat = el("div", { class: "statbar" }, [
      el("div", { class: "stat" }, [el("div", { class: "n", style: "color:#34d399" }, [String(d.totals.published)]), el("div", { class: "l" }, ["published (npm)"])]),
      el("div", { class: "stat" }, [el("div", { class: "n" }, [String(d.totals.sub)]), el("div", { class: "l" }, ["sub-packages"])]),
      el("div", { class: "stat" }, [el("div", { class: "n" }, [String(d.totals.apps)]), el("div", { class: "l" }, ["app packages"])]),
    ]);
    // ① published by scope
    const pubGrid = el("div", { class: "grid-orgs" });
    for (const sc of Object.keys(d.scopes).sort()) {
      const col = scopeColor[sc] || "#64748b";
      pubGrid.append(el("div", { class: "orgcard" }, [
        el("div", { class: "hd" }, [el("span", { class: "dot", style: `background:${col}` }), el("b", {}, [sc]), el("span", { class: "scope" }, [d.scopes[sc].length + " published"])]),
        el("div", { class: "body" }, d.scopes[sc].map((p) => el("div", { class: "repo" }, [el("span", { class: "rn" }, [p.name.replace(sc + "/", "")]), el("span", { class: "ver" }, [" " + p.version]), el("span", { class: "ver", style: "margin-left:auto;color:var(--ink-dim)" }, [p.repo.split("/").pop()])]))),
      ]));
    }
    // ② monorepo breakdown
    const mono = d.repos.filter((r) => r.published.length);
    const monoTable = el("table", { class: "pkgtable" }, [
      el("thead", {}, [el("tr", {}, ["Repo (monorepo)", "Published", "Sub-packages (internal, private)"].map((h) => el("th", {}, [h])))]),
      el("tbody", {}, mono.map((r) => el("tr", {}, [
        el("td", {}, [el("b", {}, [r.repo.split("/").pop()]), el("div", { class: "was" }, [r.repo])]),
        el("td", {}, r.published.map((p) => el("div", {}, [el("code", { class: "pub" }, [p.name]), el("span", { class: "was" }, [" @" + p.version])]))),
        el("td", {}, r.sub.length ? r.sub.map((p) => el("div", {}, [el("code", { class: "priv" }, [p.name]), el("span", { class: "was" }, [" @" + p.version])])) : [el("span", { class: "was" }, ["—"])]),
      ]))),
    ]);
    // ③ app packages (private roots)
    const apps = d.repos.filter((r) => r.appRoot && !r.published.length);
    const appTable = el("table", { class: "pkgtable" }, [
      el("thead", {}, [el("tr", {}, ["App / private package", "Version", "Repo"].map((h) => el("th", {}, [h])))]),
      el("tbody", {}, apps.map((r) => el("tr", {}, [el("td", {}, [el("code", {}, [r.appRoot.name])]), el("td", {}, [r.appRoot.version]), el("td", { class: "was" }, [r.repo])]))),
    ]);
    body.replaceChildren(
      stat,
      el("div", { class: "hint" }, [el("b", {}, ["① Published npm packages"]), " — real, on-registry, by scope:"]), pubGrid,
      el("div", { class: "hint", style: "margin-top:18px" }, [el("b", {}, ["② Monorepo breakdown"]), " — each publishing repo: its published packages + the internal sub-packages that compose them:"]), monoTable,
      el("div", { class: "hint", style: "margin-top:18px" }, [el("b", {}, ["③ App packages"]), " — private package roots (the apps themselves, not published to npm):"]), appTable,
    );
  })();
  return wrap;
}

/* ---------- shared: org-mode toggle + tooltips ---------- */
function orgModeToggle() {
  const mk = (mode, label) => el("button", {
    class: "ghost", style: ORGMODE === mode ? "border-color:var(--accent);color:var(--ink)" : "",
    onclick: () => { ORGMODE = mode; renderStatbar(); render(); },
  }, [label]);
  return el("div", { class: "graph-controls" }, [
    el("span", { style: "color:var(--ink-dim);font-size:12px" }, ["Org view:"]),
    mk("current", "Current (today)"), mk("target", "Target (greenlit reorg)"),
  ]);
}

function attachTip(node, r) {
  node.addEventListener("mouseenter", (e) => attachTipShow(e, r));
  node.addEventListener("mousemove", moveTip);
  node.addEventListener("mouseleave", hideTip);
}
function attachTipShow(e, r) {
  const role = roleOf(r.role);
  const pkgs = (r.packages || []).map((p) => `<code>${p.name}@${p.version}</code>`).join("<br>") || "—";
  const consumes = (r.consumes || []).join(", ") || "—";
  showTip(e, `
    <b>${r.name}</b> <span style="color:${role.color}">${role.glyph} ${role.label}</span>
    <div class="row">ecosystem: ${r.ecosystem || "—"} · layer ${r.layer}</div>
    <div class="row">org: ${r.org.current || "—"} → <b style="color:var(--ink)">${r.org.target || "—"}</b></div>
    <div class="row">local: ${r.localPath}</div>
    <div class="row">consumes: ${consumes}</div>
    <div class="row" style="margin-top:6px">${pkgs}</div>
    ${(r.movement && r.movement.length) ? `<div class="row" style="color:#f59e0b;margin-top:6px">⇄ ${r.movement.join("<br>⇄ ")}</div>` : ""}
    <div class="row" style="margin-top:6px">${r.notes || ""}</div>`);
}
function showTip(e, html) { const t = $("#tooltip"); t.innerHTML = html; t.hidden = false; moveTip(e); }
function moveTip(e) {
  const t = $("#tooltip"); if (t.hidden) return;
  const pad = 16, w = t.offsetWidth, h = t.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth) x = e.clientX - w - pad;
  if (y + h > innerHeight) y = e.clientY - h - pad;
  t.style.left = x + "px"; t.style.top = y + "px";
}
function hideTip() { $("#tooltip").hidden = true; }

boot();
