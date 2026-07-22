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
  if (VIEW !== "git" && GIT_TIMER) { clearInterval(GIT_TIMER); GIT_TIMER = null; }
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
    el("div", { class: "hint" }, ["View a dev server running on the work machine, here in your remote browser (proxied through the tunnel). Best for server-rendered / relative-path sites; live-reload (WebSocket) and absolute-path SPA assets may not fully work."]),
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
function viewDeploy() {
  const root = el("div", { class: "deploy-wrap" }, []);
  const verRow = el("div", { class: "deploy-vers" }, [el("div", { class: "hint" }, ["Loading version state…"])]);
  const term = el("pre", { class: "deploy-term" }, ["(no deploy run yet)"]);
  const actions = el("div", { class: "deploy-actions" }, []);
  const note = el("div", { class: "hint" }, []);

  const verCard = (title, v, tone) => el("div", { class: "deploy-card " + (tone || "") }, [
    el("div", { class: "deploy-card-t" }, [title]),
    el("div", { class: "deploy-ver" }, [v ? "v" + v.version : "—"]),
    el("div", { class: "deploy-sha" }, [v ? (v.gitSha || "") + (v.builtAt ? " · " + new Date(v.builtAt).toLocaleString() : "") : "unreachable"]),
  ]);

  function openStream() {
    try { DEPLOY_ES && DEPLOY_ES.close(); } catch {}
    term.textContent = "";
    DEPLOY_ES = new EventSource("/api/deploy/stream");
    DEPLOY_ES.onmessage = (e) => {
      let line; try { line = JSON.parse(e.data); } catch { return; }
      if (line === "__DONE_OK__" || line === "__DONE_FAIL__") { note.textContent = line === "__DONE_OK__" ? "✓ Deploy finished — refresh version state." : "✗ Deploy failed — see the log."; refresh(); try { DEPLOY_ES.close(); } catch {} return; }
      term.textContent += line + "\n"; term.scrollTop = term.scrollHeight;
    };
    DEPLOY_ES.onerror = () => { try { DEPLOY_ES.close(); } catch {} };
  }

  async function refresh() {
    let st = {}; try { st = await (await fetch("/api/deploy/status", { cache: "no-store" })).json(); } catch {}
    const remote = !!st.remote;   // live site: the deploy runs on the work machine over the tunnel
    const pending = st.pending, live = st.live && st.live.version ? st.live : null;
    const same = pending && live && pending.version === live.version && pending.gitSha === live.gitSha;
    verRow.replaceChildren(
      verCard("Live · brain.ancientholdings.eu", live, same ? "ok" : "stale"),
      el("div", { class: "deploy-arrow" }, [same ? "＝" : "⇒"]),
      remote ? verCard("Pending · the work machine", null, "pending") : verCard("Pending · this machine", pending, "pending"),
    );
    // Deploy is available locally (direct) or on the live site when the work machine is connected.
    const canDeploy = !remote || st.localConnected;
    const deployBtn = el("button", { class: "loginbtn" + (same ? " secondary" : "") }, [st.running ? "Deploying…" : (same ? "Redeploy" : "Deploy to live ↗")]);
    if (st.running || !canDeploy) deployBtn.disabled = true;
    deployBtn.addEventListener("click", async () => {
      if (!confirm("Deploy the current build to brain.ancientholdings.eu? The relay rebuilds (~1 min).")) return;
      note.textContent = "Starting deploy…"; openStream();
      const r = await wsPost2("/api/deploy", {});
      if (!r.ok) { try { DEPLOY_ES.close(); } catch {} DEPLOY_ES = null; note.textContent = "⚠ " + (r.message || "could not start"); }
    });
    const logBtn = el("button", { class: "ghost" }, ["Show live log"]);
    logBtn.addEventListener("click", openStream);
    actions.replaceChildren(deployBtn, logBtn);
    if (remote && !st.localConnected) actions.append(el("span", { class: "hint" }, ["  (the work machine is offline)"]));
    if (st.running && !DEPLOY_ES) openStream();
    if (st.logTail && st.logTail.length && term.textContent === "(no deploy run yet)") term.textContent = st.logTail.join("\n");
  }
  root.replaceChildren(
    el("h2", { class: "deploy-h" }, ["Deploy & Version"]),
    el("div", { class: "hint" }, ["The version + changelog are cut by the agent when a change is built (Pantheonic §10). This panel just ships the built version to the live site."]),
    verRow,
    el("div", { class: "deploy-actions-row" }, [actions, note]),
    el("h3", { style: "margin:14px 0 4px" }, ["Deploy log"]), term,
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
const fmtUsd = (n) => "$" + (Number(n) || 0).toFixed(2);

// Pane grid limits. 8 across is sized for an ultrawide (5120px ⇒ ~600px a pane); narrower
// screens keep the panes readable and scroll the grid sideways instead of crushing them.
const WS_MAX_COLS = 8, WS_MAX_ROWS = 2;
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
    pendingOpens: new Map(),       // savedSessionKey -> { paneId, mode } — reopens in flight, correlated
    dataSizes: {},                 // localPath -> { bytes, conversations, turns } — collected raw volume
    collapsedOrgs: new Set(),      // org names collapsed in the Repositories sidebar
    searchQuery: "", searchResults: null,   // full-text search over saved conversations
  };
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
  const newPane = () => ({ id: wsUuid(), sessionKey: wsUuid(), repo: "", mode: st.defaultMode, transcript: [], usage: {}, status: "idle", readonly: false, resume: null });

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
        panes: st.panes.map((p) => ({ id: p.id, sessionKey: p.sessionKey, repo: p.repo, mode: p.mode })),
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
      id: p.id || wsUuid(), sessionKey: p.sessionKey || wsUuid(), repo: p.repo || "",
      mode: WS_MODE_IDS.has(p.mode) ? p.mode : st.defaultMode,
    }));
    while (st.panes.length < st.cols * st.rows) st.panes.push(newPane());
    st.activeId = st.panes.some((p) => p.id === s.activeId) ? s.activeId : st.panes[0].id;
    return true;
  }
  /** Re-attach restored panes to their saved threads — but only for keys history actually
   *  knows, so a pane that never got a prompt doesn't trigger a "could not be opened" error. */
  function restorePanes() {
    const known = new Set(st.history.map((h) => h.sessionKey));
    let n = 0;
    for (const p of st.panes) {
      if (!known.has(p.sessionKey) || p.transcript.length) continue;
      st.pendingOpens.set(p.sessionKey, { paneId: p.id, mode: "restore" });
      wsPost("control", { action: "open", args: { sessionKey: p.sessionKey } });
      n++;
    }
    if (n) note(`Reattached ${n} pane(s) to their conversations — your next message continues where you left off.`);
  }
  const paneUI = new Map();        // paneId -> { root, transcriptEl, promptEl, repoSel, usageEl, dot, sendBtn, badge }
  const paneOf = (key) => st.panes.find((p) => p.sessionKey === key);
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

  // ---- transcript rendering (handles both live {kind} and saved {role} items) ----
  function line(cls, kids) { return el("div", { class: "ws-line " + cls }, kids); }
  function renderItem(m) {
    if (m.role === "user") return line("ws-user", [el("b", {}, ["you  "]), m.text]);
    if (m.role === "assistant" || m.kind === "assistant") return line("ws-assistant", [m.text]);
    if (m.kind === "tool_use") return line("ws-tool", [el("i", { class: "ti ti-tool" }, []), " ", (m.tools || []).map((t) => t.name).join(", ")]);
    if (m.kind === "tool_result") return line("ws-toolres", ["✓ tool result"]);
    if (m.kind === "result") return line("ws-result", [`— done · ${(m.usage?.output_tokens || 0)} out tok · ~${fmtUsd(m.costUsd)}`]);
    if (m.kind === "error") return line("ws-err", ["⚠ " + m.text]);
    if (m.kind === "created") return line("ws-note", [`created ${m.what}: ${m.path}`]);
    return null;
  }

  // ---- one pane ------------------------------------------------------------------
  function buildPane(p) {
    const repoSel = el("select", { class: "wsel wsel-sm" }, []); fillRepoSelect(repoSel, p.repo);
    const modeSel = el("select", { class: "wsel wsel-mode", title: "Permission mode for this pane" },
      WS_MODES.map((m) => el("option", { value: m.id }, [m.short])));
    modeSel.value = p.mode;
    const dot = el("span", { class: "actdot" });
    const badge = el("span", { class: "ws-usage" }, ["—"]);
    const closeBtn = el("button", { class: "ws-x", title: "Clear this pane (ends its session)" }, ["×"]);
    const histBtn = el("button", { class: "ws-ico", title: "History for this repo" }, ["⏱"]);
    const transcriptEl = el("div", { class: "ws-transcript" }, []);
    const promptEl = el("textarea", { class: "ws-prompt", rows: "2", placeholder: "Message Claude… (Ctrl+Enter)" });
    const sendBtn = el("button", { class: "loginbtn ws-send" }, ["Send"]);
    const header = el("div", { class: "ws-pane-hd" }, [dot, repoSel, modeSel, histBtn, el("span", { class: "ws-spacer" }), badge, closeBtn]);
    const paneRoot = el("div", { class: "ws-pane" }, [header, transcriptEl, el("div", { class: "ws-compose" }, [promptEl, sendBtn])]);

    paneRoot.addEventListener("mousedown", () => setActive(p.id));
    repoSel.addEventListener("change", () => { p.repo = repoSel.value; p.readonly = false; p.resume = null; paintPane(p); saveLayout(); });
    // Applies live: the server calls the SDK's setPermissionMode on a running session, so
    // switching mid-conversation behaves the same as switching it in the Claude Code UI.
    modeSel.addEventListener("change", () => { p.mode = modeSel.value; wsPost("control", { action: "setMode", args: { sessionKey: p.sessionKey, mode: p.mode } }); paintPane(p); saveLayout(); });
    histBtn.addEventListener("click", (e) => { e.stopPropagation(); loadHistory(p.repo || null); });
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); clearPane(p); });
    sendBtn.addEventListener("click", () => send(p));
    promptEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(p); } });

    paneUI.set(p.id, { root: paneRoot, transcriptEl, promptEl, repoSel, modeSel, usageEl: badge, dot, sendBtn });
    return paneRoot;
  }

  function paintPane(p) {
    const ui = paneUI.get(p.id); if (!ui) return;
    ui.root.classList.toggle("on", p.id === st.activeId);
    ui.root.classList.toggle("ro", !!p.readonly);
    // Keep the dropdown showing the pane's repo, injecting an option for a tree-picked
    // path that isn't a tracked repo.
    if (!Array.from(ui.repoSel.options).some((o) => o.value === (p.repo || ""))) fillRepoSelect(ui.repoSel, p.repo);
    else if (ui.repoSel.value !== (p.repo || "")) ui.repoSel.value = p.repo || "";
    if (ui.modeSel.value !== p.mode) ui.modeSel.value = p.mode;
    ui.modeSel.classList.toggle("danger", p.mode === "bypassPermissions");
    ui.modeSel.classList.toggle("plan", p.mode === "plan");
    const busy = p.status === "thinking" || p.status === "awaiting-permission";
    ui.dot.classList.toggle("on", busy);
    ui.promptEl.disabled = !!p.readonly;
    ui.sendBtn.disabled = !!p.readonly;
    ui.promptEl.placeholder = p.readonly ? "Read-only — pick the repo above or Resume from history to continue" : (p.resume ? "Resuming saved session — your next message continues it" : "Message Claude… (Ctrl+Enter)");
    const u = p.usage || {};
    ui.usageEl.textContent = (u.inputTokens || u.outputTokens) ? `${((u.inputTokens || 0) + (u.outputTokens || 0)).toLocaleString()} tok · ~${fmtUsd(u.costUsd)}` : "—";
    if (!p.transcript.length) ui.transcriptEl.replaceChildren(el("div", { class: "hint" }, [p.repo ? "Send a message — Claude runs in " + shortRepo(p.repo) + " on your machine." : "Pick a repository (dropdown, or the sidebar) to start."]));
    else ui.transcriptEl.replaceChildren(...p.transcript.map(renderItem).filter(Boolean));
    ui.transcriptEl.scrollTop = ui.transcriptEl.scrollHeight;
  }

  function setActive(id) {
    if (st.activeId === id) return;
    st.activeId = id;
    for (const p of st.panes) paneUI.get(p.id)?.root.classList.toggle("on", p.id === id);
    renderSidebar();
    saveLayout();
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
  function histItem(h, snippet) {
    const when = h.updatedAt ? new Date(h.updatedAt).toLocaleString() : "";
    const openB = el("button", { class: "ws-ico", title: "Reopen read-only" }, ["👁"]);
    const resumeB = el("button", { class: "ws-ico", title: "Resume live" }, ["▶"]);
    openB.addEventListener("click", () => reopen(h.sessionKey, "open"));
    resumeB.addEventListener("click", () => reopen(h.sessionKey, "resume"));
    return el("div", { class: "ws-hist-item" }, [
      el("div", { class: "ws-hist-line1" }, [el("b", {}, [shortRepo(h.repo) || "—"]), el("span", { class: "ws-hist-meta" }, [snippet != null ? `${h.matchCount} match(es)` : `${h.turns || 0} turn(s) · ~${fmtUsd(h.usage?.costUsd)}`])]),
      el("div", { class: "ws-hist-first" }, [snippet != null ? "…" + snippet + "…" : (h.firstPrompt || "(no prompt)")]),
      el("div", { class: "ws-hist-actions" }, [el("span", { class: "ws-hist-when" }, [when]), el("span", { class: "ws-spacer" }, []), openB, resumeB]),
    ]);
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
    const title = el("div", { class: "ws-hist-hd" }, ["History", el("span", { class: "ws-hist-scope" }, [st.historyRepo ? shortRepo(st.historyRepo) : "all repos"]), (() => { const b = el("button", { class: "ws-ico", title: "Refresh" }, ["⟳"]); b.addEventListener("click", () => { st.searchQuery = ""; st.searchResults = null; loadHistory(st.historyRepo); }); return b; })()]);
    const searching = st.searchResults !== null && st.searchQuery.trim();
    const rows = searching
      ? (st.searchResults.length ? st.searchResults.map((h) => histItem(h, h.snippet)) : [el("div", { class: "hint" }, [`No conversation matches “${st.searchQuery.trim()}”.`])])
      : (st.history.length ? st.history.map((h) => histItem(h)) : [el("div", { class: "hint" }, ["No saved conversations yet."])]);
    histList.replaceChildren(title, searchBox, ...rows);
    if (searchBox.value) { searchBox.focus(); searchBox.setSelectionRange(searchBox.value.length, searchBox.value.length); }
  }
  function reopen(sessionKey, mode) {
    const p = activePane(); if (!p) { note("Open a pane first."); return; }
    st.pendingOpens.set(sessionKey, { paneId: p.id, mode });   // correlated by the saved key echoed back
    wsPost("control", { action: "open", args: { sessionKey } });
  }

  // ---- SSE handling --------------------------------------------------------------
  function onPayload({ kind, sessionKey, data }) {
    if (kind === "state") {
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
      if (Array.isArray(data.sessions)) for (const s of data.sessions) { const p = paneOf(s.sessionKey); if (p) { p.status = s.status || p.status; if (s.mode) p.mode = s.mode; if (s.usage) p.usage = s.usage; paintPane(p); } }
      if (data.session) { const p = paneOf(data.session.sessionKey); if (p) { Object.assign(p, { status: data.session.status ?? p.status, mode: data.session.mode ?? p.mode, usage: data.session.usage ?? p.usage }); paintPane(p); } }
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
      const req = st.pendingOpens.get(sessionKey); if (!req) return;
      st.pendingOpens.delete(sessionKey);
      const p = st.panes.find((x) => x.id === req.paneId); if (!p) return;   // its pane was trimmed away
      p.transcript = data.transcript || [];
      p.repo = data.repo || p.repo;
      p.usage = data.usage || {};
      if (req.mode === "resume" || req.mode === "restore") {
        // Adopt the saved conversation's key. The pane's own key would make the work machine
        // persist the continuation to a SECOND file holding only the new turns — Claude would
        // remember everything while the stored history silently forked in two.
        const clash = st.panes.find((x) => x !== p && x.sessionKey === sessionKey);
        if (clash) { p.readonly = true; p.resume = null; note("That conversation is already open in another pane — reopened read-only here."); }
        else {
          p.sessionKey = sessionKey; p.readonly = false; p.resume = data.sessionId || null;
          if (req.mode === "resume") note("Resuming — your next message continues this session.");
        }
      } else { p.readonly = true; p.resume = null; note("Reopened read-only. Pick the repo or Resume to continue."); }
      paintPane(p); setUsageTotal(); saveLayout();
      return;
    }
    if (kind === "event") {
      // Workspace-level notices (create/error) carry no sessionKey.
      if (!sessionKey && (data.kind === "created" || data.kind === "error")) {
        note(data.kind === "created" ? `Created ${data.what}: ${data.path}` : ("⚠ " + data.message));
        if (data.kind === "created") { wsPost("control", { action: "list" }); wsPost("control", { action: "tree" }); }
        return;
      }
      // A streamed event ALWAYS carries its session's key. Route strictly by it; drop frames
      // for a pane that no longer exists (e.g. trimmed by the layout picker) rather than
      // spilling another session's output into the active pane.
      const p = sessionKey ? paneOf(sessionKey) : activePane(); if (!p) return;
      if (data.kind === "status") { p.status = data.status; paintPane(p); return; }
      p.transcript.push(data);
      if (data.usageTotal) p.usage = data.usageTotal;
      paintPane(p); setUsageTotal();
    }
  }
  function primeControls() { wsPost("control", { action: "list" }); wsPost("control", { action: "tree" }); wsPost("control", { action: "history", args: {} }); wsPost("control", { action: "dataSizes" }); }
  function openStream() {
    try { WS_ES && WS_ES.close(); } catch {}
    WS_ES = new EventSource("/api/workspace/stream");
    WS_ES.addEventListener("hello", (e) => {
      // The stream is now subscribed — only NOW request the initial state, so the bridge's
      // reply can't race an unsubscribed stream (it would be dropped silently).
      try { const d = JSON.parse(e.data); if (d.localConnected) { bridgeNote.hidden = true; bridgeNote.textContent = ""; } else note("The work machine isn't connected — start the local dashboard + relay."); } catch {}
      primeControls();
    });
    WS_ES.onmessage = (e) => { try { onPayload(JSON.parse(e.data)); } catch {} };
    WS_ES.onerror = () => note("Stream interrupted — retrying…");
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
  async function send(p) {
    if (p.readonly) return;
    const ui = paneUI.get(p.id); const text = ui.promptEl.value.trim(); if (!text) return;
    if (!p.repo) { note("Pick a repository for this pane first."); return; }
    p.transcript.push({ role: "user", text }); ui.promptEl.value = ""; paintPane(p);
    const body = { sessionKey: p.sessionKey, repo: p.repo, text, mode: p.mode };
    if (p.resume) { body.resume = p.resume; p.resume = null; }
    const r = await wsPost("prompt", body);
    if (!r.ok) { p.transcript.push({ kind: "error", text: r.message || "Could not reach the work machine." }); paintPane(p); }
  }

  // ---- toolbar controls ----------------------------------------------------------
  // A spreadsheet-style size picker: hover to preview the grid, click to apply. 16 buttons
  // beats 16 numbered ones, and it reads as "columns × rows" at a glance.
  const layoutPicker = el("div", { class: "ws-layout" }, []);
  function renderLayoutPicker(hoverC, hoverR) {
    const cells = [];
    for (let r = 1; r <= WS_MAX_ROWS; r++) for (let c = 1; c <= WS_MAX_COLS; c++) {
      const inHover = hoverC ? (c <= hoverC && r <= hoverR) : false;
      const inCur = c <= st.cols && r <= st.rows;
      const b = el("button", { class: "ws-cell" + (inCur ? " on" : "") + (inHover ? " hov" : ""), title: `${c} × ${r}`,
        style: `grid-column:${c};grid-row:${r}` }, []);
      b.addEventListener("mouseenter", () => renderLayoutPicker(c, r));
      b.addEventListener("click", () => setLayout(c, r));
      cells.push(b);
    }
    const shown = hoverC ? `${hoverC} × ${hoverR}` : `${st.cols} × ${st.rows}`;
    layoutPicker.replaceChildren(
      el("span", { class: "ws-layout-lbl" }, ["Panes"]),
      el("div", { class: "ws-cellgrid" }, cells),
      el("span", { class: "ws-layout-n" }, [shown]),
    );
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
  const backupBtn = el("button", { class: "ghost", id: "btnBackup" }, ["💾 Back up now"]);
  const mpBtn = el("button", { class: "ghost", id: "btnMP" }, ["⚙ master-pollinate (dry-run)"]);
  const forceWrap = el("label", { style: "font-size:11px;color:var(--ink-dim);display:inline-flex;gap:5px;align-items:center" }, [el("input", { type: "checkbox", id: "forceBk" }), "force (ignore activity gate)"]);
  const controls = el("div", { class: "graph-controls" }, [backupBtn, mpBtn, forceWrap]);

  /* --- automated daily backup: toggle, location, schedule, state --- */
  const schedBox = el("div", { class: "movecard", style: "margin-top:10px" }, [el("div", { class: "hint" }, ["Loading backup settings…"])]);
  async function loadSched() {
    let s; try { s = await (await fetch("/api/backup/config")).json(); } catch { return; }
    const c = s.config || {};
    const toggle = el("input", { type: "checkbox", id: "bkEnabled" });
    if (c.enabled) toggle.setAttribute("checked", "checked");
    const loc = el("input", { type: "text", id: "bkLoc", value: c.location || "",
      style: "flex:1;min-width:200px;background:var(--chip);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:5px 9px;font-family:ui-monospace,monospace;font-size:12px" });
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

    const stateBits = [];
    stateBits.push(el("span", { style: `font-weight:700;color:${c.enabled ? "#34d399" : "#94a3b8"}` }, [c.enabled ? "● ON" : "○ OFF"]));
    if (c.enabled) stateBits.push(el("span", { class: "was" }, [`  runs daily at ${String(c.hour).padStart(2, "0")}:00 when the suite is idle`]));
    if (c.lastRunDate) stateBits.push(el("span", { class: "was" }, [`  · last auto-run ${c.lastRunDate}`]));
    if (s.schedule?.lastAutoRun?.deferred) stateBits.push(el("span", { style: "color:#fbbf24" }, ["  · deferred (agent active) — will catch up when idle"]));

    schedBox.replaceChildren(
      el("div", { class: "desc" }, [el("b", {}, ["Automated daily backup"])]),
      el("div", { style: "display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:6px 0" }, [
        el("label", { style: "display:inline-flex;align-items:center;gap:6px;font-size:13px" }, [toggle, "Enabled"]),
        el("div", { style: "display:flex;align-items:center;gap:6px;flex:1;min-width:220px" }, [el("span", { class: "was" }, ["location"]), loc]),
        el("div", { style: "display:flex;align-items:center;gap:6px" }, [el("span", { class: "was" }, ["hour"]), hour, el("span", { class: "was" }, [":00"])]),
        saveBtn,
      ]),
      el("div", { style: "font-size:12px" }, stateBits),
      el("div", { class: "hint", style: "margin-top:4px" }, ["The scheduler runs inside this dashboard, so keep it open (or auto-started) for daily backups. It writes to the location above — any drive or folder — and skips itself while an agent is working."]),
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
    await post("/api/backup" + ($("#forceBk").checked ? "?force=1" : ""), backupBtn, "Backup");
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

  async function refreshArchives() {
    let d;
    try { d = await (await fetch("/api/backups")).json(); } catch { return; }
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
    // gate the buttons on idle unless force
    backupBtn.disabled = !idle && !$("#forceBk").checked;
    mpBtn.disabled = !idle;
    $("#opsStatus").replaceChildren(
      el("div", { class: "statbar" }, [
        el("div", { class: "stat" }, [el("div", { class: "n", style: `color:${color}` }, [idle ? "IDLE" : "ACTIVE"]), el("div", { class: "l" }, ["suite status"])]),
        el("div", { class: "stat" }, [el("div", { class: "n" }, [String(a.liveSessionCount || 0)]), el("div", { class: "l" }, ["live sessions"])]),
        el("div", { class: "stat" }, [el("div", { class: "n" }, [a.activeRepos && a.activeRepos.length ? a.activeRepos.join(", ") : "—"]), el("div", { class: "l" }, ["active repos"])]),
        el("div", { class: "stat" }, [el("div", { class: "n", style: "font-size:13px" }, [lb ? (lb.ok ? "✅ " : "❌ ") + (lb.finishedAt || "").slice(0, 16).replace("T", " ") : "never"]), el("div", { class: "l" }, ["last backup"])]),
      ]),
      el("div", { class: "hint" }, [idle
        ? "Suite is idle — backup and master-pollinate are enabled. Backup writes a dated tar archive to the configured backup location (excludes node_modules/.next/dist; keeps .git, .secrets and uncommitted work)."
        : "An agent is working — buttons gated until idle. Backup can be forced with the checkbox."]),
      activityView(a),
    );
  }
  refresh(); OPS_TIMER = setInterval(refresh, 4000);
  refreshArchives();
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
