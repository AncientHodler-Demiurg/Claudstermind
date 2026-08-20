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
// `icon` (emoji, dependency-free) + `short` drive the mobile bottom tab bar / tier-2 drawer, where
// an icon + micro-label replaces the wide text buttons; desktop still renders the full text labels.
const SECTIONS = [
  { id: "overview", label: "Overview", icon: "🏠", view: "overview" },
  { id: "map", label: "Map", icon: "🗺", subs: [
    { id: "tree", label: "Tree", icon: "🌳", short: "Tree", view: "tree" },
    { id: "matrix", label: "Org × Role", icon: "▦", short: "Roles", view: "matrix" },
    { id: "graph", label: "Dependency graph", icon: "🕸", short: "Graph", view: "graph" },
    { id: "movements", label: "Movements", icon: "🔁", short: "Moves", view: "movements" },
    { id: "packages", label: "Packages", icon: "📦", short: "Packages", view: "packages" },
  ] },
  { id: "activity", label: "Activity", icon: "📈", view: "activity" },
  { id: "pipeline", label: "Pipeline", icon: "🔀", subs: [
    { id: "cascade", label: "Cascade", icon: "🌊", short: "Cascade", view: "cascade" },
    { id: "git", label: "Git state", icon: "🌿", short: "Git", view: "git" },
  ] },
  { id: "brain", label: "Brain", icon: "🧠", view: "brain" },
  { id: "workspace", label: "Workspace", icon: "💬", view: "workspace", gate: () => ME.canExecute && (ME.mode === "live" || ME.mode === "local"), subs: [
    { id: "core", label: "Core", icon: "💬", short: "Core", view: "workspace" },
    { id: "pact", label: "Pact", icon: "⬡", short: "Pact", view: "pact" },
    { id: "usage", label: "Usage", icon: "📊", short: "Usage", view: "usage" },
    { id: "mirror", label: "Mirror", icon: "🪞", short: "Mirror", view: "mirror" },
    { id: "localhost", label: "LocalHost", icon: "🌐", short: "Host", view: "localhost" },
  ] },
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
  // The "Signed in as" prefix is wrapped so mobile CSS can drop it (and truncate the name) to keep
  // a long email from overflowing the header — see the mobile block in styles.css.
  // A small session pill: shows how long you're kept logged in (auto-renews while the tab is used), or
  // "session ended" if the login lapsed. Filled by renderSessionPill (also ticked on a timer).
  const sessionPill = el("span", { id: "phSession", class: "ph-session" }, []);
  host.replaceChildren(el("span", { class: "ph-id-name" }, [el("span", { class: "ph-id-prefix" }, ["Signed in as "]), nameB]), roleBadge(isAncient ? "ancient" : ((ME.roles || [])[0] || "member")), sessionPill, adminLink(isAncient), el("a", { class: "ph-btn --ghost --sm ph-logout", href: "/auth/logout" }, ["Log out"]));
  renderSessionPill();
}
// Show a "local-only engine" badge next to the version pill when THIS dashboard runs its OWN in-process
// agent engine (not the shared sessiond daemon) — the state that makes a prompt sent here invisible to your
// other clients (e.g. your phone) until the turn finishes and persists. Cleared on sessiond, or when the
// field is absent (e.g. the relay). The at-a-glance diagnostic for the localhost↔remote desync.
function showEngineBadge(engine) {
  const existing = document.getElementById("phEngineBadge");
  if (existing) existing.remove();
  if (engine !== "in-process") return;
  const vc = document.getElementById("phVer");
  if (!vc || !vc.parentNode) return;
  const b = el("span", { id: "phEngineBadge", class: "ph-engine-badge", title: "This dashboard runs its OWN in-process agent engine — prompts sent from HERE are not shared live with your other clients (e.g. your phone) until the turn finishes and saves. Restart this dashboard with the latest code so it auto-joins the shared sessiond daemon; then this warning disappears." }, ["⚠ local-only engine"]);
  vc.parentNode.insertBefore(b, vc.nextSibling);
}
// ---- Collapse the whole top app header (.ph) to reclaim vertical working area. Implemented as a
// body class so a single flag hides the header everywhere; the toggle buttons live BELOW the header
// (Pact toolbar, Core workspace controls) so they stay reachable when it's hidden. Persisted across
// reloads in localStorage so the header stays where the user left it.
const PH_COLLAPSE_KEY = "cm.ph-collapsed";
function phHeaderCollapsed() { try { return localStorage.getItem(PH_COLLAPSE_KEY) === "1"; } catch { return false; } }
function applyPhCollapsed(on) {
  document.body.classList.toggle("ph-collapsed", !!on);
  for (const b of document.querySelectorAll(".ph-collapse-btn")) {
    b.classList.toggle("--on", !!on);
    b.title = on ? "Show the app header" : "Hide the app header to maximize the working area";
  }
}
function togglePhCollapsed() {
  const on = !document.body.classList.contains("ph-collapsed");
  try { localStorage.setItem(PH_COLLAPSE_KEY, on ? "1" : "0"); } catch { /* private mode — still toggles for the session */ }
  applyPhCollapsed(on);
}
// A toggle button for the collapse-header control — reused by the Pact toolbar and the Core workspace.
function phCollapseBtn(extraClass) {
  const b = el("button", { class: (extraClass ? extraClass + " " : "") + "ph-collapse-btn", type: "button" }, ["⤢"]);
  b.classList.toggle("--on", document.body.classList.contains("ph-collapsed"));
  b.title = document.body.classList.contains("ph-collapsed") ? "Show the app header" : "Hide the app header to maximize the working area";
  b.addEventListener("click", () => togglePhCollapsed());
  return b;
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
  renderMobileNav();
}

// Mobile navigation (phone only; CSS hides it ≥901px) — ported from OuronetUI's mobile rehaul:
//   • Tier-1 sections become a FIXED BOTTOM TAB BAR of icon + micro-label cells (thumb-reachable,
//     all visible at once — no more a horizontally-scrolling text row with the last item cut off).
//   • Tier-2 sub-views become a transient DRAWER that pops UP from the bar when you tap a section
//     that has sub-views; an outside tap or picking a sub closes it, so it never permanently eats
//     vertical space. The old top tier-1/tier-2 rows (.ph-l2/.ph-l3) are hidden on mobile.
let _mnav = null;          // cached { backdrop, drawer, bar } shell, built once
let _mnavOpen = null;      // id of the tier-1 section whose tier-2 drawer is currently open (or null)
function renderMobileNav() {
  if (!_mnav) {
    const backdrop = el("div", { class: "ph-tabbar-backdrop" });
    backdrop.addEventListener("click", () => { _mnavOpen = null; renderMobileNav(); });
    const drawer = el("div", { class: "ph-tabdrawer" });
    const bar = el("nav", { class: "ph-tabbar", "aria-label": "Sections" });
    document.body.append(backdrop, drawer, bar);
    _mnav = { backdrop, drawer, bar };
  }
  const { backdrop, drawer, bar } = _mnav;
  const secs = SECTIONS.filter((s) => !s.gate || s.gate());
  // If the open section got gated away (e.g. mode change), forget it so nothing renders stale.
  if (_mnavOpen && !secs.some((s) => s.id === _mnavOpen)) _mnavOpen = null;

  // Tier-1 tab bar
  bar.replaceChildren(...secs.map((s) => {
    const active = !ROUTE.admin && ROUTE.section === s.id;
    const hasSubs = !!(s.subs && s.subs.length);
    const isOpen = _mnavOpen === s.id;
    const cell = el("button", { class: "ph-tab" + (active ? " --active" : "") + (isOpen ? " --open" : ""), title: s.label, type: "button" }, [
      el("span", { class: "ph-tab-ic" }, [s.icon || "•"]),
      el("span", { class: "ph-tab-lbl" }, [s.label]),
    ]);
    cell.addEventListener("click", () => {
      // A section WITH sub-views toggles its drawer (pick a sub to navigate); a leaf navigates
      // directly and closes any open drawer.
      if (hasSubs) { _mnavOpen = isOpen ? null : s.id; renderMobileNav(); }
      else { _mnavOpen = null; location.hash = "#" + s.id; }
    });
    return cell;
  }));

  // Tier-2 drawer for the open section
  const openSec = _mnavOpen ? secs.find((s) => s.id === _mnavOpen) : null;
  const subs = (openSec && openSec.subs) ? openSec.subs : [];
  const shown = subs.length > 0;
  if (shown) {
    const activeSub = (!ROUTE.admin && ROUTE.section === openSec.id) ? (ROUTE.sub || subs[0].id) : null;
    drawer.replaceChildren(el("div", { class: "ph-tabdrawer-grid" }, subs.map((sub) => {
      const cell = el("button", { class: "ph-tabsub" + (activeSub === sub.id ? " --active" : ""), title: sub.label, type: "button" }, [
        el("span", { class: "ph-tab-ic" }, [sub.icon || "•"]),
        el("span", { class: "ph-tabsub-lbl" }, [sub.short || sub.label]),
      ]);
      cell.addEventListener("click", () => { _mnavOpen = null; location.hash = `#${openSec.id}/${sub.id}`; });
      return cell;
    })));
  } else {
    drawer.replaceChildren();
  }
  drawer.classList.toggle("--shown", shown);
  backdrop.classList.toggle("--shown", shown);
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
  try { const v = await (await fetch("/api/version", { cache: "no-store" })).json(); const vc = $("#phVer"); if (vc) { vc.textContent = "v" + v.version; vc.title = `v${v.version}${v.gitSha ? " · " + v.gitSha : ""}${v.builtAt ? " · " + v.builtAt : ""}${v.engine ? " · engine: " + v.engine : ""}`; } showEngineBadge(v.engine); } catch {}

  applyPhCollapsed(phHeaderCollapsed());   // restore the collapsed-header preference before first paint
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
    sessionStartKeepAlive();   // slide the login while this tab is used; surface the countdown + expiry
    setInterval(async () => {
      let next; try { next = await (await fetch("/api/me", { cache: "no-store" })).json(); } catch { return; }
      const flipped = next.localConnected !== ME.localConnected || next.localActionsAvailable !== ME.localActionsAvailable;
      next._fetchedAt = Date.now();
      ME = next;
      // Track login health from the poll too, so a silent expiry is caught WITHOUT waiting for a send.
      if (typeof next.sessionExpiresAt === "number") SESSION_EXP = next.sessionExpiresAt;
      sessionSetExpired(next.authenticated === false);
      renderHeader();
      renderSessionPill();
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
  if (VIEW !== "workspace" && WS_ES) { try { WS_ES.close(); } catch {} WS_ES = null; if (WS_HEAL_TIMER) { clearInterval(WS_HEAL_TIMER); WS_HEAL_TIMER = null; } }
  if (!(VIEW === "admin" && ADMIN_SECTION === "deploy") && DEPLOY_ES) { try { DEPLOY_ES.close(); } catch {} DEPLOY_ES = null; }
  if (!(VIEW === "admin" && ADMIN_SECTION === "deploy") && RESTART_ES) { try { RESTART_ES.close(); } catch {} RESTART_ES = null; }
  if (VIEW !== "git" && GIT_TIMER) { clearInterval(GIT_TIMER); GIT_TIMER = null; }
  if (VIEW !== "localhost" && LH_TIMER) { clearInterval(LH_TIMER); LH_TIMER = null; }
  if (VIEW !== "pact" && typeof PACT_RUN_ES !== "undefined" && PACT_RUN_ES) { try { PACT_RUN_ES.close(); } catch {} PACT_RUN_ES = null; }
  if (VIEW !== "pact" && typeof PACT_CHAT !== "undefined" && PACT_CHAT) { pactChatStop(); }
  if (VIEW !== "usage") usageStop();   // close the Usage tab's SSE stream when leaving it
  document.body.classList.toggle("ws-full", VIEW === "workspace" || VIEW === "pact");   // full-height cockpit views
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
  else if (VIEW === "pact") v.replaceChildren(viewPact());
  else if (VIEW === "brain") v.replaceChildren(viewBrain());
  else if (VIEW === "tree") v.replaceChildren(viewTree());
  else if (VIEW === "admin") v.replaceChildren(viewAdmin(ADMIN_SECTION));
  else if (VIEW === "mirror") v.replaceChildren(viewMirror());
  else if (VIEW === "localhost") v.replaceChildren(viewLocalHost());
  else if (VIEW === "usage") v.replaceChildren(viewUsage());
}

/* ---------- Usage & Keys (Workspace → Usage): multi-key OAuth + plan rate-limit viewer + failover ----- */
let USAGE_ES = null;
function usageStop() { try { USAGE_ES && USAGE_ES.close(); } catch {} USAGE_ES = null; }
function viewUsage() {
  const list = el("div", { class: "usage-keys" }, [el("div", { class: "hint", style: "padding:12px" }, ["Loading keys…"])]);
  const refreshBtn = el("button", { class: "loginbtn secondary" }, ["↻ Refresh"]);
  refreshBtn.addEventListener("click", () => { wsPost("control", { action: "usageLimits" }); wsPost("control", { action: "keysUsage" }); refreshBtn.textContent = "↻ Refreshing…"; setTimeout(() => { refreshBtn.textContent = "↻ Refresh"; }, 1200); });
  const pct = (w) => (w && typeof w.utilization === "number") ? Math.round(w.utilization) : null;
  function bar(label, val, resetAt) {
    const row = [el("span", { class: "usage-bar-lbl" }, [label])];
    if (val === null) { row.push(el("span", { class: "hint" }, ["— no data yet"])); return el("div", { class: "usage-bar-row" }, row); }
    const cls = val >= 95 ? " --hot" : val >= 80 ? " --warn" : "";
    row.push(
      el("div", { class: "usage-bar" }, [el("div", { class: "usage-bar-fill" + cls, style: `width:${Math.min(100, Math.max(0, val))}%` }, [])]),
      el("span", { class: "usage-bar-pct" + cls }, [val + "%"]),
      resetAt ? el("span", { class: "usage-bar-reset hint" }, ["resets " + new Date(resetAt).toLocaleString()]) : "",
    );
    return el("div", { class: "usage-bar-row" }, row);
  }
  function card(r) {
    const rl = r.limits && r.limits.rate_limits;
    // Account identity this key authenticates as (email / subscription), when the SDK surfaces it —
    // needs the user:profile scope, so often absent for a setup-token. Shown next to the fingerprint.
    const acct = r.account && (r.account.email || r.account.subscriptionType) ? el("span", { class: "usage-key-acct", title: "Claude account this key is tied to" }, [
      [r.account.email, r.account.subscriptionType].filter(Boolean).join(" · "),
    ]) : "";
    const head = el("div", { class: "usage-key-hd" }, [
      el("span", { class: "usage-key-name" }, [r.name]),
      el("code", { class: "usage-key-fp" }, [r.fingerprint]),
      acct,
      el("span", { class: "ws-spacer" }, []),
      r.active ? el("span", { class: "usage-key-badge --active" }, ["● active"]) : "",
      r.exhausted ? el("span", { class: "usage-key-badge --exhausted" }, ["⚠ exhausted" + (r.exhaustedUntil ? " · frees " + new Date(r.exhaustedUntil).toLocaleTimeString() : "")]) : "",
    ]);
    let bars;
    if (rl) {
      bars = [bar("5-hour", pct(rl.five_hour), rl.five_hour && rl.five_hour.resets_at), bar("7-day", pct(rl.seven_day), rl.seven_day && rl.seven_day.resets_at)];
    } else if (r.checked && !r.available) {
      // The SDK answered but this key has no plan rate-limits (API-key/Bedrock/Vertex auth, or the token
      // was minted without the plan-usage scope). No percentages will ever come — say so, don't imply waiting.
      bars = [el("div", { class: "usage-unavail" }, ["⛔ Plan usage isn't available for this key. Tokens minted by ", el("code", {}, ["claude setup-token"]), " only carry the ", el("code", {}, ["user:inference"]), " scope; plan rate-limits need ", el("code", {}, ["user:profile"]), ", which only the interactive ", el("code", {}, ["claude /login"]), " (or Claude Desktop) login grants. Re-minting a setup-token can't add it. Error-based failover still works regardless."])];
    } else {
      bars = [el("div", { class: "hint", style: "padding:4px 0" }, ["No usage recorded yet — run a turn on this key (or hit ↻ Refresh) to populate it."])];
    }
    if (rl && pct(rl.seven_day_opus) !== null) bars.push(bar("7-day · Opus", pct(rl.seven_day_opus), null));
    if (rl && pct(rl.seven_day_sonnet) !== null) bars.push(bar("7-day · Sonnet", pct(rl.seven_day_sonnet), null));
    return el("div", { class: "usage-key-card" + (r.active ? " --active" : "") + (r.exhausted ? " --exhausted" : "") }, [head, ...bars]);
  }
  function render(rows) {
    if (!rows || !rows.length) { list.replaceChildren(el("div", { class: "hint", style: "padding:12px" }, ["No OAuth keys configured. Add one or more to ", el("code", {}, [".secrets/claude-oauth-keys.csv"]), " — one per line: ", el("code", {}, ["<token> ; <name>"]), "."])); return; }
    list.replaceChildren(...rows.map(card));
  }
  // Live: open a workspace SSE stream, ask for the key list + a usage refresh, render on the state frame.
  usageStop();
  const q = "?conn=" + encodeURIComponent(wsUuid() + ":usage") + "&label=" + encodeURIComponent("usage");
  let es; try { es = new EventSource("/api/workspace/stream" + q); USAGE_ES = es; } catch {}
  if (es) {
    es.addEventListener("hello", () => { wsPost("control", { action: "keysUsage" }); wsPost("control", { action: "usageLimits" }); });
    es.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m && m.kind === "state" && m.data && Array.isArray(m.data.keysUsage)) render(m.data.keysUsage); };
  }
  return el("div", { class: "usage-view" }, [
    el("h2", { class: "deploy-h" }, ["📊 Usage & Keys"]),
    el("div", { class: "hint" }, ["Plan rate-limit utilization per OAuth key. New turns run on the active key; when a key's 5-hour or weekly limit is hit, they fall over to the next key automatically."]),
    el("div", { class: "usage-actions" }, [refreshBtn]),
    list,
    el("div", { class: "usage-note hint" }, ["Keys live in ", el("code", {}, [".secrets/claude-oauth-keys.csv"]), " — one per line, ", el("code", {}, ["<token> ; <name>"]), ". Add a line to add a key; edit after the ", el("code", {}, [";"]), " to rename. Utilization is the SDK's experimental plan-limit surface and may be unavailable until a key has run a turn."]),
  ]);
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
    if (opts && opts.onLine) { try { opts.onLine(line); } catch {} }   // drive the step-by-step progress view
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
async function pollBackUp(noteEl, { attempts = 40 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, DeployHelpers.pollBackoff(i, { baseMs: 1000, maxMs: 5000 })));
    try {
      const v = await (await fetch("/api/version", { cache: "no-store", signal: AbortSignal.timeout(2000) })).json();
      if (v && v.version) { noteEl.textContent = "✓ Back up — v" + v.version + " reconnected."; return v.version; }
    } catch { /* still down or unreachable through the tunnel — keep polling */ }
  }
  noteEl.textContent = "⚠ Restart triggered, but the dashboard hasn't answered again after a minute — check it manually.";
  return null;
}

/** A restart/deploy that settled successfully means the code on this page is now stale — reload the
 *  whole page after a short, visible beat (Explorer-style) so the operator lands on the fresh build
 *  and any leftover progress UI is cleared for free. Isolated so tests / a caller can stub it. */
function reloadSoon(noteEl, ms = 2500) {
  if (noteEl) noteEl.textContent += " Reloading…";
  setTimeout(() => { try { location.reload(); } catch {} }, ms);
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
      if (st?.live?.version === expectedVersion) { noteEl.textContent = "✓ Deploy finished — live is now v" + expectedVersion + "."; return true; }
    } catch { /* still mid-swap, or briefly unreachable — keep polling */ }
  }
  noteEl.textContent = "⚠ No confirmation received — check the version chip manually.";
  return false;
}

/** A polished, StoaExplorer-style step-by-step progress view driven by the existing deploy/restart
 *  SSE log stream (openLogStream feeds it each line via opts.onLine). The log is unstructured text,
 *  so phases are recognized by matching known per-step markers the server already prints (deploy:
 *  "── Package ──" …; restart: the pre-flight / trigger lines). Marks + colors mirror StoaExplorer
 *  (○ pending · ◐ running · ● done · ✕ failed) but use Claudstermind's dark-theme classes. Elapsed
 *  timers tick per-second while running and freeze when the run settles. The raw log stays available
 *  in a collapsible "Full log" the caller wires below. */
function makeProgress(phaseDefs) {
  const state = phaseDefs.map((d) => ({ id: d.id, label: d.label, match: d.match, status: "pending", startedAt: null, endedAt: null }));
  const MARK = { pending: "○", running: "◐", done: "●", failed: "✕", waiting: "◐" };
  const STATUS_TEXT = { idle: "Ready when you are.", running: "Running…", waiting: "Waiting for the service to come back…", ok: "Complete.", failed: "Failed — the previous version is still serving. See the log." };
  let runStatus = "idle", runStart = null, runEnd = null, current = -1, tick = null;

  const hd = el("div", { class: "dp-hd" }, []);
  const list = el("ol", { class: "dp-list" }, []);
  const wrap = el("div", { class: "dp-progress" }, [hd, list]);

  const fmt = (ms) => {
    if (ms == null || ms < 0) return "—";
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return m + "m " + String(r).padStart(2, "0") + "s";
    return Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m";
  };

  function paint(now = Date.now()) {
    const totalEnd = runStatus === "running" ? now : (runEnd || now);
    hd.replaceChildren(
      el("span", { class: "dp-status dp-" + runStatus }, [STATUS_TEXT[runStatus]]),
      el("span", { class: "dp-elapsed" }, [runStart ? fmt(totalEnd - runStart) + " elapsed" : ""]),
    );
    list.replaceChildren(...state.map((p) => {
      const end = p.endedAt != null ? p.endedAt : (p.status === "running" ? now : null);
      const dur = p.startedAt != null && end != null ? end - p.startedAt : null;
      return el("li", { class: "dp-step dp-" + p.status }, [
        el("span", { class: "dp-mark", "aria-hidden": "true" }, [MARK[p.status]]),
        el("span", { class: "dp-label" }, [p.label]),
        el("span", { class: "dp-time" }, [p.status === "pending" ? "" : fmt(dur)]),
      ]);
    }));
  }
  const startTick = () => { if (!tick) tick = setInterval(() => paint(), 1000); };
  const stopTick = () => { if (tick) { clearInterval(tick); tick = null; } };

  function reset() {
    stopTick();
    for (const p of state) { p.status = "pending"; p.startedAt = null; p.endedAt = null; }
    runStatus = "idle"; runStart = null; runEnd = null; current = -1;
    paint();
  }
  function onLine(line) {
    const now = Date.now();
    if (runStatus === "idle") { runStatus = "running"; runStart = now; startTick(); }
    for (let i = 0; i < state.length; i++) {
      if (i > current && state[i].match.test(line)) {
        for (let j = current + 1; j < i; j++) { if (state[j].startedAt == null) state[j].startedAt = now; state[j].endedAt = now; state[j].status = "done"; }
        if (current >= 0 && state[current].status === "running") { state[current].endedAt = now; state[current].status = "done"; }
        state[i].startedAt = now; state[i].status = "running"; current = i;
        break;
      }
    }
    paint(now);
  }
  // Freeze the elapsed timer and hold the current phase as in-progress while we wait out-of-band
  // for the service to answer again (a real restart kills THIS process, so the SSE stream can never
  // deliver a completion sentinel — the elapsed counter would otherwise tick forever). `runEnd` is
  // pinned to now so paint() stops advancing the header/step timers; the header shows `msg`.
  function waiting(msg) {
    const now = Date.now();
    stopTick();
    if (runStatus === "idle") { runStatus = "running"; runStart = now; }   // a stream that closed before any line still gets a start
    runEnd = now;
    runStatus = "waiting";
    if (msg) STATUS_TEXT.waiting = msg;
    // Anchor a per-step end so the running step's timer freezes at this instant too.
    if (current >= 0 && state[current].status === "running") state[current].endedAt = now;
    paint(now);
  }
  function done(ok) {
    const now = Date.now();
    stopTick(); runEnd = now; runStatus = ok ? "ok" : "failed";
    if (ok) { for (const p of state) { if (p.status !== "done") { if (p.startedAt == null) p.startedAt = now; p.endedAt = now; p.status = "done"; } } }
    else if (current >= 0) { state[current].endedAt = now; state[current].status = "failed"; }
    paint(now);
  }
  paint();
  return { wrap, onLine, done, waiting, reset };
}
const DEPLOY_PHASES = [
  { id: "package", label: "Package the build", match: /── Package ──/ },
  { id: "ship", label: "Ship to the host", match: /── Ship ──/ },
  { id: "rebuild", label: "Rebuild image + blue-green swap", match: /── Rebuild ──/ },
  { id: "cleanup", label: "Clean up", match: /── Cleanup ──/ },
];
const RESTART_PHASES = [
  { id: "preflight", label: "Sandboxed pre-flight", match: /pre-flight/ },
  { id: "restart", label: "Restart the service", match: /triggering the real restart|restart triggered/ },
];

function viewDeploy() {
  const root = el("div", { class: "deploy-wrap" }, []);
  // The deploy admin is a "terminator-style" split: Reload on the LEFT, Deploy on the RIGHT, each a
  // self-contained column (action card → progress checker → its own black terminal). These boxes are
  // filled by refresh()/refreshProcesses() below; the split + tabs are assembled at the very end.
  const pendingHd = el("div", { class: "deploy-pending-hd" }, [el("div", { class: "hint" }, ["Loading version state…"])]);
  const reloadCardBox = el("div", { class: "deploy-cardbox" }, [el("div", { class: "hint" }, ["Loading…"])]);
  const deployCardBox = el("div", { class: "deploy-cardbox" }, [el("div", { class: "hint" }, ["Loading…"])]);
  const term = el("pre", { class: "deploy-term" }, ["(no deploy run yet)"]);
  const actions = el("div", { class: "deploy-actions" }, []);
  const note = el("div", { class: "hint" }, []);

  // "What this deploy restarts" banner + the live process list (deploy-survivable agents W4). The
  // banner mirrors the server's deployPlan over the pending changed files: web-only (agents keep
  // running) vs also-the-agent-engine (agents interrupted). `LAST_PROC` caches the last fetch so
  // the deploy guard can read it, but the guard also re-fetches at click time so it's never stale.
  const restartBanner = el("div", { class: "deploy-restart-banner" }, [el("div", { class: "hint" }, ["Checking what this deploy restarts…"])]);
  // Reload's own "what this restarts" banner — a reload always interrupts local agents, so it's a
  // fixed statement (unlike Deploy's, which depends on the changed files' plan).
  // Filled dynamically by refreshProcesses from `reloadDaemonAffected`: a reload that changes engine
  // code also restarts sessiond (interrupts running agents); a web/client-only reload keeps the engine
  // and every running agent alive (a pending prompt is NOT lost).
  const reloadBannerHd = el("div", { class: "deploy-restart-hd" }, ["⚠ What a Reload restarts"]);
  const reloadBannerTxt = el("div", { class: "deploy-restart-txt" }, ["Checking what this reload restarts…"]);
  const reloadBanner = el("div", { class: "deploy-restart-banner" }, [reloadBannerHd, reloadBannerTxt]);
  const procBox = el("div", { class: "deploy-proc" }, [el("div", { class: "hint" }, ["Loading running processes…"])]);
  let LAST_PROC = null;

  const PROC_ICON = { running: "●", stopped: "◐", "not-installed": "○", unknown: "◌" };
  async function refreshProcesses() {
    let d = {};
    try { d = await (await fetch("/api/admin/processes", { cache: "no-store" })).json(); } catch { d = { ok: false }; }
    LAST_PROC = d;
    // Reload banner: engine-affecting reloads restart sessiond (interrupt agents); web-only reloads
    // keep the engine + every running agent alive. `reloadDaemonAffected` defaults to the safe
    // (interrupts) reading when the plan couldn't be computed.
    const reloadHitsEngine = d.reloadDaemonAffected !== false;
    reloadBanner.className = "deploy-restart-banner " + (reloadHitsEngine ? "--warn" : "--safe");
    reloadBannerHd.textContent = (reloadHitsEngine ? "⚠ " : "✓ ") + "What a Reload restarts";
    reloadBannerTxt.textContent = reloadHitsEngine
      ? "Engine code changed — this Reload restarts BOTH the web and the session engine (sessiond), so it picks up all on-disk code. Any agents running here are interrupted (a pending prompt mid-turn is lost)."
      : "Web/client-only change — this Reload restarts just the web. The session engine and every running agent keep going, so a pending prompt is preserved.";
    const b = d.banner || { tone: "safe", text: "Deploy impact unknown — the process list couldn't be read." };
    restartBanner.className = "deploy-restart-banner " + (b.tone === "warn" ? "--warn" : "--safe");
    const restarts = (d.plan && d.plan.restarts) || ["web"];
    restartBanner.replaceChildren(
      el("div", { class: "deploy-restart-hd" }, [(b.tone === "warn" ? "⚠ " : "✓ ") + "What this deploy restarts"]),
      el("div", { class: "deploy-restart-txt" }, [b.text]),
      el("div", { class: "deploy-restart-meta" }, [
        "Restarts: " + restarts.join(" + "),
        d.changedFiles ? el("span", {}, ["  ·  " + d.changedFiles.length + " changed file(s)"]) : "",
        d.busy && d.busy.count ? el("span", { class: "deploy-restart-busy" }, ["  ·  " + d.busy.count + " agent(s) working"]) : "",
      ]),
    );
    const procRow = (p) => el("div", { class: "deploy-proc-row" }, [
      el("span", { class: "deploy-proc-dot --" + (p.status || "unknown") }, [PROC_ICON[p.status] || "◌"]),
      el("div", { class: "deploy-proc-main" }, [
        el("span", { class: "deploy-proc-name" }, [p.name || p.key]),
        el("span", { class: "deploy-proc-role" }, [p.role || ""]),
      ]),
      el("span", { class: "deploy-proc-detail" }, [p.detail || p.status || ""]),
    ]);
    // Claudstermind CORE processes (the web service + the claudstermind-sessiond daemon, flagged
    // `core: true` server-side) always show — even when stopped / not-installed — so the daemon row
    // is visible by default (as "unit not installed") rather than buried. Everything else (the
    // aggregator's localhost apps) collapses behind an "N others — show" toggle, running or not.
    // Partition is a pure, unit-tested helper.
    const { core, others, othersCount } = DeployHelpers.partitionProcesses(d.processes || []);
    const kids = [el("div", { class: "deploy-card-t" }, ["Claudstermind core"])];
    if (core.length) kids.push(...core.map(procRow));
    else kids.push(el("div", { class: "hint" }, [d.ok === false ? "Process list unavailable." : "No core processes reported."]));
    if (othersCount) {
      const othBox = el("div", { class: "deploy-proc-dormant", hidden: "" }, others.map(procRow));
      let open = false;
      const toggle = el("button", { class: "deploy-proc-more", onclick: () => {
        open = !open; othBox.hidden = !open;
        toggle.textContent = open ? "▾ " + othersCount + " others — hide" : "▸ " + othersCount + " others — show";
      } }, ["▸ " + othersCount + " others — show"]);
      kids.push(toggle, othBox);
    }
    procBox.replaceChildren(...kids);
  }

  // Drain: wait for the agent engine to go IDLE (no in-flight turns) before an engine-restarting deploy, so
  // it can't cut a live turn short — the fix for "I deployed and it killed my running turn". Polls the same
  // authoritative busy count the guard uses; a new turn starting just keeps the wait going until it's quiet.
  // Resolves true (idle → deploy), "now" (deploy immediately anyway), or false (cancel). Live count + Esc/Cancel.
  function deployWaitForIdle() {
    return new Promise((resolve) => {
      let done = false, timer = null;
      const countEl = el("span", { class: "deploy-drain-count" }, ["(checking…)"]);
      const finish = (r) => { if (done) return; done = true; clearTimeout(timer); document.removeEventListener("keydown", onKey); overlay.remove(); resolve(r); };
      const onKey = (e) => { if (e.key === "Escape") finish(false); };
      const nowBtn = el("button", { class: "ghost", style: "background:#f87171;border-color:#f87171" }, ["Deploy now anyway"]);
      nowBtn.addEventListener("click", () => finish("now"));
      const cancelBtn = el("button", { class: "ghost" }, ["Cancel"]);
      cancelBtn.addEventListener("click", () => finish(false));
      const overlay = el("div", { class: "modal-overlay" }, [
        el("div", { class: "modal" }, [
          el("div", { class: "modal-hd" }, [el("span", { class: "dot" }), "⏳ Waiting for agents to finish"]),
          el("div", { class: "modal-bd" }, [el("div", { class: "modal-sub" }, ["Deploying restarts the agent engine. Holding until no turn is running so nothing gets cut off.  ", countEl])]),
          el("div", { class: "modal-ft" }, [cancelBtn, nowBtn]),
        ]),
      ]);
      document.body.append(overlay);
      document.addEventListener("keydown", onKey);
      const poll = async () => {
        if (done) return;
        let count = null;
        try { const d = await (await fetch("/api/admin/processes", { cache: "no-store" })).json(); count = (d && d.busy && d.busy.count) || 0; } catch { count = null; }
        if (done) return;
        if (count === 0) return finish(true);   // idle → safe to deploy
        countEl.textContent = count == null ? "(checking…)" : (count === 1 ? "1 agent still working…" : count + " agents still working…");
        timer = setTimeout(poll, 3000);
      };
      poll();
    });
  }

  // The deploy confirmation — a custom in-app modal (never window.confirm) PLUS the busy-agent
  // guard (T4.4). The deploy button's only click path awaits this, so the guard is impossible to
  // bypass. The plan + busy count are re-fetched here at click time (not read from a possibly-stale
  // panel render) so the decision is always authoritative. A web-only deploy (deployPlan not
  // daemon-affected) never warns — it goes straight to the standard confirm.
  async function deployConfirm() {
    let plan = LAST_PROC && LAST_PROC.plan, busy = LAST_PROC && LAST_PROC.busy;
    try {
      const d = await (await fetch("/api/admin/processes", { cache: "no-store" })).json();
      LAST_PROC = d; if (d.plan) plan = d.plan; if (d.busy) busy = d.busy;
    } catch { /* keep the last known plan/busy — fail toward the standard confirm below */ }
    const count = (busy && busy.count) || 0;
    if (plan && plan.daemonAffected && count > 0) {
      // Three-way: WAIT for the agents to finish then deploy (safe, no interruption) · deploy NOW anyway
      // (their in-flight turns are cut off) · cancel. "Wait" is the primary action — it's what stops the
      // recurring "I deployed and it killed my running turn".
      const choice = await showModal({
        title: count === 1 ? "1 agent still working" : count + " agents still working",
        confirmLabel: "Wait for them, then deploy", thirdLabel: "Deploy now anyway",
        sub: `This deploy restarts the agent engine (sessiond), which CUTS OFF any turn still running — a mid-turn reply is lost. Wait for ${count === 1 ? "it" : "them"} to finish first, or deploy now anyway?`,
      });
      if (choice === false) return false;                       // Cancel
      if (choice === true) {                                    // Wait, then deploy → drain to idle
        const drained = await deployWaitForIdle();
        if (drained === false) return false;                    // bailed out of the wait
        // drained === true (now idle) or "now" (deploy immediately) → fall through to the final confirm
      }
      // choice === "third" (Deploy now anyway) → fall through, interrupting the running turn(s)
    }
    return await showModal({ title: "Deploy to live", confirmLabel: "Deploy",
      sub: "Deploy the current build to brain.ancientholdings.eu? The relay rebuilds (~1 min)." });
  }

  // Reload's own confirm + busy-agent guard. A reload that must restart the engine (engine code
  // changed) interrupts every ongoing chat and loses its unfinished reply — so when there ARE ongoing
  // chats, warn explicitly and recommend letting them finish first (re-fetched at click time so the
  // count + engine-impact are authoritative, never a stale panel render). A web-only reload keeps the
  // engine + agents alive, so it just gets a plain confirm.
  async function reloadConfirm() {
    let daemonHit = true, busy = LAST_PROC && LAST_PROC.busy;
    try {
      const d = await (await fetch("/api/admin/processes", { cache: "no-store" })).json();
      LAST_PROC = d; if (typeof d.reloadDaemonAffected === "boolean") daemonHit = d.reloadDaemonAffected; if (d.busy) busy = d.busy;
    } catch { /* keep last known — fail toward the standard confirm below */ }
    const count = (busy && busy.count) || 0;
    if (daemonHit && count > 0) {
      const choice = await showModal({
        title: count === 1 ? "1 chat still working" : count + " chats still working",
        confirmLabel: "Wait for them, then reload", thirdLabel: "Reload now anyway",
        sub: `This reload restarts the session engine, so ${count === 1 ? "that ongoing chat" : "those " + count + " ongoing chats"} will be interrupted and ${count === 1 ? "its" : "their"} unfinished reply lost. Wait for ${count === 1 ? "it" : "them"} to finish first, or reload now anyway?`,
      });
      if (choice === false) return false;            // Cancel
      if (choice === true) { if ((await deployWaitForIdle()) === false) return false; }   // Wait → drain to idle
      return true;                                   // drained idle / "now" / "reload now anyway" → proceed
    }
    return await showModal({ title: "Reload the local dashboard", confirmLabel: "Reload",
      sub: daemonHit
        ? "Run a sandboxed pre-flight and, only if it passes, reload now? This picks up engine changes and briefly restarts the engine."
        : "Run a sandboxed pre-flight and, only if it passes, reload now? Web-only change — the engine and any running agents keep going." });
  }

  // Self-restart safety: a sandboxed pre-flight, then (only on ok:true) the real restart —
  // gated identically to Deploy above (same canDeploy/canRestart condition) rather than a
  // new auth path, and reusing this same log-terminal rendering (openLogStream) rather than
  // building a second terminal widget. "Reload" is this button's user-facing name — it's the
  // local host's half of the same "pick up what's on disk" action Deploy is for the container.
  const rterm = el("pre", { class: "deploy-term" }, ["(no restart run yet)"]);
  const rActions = el("div", { class: "deploy-actions" }, []);
  const rNote = el("div", { class: "hint" }, []);

  // ── ONE shared terminal (Explorer-style: collapsed by default; a header toggle expands it) that
  // replaces the two per-column terminals. When expanded it shows the reload log, the deploy log, or
  // — when BOTH run concurrently — a terminator-style split (reload LEFT, deploy RIGHT, equal width).
  // It collapses back to a single pane the moment only one stream is still active; once both are idle
  // it shows whichever ran most recently. `term`/`rterm` (above) stay the two live SSE buffers — this
  // only re-parents those same <pre> nodes between single/split layouts, so their content persists.
  // Never auto-expands on a run (matches Explorer); expanding mid/after a run shows the current log.
  let termExpanded = false, reloadRunning = !!RESTART_ES, deployRunning = false, lastActive = null;
  const termToggle = el("button", { class: "deploy-term-toggle" }, []);
  const termBody = el("div", { class: "deploy-term-body", hidden: "" }, []);
  termToggle.addEventListener("click", () => { termExpanded = !termExpanded; renderTerm(); });
  function termWhich() {
    if (reloadRunning) return "reload";
    if (deployRunning) return "deploy";
    if (lastActive) return lastActive;
    if (term.textContent && term.textContent !== "(no deploy run yet)") return "deploy";
    if (rterm.textContent && rterm.textContent !== "(no restart run yet)") return "reload";
    return null;
  }
  function renderTerm() {
    const both = reloadRunning && deployRunning;
    const live = both ? "reload + deploy" : reloadRunning ? "reload" : deployRunning ? "deploy" : "";
    termToggle.replaceChildren(
      el("span", { class: "deploy-term-caret", "aria-hidden": "true" }, [termExpanded ? "▾" : "▸"]),
      el("span", {}, [" Terminal"]),
      live ? el("span", { class: "deploy-term-live" }, ["● " + live]) : "",
    );
    termBody.hidden = !termExpanded;
    if (!termExpanded) return;
    if (both) {
      termBody.className = "deploy-term-body --split";
      termBody.replaceChildren(
        el("div", { class: "deploy-term-pane" }, [el("div", { class: "deploy-term-hd" }, ["Reload log"]), rterm]),
        el("div", { class: "deploy-term-pane" }, [el("div", { class: "deploy-term-hd" }, ["Deploy log"]), term]),
      );
    } else {
      termBody.className = "deploy-term-body";
      const which = termWhich();
      if (which === "reload") termBody.replaceChildren(el("div", { class: "deploy-term-hd" }, ["Reload log"]), rterm);
      else if (which === "deploy") termBody.replaceChildren(el("div", { class: "deploy-term-hd" }, ["Deploy log"]), term);
      else termBody.replaceChildren(el("div", { class: "hint" }, ["No reload or deploy has run yet — start one above, then expand to watch the log."]));
    }
    // Both buffers jump to their newest line — either may have streamed while off-screen (collapsed).
    rterm.scrollTop = rterm.scrollHeight; term.scrollTop = term.scrollHeight;
  }
  const sharedTerm = el("div", { class: "deploy-shared-term" }, [termToggle, termBody]);

  // StoaExplorer-style step-by-step progress views, driven by the same SSE log streams (T4.2).
  const deployProgress = makeProgress(DEPLOY_PHASES);
  const restartProgress = makeProgress(RESTART_PHASES);
  let restarting = !!RESTART_ES;   // a stream from a previous mount of this section is still live
  let canRestart = true;           // updated by refresh() every poll; read by refreshRestartBtn()

  const verLine = (v) => v ? (v.gitSha || "") + (v.builtAt ? " · " + new Date(v.builtAt).toLocaleString() : "") : "unreachable";

  function openStream(expectedVersion) {
    try { DEPLOY_ES && DEPLOY_ES.close(); } catch {}
    deployProgress.reset();
    deployRunning = true; lastActive = "deploy"; renderTerm();
    DEPLOY_ES = openLogStream("/api/deploy/stream", term, (ok) => {
      deployProgress.done(ok);
      if (ok) { note.textContent = "✓ Deploy finished — live is up to date."; reloadSoon(note); }   // settle → auto-reload (Explorer-style)
      else { note.textContent = "✗ Deploy failed — see the log."; refresh(); }
      deployRunning = false; renderTerm();
    }, {
      onLine: (line) => deployProgress.onLine(line),
      ...(expectedVersion ? {
        // ~2x a typical ~1min deploy's headroom — long enough that a merely-slow rebuild doesn't
        // trip it, short enough that a genuinely silent stream doesn't leave "Deploying…" stuck.
        timeoutMs: 90000,
        onFallback: async () => {
          DEPLOY_ES = null;
          // The blue-green swap stops the OLD container exactly when it would confirm, so a silent
          // stream here usually means it actually succeeded — freeze the progress on "waiting" and
          // poll /api/deploy/status until live matches, then settle + auto-reload (never loop).
          deployProgress.waiting("Waiting for the live container to confirm…");
          note.textContent = "No confirmation received — checking if it actually deployed…";
          const ok = await pollDeploySucceeded(note, expectedVersion);
          if (ok) { deployProgress.done(true); reloadSoon(note); } else { deployProgress.done(false); refresh(); }
          deployRunning = false; renderTerm();
        },
      } : {}),
    });
  }

  function openRestartStream() {
    try { RESTART_ES && RESTART_ES.close(); } catch {}
    restartProgress.reset();
    reloadRunning = true; lastActive = "reload"; renderTerm();
    // Once the real restart is triggered, `systemctl restart claudstermind` kills THIS process, so
    // the SSE stream dies mid-flight and can NEVER deliver a completion sentinel — the elapsed
    // timer would otherwise tick "Running… 53s… 54s…" forever. The moment we see the trigger line
    // (or the stream errors/times out after start), we FREEZE the progress on a "waiting" state and
    // poll /api/version until the NEW process answers, then settle "Restart the service" complete
    // and auto-reload the whole page. `settled` makes at most one of those paths run.
    let settled = false;
    async function beginWaiting() {
      if (settled) return;
      settled = true;
      try { RESTART_ES && RESTART_ES.close(); } catch {}
      RESTART_ES = null;
      // Keep `restarting` true (button stays "Reloading…" / disabled) through the wait — the page
      // is about to reload on success, and a failed wait clears it below.
      restartProgress.waiting("Waiting for the service to come back…");
      rNote.textContent = "Restart triggered — waiting for the service to come back…";
      refreshRestartBtn();
      const back = await pollBackUp(rNote);            // ✕ never loops: bounded attempts w/ backoff
      if (back) { restartProgress.done(true); reloadSoon(rNote); }   // ● complete → auto-reload
      else { restartProgress.done(false); restarting = false; }
      reloadRunning = false; renderTerm();
      refreshRestartBtn();
    }
    RESTART_ES = openLogStream("/api/dashboard/restart/stream", rterm, (ok) => {
      // The sentinel DID arrive (fast local restart, or a pre-flight failure that never triggered).
      if (settled) return;
      if (ok) { beginWaiting(); return; }              // ok before the process dropped → settle path
      restartProgress.done(false);
      restarting = false;
      reloadRunning = false; renderTerm();
      RESTART_ES = null;
      // The refusal reason (timeout / crashed / port bind failure / spawn-failed / …) is
      // written into the log itself by runSelfRestart's onLog (already prefixed "✗ "), not
      // carried as structured data over the stream — so the specific reason is the log's
      // last line verbatim, not a generic "restart failed".
      const lines = rterm.textContent.trim().split("\n");
      rNote.textContent = lines[lines.length - 1] || "✗ Restart refused — see the log.";
      refreshRestartBtn();
    }, {
      onLine: (line) => {
        restartProgress.onLine(line);
        // The trigger line is the last thing this process can ever emit — switch to waiting now
        // rather than banking on a sentinel the dying process won't live to send.
        if (DeployHelpers.reachedRestartTrigger(line)) beginWaiting();
      },
      // 40s backstop for the case where even the trigger line never arrives (e.g. the tunnel drops
      // silently on the remote/live-site path) — the browser↔relay SSE stays healthy so onerror
      // never fires, and only a timeout closes that gap.
      timeoutMs: 40000,
      onFallback: () => { rNote.textContent = "No confirmation received — checking if it's back up…"; beginWaiting(); },
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
      if (!(await deployConfirm())) return;   // custom modal (+ busy-agent guard) — never window.confirm
      note.textContent = "Starting deploy…"; openStream(pending?.version);
      const r = await wsPost2("/api/deploy", {});
      if (!r.ok) { try { DEPLOY_ES.close(); } catch {} DEPLOY_ES = null; note.textContent = "⚠ " + (r.message || "could not start"); deployRunning = false; renderTerm(); }
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

    pendingHd.replaceChildren(
      el("div", { class: "deploy-card-t" }, ["Pending — what Reload or Deploy would produce"]),
      el("div", { class: "deploy-ver-lg" }, [pending ? "v" + pending.version : "—"]),
      el("div", { class: "deploy-sha" }, [verLine(pending)]),
    );
    // LEFT column card — Reload: the local host's own on-disk vs. running code.
    reloadCardBox.replaceChildren(
      el("div", { class: "deploy-card" + (localStale ? " stale" : pending ? " ok" : "") }, [
        el("div", { class: "deploy-card-t" }, [remote ? "Local host · the work machine" : "Local host · this machine"]),
        el("div", { class: "deploy-ver" }, [localRunning ? "v" + localRunning.version : "—"]),
        el("div", { class: "deploy-sha" }, [remote && !st.localConnected ? "offline" : verLine(localRunning)]),
        localStale ? el("div", { class: "deploy-stale-note" }, ["⚠ running code is behind Pending — Reload to pick it up"]) : "",
        el("div", { class: "deploy-actions-row" }, [rActions, rNote]),
      ]),
    );
    // RIGHT column card — Deploy: the live container vs. Pending.
    deployCardBox.replaceChildren(
      el("div", { class: "deploy-card" + (live ? (same ? " ok" : " stale") : "") }, [
        el("div", { class: "deploy-card-t" }, ["Live container · brain.ancientholdings.eu"]),
        el("div", { class: "deploy-ver" }, [live ? "v" + live.version : "—"]),
        el("div", { class: "deploy-sha" }, [verLine(live)]),
        live && !same ? el("div", { class: "deploy-stale-note" }, ["⚠ behind Pending — Deploy to update"]) : "",
        el("div", { class: "deploy-actions-row" }, [actions, note]),
      ]),
    );
  }

  function refreshRestartBtn() {
    const restartBtn = el("button", { class: "loginbtn secondary" }, [restarting ? "Reloading…" : "⟳ Reload"]);
    if (restarting || !canRestart) restartBtn.disabled = true;
    restartBtn.addEventListener("click", async () => {
      if (!(await reloadConfirm())) return;   // custom modal (+ busy-agent guard when the reload restarts the engine)
      restarting = true; rNote.textContent = "Starting reload pre-flight…"; openRestartStream();
      refreshRestartBtn();
      const r = await wsPost2("/api/dashboard/restart", {});
      if (!r.ok) { try { RESTART_ES.close(); } catch {} RESTART_ES = null; restarting = false; rNote.textContent = "⚠ " + (r.message || "could not start"); reloadRunning = false; renderTerm(); refreshRestartBtn(); }
    });
    rActions.replaceChildren(restartBtn);
    if (!canRestart) rActions.append(el("span", { class: "hint" }, ["  (the work machine is offline)"]));
  }

  // ── Tab A "Deploy & Reload" — two symmetric columns (Reload LEFT, Deploy RIGHT), each: header →
  // action/version card → its "what this restarts" banner → its progress checker. The four paired
  // sections are kept top-aligned across the columns by a CSS subgrid (`.deploy-col` adopts the
  // split's rows), so Reload's 2-step and Deploy's 4-step checkers still start at the same y. The two
  // terminals are gone from the columns — one shared, collapsible terminal sits below the split. ──
  const reloadCol = el("div", { class: "deploy-col" }, [
    el("div", { class: "deploy-col-hd" }, ["⟳ Reload — local host"]),
    reloadCardBox,
    reloadBanner,
    restartProgress.wrap,
  ]);
  const deployCol = el("div", { class: "deploy-col" }, [
    el("div", { class: "deploy-col-hd" }, ["🚀 Deploy — live container"]),
    deployCardBox,
    restartBanner,
    deployProgress.wrap,
  ]);
  const tabDeploy = el("div", { class: "deploy-tabpanel" }, [
    pendingHd,
    el("div", { class: "deploy-split" }, [reloadCol, deployCol]),
    sharedTerm,
  ]);
  renderTerm();   // set the collapsed toggle label; body stays hidden until the user expands it
  // ── Tab B "Running locally" — the process list, moved out of the deploy columns (filled by
  // refreshProcesses, which partitions running vs. dormant). ──
  const tabProcs = el("div", { class: "deploy-tabpanel", hidden: "" }, [procBox]);

  const tabs = [
    { id: "deploy", label: "Deploy & Reload", panel: tabDeploy },
    { id: "procs", label: "Running locally", panel: tabProcs },
  ];
  const tabBtns = {};
  function showTab(id) {
    for (const t of tabs) { t.panel.hidden = t.id !== id; tabBtns[t.id].className = "deploy-tab" + (t.id === id ? " on" : ""); }
  }
  const tabbar = el("div", { class: "deploy-tabbar" }, tabs.map((t) => {
    const b = el("button", { class: "deploy-tab", onclick: () => showTab(t.id) }, [t.label]);
    tabBtns[t.id] = b; return b;
  }));

  root.replaceChildren(
    el("h2", { class: "deploy-h" }, ["Deploy & Version"]),
    el("div", { class: "hint" }, ["The version + changelog are cut by the agent when a change is built (Pantheonic §10). Reload picks up the local host's own on-disk code; Deploy ships it to the live container."]),
    tabbar,
    tabDeploy,
    tabProcs,
  );
  showTab("deploy");
  refresh();
  refreshProcesses();
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
    // Token counts only — no dollar-equivalent figure. This is subscription usage, not metered
    // billing, so a synthesized "~$X" cost was never a real charge, just a confusing guess.
    const usageText = `Claude distill usage: ${u.runs || 0} run(s) · ${((u.inputTokens || 0) + (u.outputTokens || 0)).toLocaleString()} tok`;
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
function showModal({ title, sub, value = "", editable = false, confirmLabel = "Confirm", danger = false, thirdLabel = null }) {
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
    // An optional THIRD action (distinct from confirm/cancel) — resolves "third". Used e.g. by the deploy
    // guard: [Wait for agents, then deploy] (confirm) · [Deploy now anyway] (third) · [Cancel].
    const thirdBtn = thirdLabel ? el("button", { class: "ghost" }, [thirdLabel]) : null;
    if (thirdBtn) thirdBtn.addEventListener("click", () => finish("third"));
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
          cancelBtn, thirdBtn || "", confirmBtn,
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
let WS_HEAL_TIMER = null;    // fast (~4s) local self-heal — surfaces a dropped reply in ~8s, not the 25s heartbeat gap
// Close any open ★-bookmark popup when clicking outside it (registered once, module load).
document.addEventListener("mousedown", (e) => { if (!e.target.closest || !e.target.closest(".ws-bm-wrap")) document.querySelectorAll(".ws-bm-pop.--show").forEach((x) => x.classList.remove("--show")); });
let WS_EVER_CONNECTED = false;   // true after the FIRST successful "hello" — so only a later hello logs as a "reconnect"
// Comfortably above the 25s server heartbeat: two missed pulses plus slack, not one, so an
// ordinary single slow tick over a mobile link never triggers a needless reconnect.
const WS_STALE_MS = 65_000;
// A pane still marked busy but silent this long is treated as a missed end-of-turn and resynced on
// the next heartbeat (server heartbeat is 25s; a live turn streams events far more often than this).
const WS_HEAL_QUIET_MS = 20_000;
// How long after a tab's last REAL activity the client keeps re-verifying an idle-LOOKING active tab against
// the server. A turn's "result" flips the tab to idle, but the SDK can keep producing in a "deepwork" phase
// whose status event is easy to miss on a flaky mobile link — and the old 2-minute window (keyed to the last
// `result`) was far too short for a long autonomous build or a >2-min connection drop, so the tab sat showing
// "done" while the agent kept working. This bounds the polling (one scoped resync per tab) yet is long enough
// to bridge a real outage; once a resync catches the deepwork, the busy-branch takes over and self-sustains.
const WS_HEAL_ACTIVE_WINDOW_MS = 10 * 60_000;
// How often an idle-LOOKING but recently-active pane/tab re-verifies against the server. Shorter than
// WS_HEAL_QUIET_MS so a reply whose stream events were dropped surfaces in ~8s instead of ~20-25s — the
// "round looks done but nothing showed up" gap. Kept comfortably above a resync round-trip so it can't stack.
const WS_HEAL_ACTIVE_QUIET_MS = 8_000;
// Matches the server's WS_RESYNC_MSG_CAP (lib/workspace.mjs): a capped resync ships at most this many
// messages. When a tab's LOCAL transcript already holds more than this (its capped tail plus an
// optimistically-shown prompt, or a fully-revealed big history), a capped resync is SHORTER than local, so
// pactResyncDecision's `incoming >= local` guard rejects it — even when it carries a dropped reply. In that
// case a resync must be `full` to beat the guard. Keep in sync with the server constant.
const PACT_RESYNC_CAP = 250;
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
const wsPost = (action, body) => fetch("/api/workspace/" + action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) })
  .then(async (r) => {
    let j = {}; try { j = await r.json(); } catch {}
    // Normalize `ok` to the HTTP status so senders can trust it. A 401 (expired login) or 403/503
    // returns a JSON error BODY with no `ok` field, which used to read as "sent" — the exact reason a
    // rejected prompt was silently dropped. `_status`/`_offline` let the send paths distinguish
    // "login/permission" (retry after re-login) from "network" (retry when back online).
    if (!r.ok) { j.ok = false; j._status = r.status; }
    else if (typeof j.ok === "undefined") j.ok = true;
    return j;
  })
  .catch(() => ({ ok: false, _status: 0, _offline: true }));
const wsUuid = () => (crypto.randomUUID ? crypto.randomUUID() : "s-" + Date.now() + "-" + Math.random().toString(36).slice(2));

// ===== SESSION KEEP-ALIVE — sliding login, a visible countdown, and non-silent expiry =====
// Our login is a first-party cookie we fully control. Without a refresh it dies on a fixed timer and the
// page only discovers it when a prompt is rejected (and, in the Pact chat, silently dropped). This slides
// the cookie while the tab is used, shows the time left, and — if it ever DOES lapse — surfaces a
// non-destructive banner instead of eating your work. Live mode only (local mode has no login).
let SESSION_EXP = null;        // epoch ms the current cookie expires (from /api/me or /auth/refresh)
let SESSION_EXPIRED = false;   // true once a refresh returns 401 — drives the banner + pill
let SESSION_KA_TIMER = null;
async function sessionRefresh() {
  if (ME.mode !== "live") return true;
  try {
    const r = await fetch("/auth/refresh", { method: "POST", cache: "no-store" });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      if (j.expiresAt) SESSION_EXP = j.expiresAt;
      sessionSetExpired(false);
      pactOutboxFlush();   // login is healthy again — release anything that failed to send while it wasn't
      renderSessionPill();
      return true;
    }
    if (r.status === 401) { sessionSetExpired(true); return false; }
  } catch { /* offline blip — the /api/me poll + heartbeat catch a real drop; don't flip to expired here */ }
  return false;
}
function sessionStartKeepAlive() {
  if (ME.mode !== "live") return;
  if (typeof ME.sessionExpiresAt === "number") SESSION_EXP = ME.sessionExpiresAt;
  clearInterval(SESSION_KA_TIMER);
  SESSION_KA_TIMER = setInterval(sessionRefresh, 20 * 60 * 1000);   // slide every 20 min of an open tab
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sessionRefresh(); });
  window.addEventListener("online", () => { sessionRefresh(); });
  setInterval(renderSessionPill, 30 * 1000);
  sessionRefresh();   // slide immediately so a nearly-dead cookie from a long-idle tab renews at once
}
function sessionSetExpired(expired) {
  const was = SESSION_EXPIRED; SESSION_EXPIRED = !!expired;
  if (was !== SESSION_EXPIRED) { renderSessionBanner(); renderSessionPill(); }
}
function sessionFmtRemaining(ms) {
  if (!(ms > 0)) return null;
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}
function renderSessionPill() {
  const host = document.getElementById("phSession"); if (!host) return;
  if (ME.mode !== "live" || !ME.authenticated) { host.hidden = true; return; }
  host.hidden = false; host.onclick = () => sessionRefresh();
  if (SESSION_EXPIRED) { host.textContent = "🔒 session ended"; host.className = "ph-session --bad"; host.title = "Your login expired — click Re-login below. Unsent messages are saved."; return; }
  const remMs = SESSION_EXP ? SESSION_EXP - Date.now() : null;
  const rem = remMs != null ? sessionFmtRemaining(remMs) : null;
  host.textContent = "🔒 " + (rem || "active");
  host.className = "ph-session" + (remMs != null && remMs < 3600000 ? " --warn" : "");
  host.title = "You're kept logged in while you use this tab (auto-renews). Click to renew now.";
}
function renderSessionBanner() {
  let bar = document.getElementById("sessionBanner");
  if (!SESSION_EXPIRED) { if (bar) bar.remove(); return; }
  if (bar) return;
  bar = el("div", { id: "sessionBanner", class: "session-banner" }, [
    el("span", {}, ["⚠ Your login expired. Re-login to keep working — your unsent messages are saved and retry automatically."]),
    el("a", { class: "ph-btn --primary --sm", href: "/auth/login" }, ["Re-login"]),
  ]);
  document.body.appendChild(bar);
}
// ===== end SESSION KEEP-ALIVE =====

// ===== PACT CHAT OUTBOX — never lose a prompt =====
// A prompt that fails to send (offline, or the login lapsed) is kept here — in localStorage, so it
// survives a reload/relogin — and auto-retried when the connection/login is healthy again. This is what
// stops "I typed a long prompt, the tunnel was down, and it vanished on reload."
const PACT_OUTBOX_KEY = "pact.chat.outbox.v1";
function pactOutboxLoad() { try { const a = JSON.parse(localStorage.getItem(PACT_OUTBOX_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } }
function pactOutboxSave(list) { try { localStorage.setItem(PACT_OUTBOX_KEY, JSON.stringify(list.slice(-20))); } catch {} }
function pactOutboxAdd(sessionKey, text, images) {
  if (!text) return null;
  const entry = { id: wsUuid(), sessionKey, text, images: (images || []).map((a) => ({ mediaType: a.mediaType, base64Data: a.base64Data, dataUrl: a.dataUrl })), ts: Date.now() };
  const list = pactOutboxLoad(); list.push(entry);
  try { localStorage.setItem(PACT_OUTBOX_KEY, JSON.stringify(list.slice(-20))); }
  catch { entry.images = []; pactOutboxSave(list); }   // images blew the quota → keep at least the text
  return entry.id;
}
function pactOutboxRemove(id) { if (id) pactOutboxSave(pactOutboxLoad().filter((e) => e.id !== id)); }
function pactOutboxFlush() {
  if (!PACT_CHAT) return;
  for (const e of pactOutboxLoad()) {
    const t = pactChatByKey(e.sessionKey);
    if (!t || pactChatBusy(t)) continue;   // tab not open (retry later) or busy (its own queue owns it)
    pactOutboxRemove(e.id);
    pactChatDispatch(t, e.text, e.images || []);   // re-adds itself to the outbox if it fails again
  }
}
// On unload (deploy/reload), fold every tab's still-QUEUED (orange, not-yet-sent) message into the
// durable outbox — otherwise it lived only in memory and vanished on the reload. On the way back the
// outbox auto-sends them (flush on hello / turn-end), exactly like a failed send.
function pactOutboxAbsorbQueues() {
  if (!PACT_CHAT) return;
  for (const t of PACT_CHAT.tabs) {
    if (t.key && t._queue && t._queue.length) { for (const q of t._queue) pactOutboxAdd(t.key, q.text, q.images); t._queue = null; }
  }
}
// ===== end PACT CHAT OUTBOX =====
// The workspace id a pane attaches to: repo + worktree. TWO terminals selecting the same repo
// (and worktree) derive the SAME key, so they drive — and watch — the one shared conversation.
const wsWorkspaceId = (repo, worktree) => (repo ? repo + "@" + (worktree || "main") : null);
// A reloaded/reopened transcript has per-turn `workspaceId` stripped by the server, but the user
// message renderer needs it to build the /api/workspace/image URL — without it, an image-bearing
// prompt reloads looking like it had no attachments. Stamp it back from the frame-level id (the
// images themselves were always saved server-side; this only restores the field the renderer reads).
function wsBackfillTurnWorkspace(transcript, wid) {
  if (Array.isArray(transcript) && wid) for (const m of transcript) if (m && (m.images || m.image) && !m.workspaceId) m.workspaceId = wid;
  return Array.isArray(transcript) ? transcript : [];
}
// ===== WS USAGE — pure token/context formatter (sliced out for unit tests; see lib/wsUsage.test.mjs)
// The compact "N tok · P% ctx" readout shared by BOTH the Core pane badge (paintPane) and the Pact
// chat header (pactChatPaint) — one formatter so the two surfaces never drift. `usage` carries the
// running input/output token totals; `contextUsage` (requested per-turn) carries the context-window
// percentage + totals. Returns { text, ctxPct, title } — `text` is "" when there's no usage yet
// (each caller decides its own placeholder), `title` is the hover breakdown.
function wsUsageLabel(usage, contextUsage) {
  const u = usage || {};
  const ctx = contextUsage;
  const ctxPct = ctx && typeof ctx.percentage === "number" ? Math.round(ctx.percentage <= 1 ? ctx.percentage * 100 : ctx.percentage) : null;
  const text = (u.inputTokens || u.outputTokens)
    ? `${((u.inputTokens || 0) + (u.outputTokens || 0)).toLocaleString()} tok` + (ctxPct !== null ? ` · ${ctxPct}% ctx` : "")
    : "";
  const title = ctx ? `Context window: ${(ctx.totalTokens || 0).toLocaleString()} / ${(ctx.maxTokens || 0).toLocaleString()} tokens (${ctxPct ?? "—"}%)` : "";
  return { text, ctxPct, title };
}
// ===== end WS USAGE pure helper =====
// ===== WS IMAGE — pure attach/encode helpers (sliced out for unit tests; see lib/wsImage.test.mjs)
// Up to WS_IMG_MAX_COUNT images per prompt (Claude Code's own limit), riding the existing `prompt`
// payload as `images: [{ mediaType, base64Data }, ...]` — see lib/workspace.mjs `_prompt`/`_saveImages`
// and lib/workspaceStore.mjs `saveImage`'s IMAGE_EXT for the closed mediaType list this must match.
// Lifted to module scope so BOTH the Core cockpit (viewWorkspace) and the Pact chat encode identically.
const WS_IMG_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const WS_IMG_MAX_COUNT = 5;
// "roughly 3 MB" per design — measured on the ENCODED (base64) string, since that's what actually
// rides the WS control frame; base64 chars ≈ bytes (ASCII), so string length is a fine proxy.
const WS_IMG_MAX_ENCODED_BYTES = 3 * 1024 * 1024;
// Recompression ladder: try full-size-but-lower-quality first (cheapest to look at), only downscaling
// resolution once quality alone can't get under the cap.
const WS_IMG_COMPRESS_STEPS = [[1, 0.92], [1, 0.7], [0.75, 0.6], [0.5, 0.5], [0.35, 0.4]];
function wsReadFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("could not read file"));
    r.readAsDataURL(file);
  });
}
/** Length of the base64 payload after the `data:...;base64,` prefix — the part that actually travels
 *  in the prompt payload. */
function wsDataUrlEncodedSize(dataUrl) { const i = dataUrl.indexOf(","); return i < 0 ? 0 : dataUrl.length - i - 1; }
function wsDataUrlToAttachment(dataUrl) {
  const m = /^data:([^;,]+)(?:;[^,]*)?,([\s\S]*)$/.exec(dataUrl || "");
  if (!m || !m[2]) return null;
  return { mediaType: m[1], base64Data: m[2], dataUrl };
}
/** Decode a File into something <canvas> can draw — `createImageBitmap` where available (works
 *  off-thread, no DOM node needed), falling back to a plain `Image`. */
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
/** Downscale/recompress via <canvas>, always re-encoding as JPEG (in WS_IMG_ALLOWED_TYPES regardless
 *  of the source format) — walks WS_IMG_COMPRESS_STEPS until the encoded result fits under the cap, or
 *  returns null if it still doesn't after the whole ladder. */
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
// ===== end WS IMAGE pure helper =====
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
// Pane grid limits. 8 across is sized for an ultrawide (5120px ⇒ ~600px a pane); narrower
// screens keep the panes readable and scroll the grid sideways instead of crushing them.
const WS_MAX_COLS = 8, WS_MAX_ROWS = 2;
// How long a reopen/resume ("control open") waits for a "transcript" or error reply before giving
// up and surfacing an explicit note — covers a disconnected bridge, which otherwise never answers
// at all and would leave the UI (and the pendingOpens entry) waiting forever.
const WS_OPEN_TIMEOUT_MS = 8000;
// A pane repaints on every streamed event; only re-snap the transcript scroll to the bottom when the
// reader is at DEAD BOTTOM — otherwise someone who scrolled up (even a little) keeps their exact spot
// instead of being yanked down mid-turn. This is a tolerance, not a "near" band: 4px absorbs only the
// sub-pixel/fractional-height rounding a browser reports at a true bottom (Chrome/Safari can be ~1px
// off on high-DPI). It used to be 48px, which treated "a couple of lines up" as bottom and produced
// exactly the "incoming reply drags my scroll down" report. Pact already used this strict value.
const WS_SCROLL_NEAR_BOTTOM_PX = 4;
// Only the most recent WS_TURN_RENDER_CAP turns are kept in the DOM by default; older ones sit
// behind a "show earlier" control (see renderTranscriptInto). This keeps the standing DOM small
// on a long conversation so a weaker/software-rendering browser isn't asked to lay out and paint
// thousands of nodes at once — the real fix for the whole workspace lagging on such a client,
// WITHOUT content-visibility's on-scroll rendering (which made scrolling feel like it was
// "loading"). Everything rendered is real and accurately sized, so scrolling stays smooth.
const WS_TURN_RENDER_CAP = 20;
// ===== PACT VISIBLE-WINDOW — pure cap helper (sliced for lib/pactVisibleStart.test.mjs) =====
// The Pact chat renders individual messages: user / assistant TEXT plus collapsed tool_use rows (the
// Read / Bash / Edit lines). Capping by RAW message count was wrong — a tool-heavy turn fills the window
// with collapsed rows and crowds out the actual readable text you'd want to scroll back through. Instead
// guarantee the last PACT_TEXT_RENDER_CAP READABLE (user/assistant) messages are always shown — the tool
// rows interleaved among them ride along for free — with PACT_MSG_HARD_CAP as an absolute node ceiling so
// a pathological run of tool rows can't blow the DOM back up (which would hurt scroll/paint; typing itself
// is already protected by the .pact-* `contain: layout paint` fix). Older messages sit behind a "show
// earlier" chip (t._showFrom reveals older messages 100 at a time). This keeps the standing DOM bounded AND readable.
const PACT_TEXT_RENDER_CAP = 50;
const PACT_MSG_HARD_CAP = 400;
// Start index of the visible window: walk back from the end until PACT_TEXT_RENDER_CAP readable messages
// have been included OR the hard node ceiling is reached, whichever comes first. Pure (messages → index)
// so it's unit-tested. "Readable" = a user/assistant turn carrying non-empty text; tool_use / note / other
// rows don't count toward the readable budget (but are still shown when they fall inside the window).
function pactVisibleStart(msgs, textCap = PACT_TEXT_RENDER_CAP, hardCap = PACT_MSG_HARD_CAP) {
  if (!Array.isArray(msgs)) return 0;
  let textSeen = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && (m.role === "user" || m.role === "assistant") && m.text != null && m.text !== "") {
      if (++textSeen >= textCap) return i;
    }
    if (msgs.length - i >= hardCap) return i;   // absolute node ceiling hit before the readable budget
  }
  return 0;
}
// ===== end PACT VISIBLE-WINDOW pure helper =====
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

// ---- stick-to-bottom controller (shared by the workspace transcript AND the Pact chat) ----
// "Read at your own pace": new output only auto-scrolls while the reader is already at the bottom.
// Scroll up and you keep your spot instead of being yanked down mid-stream; a blinking "↓ New
// output" pill then appears to say more has arrived. Click it — or scroll back to the bottom by
// hand — to resume following the tail. ONE helper, two call sites, so the logic isn't duplicated:
// the workspace transcript (paintPane / scheduleLiveRender) and the Pact chat (pactChatPaint /
// pactChatPaintLive). The pill floats bottom-right of a thin relative wrapper placed exactly where
// the scroll container sat, so it never scrolls away with the content and stays above the compose row.
// Usage: sample() reads live scroll position (call it BEFORE a replaceChildren, while scrollTop is
// still meaningful); apply(stick) acts after the DOM changed — follow the tail, or reveal the pill.
function attachStickController(scrollEl, opts = {}) {
  if (scrollEl._stick) return scrollEl._stick;                 // idempotent — safe to call every render
  const wrap = el("div", { class: "stick-wrap" + (opts.wrapClass ? " " + opts.wrapClass : "") });
  const parent = scrollEl.parentNode;
  if (parent) parent.insertBefore(wrap, scrollEl);
  wrap.appendChild(scrollEl);
  const pill = el("button", { class: "stick-pill", type: "button", title: "Jump to the latest output" }, ["↓ New output"]);
  wrap.appendChild(pill);
  // Persistent mode "bulb" — tells you at a glance which mode the transcript is in, ALWAYS visible (unlike
  // the pill, which only appears when new output lands while you're scrolled up):
  //   • LIVE  (green, at dead bottom)  → incoming messages scroll into view automatically.
  //   • HELD  (amber, scrolled up)     → incoming messages stay put; your view won't move.
  // Click it to jump to the latest and go Live. reflect() repaints it from ctrl.pinned on every scroll
  // and every sample()/apply(), so it can never disagree with the actual scroll behavior.
  const modeTag = el("button", { class: "stick-mode stick-mode--float", type: "button" }, [
    el("span", { class: "stick-mode-dot" }, []), el("span", { class: "stick-mode-lbl" }, []),
  ]);
  wrap.appendChild(modeTag);   // default home: bottom-left float over the transcript (callers can re-dock it)
  const reflect = () => {
    const live = !!ctrl.pinned;
    modeTag.classList.toggle("--live", live);
    modeTag.classList.toggle("--held", !live);
    modeTag.querySelector(".stick-mode-lbl").textContent = live ? "Live" : "Held";
    modeTag.title = live
      ? "Live — you're at the bottom, so new messages scroll into view automatically."
      : "Held — you've scrolled up, so new messages stay put and won't move your view. Click to jump to the latest.";
  };
  // How close to the bottom still counts as "following the tail". Callers can force STRICT (~exact bottom)
  // so that the instant you scroll up even a little, nothing may auto-scroll you back down.
  const nearPx = typeof opts.nearPx === "number" ? opts.nearPx : WS_SCROLL_NEAR_BOTTOM_PX;
  const atBottom = () => (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight) < nearPx;
  // A stable "what am I looking at" anchor for the NOT-pinned case: the first child whose bottom edge is
  // below the scroller's top, plus how far its own top sits from that edge. Captured in sample() (before
  // the DOM changes) and restored in apply(), so content inserted / removed / replaced ABOVE the viewport
  // — a render-cap eviction of the oldest turn, the live→final node swap, a full replaceChildren — can't
  // shift the reader's view. In the common case (new content appended BELOW the viewport) the anchor
  // doesn't move, so the restore is a mathematical no-op — identical to the old "leave scrollTop alone",
  // just also correct when the change is above the fold.
  // BINARY SEARCH over offsetTop (monotonic for stacked in-flow children) for the first child whose bottom
  // edge is below the scroll top — O(log n) reads, not an O(n) getBoundingClientRect sweep, so a large
  // window (hundreds of nodes) stays cheap to sample even mid-stream. `delta` is the anchor's top relative
  // to the viewport top at capture; apply() restores scrollTop so the anchor returns to exactly that spot.
  const captureAnchor = () => {
    const kids = scrollEl.children, n = kids.length;
    if (!n) return null;
    const st = scrollEl.scrollTop;
    let lo = 0, hi = n - 1, ans = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, c = kids[mid];
      if (c.offsetTop + c.offsetHeight > st) { ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    let node = kids[ans];
    // Never anchor to the "▲ Show earlier" chip: it's recreated each paint and pinned to the very top,
    // so anchoring to it would leave the reader stuck at scrollTop 0 when older messages load in. Use the
    // next real node so the message you were reading stays put as content grows ABOVE it.
    if (node && node.classList && node.classList.contains("ws-show-earlier") && kids[ans + 1]) node = kids[ans + 1];
    return node ? { node, delta: node.offsetTop - st } : null;
  };
  const ctrl = {
    pinned: true, scrollEl, wrap, pill, _anchor: null,
    // Read the live position. Call BEFORE replacing/growing content, when scrollTop still reflects
    // where the reader actually is — the answer is "were they at DEAD BOTTOM a moment ago?". When they
    // weren't, also snapshot a visual anchor so apply() can pin their exact spot afterward.
    sample() { this.pinned = atBottom(); this._anchor = this.pinned ? null : captureAnchor(); reflect(); return this.pinned; },
    // Act on that decision once the DOM has changed: glue to the tail, or hold the reader's exact spot
    // (anchor restore) and reveal the pulsing pill that new output arrived.
    apply(stick) {
      if (stick) { scrollEl.scrollTop = scrollEl.scrollHeight; this.pinned = true; this._anchor = null; pill.classList.remove("--show"); }
      else {
        const a = this._anchor;
        if (a && a.node && a.node.parentNode === scrollEl) {
          const target = a.node.offsetTop - a.delta;   // scrollTop that returns the anchor to its recorded viewport spot
          if (Math.abs(target - scrollEl.scrollTop) >= 1) scrollEl.scrollTop = target;   // ignore sub-px noise
        }
        this.pinned = false; pill.classList.add("--show");
      }
      reflect();
    },
    // Force back to the tail and re-pin (pill click, or a just-sent message).
    pin() { this.pinned = true; this._anchor = null; scrollEl.scrollTop = scrollEl.scrollHeight; pill.classList.remove("--show"); reflect(); },
    modeTag,
    // Re-home the mode bulb out of the default bottom-left float and into `mountEl` with placement class
    // `cls` (docked above the Send button on desktop, or inline in the Pact mobile control bar). Idempotent
    // — safe to call on every render; it just moves the one element and re-applies the live/held state.
    dockMode(mountEl, cls) {
      if (!mountEl) return;
      modeTag.className = "stick-mode " + (cls || "stick-mode--float");
      mountEl.appendChild(modeTag);
      reflect();
    },
  };
  let raf = 0;
  scrollEl.addEventListener("scroll", () => {
    if (raf) return;
    raf = (window.requestAnimationFrame || ((fn) => setTimeout(fn, 16)))(() => {
      raf = 0;
      // Reaching the bottom by hand re-pins and dismisses the pill; scrolling up just unpins
      // (the pill only turns ON when new output lands via apply(), not merely on scroll-up).
      if (atBottom()) { ctrl.pinned = true; pill.classList.remove("--show"); }
      else ctrl.pinned = false;
      reflect();
    });
  }, { passive: true });
  pill.addEventListener("click", () => ctrl.pin());
  modeTag.addEventListener("click", () => ctrl.pin());   // the bulb is also a "jump to latest + go Live" button
  reflect();   // paint the initial state (starts Live/pinned)
  scrollEl._stick = ctrl;
  return ctrl;
}

/* ---------- Pact IDE (Workspace › Pact) ----------
   A Pact development workspace, structured as an IDE, whose folder tree points at the Ouronet Pact
   repo on disk (read via /api/pact/*). Three zones: a left file tree, a center editor (Zone A, ~75%),
   and a right column (Zone B, ~25%) split into an AI-chat top and a REPL-terminal bottom.
   Phase 1a (here): nav + 3-zone shell + a real lazy folder tree + plain-text file viewer.
   Next: StoicSyntax syntax coloring, markdown rendering, multi-pane tabs, and the live `.repl`
   terminal runner; then Phase 2 wires the chat tabs + "pact brain". */
function pactFileIcon(name) {
  const n = name.toLowerCase();
  if (n.endsWith(".pact")) return "⬡";
  if (n.endsWith(".repl")) return "▶";
  if (n.endsWith(".md")) return "📄";
  if (n.endsWith(".json")) return "🔧";
  if (n.endsWith(".yaml") || n.endsWith(".yml")) return "⚙";
  return "•";
}
// Highlight the whole file, then split the resulting HTML into one string per SOURCE line — carefully
// re-opening/closing any <span> that straddles a newline (only pk-string spans can, for multi-line
// string literals; comments stop at EOL). pactHighlight never nests spans, so tracking one open tag
// suffices. Returns exactly content.split("\n").length entries (newline count is preserved by
// highlighting). Non-pact files (or no highlighter) fall back to per-line escaped plain text.
function pactHighlightLines(content, rel) {
  const ext = (rel || "").toLowerCase();
  const isPact = ext.endsWith(".pact") || ext.endsWith(".repl");
  const src = String(content);
  if (!isPact || typeof window.pactHighlight !== "function") return src.split("\n").map(escapeHtml);
  const html = window.pactHighlight(src);
  const lines = [];
  let cur = "", openTag = null;
  for (const p of html.split(/(<span[^>]*>|<\/span>)/)) {
    if (!p) continue;
    if (p.charAt(0) === "<" && p.charAt(1) !== "/") { openTag = p; cur += p; continue; }
    if (p === "</span>") { openTag = null; cur += p; continue; }
    const segs = p.split("\n");
    cur += segs[0];
    for (let k = 1; k < segs.length; k++) {
      if (openTag) cur += "</span>";
      lines.push(cur);
      cur = (openTag || "") + segs[k];
    }
  }
  lines.push(cur);
  return lines;
}
// A compact strip that teaches the band colors — "the prefix is the contract" made visible. Hardcoded to
// the StoicSyntax COLOUR FAMILIES (OuronetInformational/StoicSyntax-Prefixes.md §4), NOT the read-only base
// highlighter's window.pactBandLegend (older bands), so the strip matches what the editor colours by.
function pactLegend() {
  const legend = [
    ["pk-compute", "UC_",  "COMPUTE — pure, no reads/enforce"],
    ["pk-read",    "UR_",  "READ — bounded point read"],
    ["pk-heavy",   "URH_", "HEAVY-READ ⚠ — scan (select/keys); OFF the execution path only"],
    ["pk-enforce", "UEV_", "ENFORCE — read + enforce; can abort the tx (UEV_/CAP_)"],
    ["pk-ctor",    "UDC_", "CONSTRUCT — data/object builder"],
    ["pk-const",   "CT_",  "CONSTANT — constant accessor"],
    ["pk-write",   "WU_",  "WRITE — raw persistence (WI_/WU_/WW_)"],
    ["pk-recipe",  "C_",   "RECIPE — client/admin entrypoint (A_/C_/CC_)"],
    ["pk-orch",    "XI_",  "PROTECTED — protected orchestration (XI_/XE_/XB_)"],
    ["pk-struct",  "GOV",  "STRUCTURAL — governance/policy/SECURE/UEV_IMC boilerplate"],
  ];
  return el("div", { class: "pact-legend" }, legend.map(([cls, tag, desc]) =>
    el("span", { class: "pact-legend-item", title: desc }, [el("code", { class: cls }, [tag]), el("span", { class: "pact-legend-desc" }, [desc])])));
}

// Worktree query fragment for a Pact-IDE fetch: "" for main (or unset), else "&worktree=<name>". Every
// per-box/per-tab read/save/diff appends this so it acts on that box's bound checkout (Stage-1 worktrees).
const pactWtQ = (wt) => (wt && wt !== "main") ? "&worktree=" + encodeURIComponent(wt) : "";
// The worktree the file TREE + Changed panel currently reflect: the ACTIVE editor box's worktree, so
// browsing shows the checkout you're working in (Stage-3 polish). Same paths across worktrees; content +
// git-status differ.
function pactActiveWt() {
  if (!PACT_ED) return "main";
  const g = PACT_ED.groups.find((x) => x.id === PACT_ED.activeId);
  return (g && g.worktree) || "main";
}
async function loadPactDir(rel, container) {
  let d;
  try { d = await (await fetch("/api/pact/tree?dir=" + encodeURIComponent(rel) + pactWtQ(pactActiveWt()))).json(); }
  catch { container.replaceChildren(el("div", { class: "hint" }, ["Tree unavailable."])); return; }
  if (!d.ok) { container.replaceChildren(el("div", { class: "hint" }, [d.error || "error"])); return; }
  if (!d.items.length) { container.replaceChildren(el("div", { class: "hint", style: "padding:4px 8px" }, ["(empty)"])); return; }
  container.replaceChildren(...d.items.map((it) => pactNode(it)));
  pactTreeApplyChangeColors();   // color the freshly-rendered nodes (+ update dir hints) from the current map
}
function pactNode(it) {
  if (it.type === "dir") {
    const kids = el("div", { class: "pact-node-kids" }); kids.hidden = true; kids.dataset.path = it.path;
    let loaded = false;
    const chev = el("span", { class: "pact-chev" }, ["▸"]);
    const row = el("div", { class: "pact-node pact-dir" }, [chev, el("span", { class: "pact-node-ic" }, ["📁"]), el("span", { class: "pact-node-name" }, [it.name])]);
    row.dataset.path = it.path;   // so pactTreeApplyChangeColors can give it a "changes below" hint
    const wrap = el("div", { class: "pact-node-wrap" }, [row, kids]);
    wrap.dataset.path = it.path;
    // Track which folders are open (PACT_ED.treeExpanded) so a post-turn re-scan can restore them, and
    // expose _expand() so that re-scan can re-open this folder programmatically.
    const setOpen = async (open) => {
      kids.hidden = !open;
      chev.textContent = open ? "▾" : "▸";
      if (PACT_ED && PACT_ED.treeExpanded) { if (open) PACT_ED.treeExpanded.add(it.path); else PACT_ED.treeExpanded.delete(it.path); }
      if (open && !loaded) { loaded = true; await loadPactDir(it.path, kids); }   // loadPactDir re-colors on completion
    };
    wrap._expand = () => setOpen(true);
    row.addEventListener("click", () => setOpen(kids.hidden));
    return wrap;
  }
  const row = el("div", { class: "pact-node pact-file", title: it.path }, [
    el("span", { class: "pact-chev" }, [""]), el("span", { class: "pact-node-ic" }, [pactFileIcon(it.name)]), el("span", { class: "pact-node-name" }, [it.name]),
  ]);
  row.dataset.path = it.path;   // stable key so the tree can be re-colored on update without a full re-render
  pactFileRowApplyGit(row, pactChangedStatusMap().get(it.path) || null);   // initial color at creation
  // Desktop: tap opens into the active box. Mobile: viewPactMobile installs PACT_MOBILE_FILE_TAP, which
  // pops the double-donut box picker instead (M3). Read the hook at click time so the (cached, warmed-once)
  // tree always routes to the CURRENT mobile view — and falls back to pactEdOpen after a rotate to desktop.
  row.addEventListener("click", () => {
    if (pactIsMobile() && typeof PACT_MOBILE_FILE_TAP === "function") PACT_MOBILE_FILE_TAP(it.path, row);
    else pactEdOpen(it.path, row);
  });
  return row;
}
let PACT_MOBILE_FILE_TAP = null;   // (path,row)=>… set by viewPactMobile; the tree's file tap → donut picker
let PACT_MOBILE_SESSIONS_CB = null;   // ()=>… set by viewPactMobile while its history sheet is open; re-renders it when a `sessions` fetch lands
let PACT_MOBILE_PAINT_CB = null;      // ()=>… set by viewPactMobile's chatStage; syncs the mobile control bar's send/stop + chat count to the active tab (called at the end of pactChatPaint)
// Whether the mobile compose box is pinned to a single line (so a long draft stops eating into the
// transcript). Persisted so the choice survives reloads. Toggled from the control bar (v1.3.8).
let PACT_COMPOSE_COLLAPSED = (() => { try { return localStorage.getItem("pact.compose.collapsed") === "1"; } catch { return false; } })();
// ---- Pact .repl terminal runner: stream `pact <file>.repl` over SSE into the right-column terminal.
let PACT_RUN_ES = null;
function pactTermEl() { return document.querySelector(".pact-terminal"); }
function pactTermAppend(text, cls) {
  const t = pactTermEl(); if (!t) return;
  t.appendChild(el("span", cls ? { class: cls } : {}, [text]));
  t.scrollTop = t.scrollHeight;
}
function pactStopRun() { if (PACT_RUN_ES) { try { PACT_RUN_ES.close(); } catch {} PACT_RUN_ES = null; } }
function pactRunRepl(rel) {
  const t = pactTermEl(); if (!t) return;
  pactStopRun();
  t.replaceChildren();
  pactTermAppend("❯ pact " + rel.split("/").pop() + "\n", "pt-cmd");
  let es;
  try { es = new EventSource("/api/pact/run?path=" + encodeURIComponent(rel)); }
  catch { pactTermAppend("[cannot start run]\n", "pt-err"); return; }
  PACT_RUN_ES = es;
  es.addEventListener("out", (e) => pactTermAppend(JSON.parse(e.data).chunk));
  es.addEventListener("err", (e) => pactTermAppend(JSON.parse(e.data).chunk, "pt-err"));
  es.addEventListener("exit", (e) => { const d = JSON.parse(e.data); pactTermAppend("\n[exit " + d.code + " · " + d.ms + " ms]\n", d.code === 0 ? "pt-ok" : "pt-err"); pactStopRun(); });
  es.addEventListener("fail", (e) => { pactTermAppend("\n[error: " + (JSON.parse(e.data).message || "spawn failed") + "]\n", "pt-err"); pactStopRun(); });
  // Native connection error (server end / drop). Guarded so a clean exit doesn't print a spurious line.
  es.addEventListener("error", () => { if (PACT_RUN_ES) { pactTermAppend("\n[disconnected]\n", "pt-err"); pactStopRun(); } });
}
// ---- Multi-group tabbed editor (Zone A). Up to 6 boxes, each with its own tabs; the tree opens a
// file into the ACTIVE box; ⊞ splits (adds a box), × closes it. Content is fetched once per tab and
// cached, so switching tabs is instant. Files render per type: .pact/.repl → StoicSyntax coloring,
// .md → markdown, else plain monospace.
// ===== PACT MOBILE — pure helpers (sliced out for unit tests; see lib/pactMobile.test.mjs). No DOM.
// pactRoman: 1..8 → the roman numeral shown for a "View boxes" menu entry (I…VIII). Out of range → "".
function pactRoman(n) {
  const R = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
  return Number.isInteger(n) && n >= 1 && n <= 8 ? R[n] : "";
}
// pactMobileDefaultSel: the default full-screen selection for the phone shell. Always the agent Chat —
// the user's primary entry point on load/reload (the prime conversation, scrolled to its latest message).
// Takes the { id, active } box snapshots for signature/back-compat but ignores them: Chat is the deliberate
// default (v1.3.4). Pure — the DOM render (viewPactMobile) consumes it.
function pactMobileDefaultSel(groups, activeId) {
  return { kind: "chat" };
}
// pactDonutSegments: the wedge states for the mobile tree's double-donut file-open picker. Always 8 wedges
// (1-based indices), one per POSSIBLE view box (pactEdLayout caps at 8). Given the number of open boxes:
//   1..boxCount        → 'open'     (tap opens the file into that EXISTING box)
//   boxCount+1 (if ≤8) → 'next'     (tap CREATES that box via pactEdAddGroup, then opens the file there)
//   the rest           → 'disabled' (rendered but not tappable)
// Junk/negative counts clamp to 0; counts > 8 clamp to 8 (all 'open', no 'next'). Pure — the SVG render
// (viewPactMobile) consumes it.
function pactDonutSegments(boxCount) {
  const n = Math.max(0, Math.min(8, Number.isInteger(boxCount) ? boxCount : 0));
  const out = [];
  for (let i = 1; i <= 8; i++) {
    out.push({ index: i, state: i <= n ? "open" : (i === n + 1 ? "next" : "disabled") });
  }
  return out;
}
// pactChatMsgLabel: the "N msg"/"N msgs" count shown on a history row (mobile history sheet). Mirrors the
// desktop 🕐 row's `${turns} msg${…}` wording. Junk/negative → "0 msgs". Pure — the sheet render consumes it.
function pactChatMsgLabel(turns) {
  const n = Number.isFinite(turns) && turns > 0 ? Math.floor(turns) : 0;
  return n + " msg" + (n === 1 ? "" : "s");
}
// ===== end PACT MOBILE pure helpers =====
// The Pact workspace has a bespoke phone re-layout (viewPactMobile). Gate it on the SAME 900px breakpoint
// the rest of the dashboard's mobile chrome uses (WS_MOBILE_MQ), so the JS branch and the CSS
// `@media (max-width:900px)` rules never disagree at the edge. Re-render on a cross so rotating a device
// swaps the desktop⇄mobile layout cleanly.
const PACT_MOBILE_MQ = window.matchMedia ? window.matchMedia("(max-width: 900px), (pointer: coarse) and (max-width: 1180px)") : { matches: false, addEventListener() {} };
function pactIsMobile() { return !!PACT_MOBILE_MQ.matches; }
if (PACT_MOBILE_MQ.addEventListener) PACT_MOBILE_MQ.addEventListener("change", () => {
  if (VIEW !== "pact") return;
  if (typeof PACT_CHAT !== "undefined" && PACT_CHAT) pactChatStop();   // close the old chat stream before the rebuild reopens one
  // Drop the mobile-only hooks so the discarded stage's closures (a gone donut / history sheet) can't fire
  // into detached DOM after the swap; viewPactMobile re-installs its own on the way back.
  PACT_MOBILE_FILE_TAP = null; PACT_MOBILE_SESSIONS_CB = null; PACT_MOBILE_PAINT_CB = null;
  render();
});
let PACT_TREE_FONT = 12.5;   // tree font size (px), adjustable via the tree header A-/A+
let PACT_ED = null;   // { host, groups:[group], activeId, seq }; group = { id, tabs:[{path,name,loaded,content,error}], active, fontPx }
function pactEdInit(host) { PACT_ED = { host, groups: [], activeId: null, seq: 0, treeExpanded: new Set(), worktrees: [{ name: "main", branch: "main", isMain: true }], _treeWt: "main" }; pactEdAddGroup(); pactEdLoadWorktrees(); }
// Fetch the Pact repo's checkouts (main + any worktrees) so each editor box can be BOUND to one. Cheap;
// refreshed on init and after a worktree add/remove. When more than main exists, box headers show a
// worktree selector (see pactEdRenderGroup).
async function pactEdLoadWorktrees() {
  if (!PACT_ED) return;
  let d; try { d = await (await fetch("/api/pact/worktrees")).json(); } catch { return; }
  if (d && d.ok && Array.isArray(d.worktrees) && d.worktrees.length) {
    PACT_ED.worktrees = d.worktrees;
    pactReconcileWorktrees(d.worktrees);                     // a conversation whose worktree was removed → back on main
    for (const g of PACT_ED.groups) pactEdRenderGroup(g);   // reveal/refresh the box selectors
    if (PACT_CHAT && PACT_CHAT.host && typeof pactChatRender === "function") pactChatRender();   // and the chat-head selector
  }
}
// When a worktree is merged & removed — whether via the UI's "Merge & return" OR by the AGENT running the git
// commands itself (which the client can't observe live) — any conversation still BOUND to it is now pointing
// at a checkout that no longer exists; its next prompt would fail "worktree not found". Flip those tabs back
// to main and drop a visible marker, so returning to main happens automatically instead of stranding the tab.
function pactReconcileWorktrees(worktrees) {
  const have = new Set((worktrees || []).map((w) => w && w.name).filter(Boolean));
  // CHAT tabs bound to a removed worktree → back to main.
  if (PACT_CHAT && Array.isArray(PACT_CHAT.tabs)) {
    let changed = false;
    for (const t of PACT_CHAT.tabs) {
      if (t.worktree && t.worktree !== "main" && !have.has(t.worktree)) {
        const gone = t.worktree;
        t.worktree = undefined;                               // ← back on main; the next prompt runs there
        // A transient note for immediate feedback; the persistent "returned to main" separator is derived from
        // the transcript once the next (main) turn runs (pactDeriveMigrations sees the worktree→main transition),
        // so no explicit marker is added here — that would double it.
        if (Array.isArray(t.msgs)) t.msgs.push({ kind: "note", text: `⌥ Worktree "${gone}" was merged & removed — this conversation is back on main.` });
        t._forceBottom = true;
        changed = true;
      }
    }
    if (changed) { pactStateSave(); pactChatRender(); const a = pactChatActive && pactChatActive(); if (a) pactChatPaint(a); }
  }
  // EDITOR boxes bound to a removed worktree → back to main + reload their files (fixes "⚠ worktree not found").
  if (PACT_ED && Array.isArray(PACT_ED.groups)) {
    let edChanged = false;
    for (const g of PACT_ED.groups) {
      if (g.worktree && g.worktree !== "main" && !have.has(g.worktree)) { pactEdRevertGroupToMain(g); edChanged = true; }
    }
    // The file TREE follows a box; if it was pointed at the removed worktree, snap it back to main too.
    if (PACT_ED._treeWt && PACT_ED._treeWt !== "main" && !have.has(PACT_ED._treeWt)) {
      PACT_ED._treeWt = "main";
      if (PACT_ED.treeHdWt) { PACT_ED.treeHdWt.textContent = ""; PACT_ED.treeHdWt.hidden = true; }
      if (typeof pactTreeRefresh === "function") pactTreeRefresh();
    }
    if (edChanged) pactStateSave();
  }
}
// ---- Stage-3: worktree lifecycle from the Pact IDE (create / merge-to-main / remove) --------------
function pactWorktreeMenu(x, y) {
  const wts = (PACT_ED && PACT_ED.worktrees) || [{ name: "main", isMain: true }];
  const named = wts.filter((w) => !w.isMain);
  const items = [{ label: "＋ New worktree…", onClick: pactWorktreeCreate }];
  items.push("---");
  if (named.length) for (const w of named) items.push({ label: "⌥ " + w.name, submenu: [
    { label: "Merge into main", onClick: () => pactWorktreeMerge(w.name) },
    { label: "Remove worktree", onClick: () => pactWorktreeRemove(w.name) },
  ] });
  else items.push({ label: "No worktrees yet — create one to isolate parallel work", disabled: true });
  pactShowCtxMenu(x, y, items);
}
// A tidy in-app alert (reuses the styled modal, not a native popup): title + message + a single OK.
const pactNotify = (title, msg, danger) => showModal({ title, sub: msg, confirmLabel: "OK", danger: !!danger });
async function pactWorktreeAct(action, name) {
  let r;
  try { r = await fetch("/api/pact/worktree", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, name }) }); }
  catch { return { ok: false, error: "Couldn't reach the work machine." }; }
  // The worktree endpoints ship in an update that may not be on the RUNNING dashboard yet (a restart is
  // needed). A 404 there otherwise looks like "nothing happened" — surface it plainly instead.
  if (r.status === 404) return { ok: false, error: "Worktree management isn't available on the running dashboard yet — restart the dashboard to enable it (create/merge/remove ship in an update that hasn't been deployed)." };
  try { return await r.json(); }
  catch { return { ok: false, error: `The dashboard returned an unexpected response (HTTP ${r.status}).` }; }
}
async function pactWorktreeCreate() {
  const name = await showModal({ title: "＋ New worktree", sub: "A fresh isolated checkout + branch off HEAD. Letters, digits, . _ - only.", editable: true, value: "", confirmLabel: "Create" });
  if (name == null || !name.trim()) return;
  const d = await pactWorktreeAct("create", name.trim());
  if (d.ok) { pactEdSaveStatus('✓ worktree "' + name.trim() + '" created', false); pactEdLoadWorktrees(); if (d.staleWarning) await pactNotify("Worktree reattached", d.staleWarning, true); }
  else await pactNotify("Couldn't create worktree", d.error || "create failed", true);
}
async function pactWorktreeRemove(name) {
  if (!(await showModal({ title: `Remove worktree "${name}"?`, sub: "Deletes its checkout folder; the branch and its commits are kept. Any UNCOMMITTED work in that checkout is lost — merge it first if you want its changes.", confirmLabel: "Remove", danger: true }))) return;
  const d = await pactWorktreeAct("remove", name);
  if (d.ok) {
    // Unbind any box/unstarted-chat pointing at the now-gone worktree so it doesn't error on the missing checkout.
    for (const g of PACT_ED.groups) if (g.worktree === name) { g.worktree = undefined; for (const t of g.tabs) t.worktree = "main"; }
    if (PACT_CHAT) for (const t of PACT_CHAT.tabs) if (t.worktree === name && !(t.started || (t.msgs && t.msgs.length))) t.worktree = undefined;
    pactEdSaveStatus('✓ worktree "' + name + '" removed', false); pactEdLoadWorktrees(); pactStateSave();
  } else await pactNotify("Couldn't remove worktree", d.error || "remove failed", true);
}
async function pactWorktreeMerge(name) {
  if (!(await showModal({ title: `Merge "${name}" into main?`, sub: "Both checkouts must be committed-clean (a merge only takes committed work). If it would conflict, it's aborted and main is left exactly as it is.", confirmLabel: "Merge" }))) return;
  pactEdSaveStatus('merging "' + name + '" into main…', false);
  const d = await pactWorktreeAct("merge", name);
  if (d.ok) pactEdSaveStatus('✓ merged "' + name + '" into ' + (d.mainBranch || "main") + " (" + (d.merged || 0) + " commit" + (d.merged === 1 ? "" : "s") + ")", false);
  else await pactNotify("Merge not done", d.error || "merge failed", true);
  pactEdCheckChangedFiles();
}
// Bind an editor box to a worktree. Reloads every open tab from the NEW checkout (same paths, different
// content). Refuses if the box has unsaved edits — switching would discard them — so nothing is lost.
async function pactEdSetGroupWorktree(g, wt) {
  const norm = (wt && wt !== "main") ? wt : undefined;
  if ((g.worktree || undefined) === norm) return;
  const dirty = g.tabs.filter((t) => t.dirty);
  if (dirty.length) {
    pactEdSaveStatus("Save or close the " + dirty.length + " unsaved file(s) in this box before switching its worktree.", true);
    pactEdRenderGroup(g);   // snap the selector back to the box's current worktree
    return;
  }
  g.worktree = norm;
  for (const t of g.tabs) { t.worktree = norm || "main"; t.loaded = false; t.agentDiff = null; t.diffBase = undefined; t.headContent = undefined; t.error = null; }
  pactEdRenderGroup(g);   // shows "Loading…" while the reloads land
  for (const t of g.tabs) {
    let d; try { d = await (await fetch("/api/pact/file?path=" + encodeURIComponent(t.path) + pactWtQ(t.worktree))).json(); } catch { d = { ok: false, error: "unreachable" }; }
    if (d.ok) { t.content = d.content; t.saved = d.content; t.dirty = false; t.loaded = true; t.error = null; }
    else { t.error = (d.error || "not in this worktree") + (d.tooLarge ? ` (${Math.round((d.size || 0) / 1e6)} MB)` : ""); t.loaded = true; }
  }
  pactEdRenderGroup(g);
  if (g.id === PACT_ED.activeId) pactEdSyncTreeToActiveBox();   // the active box changed worktree → re-point the tree
  pactStateSave();
}
// Force a box back to main because its worktree was REMOVED (merged & deleted — via the UI or by the agent's
// own git). Unlike pactEdSetGroupWorktree this can't honour a dirty-file guard: the worktree is gone, so those
// edits couldn't be saved there anyway — reload each file from the main checkout so the box is usable again
// instead of stuck on "⚠ worktree not found".
async function pactEdRevertGroupToMain(g) {
  if (!g) return;
  g.worktree = undefined;
  for (const t of g.tabs) { t.worktree = "main"; t.loaded = false; t.dirty = false; t.agentDiff = null; t.diffBase = undefined; t.headContent = undefined; t.error = null; }
  pactEdRenderGroup(g);
  for (const t of g.tabs) {
    let d; try { d = await (await fetch("/api/pact/file?path=" + encodeURIComponent(t.path) + pactWtQ("main"))).json(); } catch { d = { ok: false, error: "unreachable" }; }
    if (d.ok) { t.content = d.content; t.saved = d.content; t.dirty = false; t.loaded = true; t.error = null; }
    else { t.error = (d.error || "not found in main"); t.loaded = true; }
  }
  pactEdRenderGroup(g);
  if (g.id === PACT_ED.activeId) pactEdSyncTreeToActiveBox();
}
function pactEdAddGroup() {
  if (!PACT_ED || PACT_ED.groups.length >= 8) return;
  PACT_ED.groups.push({ id: ++PACT_ED.seq, tabs: [], active: null });
  PACT_ED.activeId = PACT_ED.seq;
  pactEdLayout();
}
function pactEdCloseGroup(id) {
  if (!PACT_ED || PACT_ED.groups.length <= 1) return;
  PACT_ED.groups = PACT_ED.groups.filter((g) => g.id !== id);
  if (PACT_ED.activeId === id) PACT_ED.activeId = PACT_ED.groups[0].id;
  pactEdLayout();
}
function pactEdCloseTab(g, path) {
  const i = g.tabs.findIndex((t) => t.path === path); if (i < 0) return;
  g.tabs.splice(i, 1);
  if (g.active === path) g.active = g.tabs.length ? g.tabs[Math.max(0, i - 1)].path : null;
  pactEdRenderGroup(g);
  pactStateSave();
}
// ===== PACT TAB-MOVE — pure helper (unit-tested via lib/pactTabMove.test.mjs) =====
// Chrome-style tab drag: reorder within a box, or move a tab BETWEEN boxes. Given the source/target boxes'
// path lists, the dragged `path`, and the path it was dropped BEFORE (null = drop at the end), returns the
// resulting path lists. Blocks a no-op (dropped on itself) and a cross-box move onto a box that already has
// that file open (which would duplicate it). For a same-box reorder, `from`/`to` are the one new order.
function pactTabMovePlan(fromPaths, toPaths, path, beforePath, sameGroup) {
  const src0 = Array.isArray(fromPaths) ? fromPaths.slice() : [];
  const tgt0 = sameGroup ? src0.slice() : (Array.isArray(toPaths) ? toPaths.slice() : []);
  if (!src0.includes(path)) return { from: src0, to: sameGroup ? src0 : tgt0, blocked: true };
  if (sameGroup && beforePath === path) return { from: src0, to: src0, blocked: true };   // dropped on itself
  if (!sameGroup && tgt0.includes(path)) return { from: src0, to: tgt0, blocked: true };   // already open there
  const src = src0.filter((p) => p !== path);
  const tgt = sameGroup ? src : tgt0.slice();
  let j = tgt.length;
  if (beforePath != null && beforePath !== path) { const bi = tgt.indexOf(beforePath); if (bi >= 0) j = bi; }
  tgt.splice(j, 0, path);
  return sameGroup ? { from: tgt, to: tgt, blocked: false } : { from: src, to: tgt, blocked: false };
}
// ===== end PACT TAB-MOVE pure helper =====
// Apply a tab move to the live editor model (moves the whole tab OBJECT — its CodeMirror + unsaved content
// ride along), then relayout. `beforePath` is the drop target (null = end of the destination box).
function pactEdMoveTab(fromGid, path, toGid, beforePath) {
  const fromG = PACT_ED.groups.find((g) => g.id === fromGid);
  const toG = PACT_ED.groups.find((g) => g.id === toGid);
  if (!fromG || !toG) return;
  const sameGroup = fromG === toG;
  const plan = pactTabMovePlan(fromG.tabs.map((t) => t.path), sameGroup ? null : toG.tabs.map((t) => t.path), path, beforePath, sameGroup);
  if (plan.blocked) return;
  const tab = fromG.tabs.find((t) => t.path === path);
  if (!tab) return;
  if (sameGroup) {
    fromG.tabs = plan.from.map((p) => fromG.tabs.find((t) => t.path === p));
    fromG.active = path;
  } else {
    fromG.tabs = plan.from.map((p) => fromG.tabs.find((t) => t.path === p));
    if (!fromG.tabs.some((t) => t.path === fromG.active)) fromG.active = fromG.tabs.length ? fromG.tabs[0].path : null;
    toG.tabs = plan.to.map((p) => (p === path ? tab : toG.tabs.find((t) => t.path === p)));
    toG.active = path; PACT_ED.activeId = toG.id;
  }
  pactEdLayout();
  pactStateSave();
}
// ---- Tab right-click context menu (desktop) ----------------------------------------------------
let PACT_CTX_EL = null;
function pactCloseCtxMenu() {
  if (!PACT_CTX_EL) return;
  PACT_CTX_EL.remove(); PACT_CTX_EL = null;
  document.removeEventListener("mousedown", pactCtxOutside, true);
  document.removeEventListener("keydown", pactCtxKey, true);
  window.removeEventListener("blur", pactCloseCtxMenu);
}
function pactCtxOutside(e) { if (PACT_CTX_EL && !PACT_CTX_EL.contains(e.target)) pactCloseCtxMenu(); }
function pactCtxKey(e) { if (e.key === "Escape") pactCloseCtxMenu(); }
// items: [{ label, onClick?, submenu?:[...], disabled? }]. A `---` string is a separator.
function pactCtxItemNode(it) {
  if (it === "---") return el("div", { class: "pact-ctx-sep" }, []);
  const hasSub = Array.isArray(it.submenu) && it.submenu.length;
  const row = el("div", { class: "pact-ctx-item" + (hasSub ? " --has-sub" : "") + (it.disabled ? " --disabled" : "") }, [
    el("span", { class: "pact-ctx-label" }, [it.label]),
    hasSub ? el("span", { class: "pact-ctx-arrow" }, ["▸"]) : "",
  ]);
  if (it.disabled) return row;
  if (hasSub) { row.appendChild(el("div", { class: "pact-ctx-sub" }, it.submenu.map(pactCtxItemNode))); }
  else { row.addEventListener("click", (e) => { e.stopPropagation(); const fn = it.onClick; pactCloseCtxMenu(); if (fn) fn(); }); }
  return row;
}
function pactShowCtxMenu(x, y, items) {
  pactCloseCtxMenu();
  const menu = el("div", { class: "pact-ctx-menu" }, items.map(pactCtxItemNode));
  document.body.appendChild(menu);
  PACT_CTX_EL = menu;
  const r = menu.getBoundingClientRect();
  const left = Math.max(6, Math.min(x, window.innerWidth - r.width - 6));
  menu.style.left = left + "px";
  menu.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 6)) + "px";
  if (left + r.width + 176 > window.innerWidth) menu.classList.add("--left");   // open submenus leftward near the right edge
  setTimeout(() => {   // defer so the opening right-click's own mouseup/mousedown doesn't instantly close it
    document.addEventListener("mousedown", pactCtxOutside, true);
    document.addEventListener("keydown", pactCtxKey, true);
    window.addEventListener("blur", pactCloseCtxMenu);
  }, 0);
}
// Build + show the per-tab menu: clone/move to another box (submenu of boxes + New box), font size, find.
function pactEdTabMenu(clientX, clientY, g, tb) {
  const label = (gg) => "Box " + (PACT_ED.groups.indexOf(gg) + 1) + (gg.active ? " · " + gg.active.split("/").pop() : "");
  const others = PACT_ED.groups.filter((gg) => gg.id !== g.id);
  const cloneSub = others.map((gg) => ({ label: label(gg), onClick: () => pactEdOpenInto(gg, tb.path, true, true) }));
  cloneSub.push({ label: "＋ New box", onClick: () => { pactEdAddGroup(); const ng = PACT_ED.groups[PACT_ED.groups.length - 1]; pactEdOpenInto(ng, tb.path, true, true); } });
  const moveSub = others.map((gg) => ({ label: label(gg), onClick: () => pactEdMoveTab(g.id, tb.path, gg.id, null) }));
  moveSub.push({ label: "＋ New box", onClick: () => { pactEdAddGroup(); const ng = PACT_ED.groups[PACT_ED.groups.length - 1]; pactEdMoveTab(g.id, tb.path, ng.id, null); } });
  pactShowCtxMenu(clientX, clientY, [
    { label: "Reveal in tree", onClick: () => pactTreeReveal(tb.path) },
    "---",
    { label: "Clone to", submenu: cloneSub },
    { label: "Move to", submenu: moveSub },
    "---",
    { label: "Text size  A+", onClick: () => { g.fontPx = Math.min(22, (g.fontPx || 12.5) + 1); pactEdRenderGroup(g); pactStateSave(); } },
    { label: "Text size  A−", onClick: () => { g.fontPx = Math.max(9, (g.fontPx || 12.5) - 1); pactEdRenderGroup(g); pactStateSave(); } },
    "---",
    { label: "Find / Replace…", onClick: () => { PACT_ED.activeId = g.id; g.active = tb.path; pactEdLayout(); const gg = PACT_ED.groups.find((x) => x.id === g.id); if (gg) { const s = pactEdSearchState(gg); s.open = true; s.replaceMode = true; pactEdRenderGroupFooter(gg); pactEdSyncSearchPanel(gg, true); } } },
  ]);
}
// The path the drop would land BEFORE, from the pointer x over a box's tab header (null = at the end).
function pactEdDropBefore(headerEl, clientX) {
  for (const t of headerEl.querySelectorAll(".pact-tab2")) {
    const r = t.getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return t.dataset.path || null;
  }
  return null;
}
// Clear any drag-over affordance across all boxes.
function pactEdClearDropCue() {
  if (!PACT_ED) return;
  for (const g of PACT_ED.groups) {
    if (!g.tabsEl) continue;
    g.tabsEl.classList.remove("--dnd-over");
    for (const t of g.tabsEl.querySelectorAll(".pact-tab2.--drop-before")) t.classList.remove("--drop-before");
  }
}
// The split ladder (point 6): how the N boxes distribute into rows. Each entry is the box count per
// row, top-to-bottom. Under-filled last rows (5→[3,2], 7→[4,3]) simply share their row equally.
const PACT_ED_ROWS = { 1: [1], 2: [2], 3: [3], 4: [4], 5: [3, 2], 6: [3, 3], 7: [4, 3], 8: [4, 4] };
// A draggable gutter between two flex siblings. `axis` "x" resizes the two groups within a row (via
// each group's flex-grow), "y" resizes two rows (via PACT_ED.rowFlex). Equal by default; weights live
// on the group objects / PACT_ED.rowFlex so they survive re-renders (tab switches) but reset when the
// box count changes.
function pactEdGutter(axis, getA, getB, container, onApply) {
  const gut = el("div", { class: axis === "x" ? "pact-ed-gutter-x" : "pact-ed-gutter-y" }, []);
  gut.addEventListener("mousedown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const rect = container.getBoundingClientRect();
    const total = axis === "x" ? rect.width : rect.height;
    const start = axis === "x" ? e.clientX : e.clientY;
    const a0 = getA(), b0 = getB(), sum = a0 + b0;
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    const move = (ev) => {
      const pos = axis === "x" ? ev.clientX : ev.clientY;
      const frac = total > 0 ? ((pos - start) / total) * sum : 0;
      const min = sum * 0.15;
      let a = a0 + frac, b = b0 - frac;
      if (a < min) { a = min; b = sum - min; }
      if (b < min) { b = min; a = sum - min; }
      onApply(a, b);
    };
    const up = () => {
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
      document.body.style.cursor = ""; document.body.style.userSelect = "";
      pactStateSave();   // persist the new box/row weights
    };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  });
  return gut;
}
function pactEdLayout() {
  const host = PACT_ED.host, n = PACT_ED.groups.length;
  const dist = PACT_ED_ROWS[n] || [4, 4];
  // Equal by default: reset the resize weights whenever the box count changes.
  if (PACT_ED.layoutN !== n) { PACT_ED.layoutN = n; PACT_ED.rowFlex = dist.map(() => 1); for (const g of PACT_ED.groups) g.flex = 1; }
  for (const g of PACT_ED.groups) {
    g.tabsEl = el("div", { class: "pact-ed-hd" });
    g.bodyEl = el("div", { class: "pact-ed-body" });
    g.footEl = el("div", { class: "pact-ed-foot" });   // per-box control strip (font/split/close/search) — keeps the tab row full-width for file names
    g.el = el("div", { class: "pact-ed-group" + (g.id === PACT_ED.activeId ? " --active" : "") }, [g.tabsEl, g.bodyEl, g.footEl]);
    g.el.style.flex = (g.flex || 1) + " 1 0";
    g.el.addEventListener("mousedown", () => {
      if (PACT_ED.activeId !== g.id) {
        PACT_ED.activeId = g.id;
        for (const gg of PACT_ED.groups) gg.el.classList.toggle("--active", gg.id === PACT_ED.activeId);
        pactEdSyncTreeToActiveBox();   // re-point the tree at this box's worktree (only re-scans if it changed)
        if (g.active) pactTreeReveal(g.active);   // selecting a box reveals the file it's showing (IDE auto-reveal)
      }
    });
  }
  const rowEls = [];
  let idx = 0;
  dist.forEach((count, ri) => {
    const groups = PACT_ED.groups.slice(idx, idx + count); idx += count;
    const rowEl = el("div", { class: "pact-ed-row" }, []);
    rowEl.style.flex = (PACT_ED.rowFlex[ri] || 1) + " 1 0";
    const kids = [];
    groups.forEach((g, gi) => {
      kids.push(g.el);
      if (gi < groups.length - 1) {
        const b = groups[gi + 1];
        kids.push(pactEdGutter("x", () => g.flex || 1, () => b.flex || 1, rowEl, (av, bv) => {
          g.flex = av; b.flex = bv; g.el.style.flex = av + " 1 0"; b.el.style.flex = bv + " 1 0";
        }));
      }
    });
    rowEl.replaceChildren(...kids);
    rowEls.push(rowEl);
  });
  const hostKids = [];
  rowEls.forEach((rowEl, ri) => {
    hostKids.push(rowEl);
    if (ri < rowEls.length - 1) {
      const next = rowEls[ri + 1];
      hostKids.push(pactEdGutter("y", () => PACT_ED.rowFlex[ri] || 1, () => PACT_ED.rowFlex[ri + 1] || 1, host, (av, bv) => {
        PACT_ED.rowFlex[ri] = av; PACT_ED.rowFlex[ri + 1] = bv; rowEl.style.flex = av + " 1 0"; next.style.flex = bv + " 1 0";
      }));
    }
  });
  host.replaceChildren(...hostKids);
  for (const g of PACT_ED.groups) pactEdRenderGroup(g);
  pactStateSave();
}
function pactEdRenderGroup(g) {
  const tabs = g.tabs.map((tb) => {
    const x = el("span", { class: "pact-tab2-x", title: "Close tab" }, ["×"]);
    x.addEventListener("click", (e) => { e.stopPropagation(); pactEdCloseTab(g, tb.path); });
    const ext = (tb.name.split(".").pop() || "").toLowerCase();
    const tab = el("div", { class: "pact-tab2 pk-t-" + ext + (tb.path === g.active ? " --active" : "") + (tb.dirty ? " --dirty" : ""), title: tb.path }, [
      el("span", { class: "pact-tab2-dot", title: "Unsaved changes" }, []),
      el("span", { class: "pact-tab2-ic" }, [pactFileIcon(tb.name)]), el("span", { class: "pact-tab2-name" }, [tb.name]), x,
    ]);
    tb._tabEl = tab;
    tab.addEventListener("click", () => { PACT_ED.activeId = g.id; g.active = tb.path; pactEdLayout(); pactEdSyncTreeToActiveBox(); pactTreeReveal(tb.path); });
    // Chrome-style drag: reorder within this box, or drop onto another box's tab row to move the file
    // there (the whole tab — its editor + unsaved edits — moves with it). See pactEdMoveTab. (v1.4.6)
    tab.setAttribute("draggable", "true");
    tab.dataset.path = tb.path;
    tab.addEventListener("dragstart", (e) => {
      PACT_ED._drag = { gid: g.id, path: tb.path };
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", tb.path); } catch {}
      tab.classList.add("--dragging");
    });
    tab.addEventListener("dragend", () => { PACT_ED._drag = null; tab.classList.remove("--dragging"); pactEdClearDropCue(); });
    // Desktop right-click menu: clone/move to another box, font size, find/replace.
    tab.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); pactEdTabMenu(e.clientX, e.clientY, g, tb); });
    return tab;
  });
  const active = g.tabs.find((t) => t.path === g.active);
  // The tab row is now JUST the file tabs — full width, so many open files aren't crushed by the buttons.
  g.tabsEl.replaceChildren(el("div", { class: "pact-tabs2" }, tabs));
  // Make this box's tab row a drop target (bound once per freshly-built header node). Dropping a dragged
  // tab here moves it into THIS box at the pointer position (or the end).
  if (!g.tabsEl._dndBound) {
    g.tabsEl._dndBound = true;
    g.tabsEl.addEventListener("dragover", (e) => {
      if (!PACT_ED._drag) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = "move"; } catch {}
      g.tabsEl.classList.add("--dnd-over");
      const before = pactEdDropBefore(g.tabsEl, e.clientX);
      for (const t of g.tabsEl.querySelectorAll(".pact-tab2.--drop-before")) t.classList.remove("--drop-before");
      if (before) { const bt = [...g.tabsEl.querySelectorAll(".pact-tab2")].find((t) => t.dataset.path === before); if (bt) bt.classList.add("--drop-before"); }
    });
    g.tabsEl.addEventListener("dragleave", (e) => { if (!g.tabsEl.contains(e.relatedTarget)) { g.tabsEl.classList.remove("--dnd-over"); for (const t of g.tabsEl.querySelectorAll(".pact-tab2.--drop-before")) t.classList.remove("--drop-before"); } });
    g.tabsEl.addEventListener("drop", (e) => {
      if (!PACT_ED._drag) return;
      e.preventDefault(); e.stopPropagation();
      const d = PACT_ED._drag; PACT_ED._drag = null;
      const before = pactEdDropBefore(g.tabsEl, e.clientX);
      pactEdClearDropCue();
      pactEdMoveTab(d.gid, d.path, g.id, before);
    });
  }

  // All box controls live on a slim bottom strip (footer): contextual Run/preview on the left; font,
  // split, close, and the Find/Replace toggles on the right. Keeps the header clean for file names. (v1.4.5)
  const ctx = [];
  // Worktree binding for THIS box (Stage-1): when more than the main checkout exists, a small selector
  // ties the box to one worktree — every file opened in it reads/saves from that checkout, isolated from
  // the other boxes' worktrees. Hidden when only `main` exists (no clutter until you actually make one).
  if (PACT_ED.worktrees && PACT_ED.worktrees.length > 1) {
    const sel = el("select", { class: "pact-wt-sel" + ((g.worktree && g.worktree !== "main") ? " --active" : ""), title: "Worktree this box reads & writes — files opened here come from this checkout, isolated from other boxes" },
      PACT_ED.worktrees.map((w) => el("option", { value: w.name }, [w.isMain ? "⌂ main" : "⌥ " + w.name])));
    sel.value = g.worktree || "main";
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", (e) => { e.stopPropagation(); pactEdSetGroupWorktree(g, sel.value); });
    ctx.push(sel);
  }
  if (active && active.name.toLowerCase().endsWith(".repl")) {
    const run = el("button", { class: "pact-run-btn", title: "Run this .repl and stream the output" }, ["▶ Run"]);
    run.addEventListener("click", (e) => { e.stopPropagation(); pactRunRepl(active.path); });
    ctx.push(run);
  }
  if (active && active.name.toLowerCase().endsWith(".md")) {
    const md = el("button", { class: "pact-ed-ico", title: active.editing ? "Preview the rendered markdown" : "Edit the raw markdown" }, [active.editing ? "👁" : "✎"]);
    md.addEventListener("click", (e) => { e.stopPropagation(); active.editing = !active.editing; pactEdRenderGroup(g); });
    ctx.push(md);
  }
  const s = pactEdSearchState(g);
  const findBtn = el("button", { class: "pact-ed-ico" + (s.open && !s.replaceMode ? " --on" : ""), title: "Find in this box (Ctrl/⌘-F)" }, ["🔍"]);
  findBtn.addEventListener("click", (e) => { e.stopPropagation(); pactEdToggleSearch(g, false); });
  const replBtn = el("button", { class: "pact-ed-ico" + (s.open && s.replaceMode ? " --on" : ""), title: "Find & replace in this box (Ctrl/⌘-H)" }, ["⇄"]);
  replBtn.addEventListener("click", (e) => { e.stopPropagation(); pactEdToggleSearch(g, true); });
  // Font size as a single stepper: ◀ <px> ▶ — the number shows this box's exact font size so you always
  // know how big each box is. Clicking snaps to whole px going forward. (v1.4.9)
  const curPx = Math.round(g.fontPx || 12.5);
  const fDown = el("button", { class: "pact-font-arrow", title: "Smaller font (this box)" }, ["◀"]);
  const fNum = el("span", { class: "pact-font-num", title: "Font size for this box (px)" }, [String(curPx)]);
  const fUp = el("button", { class: "pact-font-arrow", title: "Bigger font (this box)" }, ["▶"]);
  fDown.addEventListener("click", (e) => { e.stopPropagation(); g.fontPx = Math.max(9, curPx - 1); pactEdRenderGroup(g); pactStateSave(); });
  fUp.addEventListener("click", (e) => { e.stopPropagation(); g.fontPx = Math.min(22, curPx + 1); pactEdRenderGroup(g); pactStateSave(); });
  const fontStep = el("div", { class: "pact-font-step", title: "Font size for this box" }, [fDown, fNum, fUp]);
  const split = el("button", { class: "pact-ed-ico", title: "Split — open another editor box (up to 8)" }, ["⊞"]);
  split.addEventListener("click", (e) => { e.stopPropagation(); pactEdAddGroup(); });
  const right = [findBtn, replBtn, fontStep, split];
  if (PACT_ED.groups.length > 1) {
    const closeG = el("button", { class: "pact-ed-ico", title: "Close this editor box" }, ["×"]);
    closeG.addEventListener("click", (e) => { e.stopPropagation(); pactEdCloseGroup(g.id); });
    right.push(closeG);
  }
  g.footEl.replaceChildren(...ctx, el("span", { class: "ws-spacer" }, []), ...right);
  pactEdRenderBody(g, active);
  // Re-attach the Find/Replace panel (if open) to the freshly-rendered box, and re-run the query against
  // the NOW-visible file — so switching files in this box carries the search over automatically.
  if (s.open) pactEdSyncSearchPanel(g, false);
}

// ===== PACT EDITOR SEARCH/REPLACE — a per-box find panel tied to that box's active CodeMirror =====
// Each editor box (group `g`) keeps its own { find, replace, cs, open, replaceMode } on `g._search`. The
// panel drives the box's ACTIVE file's CM: highlight-all via an overlay, prev/next via the searchcursor
// addon, replace / replace-all, and a live match count. When the box switches files the panel stays and
// re-runs against the newly-visible file (see pactEdRenderGroup's tail).
// ===== PACT SEARCH-COUNT — pure helper (unit-tested via lib/pactSearchCount.test.mjs) =====
function pactCountOccurrences(text, query, caseSensitive) {
  if (query == null || query === "") return 0;
  const h = caseSensitive ? String(text) : String(text).toLowerCase();
  const q = caseSensitive ? String(query) : String(query).toLowerCase();
  let n = 0, i = 0;
  while ((i = h.indexOf(q, i)) !== -1) { n++; i += q.length; }
  return n;
}
// ===== end PACT SEARCH-COUNT pure helper =====
function pactEdSearchState(g) { return g._search || (g._search = { find: "", replace: "", cs: false, open: false, replaceMode: false }); }
// The mounted editor for the active tab — the editable CM, or the read-only diff CM when it's an agent
// edit. Native find/replace targets it (replace is gated off for the read-only diff via pactEdActiveDiff).
function pactEdActiveCm(g) {
  const a = g.tabs.find((t) => t.path === g.active);
  if (!a) return null;
  if (a.agentDiff) return a._diffCm || null;
  return (a.loaded && a._cm) ? a._cm : null;
}
// True when the active tab is the read-only agent diff (so the panel hides Replace).
function pactEdActiveDiff(g) { const a = g.tabs.find((t) => t.path === g.active); return (a && a.agentDiff) ? a : null; }
function pactEdSearchClear(g) {
  if (g._searchOverlay && g._searchCm) { try { g._searchCm.removeOverlay(g._searchOverlay); } catch {} }
  if (g._searchScroll) { try { g._searchScroll.clear(); } catch {} g._searchScroll = null; }   // scrollbar stripes
  g._searchOverlay = null; g._searchCm = null;
}
// A CM overlay that highlights every occurrence of a plain-string query (class cm-pact-search-match).
function pactMakeSearchOverlay(query, cs) {
  const q = cs ? query : String(query).toLowerCase();
  return { token(stream) {
    if (!q) { stream.skipToEnd(); return null; }
    const line = cs ? stream.string : stream.string.toLowerCase();
    const idx = line.indexOf(q, stream.pos);
    if (idx === stream.pos) { stream.pos += q.length; return "pact-search-match"; }
    if (idx === -1) { stream.skipToEnd(); return null; }
    stream.pos = idx; return null;
  } };
}
// The 1-based index of the match at the current selection + the total — for the "5/7" readout.
function pactEdSearchPos(cm, query, cs) {
  if (!query) return { current: 0, total: 0 };
  const from = cm.getCursor("from");
  let total = 0, current = 0;
  const cur = cm.getSearchCursor(query, { line: 0, ch: 0 }, !cs);
  while (cur.findNext()) { total++; const f = cur.from(); if (!current && f.line === from.line && f.ch === from.ch) current = total; }
  return { current, total };
}
function pactEdSearchUpdateCount(g) {
  const count = g._searchPanel && g._searchPanel.querySelector(".pact-search-count");
  if (!count) return;
  const cm = pactEdActiveCm(g), s = pactEdSearchState(g);
  if (!cm || !s.find) { count.textContent = ""; return; }
  const p = pactEdSearchPos(cm, s.find, s.cs);
  count.textContent = p.total ? (p.current + "/" + p.total) : "0/0";
}
function pactEdSearchApply(g) {
  const s = pactEdSearchState(g);
  pactEdSearchClear(g);
  const cm = pactEdActiveCm(g);
  const count = g._searchPanel && g._searchPanel.querySelector(".pact-search-count");
  if (!cm || !s.find) { if (count) count.textContent = ""; return; }
  const ov = pactMakeSearchOverlay(s.find, s.cs);
  cm.addOverlay(ov); g._searchOverlay = ov; g._searchCm = cm;
  // Yellow intermittent stripes on the scrollbar for each match (matchesonscrollbar addon).
  if (typeof cm.showMatchesOnScrollbar === "function") { try { g._searchScroll = cm.showMatchesOnScrollbar(s.find, !s.cs, { className: "CodeMirror-search-match" }); } catch {} }
  // Reveal the first match at/after the cursor (stays put if the cursor is already on one) so the readout
  // is a live position "cur/total" rather than a static count — and Enter pages from there.
  const rc = cm.getSearchCursor(s.find, cm.getCursor("from"), !s.cs);
  if (rc.findNext()) { cm.setSelection(rc.from(), rc.to()); cm.scrollIntoView({ from: rc.from(), to: rc.to() }, 80); }
  else { const w = cm.getSearchCursor(s.find, { line: 0, ch: 0 }, !s.cs); if (w.findNext()) { cm.setSelection(w.from(), w.to()); cm.scrollIntoView({ from: w.from(), to: w.to() }, 80); } }
  pactEdSearchUpdateCount(g);
}
function pactEdSearchNav(g, dir) {
  const s = pactEdSearchState(g); const cm = pactEdActiveCm(g);
  if (!cm || !s.find) return;
  const start = dir > 0 ? cm.getCursor("to") : cm.getCursor("from");
  let cur = cm.getSearchCursor(s.find, start, !s.cs);
  let ok = dir > 0 ? cur.findNext() : cur.findPrevious();
  if (!ok) { cur = cm.getSearchCursor(s.find, dir > 0 ? { line: 0, ch: 0 } : { line: cm.lineCount(), ch: 0 }, !s.cs); ok = dir > 0 ? cur.findNext() : cur.findPrevious(); }
  if (ok) { cm.setSelection(cur.from(), cur.to()); cm.scrollIntoView({ from: cur.from(), to: cur.to() }, 80); }
  pactEdSearchUpdateCount(g);
}
// Seed the Find field from the editor's current selection when opening search (single-line selections
// only — a multi-line selection isn't a sensible query).
function pactEdSeedFindFromSelection(g) {
  const cm = pactEdActiveCm(g); if (!cm) return;
  const sel = cm.getSelection();
  if (sel && sel.length && sel.indexOf("\n") === -1) pactEdSearchState(g).find = sel;
}
function pactEdSearchReplaceOne(g) {
  const s = pactEdSearchState(g); const cm = pactEdActiveCm(g);
  if (!cm || !s.find) return;
  const sel = cm.getSelection();
  const isMatch = sel && (s.cs ? sel === s.find : sel.toLowerCase() === s.find.toLowerCase());
  if (isMatch) cm.replaceSelection(s.replace);
  pactEdSearchNav(g, 1);
  pactEdSearchApply(g);
}
function pactEdSearchReplaceAll(g) {
  const s = pactEdSearchState(g); const cm = pactEdActiveCm(g);
  if (!cm || !s.find) return;
  cm.operation(() => { const cur = cm.getSearchCursor(s.find, { line: 0, ch: 0 }, !s.cs); while (cur.findNext()) cur.replace(s.replace); });
  pactEdSearchApply(g);
}
function pactEdToggleSearch(g, replaceMode) {
  const s = pactEdSearchState(g);
  if (s.open && s.replaceMode === !!replaceMode) s.open = false;   // same button again → close
  else { s.open = true; s.replaceMode = !!replaceMode; pactEdSeedFindFromSelection(g); }   // opening → prefill from the editor selection
  pactEdRenderGroupFooter(g);   // reflect the --on state without rebuilding the CM
  pactEdSyncSearchPanel(g, true);
}
// Rebuild ONLY the footer button --on state (cheap; avoids a full CM rebuild on a search toggle).
function pactEdRenderGroupFooter(g) {
  const s = pactEdSearchState(g);
  const find = g.footEl && g.footEl.querySelector('[title^="Find in this box"]');
  const repl = g.footEl && g.footEl.querySelector('[title^="Find & replace"]');
  if (find) find.classList.toggle("--on", s.open && !s.replaceMode);
  if (repl) repl.classList.toggle("--on", s.open && s.replaceMode);
}
// Build/replace the floating Find/Replace panel on the box and apply the query to the visible file.
function pactEdSyncSearchPanel(g, focus) {
  const s = pactEdSearchState(g);
  if (g._searchPanel) { g._searchPanel.remove(); g._searchPanel = null; }
  if (!s.open) { pactEdSearchClear(g); return; }
  const findIn = el("input", { class: "pact-search-in", type: "text", placeholder: "Find", value: s.find });
  const count = el("span", { class: "pact-search-count" }, []);
  const prev = el("button", { class: "pact-ed-ico", title: "Previous (Shift-Enter)" }, ["▲"]);
  const next = el("button", { class: "pact-ed-ico", title: "Next (Enter)" }, ["▼"]);
  const csBtn = el("button", { class: "pact-ed-ico" + (s.cs ? " --on" : ""), title: "Match case" }, ["Aa"]);
  const closeB = el("button", { class: "pact-ed-ico", title: "Close (Esc)" }, ["×"]);
  prev.addEventListener("click", (e) => { e.stopPropagation(); pactEdSearchNav(g, -1); });
  next.addEventListener("click", (e) => { e.stopPropagation(); pactEdSearchNav(g, 1); });
  csBtn.addEventListener("click", (e) => { e.stopPropagation(); s.cs = !s.cs; csBtn.classList.toggle("--on", s.cs); pactEdSearchApply(g); });
  closeB.addEventListener("click", (e) => { e.stopPropagation(); s.open = false; pactEdRenderGroupFooter(g); pactEdSyncSearchPanel(g, false); });
  findIn.addEventListener("input", () => { s.find = findIn.value; pactEdSearchApply(g); });
  findIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); pactEdSearchNav(g, e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); s.open = false; pactEdRenderGroupFooter(g); pactEdSyncSearchPanel(g, false); const cm = pactEdActiveCm(g); if (cm) cm.focus(); }
  });
  const findRow = el("div", { class: "pact-search-row" }, [findIn, count, prev, next, csBtn, closeB]);
  const rows = [findRow];
  const isDiff = !!pactEdActiveDiff(g);   // agent green/red diff is read-only → find only, no replace
  if (isDiff) rows.push(el("div", { class: "pact-search-hint" }, ["Find in the agent diff — Keep All first to edit/replace."]));
  if (s.replaceMode && !isDiff) {
    const replIn = el("input", { class: "pact-search-in", type: "text", placeholder: "Replace", value: s.replace });
    replIn.addEventListener("input", () => { s.replace = replIn.value; });
    const one = el("button", { class: "pact-ed-ico", title: "Replace this match" }, ["Replace"]);
    const all = el("button", { class: "pact-ed-ico", title: "Replace all matches" }, ["All"]);
    one.addEventListener("click", (e) => { e.stopPropagation(); pactEdSearchReplaceOne(g); });
    all.addEventListener("click", (e) => { e.stopPropagation(); pactEdSearchReplaceAll(g); });
    replIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); pactEdSearchReplaceOne(g); } });
    rows.push(el("div", { class: "pact-search-row" }, [replIn, one, all]));
  }
  const panel = el("div", { class: "pact-ed-search" }, rows);
  panel.addEventListener("mousedown", (e) => e.stopPropagation());   // clicking the panel shouldn't re-activate/scroll the box
  g._searchPanel = panel;
  g.el.appendChild(panel);
  pactEdSearchApply(g);
  if (focus) { findIn.focus(); findIn.select(); }   // prefilled text is selected so you can retype over it immediately
}
function pactEdRenderBody(g, tab) {
  if (!tab) { g.bodyEl.replaceChildren(el("div", { class: "pact-editor-empty hint" }, ["Empty box — pick a file from the tree."])); return; }
  if (tab.error) { g.bodyEl.replaceChildren(el("div", { class: "hint", style: "padding:10px;color:#f87171" }, ["⚠ " + tab.error])); return; }
  if (!tab.loaded) { g.bodyEl.replaceChildren(el("div", { class: "hint", style: "padding:10px" }, ["Loading…"])); return; }
  const ext = tab.path.toLowerCase();
  // Agent edited this file: a READ-ONLY CodeMirror of the new file — added lines green, deleted lines as
  // red inline markers — until Keep All accepts it. Real CM ⇒ native find/scrollbar work here too.
  if (tab.agentDiff) {
    const cm = pactEdBuildDiffCm(g, tab, ext);
    g._cm = cm;   // so Ctrl/⌘-F + the search panel target this diff (pactEdActiveCm returns it)
    cm.getWrapperElement().style.fontSize = (g.fontPx || 12.5) + "px";
    const hd = el("div", { class: "pact-diff-hd" }, [
      el("span", { class: "pd-badge pd-badge-add" }, ["+" + tab.agentDiff.add]),
      el("span", { class: "pd-badge pd-badge-del" }, ["−" + tab.agentDiff.del]),
      el("span", { class: "hint", style: "margin-left:8px" }, ["agent edit — Keep All to accept + resume editing"]),
    ]);
    // Proportional overview ruler: green/red bands sized + placed by the ADDED/REMOVED runs across the
    // WHOLE diff (every row), so a 176-line deletion shows a tall red band at the right spot. CM's own
    // scrollbar annotation can't do this — deleted lines are widgets, not document lines, so it collapsed
    // any deletion to a single-line stripe. (v1.4.19)
    const ovr = el("div", { class: "pact-diff-ovr", "aria-hidden": "true" });
    for (const b of pactDiffOvrBands(tab.agentDiff.rows)) {
      const tick = el("div", { class: "pact-diff-ovr-" + b.type });
      tick.style.top = b.top + "%"; tick.style.height = b.height + "%";
      ovr.append(tick);
    }
    g.bodyEl.replaceChildren(hd, el("div", { class: "pact-diff-scrollwrap" }, [tab._diffHost, ovr]));
    requestAnimationFrame(() => cm.refresh());   // CM needs a laid-out host to size itself
    return;
  }
  // Markdown renders as a preview by default; ✎ toggles a raw editor (tab.editing).
  if (ext.endsWith(".md") && !tab.editing && typeof window.mdRender === "function") {
    const md = el("div", { class: "pact-md" }); md.innerHTML = window.mdRender(tab.content);
    g.bodyEl.replaceChildren(el("div", { class: "pact-editor-scroll" }, [md]));
    return;
  }
  // Editable surface: a real CodeMirror 5 instance (see pactEdBuildCm). CM owns line numbers, the caret,
  // scrolling, bracket matching, the active-line highlight, find/replace, and (once wired) inline folding —
  // so all the old textarea-overlay machinery (transparent <textarea> over a highlighted <pre>, the
  // hand-rolled line-number gutter, the find overlay, caret-reveal) is gone. The CM instance is cached on
  // the tab and simply re-appended on tab switches / font changes, keeping undo history + caret.
  const cm = pactEdBuildCm(g, tab, ext);
  g._cm = cm;   // the active box's editor (used by the Ctrl/⌘-F routing + font buttons)
  const fontPx = g.fontPx || 12.5;
  cm.getWrapperElement().style.fontSize = fontPx + "px";
  g.bodyEl.replaceChildren(tab._cmHost);
  requestAnimationFrame(() => { cm.refresh(); });   // CM needs a laid-out host to size itself
  // No git-vs-HEAD scrollbar ruler on the editable view (it painted the whole bar gold on an uncommitted
  // file — noise). Change stripes appear ONLY in the agent-edit diff (green added / red removed); the
  // scrollbar otherwise shows just the yellow search-match stripes. (v1.4.16)
}
// ---- Auto-reveal the cursor after you scroll away and go idle (per editor box) ----
const PACT_ED_CURSOR_REVEAL_MS = 15000;   // idle-since-last-scroll before smoothly revealing the cursor
// Clamp a (possibly stale) saved cursor to a valid position in the CM's current doc — so an open file
// ALWAYS has a real cursor position, even after its content was swapped (e.g. Keep-All) or a saved line
// no longer exists. Junk → the very start.
function pactEdClampPos(cm, pos) {
  const last = Math.max(0, cm.lineCount() - 1);
  const line = (pos && Number.isFinite(pos.line)) ? Math.max(0, Math.min(pos.line, last)) : 0;
  const ch = (pos && Number.isFinite(pos.ch)) ? Math.max(0, Math.min(pos.ch, cm.getLine(line).length)) : 0;
  return { line, ch };
}
function pactEdSmoothScrollTo(cm, targetTop) {
  const sc = cm.getScrollerElement(); if (!sc) return;
  const start = sc.scrollTop, dist = Math.max(0, targetTop) - start;
  if (Math.abs(dist) < 4) return;
  cm._autoScrollCancel = false; cm._autoScrolling = true;
  const dur = 420, t0 = performance.now();
  const step = (now) => {
    if (cm._autoScrollCancel) { cm._autoScrolling = false; return; }
    const p = Math.min(1, (now - t0) / dur);
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;   // easeInOutQuad
    sc.scrollTop = start + dist * e;
    if (p < 1) requestAnimationFrame(step); else cm._autoScrolling = false;
  };
  requestAnimationFrame(step);
}
function pactEdScheduleCursorReveal(cm) {
  if (cm._autoScrolling) return;      // our own animation is moving the scroll — ignore its scroll events
  cm._autoScrollCancel = true;        // any fresh (user) scroll cancels an in-flight auto-reveal
  clearTimeout(cm._revealT);
  cm._revealT = setTimeout(() => {
    try {
      const sc = cm.getScrollerElement(); if (!sc) return;
      const cc = cm.charCoords(cm.getCursor(), "local");
      const top = sc.scrollTop, bottom = top + sc.clientHeight;
      if (cc.top >= top && cc.bottom <= bottom) return;   // cursor already visible — leave the view alone
      pactEdSmoothScrollTo(cm, cc.top - sc.clientHeight / 2 + (cc.bottom - cc.top) / 2);   // center the cursor
    } catch {}
  }, PACT_ED_CURSOR_REVEAL_MS);
}
// Build (or reuse) the CodeMirror editor for a tab. One CM instance per tab, cached on `tab._cm` with its
// host node on `tab._cmHost`, so switching tabs / bumping the font just re-appends the same editor (undo +
// caret survive). `.pact`/`.repl` get the StoicSyntax mode + fold gutter; everything else is plain text.
function pactEdBuildCm(g, tab, ext) {
  if (tab._cm) {
    // Reuse: only force the doc if it diverged out-of-band (e.g. Keep-All swapped in the on-disk content).
    // setValue resets the caret to the top, so restore the tab's remembered cursor (clamped) — an open
    // file must never be left without a cursor position.
    if (tab._cm.getValue() !== tab.content) { tab._cm.setValue(tab.content); tab._cm.clearHistory(); tab._cm.setCursor(pactEdClampPos(tab._cm, tab._cursor)); }
    return tab._cm;
  }
  const isPact = ext.endsWith(".pact") || ext.endsWith(".repl");
  const host = el("div", { class: "pact-cm-host" });
  const extraKeys = {
    "Cmd-S": () => pactEdSaveAll(), "Ctrl-S": () => pactEdSaveAll(),
    "Tab": (cmi) => cmi.execCommand("insertSoftTab"),
    "Cmd-F": "findPersistent", "Ctrl-F": "findPersistent",
    "Cmd-H": "replace", "Ctrl-H": "replace",
    "Cmd-G": "findNext", "Ctrl-G": "findNext",
    "Shift-Cmd-G": "findPrev", "Shift-Ctrl-G": "findPrev",
  };
  const cm = window.CodeMirror(host, {
    value: tab.content,
    mode: isPact ? "stoicpact" : null,
    lineNumbers: true,
    lineWrapping: false,
    tabSize: 2,
    indentUnit: 2,
    indentWithTabs: false,
    matchBrackets: true,
    styleActiveLine: true,
    // Inline folding for .pact/.repl: the fold gutter's ▾/▸ arrows collapse modules/interfaces/def*
    // blocks WHILE the editor stays fully editable (no read-only mode). The range finder is built from
    // our paren logic (pactFoldRanges → pactCmFoldRanges), cached per doc value on the CM instance.
    gutters: isPact ? ["CodeMirror-linenumbers", "CodeMirror-foldgutter"] : ["CodeMirror-linenumbers"],
    foldGutter: isPact,
    foldOptions: isPact ? { rangeFinder: pactCmRangeFinder } : undefined,
    extraKeys,
  });
  cm.on("change", () => { tab.content = cm.getValue(); pactEdMarkDirty(g, tab); });
  // Remember this box's cursor as it moves, so every open file always has a position (survives content
  // swaps, tab switches, font changes) and the auto-reveal always has a target.
  cm.on("cursorActivity", () => { tab._cursor = cm.getCursor(); });
  // After you scroll away and go idle, smoothly bring the cursor back into view — each box tracks its own
  // (blinking) cursor. Only fires when the cursor is actually off-screen, and a fresh scroll cancels it.
  cm.on("scroll", () => pactEdScheduleCursorReveal(cm));
  cm.setCursor(pactEdClampPos(cm, tab._cursor));   // guarantee a valid cursor from the moment the file opens
  tab._cursor = cm.getCursor();
  tab._cm = cm; tab._cmHost = host;
  return cm;
}
// Build (or reuse) a READ-ONLY CodeMirror for the agent-edit diff. The doc is the NEW file (so the
// StoicSyntax mode highlights it correctly — feeding it the interleaved old+new text would mangle
// multi-line strings), ADDED lines get a green background + a "+" gutter, and DELETED lines are shown as
// red inline markers (line widgets) at their position. This makes the diff a real editor: native find,
// the scrollbar, etc. Deleted text lives in the widgets (visible, but not part of the searchable doc).
function pactEdBuildDiffCm(g, tab, ext) {
  const rows = (tab.agentDiff && tab.agentDiff.rows) || [];
  const isPact = ext.endsWith(".pact") || ext.endsWith(".repl");
  const after = rows.filter((r) => r.type !== "del").map((r) => r.text).join("\n");
  const canHl = isPact && typeof window.pactHighlight === "function";
  const beforeHl = canHl ? pactHighlightLines(rows.filter((r) => r.type !== "add").map((r) => r.text).join("\n"), tab.path) : null;
  let cm = tab._diffCm;
  if (!cm) {
    const host = el("div", { class: "pact-cm-host pact-diff-cm" });
    cm = window.CodeMirror(host, {
      value: after, mode: isPact ? "stoicpact" : null,
      lineNumbers: true, lineWrapping: false, tabSize: 2, indentUnit: 2,
      readOnly: true, matchBrackets: false,
      gutters: ["CodeMirror-linenumbers", "pact-diff-sign"],
    });
    tab._diffCm = cm; tab._diffHost = host;
  } else if (cm.getValue() !== after) { cm.setValue(after); }
  cm.operation(() => {
    if (tab._diffWidgets) for (const w of tab._diffWidgets) { try { w.clear(); } catch {} }
    tab._diffWidgets = [];
    for (let i = 0; i < cm.lineCount(); i++) { cm.removeLineClass(i, "background", "pd-add-line"); cm.setGutterMarker(i, "pact-diff-sign", null); }
    const addLines = [], delLines = [];
    let afterIdx = -1, beforeIdx = -1, pending = [];
    const flush = (line, above) => {
      if (!pending.length) return;
      const wrap = el("div", { class: "pact-diff-del-widget" });
      for (const p of pending) {
        const txt = el("span", { class: "pd-text" });
        if (p.hl != null) txt.innerHTML = p.hl === "" ? "&nbsp;" : p.hl; else txt.textContent = p.text === "" ? " " : p.text;
        wrap.append(el("div", { class: "pact-diff-del-line" }, [el("span", { class: "pd-gsign pd-gdel" }, ["−"]), txt]));
      }
      tab._diffWidgets.push(cm.addLineWidget(line, wrap, { above: !!above }));
      delLines.push(line);
      pending = [];
    };
    for (const r of rows) {
      if (r.type === "del") { beforeIdx++; pending.push({ text: r.text, hl: beforeHl ? beforeHl[beforeIdx] : null }); continue; }
      afterIdx++;
      if (r.type === "same") beforeIdx++;
      if (pending.length) flush(afterIdx, true);
      if (r.type === "add") { addLines.push(afterIdx); cm.addLineClass(afterIdx, "background", "pd-add-line"); cm.setGutterMarker(afterIdx, "pact-diff-sign", el("span", { class: "pd-gsign pd-gadd" }, ["+"])); }
    }
    if (pending.length) flush(Math.max(0, cm.lineCount() - 1), false);
    // NOTE: no annotateScrollbar here — a deletion is a widget, not a document line, so CM's scrollbar
    // annotation collapsed every deletion to a single-line stripe. The proportional green/red bands are
    // painted by the .pact-diff-ovr overview ruler in pactEdRenderBody instead (sized by row count).
  });
  return cm;
}
// ===== PACT CHANGE RULER — git-diff scrollbar decorations on the CM editor (S4). Reuses the pure
// pactChangeMarks(HEAD, current) diff and pactChangeAnnRanges mapping; paints three CM annotateScrollbar
// layers (add=green, del=red, mod=amber) on the native scrollbar. Recomputed on open (once HEAD is
// fetched), on edit (debounced 250ms), and after save / Keep-All. Empty ruler when there are 0 changes
// or git/HEAD is unavailable (tab.headContent unset). CM's native scrollbar handles click-to-scroll.
function pactEdScheduleRuler(tab) {
  if (!tab) return;
  if (tab._rulerT) clearTimeout(tab._rulerT);
  tab._rulerT = setTimeout(() => { tab._rulerT = null; pactEdUpdateRuler(tab); }, 250);
}
function pactEdUpdateRuler(tab) {
  const cm = tab && tab._cm;
  if (!cm || typeof cm.annotateScrollbar !== "function") return;
  if (!cm._ann) cm._ann = { add: cm.annotateScrollbar("cm-change-add"), del: cm.annotateScrollbar("cm-change-del"), mod: cm.annotateScrollbar("cm-change-mod") };
  const ann = cm._ann;
  if (typeof tab.headContent !== "string") { ann.add.update([]); ann.del.update([]); ann.mod.update([]); return; }
  // Normalize line endings on BOTH sides — a CRLF (or a lone CR) in the git HEAD blob against the editor's
  // LF would otherwise differ on EVERY line and paint the whole ruler "modified" (the amber-everywhere bug).
  const norm = (str) => String(str).replace(/\r\n?/g, "\n");
  const ranges = pactChangeAnnRanges(pactChangeMarks(norm(tab.headContent), norm(cm.getValue())));
  ann.add.update(ranges.add); ann.del.update(ranges.del); ann.mod.update(ranges.mod);
}
// CodeMirror fold RangeFinder for .pact/.repl: given a start Pos, return the {from,to} of the foldable
// block whose opener is on that line, or null. Ranges (pactCmFoldRanges) are recomputed only when the doc
// value changes and cached on the CM instance, so foldgutter's per-line probing stays O(1) after the map
// is built (not O(n) per line). CM.Pos-based; the pure line→range mapping lives in pactCmFoldRanges.
function pactCmRangeFinder(cm, start) {
  const val = cm.getValue();
  if (cm._foldVal !== val) {
    cm._foldMap = new Map(pactCmFoldRanges(val).map((r) => [r.from.line, r]));
    cm._foldVal = val;
  }
  const r = cm._foldMap.get(start.line);
  return r ? { from: window.CodeMirror.Pos(r.from.line, r.from.ch), to: window.CodeMirror.Pos(r.to.line, r.to.ch) } : null;
}
// ---- Save state: per-tab dirty (content ≠ last saved), a global Save-All button, debounced autosave.
function pactEdAnyDirty() { return !!(PACT_ED && PACT_ED.groups.some((g) => g.tabs.some((t) => t.dirty))); }
function pactEdDirtyCount() { return PACT_ED ? PACT_ED.groups.reduce((a, g) => a + g.tabs.filter((t) => t.dirty).length, 0) : 0; }
function pactEdUpdateSaveBar() {
  if (!PACT_ED) return;
  if (PACT_ED.saveBtn) {
    const n = pactEdDirtyCount();
    PACT_ED.saveBtn.disabled = n === 0;
    PACT_ED.saveBtn.textContent = n ? `💾 Save All (${n})` : "💾 Saved";
  }
  if (PACT_ED.keepBtn) {
    const d = pactEdDiffCount();
    PACT_ED.keepBtn.style.display = d ? "" : "none";
    PACT_ED.keepBtn.textContent = d ? `✓ Keep All (${d})` : "✓ Keep All";
  }
}
function pactEdSaveStatus(text, isErr) {
  if (!PACT_ED || !PACT_ED.saveStatus) return;
  PACT_ED.saveStatus.textContent = text || "";
  PACT_ED.saveStatus.classList.toggle("--err", !!isErr);
  if (PACT_ED._statusT) clearTimeout(PACT_ED._statusT);
  if (text && !isErr) PACT_ED._statusT = setTimeout(() => { if (PACT_ED && PACT_ED.saveStatus) PACT_ED.saveStatus.textContent = ""; }, 2600);
}
function pactEdMarkDirty(g, tab) {
  tab.dirty = tab.content !== tab.saved;
  if (tab._tabEl) tab._tabEl.classList.toggle("--dirty", tab.dirty);   // surgical — don't rebuild the body (would drop focus)
  pactEdUpdateSaveBar();
  pactEdScheduleAutosave(tab);
}
function pactEdScheduleAutosave(tab) {
  if (tab._saveTimer) { clearTimeout(tab._saveTimer); tab._saveTimer = null; }
  if (!tab.dirty) return;
  tab._saveTimer = setTimeout(() => { tab._saveTimer = null; pactEdSaveTab(tab); }, 300000);   // 5 min after you stop typing (Ctrl/⌘-S + Save All are immediate)
}
async function pactEdSaveTab(tab, opts = {}) {
  if (!tab || !tab.dirty || tab._saving) return;
  tab._saving = true;
  const snapshot = tab.content;
  // Send the editor's BASELINE (`expected` = what we last loaded/saved from disk) so the server refuses to
  // blindly overwrite a file the agent (or another session in this shared checkout) changed underneath us.
  // Data-loss fix: a silent autosave writing a stale buffer used to revert such files to an old snapshot.
  let d;
  try { d = await (await fetch("/api/pact/file", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: tab.path, content: snapshot, expected: tab.saved, force: !!opts.force, worktree: tab.worktree || "main" }) })).json(); }
  catch { d = { ok: false, error: "unreachable" }; }
  tab._saving = false;
  if (d.ok) {
    tab.saved = snapshot;
    tab.dirty = tab.content !== tab.saved;   // may have kept typing during the request
    if (tab._tabEl) tab._tabEl.classList.toggle("--dirty", tab.dirty);
    pactTreeApplyChangeColors();   // reflect the save on the tree row promptly (uses the current change map)
    if (!tab.dirty) pactEdSaveStatus("✓ saved " + tab.name, false); else pactEdScheduleAutosave(tab);
  } else if (d.conflict) {
    // The file changed on disk since we opened it — NEVER silently overwrite. A background autosave just
    // warns and stops (no reschedule — it would only conflict again). A MANUAL save asks the user, and
    // only force-overwrites on an explicit yes; "Cancel" leaves both versions intact (disk untouched).
    tab._diskConflict = typeof d.current === "string" ? d.current : null;
    if (opts.manual && window.confirm(`"${tab.name}" changed on disk since you opened it — saving now would OVERWRITE those external changes (e.g. the agent's edits, or another session's).\n\nOK = overwrite the disk with YOUR version.\nCancel = keep the disk version untouched (your unsaved edits stay in this box; close + reopen the file to load the disk version).`)) {
      return pactEdSaveTab(tab, { manual: true, force: true });
    }
    pactEdSaveStatus("⚠ " + tab.name + " changed on disk — NOT saved (a blind save would overwrite external edits). Use Save-All to resolve, or close + reopen to load the disk version.", true);
  } else {
    pactEdSaveStatus("⚠ " + (d.message || d.error || "save failed"), true);
  }
  pactEdUpdateSaveBar();
}
async function pactEdSaveAll() {
  if (!PACT_ED) return;
  const dirty = [];
  for (const g of PACT_ED.groups) for (const t of g.tabs) if (t.dirty) { if (t._saveTimer) { clearTimeout(t._saveTimer); t._saveTimer = null; } dirty.push(t); }
  if (!dirty.length) return;
  pactEdSaveStatus("saving " + dirty.length + " file" + (dirty.length > 1 ? "s" : "") + "…", false);
  for (const t of dirty) await pactEdSaveTab(t, { manual: true });   // explicit save → may prompt to resolve an on-disk conflict
  if (!pactEdAnyDirty()) pactEdSaveStatus("✓ all saved", false);
  pactEdCheckChangedFiles();   // re-fetch the change list once (reuses the existing endpoint) so saves/commits re-color the tree
}

// ===== PACT FIND/REPLACE — within-file find + find-and-replace for the active editor box. =====
// Pure helpers (DOM-free, side-effect-free; also unit-tested via lib/pactFind.test.mjs). opts:
//   { cs: case-sensitive, ww: whole-word, re: treat term as a RegExp }.
// pactBuildFindRe → { re } | { bad:true }; pactFindMatches → [{start,end}] | null (bad pattern).
function pactBuildFindRe(term, opts) {
  opts = opts || {};
  if (!term) return { re: null };
  let src = opts.re ? term : term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (opts.ww) src = "\\b(?:" + src + ")\\b";
  try { return { re: new RegExp(src, "g" + (opts.cs ? "" : "i")) }; }
  catch { return { bad: true }; }
}
function pactFindMatches(text, term, opts) {
  if (!term) return [];
  const built = pactBuildFindRe(term, opts);
  if (built.bad) return null;
  const re = built.re, out = [];
  re.lastIndex = 0;
  let m, guard = 0;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (m.index === re.lastIndex) re.lastIndex++;   // zero-width match (e.g. empty regex): step forward
    if (++guard > 200000) break;
  }
  return out;
}
function pactReplaceOne(text, match, term, replStr, opts) {
  if (!match) return text;
  let rep;
  if (opts && opts.re) {
    const built = pactBuildFindRe(term, opts);
    if (built.bad) return null;
    // Re-run on just the matched slice with a non-global clone so $1/$& group refs expand.
    rep = text.slice(match.start, match.end).replace(new RegExp(built.re.source, built.re.flags.replace("g", "")), replStr);
  } else rep = String(replStr);
  return text.slice(0, match.start) + rep + text.slice(match.end);
}
function pactReplaceAll(text, term, replStr, opts) {
  const matches = pactFindMatches(text, term, opts);
  if (matches === null) return null;
  if (!matches.length) return { text, count: 0 };
  const built = pactBuildFindRe(term, opts);
  const repl = opts && opts.re ? replStr : String(replStr).replace(/\$/g, "$$$$");   // literal mode: keep $ literal
  return { text: text.replace(built.re, repl), count: matches.length };
}
// pactFindOverlaySegs(text, matches, curIdx) → ordered [{ text, mark }] covering the WHOLE text, where
// mark is null (gap) | "hit" (a match) | "cur" (the active match, index curIdx). The overlay renders each
// segment as transparent text, wrapping "hit"/"cur" in a translucent <mark> — so every character keeps its
// exact column (white-space:pre) and only match backgrounds show over the syntax-colored code. Zero-width
// matches are skipped (nothing to paint). Pure — unit-tested.
function pactFindOverlaySegs(text, matches, curIdx) {
  const t = String(text), segs = [];
  let pos = 0;
  for (let i = 0; matches && i < matches.length; i++) {
    const m = matches[i];
    if (!m || m.end <= m.start || m.start < pos) continue;   // skip zero-width / overlapping
    if (m.start > pos) segs.push({ text: t.slice(pos, m.start), mark: null });
    segs.push({ text: t.slice(m.start, m.end), mark: i === curIdx ? "cur" : "hit" });
    pos = m.end;
  }
  if (pos < t.length) segs.push({ text: t.slice(pos), mark: null });
  return segs;
}
// ===== end PACT FIND/REPLACE pure helpers =====

// ===== PACT FOLD — string/comment-aware fold-range finder for the read/fold view. =====
// pactFoldRanges(content) → [{ start, end }] 0-based line indices, one per foldable block whose
// opener (`(module`/`(interface`/`(def*`) is the first non-whitespace token on its line and whose
// matching close paren lands on a LATER line (single-line forms don't fold). String- and comment-
// aware — parens inside "…" strings (with \" escapes; strings may span lines) or after `;` comments
// don't count — mirroring pact-highlight.js's scanner. Nested blocks each get their own range;
// unbalanced/partial parens never throw (an unclosed opener simply yields no range). Pure/DOM-free —
// unit-tested via lib/pactFold.test.mjs (same sentinel-slice-and-eval pattern as the find helpers).
function pactFoldRanges(content) {
  const FOLD = new Set(["module", "interface", "defun", "defcap", "defconst", "defschema", "deftable", "defpact"]);
  const s = String(content), n = s.length;
  const isWord = (ch) => /[A-Za-z0-9_|<>.\-]/.test(ch);
  const ranges = [], stack = [];   // stack entry: { line, foldable }
  let line = 0, lineHasNonWs = false, i = 0;
  while (i < n) {
    const c = s[i];
    if (c === "\n") { line++; lineHasNonWs = false; i++; continue; }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v") { i++; continue; }
    if (c === ";") { while (i < n && s[i] !== "\n") i++; continue; }   // comment to end of line
    if (c === '"') {                                                    // string: \" escapes; may span lines
      i++;
      while (i < n) {
        // A backslash escape skips the next char — but if that char is a NEWLINE (Pact's `\`-at-EOL
        // line continuation in a multi-line string, e.g. `@doc "… \<nl> \ …"`), it still advances a
        // physical line. Count it, or every continuation line drifts the line numbers below the
        // highlighted render's — mis-placing every fold arrow after a multi-line string.
        if (s[i] === "\\") { if (s[i + 1] === "\n") { line++; lineHasNonWs = false; } i += 2; continue; }
        if (s[i] === '"') { i++; break; }
        if (s[i] === "\n") { line++; lineHasNonWs = false; i++; continue; }
        i++;
      }
      lineHasNonWs = true; continue;
    }
    if (c === "(") {
      const firstOnLine = !lineHasNonWs; lineHasNonWs = true;
      let j = i + 1; while (j < n && (s[j] === " " || s[j] === "\t")) j++;
      let k = j; while (k < n && isWord(s[k])) k++;
      stack.push({ line, foldable: firstOnLine && FOLD.has(s.slice(j, k)) });
      i++; continue;
    }
    if (c === ")") {
      lineHasNonWs = true;
      const o = stack.pop();
      if (o && o.foldable && line > o.line) ranges.push({ start: o.line, end: line });
      i++; continue;
    }
    lineHasNonWs = true; i++;
  }
  return ranges;
}
// pactFoldHidden(ranges, folded, total) → { hidden:boolean[], feet:Map<endLine,startLine> }.
// Which source lines vanish when the given opener start-lines are collapsed: we hide start+1 .. end-1
// and KEEP the last line (the closing paren) visible directly under the opener, so a collapsed block
// shows its first AND last line. `feet` maps each preserved closing line back to its opener — the fold
// view uses it to draw the connector linking the two. Nested feet inside a collapsed parent are hidden
// (their end line falls in the parent's hidden span), so only outermost-visible feet appear. Pure/
// DOM-free — unit-tested via lib/pactFold.test.mjs.
function pactFoldHidden(ranges, folded, total) {
  const openerByStart = new Map(ranges.map((r) => [r.start, r]));
  const hidden = new Array(total).fill(false);
  for (const start of folded) {
    const r = openerByStart.get(start); if (!r) continue;
    for (let l = r.start + 1; l < r.end && l < total; l++) hidden[l] = true;
  }
  const feet = new Map();
  for (const start of folded) {
    const r = openerByStart.get(start); if (!r) continue;
    if (r.end < total && r.end !== r.start && !hidden[r.end]) feet.set(r.end, r.start);
  }
  return { hidden, feet };
}
// pactFoldCopyText(content, lineA, lineB) → the inclusive source-line slice joined with "\n". The fold
// view's copy handler maps the selection's start/end rows to their source line numbers and calls this,
// so selecting a collapsed block yields the WHOLE block (hidden middle lines included), in source order.
// Whole-line granularity — a fold view never copies mid-line. Pure — unit-tested.
function pactFoldCopyText(content, lineA, lineB) {
  const lines = String(content).split("\n");
  const lo = Math.max(0, Math.min(lineA, lineB));
  const hi = Math.min(lines.length - 1, Math.max(lineA, lineB));
  if (hi < lo) return "";
  return lines.slice(lo, hi + 1).join("\n");
}
// pactCmFoldRanges(content) → [{ from:{line,ch}, to:{line,ch} }], one CodeMirror fold range per foldable
// block from pactFoldRanges. `from` is the END of the opener line (so the opener stays visible) and `to`
// is the END of the block's closing line — folding collapses everything between into the opener + a "…"
// marker, INLINE, while the editor stays fully editable. Pure/DOM-free — unit-tested via lib/pactFold.test.mjs.
function pactCmFoldRanges(content) {
  const lines = String(content).split("\n");
  return pactFoldRanges(content).map((r) => ({
    from: { line: r.start, ch: lines[r.start] != null ? lines[r.start].length : 0 },
    to: { line: r.end, ch: lines[r.end] != null ? lines[r.end].length : 0 },
  }));
}
// ===== end PACT FOLD pure helpers =====

// ===== IDE GUTTER — line-number gutter helpers (pure; unit-tested in lib/pactGutter.test.mjs). =====
// pactGutterLineCount("a\nb") → 2. An empty document still shows line 1; a trailing newline yields an
// extra (empty) final line, matching how a textarea renders its own rows. Counts '\n' — cheap, so the
// editable overlay can call it on every keystroke and only rebuild the gutter when the count changes.
function pactGutterLineCount(text) {
  const s = String(text == null ? "" : text);
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}
// The gutter's text content for N lines: "1\n2\n…\nN". One newline-joined string so the numbers stack
// with the code's exact line-height inside a <pre>; it lives OUTSIDE the textarea and is user-select:none,
// so copying code never grabs a line number.
function pactGutterText(count) {
  const n = Math.max(1, count | 0);
  const out = new Array(n);
  for (let i = 1; i <= n; i++) out[i - 1] = i;
  return out.join("\n");
}
// Column width (in `ch`, so it scales with each box's font-size) for a gutter that must fit `count`
// lines: widest number's digit count, floored at 2 so single-digit files still read as a column.
function pactGutterWidthCh(count) {
  return Math.max(2, String(Math.max(1, count | 0)).length);
}
// ===== end IDE GUTTER pure helpers =====

// Document-level, capture-phase Ctrl/⌘-F (Ctrl/⌘-H for replace) → the active box's CodeMirror find/replace
// dialog, so the in-app search is reachable even when the editor isn't focused (otherwise the browser's own
// page search steals the shortcut — the earlier "find fell through to the browser" bug). CM's search +
// searchcursor + dialog addons (vendored) drive find/next/prev/replace/all, case + regex, and scrollbar
// match annotations. No-ops gracefully (letting the browser have the key) when the active box has no editable
// CM — markdown preview, agent diff, empty/loading tab. Bound ONCE (guarded); self-limits to VIEW === "pact".
let PACT_FIND_KEY_BOUND = false;
function pactEdInstallFindShortcut() {
  if (PACT_FIND_KEY_BOUND) return;
  PACT_FIND_KEY_BOUND = true;
  document.addEventListener("keydown", (e) => {
    if (VIEW !== "pact" || !PACT_ED) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const k = (e.key || "").toLowerCase();
    if (k !== "f" && k !== "h") return;
    const g = PACT_ED.groups.find((gg) => gg.id === PACT_ED.activeId);
    if (!g) return;
    const active = g.tabs.find((t) => t.path === g.active);
    if (!active) return;
    // Take over Ctrl/⌘-F/H inside a Pact editor box so the browser page-search never hijacks it, and open
    // the box's own Find/Replace panel (tied to this box's active file). stopPropagation keeps CM's own
    // Ctrl-F keymap from also firing and toggling a second dialog shut.
    e.preventDefault();
    e.stopPropagation();
    const s = pactEdSearchState(g);   // Ctrl-F/H always OPENS (+ focuses) the box's panel, never toggles it shut
    s.open = true; s.replaceMode = (k === "h");
    pactEdSeedFindFromSelection(g);   // selected text in the editor → seeds the Find field
    pactEdRenderGroupFooter(g);
    pactEdSyncSearchPanel(g, true);
  }, true);
}

// ---- Agent-edit diffs (point 3): the Pact chat agent writes files on disk. After each chat turn we
// re-read every open, non-dirty file; if the agent changed it, the box switches to a Cursor-style diff
// view (green added / red removed lines). "Keep All" accepts them (the new text is already on disk) and
// returns the box to the editable overlay. A user-dirty tab is left alone (their edits win).
// ===== PACT CHANGE-MARKS — pure diff→ruler helper (sliced out for unit tests; see lib/pactChangeMarks.test.mjs)
// pactDiffLines + pactChangeMarks are wrapped in one sentinel block so the test can eval them together
// (pactChangeMarks calls pactDiffLines). No DOM, no side effects.
// pactDiffOvrBands: diff rows → overview-ruler bands (merge adjacent add/del runs into {type,top%,height%}).
function pactDiffOvrBands(rows) {
  rows = Array.isArray(rows) ? rows : [];
  const total = rows.length || 1, out = [];
  let i = 0;
  while (i < rows.length) {
    const t = rows[i] && rows[i].type;
    if (t === "add" || t === "del") {
      let j = i; while (j < rows.length && rows[j] && rows[j].type === t) j++;
      out.push({ type: t, top: (i / total) * 100, height: Math.max(0.5, ((j - i) / total) * 100) });
      i = j;
    } else i++;
  }
  return out;
}
function pactDiffLines(before, after) {
  const A = String(before).split("\n"), B = String(after).split("\n");
  const rows = [];
  // Strip the common prefix and suffix FIRST, then LCS only the middle. A localized edit (e.g. one
  // added comment) in a big file leaves a tiny middle — so the diff is both cheap and correct. The old
  // code instead bailed to a useless whole-file replace whenever A.length*B.length was large, which is
  // why adding a single line to a ~4000-line file reddened the entire old file and greened the entire
  // new one (+3992/−3991) instead of showing just the one added line.
  let lo = 0;
  while (lo < A.length && lo < B.length && A[lo] === B[lo]) lo++;
  let aHi = A.length, bHi = B.length;
  while (aHi > lo && bHi > lo && A[aHi - 1] === B[bHi - 1]) { aHi--; bHi--; }
  for (let k = 0; k < lo; k++) rows.push({ type: "same", text: A[k] });   // common prefix
  const midA = A.slice(lo, aHi), midB = B.slice(lo, bHi);
  const n = midA.length, m = midB.length;
  let add = 0, del = 0;
  if (n * m > 4_000_000) {   // genuinely huge scattered change even after stripping — coarse middle
    for (const l of midA) { rows.push({ type: "del", text: l }); del++; }
    for (const l of midB) { rows.push({ type: "add", text: l }); add++; }
  } else {
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { rows.push({ type: "same", text: midA[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: "del", text: midA[i] }); i++; del++; }
      else { rows.push({ type: "add", text: midB[j] }); j++; add++; }
    }
    while (i < n) { rows.push({ type: "del", text: midA[i++] }); del++; }
    while (j < m) { rows.push({ type: "add", text: midB[j++] }); add++; }
  }
  for (let k = aHi; k < A.length; k++) rows.push({ type: "same", text: A[k] });   // common suffix
  return { rows, add, del };
}
// Map a before/after diff to per-line change marks against the NEW file (0-based line indices), for the
// editor's overview ruler. Returns [{ line, type: 'add'|'del'|'mod' }] in ascending, non-overlapping line
// order. Rules (kept deliberately simple + robust):
//   • before === after            → [] (no changes).
//   • before === ""               → EVERY new line is 'add' (a file not in git / newly added is all-green).
//     (after === "" too ⇒ before===after ⇒ [] already; an emptied file gives a single 'del' at line 0.)
//   • otherwise, walk each maximal run of consecutive non-'same' diff rows (a "hunk"):
//       – mixed (has both add + del rows) → the added lines are a modification: the first min(adds,dels)
//         added lines are 'mod'; any extra added lines beyond the deleted count are 'add'. Extra deletes
//         beyond the added count are absorbed into the 'mod' (no separate marker).
//       – adds only → each added line is 'add'.
//       – dels only → a single 'del' marker at the line boundary that now follows the deletion.
function pactChangeMarks(before, after) {
  const B = String(before == null ? "" : before), A = String(after == null ? "" : after);
  if (B === A) return [];
  if (B === "") {                       // no committed baseline → the whole file reads as added
    if (A === "") return [];
    return A.split("\n").map((_, i) => ({ line: i, type: "add" }));
  }
  if (A === "") return [{ line: 0, type: "del" }];   // whole file deleted → one del marker at the top
  const rows = pactDiffLines(B, A).rows;
  const marks = [];
  let newLine = 0, i = 0;
  while (i < rows.length) {
    if (rows[i].type === "same") { newLine++; i++; continue; }
    const hunkStart = newLine;          // new-line index where this run of changes begins
    const addLines = [];
    let dels = 0;
    while (i < rows.length && rows[i].type !== "same") {
      if (rows[i].type === "add") { addLines.push(newLine); newLine++; } else dels++;
      i++;
    }
    if (addLines.length && dels) {
      const modCount = Math.min(addLines.length, dels);
      addLines.forEach((ln, k) => marks.push({ line: ln, type: k < modCount ? "mod" : "add" }));
    } else if (addLines.length) {
      addLines.forEach((ln) => marks.push({ line: ln, type: "add" }));
    } else {
      marks.push({ line: hunkStart, type: "del" });
    }
  }
  return marks;
}
// Map the [{line,type}] change marks to per-type CodeMirror annotateScrollbar ranges. Returns
// { add, del, mod } where each is an array of { from:{line,ch}, to:{line,ch} } (ch always 0) in
// ascending line order. Consecutive same-type lines are merged into one range so a multi-line hunk
// paints a single scrollbar band rather than a stack of 1px ticks. Pure/DOM-free — unit-tested
// alongside pactChangeMarks (see lib/pactChangeMarks.test.mjs).
function pactChangeAnnRanges(marks) {
  const out = { add: [], del: [], mod: [] };
  if (!Array.isArray(marks)) return out;
  for (const m of marks) {
    const list = out[m.type];
    if (!list) continue;
    const last = list[list.length - 1];
    if (last && last.to.line === m.line - 1) last.to = { line: m.line, ch: 0 };   // extend the run
    else list.push({ from: { line: m.line, ch: 0 }, to: { line: m.line, ch: 0 } });
  }
  return out;
}
// ===== end PACT CHANGE-MARKS pure helper =====
function pactEdAnyDiff() { return !!(PACT_ED && PACT_ED.groups.some((g) => g.tabs.some((t) => t.agentDiff))); }
function pactEdDiffCount() { return PACT_ED ? PACT_ED.groups.reduce((a, g) => a + g.tabs.filter((t) => t.agentDiff).length, 0) : 0; }
let PACT_ED_DIFF_CHECKING = false;
async function pactEdCheckAgentEdits() {
  if (!PACT_ED || PACT_ED_DIFF_CHECKING) return;
  PACT_ED_DIFF_CHECKING = true;
  let changed = false;
  try {
    for (const g of PACT_ED.groups) for (const tab of g.tabs) {
      if (!tab.loaded || tab.dirty || tab._saving) continue;   // never clobber a tab the user is editing
      let d; try { d = await (await fetch("/api/pact/file?path=" + encodeURIComponent(tab.path) + pactWtQ(tab.worktree))).json(); } catch { continue; }
      if (!d.ok || typeof d.content !== "string") continue;
      if (d.content !== tab.content) {
        if (!tab.agentDiff) tab.diffBase = tab.content;         // anchor at the pre-agent content
        tab.content = d.content; tab.saved = d.content;         // disk is the source of truth now
        tab.agentDiff = pactDiffLines(tab.diffBase, d.content);
        changed = true;
      }
    }
  } finally { PACT_ED_DIFF_CHECKING = false; }
  if (changed) { pactEdLayout(); pactEdUpdateSaveBar(); pactEdSaveStatus("agent edited " + pactEdDiffCount() + " open file(s) — review + Keep All", false); }
}
function pactEdKeepAll() {
  if (!PACT_ED) return;
  for (const g of PACT_ED.groups) for (const t of g.tabs) { if (t.agentDiff) { t.agentDiff = null; t.diffBase = undefined; } }
  pactEdLayout(); pactEdUpdateSaveBar();
}
// ---- "N files changed by the agent" — a secondary tab in the file-tree column ----
// After a chat turn, list EVERY file the agent changed in the repo (the working-tree diff vs HEAD),
// not just the ones open in a box. The list lives in the left tree column under a "Changed (N)" tab
// (see viewPact), so it uses the tree's full height and never shoves the editor grid down. Each row
// opens that file into the active box as a green/red diff.
let PACT_CHANGED = [];                 // last-fetched change list from /api/pact/changed
// ===== PACT CHANGED-PATH — pure display helper (sliced out for unit tests; see lib/pactChangedPath.test.mjs)
// Split a repo-relative path into a prominent basename and a dimmed, LEFT-truncated directory. The
// directory keeps its LAST `maxSegs` segments (the ones nearest the file) and gets a leading "…/" when
// segments were dropped. Everything is plain LTR text — no `direction: rtl`, so digits in a path
// (e.g. "1_SOVEREIGN/…/04_FVT.pact") render in order and never bidi-reorder into "…FVT.pact_1".
function pactChangedPathParts(path, maxSegs = 3) {
  const clean = String(path == null ? "" : path).replace(/\/+$/, "");
  const segs = clean.split("/");
  const name = segs.pop() || clean;   // basename (or the whole thing when there's no "/")
  let dir = "";
  if (segs.length) {
    const shown = segs.slice(-Math.max(1, maxSegs));
    dir = (shown.length < segs.length ? "…/" : "") + shown.join("/") + "/";
  }
  return { name, dir };
}
// ===== end PACT CHANGED-PATH pure helper =====
// ===== PACT GIT-STATUS — pure classifier (sliced out for unit tests; see lib/pactGitStatus.test.mjs)
// Map a git working-tree status letter to the file-tree coloring class (VSCode-Explorer-style):
//   'M' (modified)                → 'mod'   (amber tint + "M" badge)
//   '?' (untracked) / 'A' (added) → 'new'   (green tint + "U" badge)
//   'D' (deleted) / anything else → null    (deleted files aren't in the tree; junk is ignored)
function pactGitStatusClass(status) {
  const s = String(status == null ? "" : status).trim().charAt(0).toUpperCase();
  if (s === "M") return "mod";
  if (s === "?" || s === "A") return "new";
  return null;
}
// ===== end PACT GIT-STATUS pure classifier =====
// Build a lookup of repo-relative path → 'mod'|'new' from the last-fetched PACT_CHANGED. Deleted
// files (and any unknown status) are dropped, since they never appear in the on-disk tree.
function pactChangedStatusMap() {
  const m = new Map();
  for (const f of (PACT_CHANGED || [])) {
    if (!f || !f.path) continue;
    const cls = pactGitStatusClass(f.status);
    if (cls) m.set(f.path, cls);
  }
  return m;
}
// Paint a single file row to reflect its git-change class (or clear it when `cls` is null). Idempotent:
// strips any prior tint class + badge first, so re-applying on an update never duplicates the badge.
function pactFileRowApplyGit(row, cls) {
  if (!row) return;
  row.classList.remove("pact-node--mod", "pact-node--new");
  const old = row.querySelector(".pact-node-git");
  if (old) old.remove();
  if (!cls) return;
  row.classList.add(cls === "mod" ? "pact-node--mod" : "pact-node--new");
  row.appendChild(el("span", { class: "pact-node-git pact-node-git--" + cls, title: cls === "mod" ? "Modified vs HEAD" : "New / untracked" }, [cls === "mod" ? "M" : "U"]));
}
// Re-apply change coloring to the currently-rendered tree WITHOUT re-rendering it (so the tree keeps
// its expand/collapse + scroll state). Walks every rendered file row, looks it up by dataset.path, and
// adds/removes the tint class + badge. Also gives ancestor directory rows a subtle "has changes below"
// hint. Called at the end of pactEdCheckChangedFiles, after a save, and after a dir lazy-expands.
function pactTreeApplyChangeColors() {
  if (!PACT_ED || !PACT_ED.treeBody) return;
  const map = pactChangedStatusMap();
  for (const row of PACT_ED.treeBody.querySelectorAll(".pact-node.pact-file"))
    pactFileRowApplyGit(row, map.get(row.dataset.path) || null);
  // Parent-dir hint: mark any directory that has a changed file nested somewhere beneath it.
  const dirty = new Set();
  for (const p of map.keys()) {
    const segs = String(p).split("/"); let cur = "";
    for (let i = 0; i < segs.length - 1; i++) { cur = cur ? cur + "/" + segs[i] : segs[i]; dirty.add(cur); }
  }
  for (const row of PACT_ED.treeBody.querySelectorAll(".pact-node.pact-dir"))
    row.classList.toggle("pact-node--dirty-dir", !!(row.dataset.path && dirty.has(row.dataset.path)));
}
// Re-scan the tree so agent-created / removed files appear, WITHOUT collapsing what you have open: reload
// the root, then re-expand every folder that was open (shallowest first, so a parent is rendered before
// its child is re-opened). Guarded against re-entry.
let PACT_TREE_REFRESHING = false;
async function pactTreeRefresh() {
  if (!PACT_ED || !PACT_ED.treeBody || PACT_TREE_REFRESHING) return;
  PACT_TREE_REFRESHING = true;
  try {
    const want = [...(PACT_ED.treeExpanded || [])].sort((a, b) => a.split("/").length - b.split("/").length);
    PACT_ED.treeExpanded = new Set();   // repopulated as we re-expand below
    await loadPactDir("", PACT_ED.treeBody);
    for (const p of want) await pactTreeExpandPath(p);
    pactTreeApplyChangeColors();
    pactEdLoadWorktrees();   // pick up any newly-created/removed worktree so box selectors stay current
  } finally { PACT_TREE_REFRESHING = false; }
}
// Re-point the file tree + Changed panel at the ACTIVE box's worktree — but only when it actually changed,
// so ordinary box/tab focus within one worktree doesn't re-scan the tree. pactTreeRefresh preserves the
// expanded folders. A small "⌥<name>" chip in the tree header shows when you're browsing a non-main checkout.
function pactEdSyncTreeToActiveBox() {
  if (!PACT_ED || !PACT_ED.treeBody) return;
  const wt = pactActiveWt();
  if (wt === PACT_ED._treeWt) return;
  PACT_ED._treeWt = wt;
  if (PACT_ED.treeHdWt) { PACT_ED.treeHdWt.textContent = wt === "main" ? "" : "⌥ " + wt; PACT_ED.treeHdWt.hidden = (wt === "main"); }
  pactTreeRefresh();
  pactEdCheckChangedFiles();
}
async function pactTreeExpandPath(path) {
  if (!PACT_ED || !PACT_ED.treeBody) return;
  const wrap = [...PACT_ED.treeBody.querySelectorAll(".pact-node-wrap")].find((w) => w.dataset.path === path);
  if (wrap && typeof wrap._expand === "function") await wrap._expand();
}
// IDE "reveal in tree" (like VS Code's auto-reveal): expand the file tree down to `path`, scroll its row
// into view, and flash it. Called when the active editor tab changes — selecting a file in a box moves
// the tree to where that file lives. Walks ancestor dirs shallowest-first, awaiting each (a folder's
// children load lazily on expand, so the next segment's node doesn't exist until its parent has loaded).
let PACT_REVEAL_SEQ = 0;
async function pactTreeReveal(path) {
  if (!PACT_ED || !PACT_ED.treeBody || !path) return;
  const mySeq = ++PACT_REVEAL_SEQ;   // if another reveal starts mid-walk, abandon this stale one
  // The tree is display:none while the "Changed" list is showing — switch back to Files or the scroll
  // (and the highlight) would be invisible.
  if (PACT_ED.treeTab === "changed") pactTreeSwitchTab("files");
  const segs = String(path).split("/");
  let cur = "";
  for (let i = 0; i < segs.length - 1; i++) {
    cur = cur ? cur + "/" + segs[i] : segs[i];
    await pactTreeExpandPath(cur);
    if (mySeq !== PACT_REVEAL_SEQ) return;
  }
  const row = [...PACT_ED.treeBody.querySelectorAll(".pact-node.pact-file")].find((n) => n.dataset.path === path);
  if (!row) return;
  for (const r of PACT_ED.treeBody.querySelectorAll(".pact-node.--revealed")) r.classList.remove("--revealed");
  row.classList.add("--revealed");
  row.scrollIntoView({ block: "center" });
  row.classList.remove("--reveal-flash"); void row.offsetWidth; row.classList.add("--reveal-flash");   // restart the flash on a re-reveal
}
// Swap the tree column between its "Files" tree and the "Changed" list without touching either's
// scroll/font state — just toggle visibility and the active-tab underline.
function pactTreeSwitchTab(which) {
  if (!PACT_ED) return;
  const isFiles = which !== "changed";
  PACT_ED.treeTab = isFiles ? "files" : "changed";
  if (PACT_ED.treeBody) PACT_ED.treeBody.style.display = isFiles ? "" : "none";
  if (PACT_ED.changedList) PACT_ED.changedList.style.display = isFiles ? "none" : "";
  if (PACT_ED.tabFilesBtn) PACT_ED.tabFilesBtn.classList.toggle("--active", isFiles);
  if (PACT_ED.tabChangedBtn) PACT_ED.tabChangedBtn.classList.toggle("--active", !isFiles);
}
async function pactEdCheckChangedFiles() {
  if (!PACT_ED || !PACT_ED.changedList) return;
  const cwt = pactActiveWt();   // the Changed panel + tree coloring reflect the active box's worktree
  let d; try { d = await (await fetch("/api/pact/changed" + (cwt !== "main" ? "?worktree=" + encodeURIComponent(cwt) : ""))).json(); } catch { return; }   // git unreachable — leave the list as-is
  if (!d || !d.ok || !Array.isArray(d.files)) return;   // git unavailable / not a repo — list stays empty
  PACT_CHANGED = d.files;
  pactEdRenderChanged();
  pactTreeApplyChangeColors();   // reflect the fresh list on the tree live (a file becoming changed/committed re-colors without collapsing)
  // The agent may have CREATED files. The tree caches a folder's contents on first expand, so a new file
  // never appears on its own. If a changed file is new-and-not-shown inside an OPEN folder (or at the root),
  // or a removed file is still shown, re-scan the tree (open folders preserved). Collapsed folders pick up
  // new files on their next expand, so we don't refresh for those.
  if (PACT_ED.treeBody) {
    const rendered = new Set([...PACT_ED.treeBody.querySelectorAll(".pact-node[data-path]")].map((n) => n.dataset.path));
    const parentOf = (p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const needsRefresh = (PACT_CHANGED || []).some((c) => {
      if (!c || !c.path) return false;
      if (c.status === "D") return rendered.has(c.path);                                   // removed file still shown → prune
      if (rendered.has(c.path)) return false;                                              // already in the tree
      const par = parentOf(c.path);
      return par === "" || (PACT_ED.treeExpanded && PACT_ED.treeExpanded.has(par));        // new file at root / in an open folder
    });
    if (needsRefresh) pactTreeRefresh();
  }
}
function pactEdRenderChanged() {
  const list = PACT_ED && PACT_ED.changedList;
  if (!list) return;
  const files = PACT_CHANGED || [];
  // Keep the tab label's count in sync; hide the number (and the emphasis) at 0.
  if (PACT_ED.tabChangedBtn) {
    PACT_ED.tabChangedBtn.textContent = files.length ? `Changed (${files.length})` : "Changed";
    PACT_ED.tabChangedBtn.classList.toggle("--has", files.length > 0);
  }
  if (files.length === 0) {   // 0 changes / git unavailable → a quiet empty state (never disruptive)
    list.replaceChildren(el("div", { class: "hint", style: "padding:8px 10px" }, ["No changes vs HEAD."]));
    return;
  }
  const refresh = el("button", { class: "pact-ed-ico", title: "Re-check the repo for agent changes" }, ["⟳"]);
  refresh.addEventListener("click", (e) => { e.stopPropagation(); pactEdCheckChangedFiles(); });
  const head = el("div", { class: "pcs-head" }, [
    el("span", { class: "pcs-title" }, [`${files.length} file${files.length > 1 ? "s" : ""} changed`]),
    el("span", { class: "ws-spacer" }, []), refresh,
  ]);
  const rows = files.map((f) => {
    const cls = f.status === "?" ? "new" : (f.status || "M").toLowerCase();
    const label = f.status === "?" ? "new" : (f.status || "M");   // status chip: M / A / D / new
    const parts = pactChangedPathParts(f.path);
    const main = el("div", { class: "pcs-main" }, [
      el("span", { class: "pcs-st pcs-st-" + cls }, [label]),
      el("span", { class: "pcs-name" }, [parts.name]),
      el("span", { class: "pcs-badges" }, [
        el("span", { class: "pd-badge pd-badge-add" }, ["+" + (f.added || 0)]),
        el("span", { class: "pd-badge pd-badge-del" }, ["−" + (f.removed || 0)]),
      ]),
    ]);
    const kids = [main];
    if (parts.dir) kids.push(el("span", { class: "pcs-dir" }, [parts.dir]));
    const row = el("button", { class: "pcs-row", title: f.path + " — open as diff" }, kids);
    row.addEventListener("click", () => pactEdOpenAsDiff(f.path));
    return row;
  });
  list.replaceChildren(head, el("div", { class: "pcs-list" }, rows));
}
// Open `path` into the active box as a green/red diff: before = the committed HEAD content, after =
// the current on-disk content (what the agent wrote). If the file is already open in some box, reuse
// that box's tab rather than duplicating. Keep All then behaves exactly as for an auto-diffed file.
async function pactEdOpenAsDiff(path) {
  if (!PACT_ED) return;
  let g = PACT_ED.groups.find((x) => x.tabs.some((t) => t.path === path))
    || PACT_ED.groups.find((x) => x.id === PACT_ED.activeId) || PACT_ED.groups[0];
  if (!g) return;
  PACT_ED.activeId = g.id;
  let tab = g.tabs.find((t) => t.path === path);
  if (!tab) { tab = { path, name: path.split("/").pop(), loaded: false, content: "", saved: "", dirty: false, error: null, worktree: g.worktree || "main" }; g.tabs.push(tab); }
  g.active = path;
  pactEdLayout();   // switch to the box + tab immediately (a "Loading…" body while the two fetches land)
  const wtq = pactWtQ(tab.worktree);
  const [aRes, bRes] = await Promise.all([
    fetch("/api/pact/file?path=" + encodeURIComponent(path) + wtq).then((r) => r.json()).catch(() => null),         // after = on-disk (this box's worktree)
    fetch("/api/pact/file?ref=head&path=" + encodeURIComponent(path) + wtq).then((r) => r.json()).catch(() => null), // before = HEAD (this box's worktree)
  ]);
  // A deleted/unreadable file → after = "" (full red diff vs HEAD). A non-tooLarge read error is the
  // only case we surface as an error.
  let after = "";
  if (aRes && aRes.ok && typeof aRes.content === "string") after = aRes.content;
  else if (aRes && aRes.tooLarge) { tab.loaded = true; tab.error = (aRes.error || "file too large"); pactEdRenderGroup(g); return; }
  const before = (bRes && bRes.ok && typeof bRes.content === "string") ? bRes.content : "";
  tab.content = after; tab.saved = after; tab.dirty = false; tab.loaded = true; tab.error = null;
  tab.diffBase = before;
  tab.headContent = before;   // seed the overview-ruler baseline (before = HEAD here) — no refetch needed
  tab.agentDiff = pactDiffLines(before, after);
  pactEdLayout(); pactEdUpdateSaveBar();
}
async function pactEdOpen(path, row) {
  if (!PACT_ED) return;
  document.querySelectorAll(".pact-file.--active").forEach((e) => e.classList.remove("--active"));
  if (row) row.classList.add("--active");
  const g = PACT_ED.groups.find((x) => x.id === PACT_ED.activeId) || PACT_ED.groups[0];
  PACT_ED.activeId = g.id;
  await pactEdOpenInto(g, path, true, true);
  pactTreeReveal(path);   // keep the tree synced to the file now active in the box (highlight + scroll)
}
// Open `path` into a SPECIFIC group (not just the active one). Shared by the tree-click open above
// and by layout restore, which reopens each saved box's files into its own group. `relayout` runs a
// full pactEdLayout (the tree-click path, which may have just switched the active group); restore
// already laid the boxes out and only needs the group re-rendered.
// Fetch the file's committed (git HEAD) content once and cache it on the tab as `tab.headContent`, then
// refresh the overview ruler if this tab is rendered. Degrades gracefully: a non-repo dir / newly-added
// file / git failure yields "" (server returns { ok:true, content:"" }) — the ruler then reads the file as
// all-added. A network error leaves headContent unset (no ruler) rather than throwing.
async function pactEdFetchHead(tab) {
  if (!tab || tab._headFetching) return;
  tab._headFetching = true;
  try {
    const d = await (await fetch("/api/pact/file?ref=head&path=" + encodeURIComponent(tab.path) + pactWtQ(tab.worktree))).json();
    if (d && d.ok && typeof d.content === "string") tab.headContent = d.content;
  } catch { /* git unreachable — leave the ruler empty */ }
  finally { tab._headFetching = false; }
  if (typeof tab._ovrUpdate === "function") tab._ovrUpdate();
}
async function pactEdOpenInto(g, path, makeActive, relayout) {
  if (!PACT_ED || !g) return;
  let tab = g.tabs.find((t) => t.path === path);
  // Each tab remembers the WORKTREE it was opened from (its box's binding) — every later read/save/diff
  // for this tab targets that checkout, so a box bound to "ats" edits ats's copy, not main's.
  if (!tab) { tab = { path, name: path.split("/").pop(), loaded: false, content: "", saved: "", dirty: false, error: null, worktree: g.worktree || "main" }; g.tabs.push(tab); }
  if (makeActive) g.active = path;
  if (relayout) pactEdLayout(); else pactEdRenderGroup(g);
  if (tab.loaded || tab.error) return;
  let d;
  try { d = await (await fetch("/api/pact/file?path=" + encodeURIComponent(path) + pactWtQ(tab.worktree))).json(); }
  catch { d = { ok: false, error: "unreachable" }; }
  if (d.ok) { tab.content = d.content; tab.saved = d.content; tab.dirty = false; tab.loaded = true; }
  else { tab.error = (d.error || "error") + (d.tooLarge ? ` (${Math.round((d.size || 0) / 1e6)} MB)` : ""); }
  if (g.active === path) pactEdRenderGroup(g);
}
// ---- Pact chat (Zone B top): agentic, multi-tab AI chat scoped to the Ouronet Pact repo. Reuses
// the PROVEN workspace session backend — each tab is a real Claude session (POST /api/workspace/prompt
// with repo=Ouronet) streamed back over /api/workspace/stream and routed here by sessionKey. So the
// agent runs in the repo cwd (writes Pact, runs REPLs) exactly like the Core cockpit, just embedded.
const PACT_REPO = "OuroborosNetwork/_onchain/Ouronet";
// ===== WS PACT ROW — pure helper (sliced for lib/wsPactRow.test.mjs) =====
// True when a Core history/search row belongs to the Ouronet Pact repo — which is worked ONLY from the
// Pact workspace (skilled agent + StoicSyntax discipline). The Core cockpit hides that repo from its
// repo picker (already filtered on tree load) AND its history/search, so it's segregated from Core.
// Matches by `repo` OR by a `workspaceId` prefix, so either row shape is caught.
function wsIsPactRow(h, pactRepo) {
  if (!h) return false;
  if (h.repo === pactRepo) return true;
  return typeof h.workspaceId === "string" && h.workspaceId.indexOf(pactRepo + "@") === 0;
}
// ===== end WS PACT ROW pure helper =====
// The single workspace id every Pact chat session lives under (repo@worktree) — used to build the
// /api/workspace/image URL for attached images on persisted turns (the server strips per-turn
// workspaceId, same as Core; see wsBackfillTurnWorkspace).
const PACT_WORKSPACE_ID = wsWorkspaceId(PACT_REPO, "main");
// ===== PACT RESUME-ID — pure helper (sliced for lib/pactResumeId.test.mjs) =====
// A tab's `resume` must be a REAL Claude Code session id — NEVER its own workspace key. When a session
// is interrupted (e.g. by a daemon restart) before Claude Code stamps its real session id, the store
// falls back to the tab KEY as the "sessionId", which then leaks into `resume`; resuming that key fails
// forever with "No conversation found with session ID: <key>". Reject any resume value that is empty or
// equals the tab key, so such a tab just starts a fresh session on its next prompt instead of dead-ending.
function pactResumeIdOk(sessionId, key) {
  return (typeof sessionId === "string" && sessionId && sessionId !== key) ? sessionId : null;
}
// ===== end PACT RESUME-ID pure helper =====
// ---- Shared, server-side IDE-state (P1 store) — so the Pact workspace reopens exactly where it was
// left AND state is identical on localhost and the remote website (it lives on the machine, not in
// localStorage). `PACT_STATE_READY` gates saves so the initial build + restore don't echo back over
// the freshly-read state; `PACT_CHAT_NAMES` is the shared { sessionKey -> friendly name } map. ----
let PACT_STATE_READY = false;
let PACT_STATE_TIMER = null;
let PACT_CHAT_NAMES = {};
// A debounced (~800ms) snapshot of the whole IDE layout, PUT to the shared store. No-op until a
// restore has completed (or a fresh view is ready), so a burst of layout changes coalesces into one
// write. A read-only remote viewer's PUT is refused server-side (403) and simply ignored here.
function pactStatePut(state, keepalive) {
  fetch("/api/pact/ide-state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ state }), keepalive: !!keepalive }).catch(() => {});
}
function pactStateSave() {
  if (!PACT_STATE_READY || !PACT_ED || !PACT_CHAT) return;
  clearTimeout(PACT_STATE_TIMER);
  PACT_STATE_TIMER = setTimeout(() => {
    const state = pactStateSnapshot(); if (state) pactStatePut(state);
  }, 800);
}
// Persist the current layout+drafts IMMEDIATELY (no debounce). Used when leaving the Pact view, on
// send, and on page unload — so a draft typed in the last 800ms (previously cancelled by the teardown's
// clearTimeout) is never lost. `keepalive` lets the request survive a page unload.
function pactStateFlush(keepalive) {
  if (!PACT_ED || !PACT_CHAT) return;
  clearTimeout(PACT_STATE_TIMER);
  const state = pactStateSnapshot(); if (state) pactStatePut(state, keepalive);
}
// The opaque blob the store persists: open file paths per editor box (+ active/font/weights), chat
// tab identity (key/name/draft/order/active), right-zone collapse, and the chat-name map. NEVER file
// contents — those live on disk / autosave (U3). Group + tab identity is stored by INDEX, since the
// live `id`/`seq` counters are minted fresh on every rebuild and wouldn't survive a reload.
function pactStateSnapshot() {
  if (!PACT_ED || !PACT_CHAT) return null;
  pactChatSaveDraft();   // fold the active tab's live compose text into its tab before snapshotting
  const editor = {
    groups: PACT_ED.groups.map((g) => ({ tabs: g.tabs.map((t) => t.path), active: g.active || null, fontPx: g.fontPx || null, flex: g.flex || 1, worktree: g.worktree || null })),
    activeIndex: Math.max(0, PACT_ED.groups.findIndex((g) => g.id === PACT_ED.activeId)),
    rowFlex: Array.isArray(PACT_ED.rowFlex) ? PACT_ED.rowFlex.slice() : null,
  };
  const chat = {
    tabs: PACT_CHAT.tabs.map((t) => ({ key: t.key, name: t.name, draft: t.draft || "", resume: t.resume || null, prime: !!t.prime, worktree: t.worktree || null, migrations: t.migrations || [], promptStates: t.promptStates || {}, bookmarks: Array.isArray(t.bookmarks) ? t.bookmarks : [] })),
    activeIndex: Math.max(0, PACT_CHAT.tabs.findIndex((t) => t.id === PACT_CHAT.activeId)),
  };
  const right = document.querySelector(".pact-right");
  const collapse = right ? (right.classList.contains("pr-chat-collapsed") ? "chat" : right.classList.contains("pr-term-collapsed") ? "term" : null) : null;
  return { v: 1, editor, chat, collapse, chatNames: PACT_CHAT_NAMES || {} };
}
// Fetch the saved state and rebuild the IDE from it — reopen editor boxes (count/sizes/fonts) and
// their files, restore chat tabs (name/draft/order/active), and the collapse. Every step is guarded
// so a missing or malformed field just leaves that part at its fresh default (never throws).
async function pactRestoreState() {
  let saved = {};
  try { const r = await (await fetch("/api/pact/ide-state")).json(); if (r && r.ok && r.state && typeof r.state === "object") saved = r.state; } catch {}
  PACT_CHAT_NAMES = (saved.chatNames && typeof saved.chatNames === "object" && !Array.isArray(saved.chatNames)) ? saved.chatNames : {};
  try { if (saved.editor && Array.isArray(saved.editor.groups) && saved.editor.groups.length) pactRestoreEditor(saved.editor); } catch (e) { console.warn("pact editor restore failed", e); }
  try { if (saved.chat && Array.isArray(saved.chat.tabs) && saved.chat.tabs.length) pactRestoreChat(saved.chat); } catch (e) { console.warn("pact chat restore failed", e); }
  try { if (saved.collapse) pactRestoreCollapse(saved.collapse); } catch {}
  PACT_STATE_READY = true;   // from here on, user changes persist
}
function pactRestoreEditor(ed) {
  const groups = ed.groups.slice(0, 8);
  PACT_ED.groups = groups.map((gs) => ({ id: ++PACT_ED.seq, tabs: [], active: null, fontPx: gs.fontPx || undefined, flex: (typeof gs.flex === "number" && gs.flex > 0) ? gs.flex : 1, worktree: (gs.worktree && gs.worktree !== "main") ? gs.worktree : undefined }));
  const n = PACT_ED.groups.length;
  PACT_ED.layoutN = n;   // pin so pactEdLayout doesn't reset our restored weights (it only resets on a count change)
  PACT_ED.rowFlex = (Array.isArray(ed.rowFlex) && ed.rowFlex.length) ? ed.rowFlex.slice() : (PACT_ED_ROWS[n] || [1]).map(() => 1);
  const ai = Number.isInteger(ed.activeIndex) && ed.activeIndex >= 0 && ed.activeIndex < n ? ed.activeIndex : 0;
  PACT_ED.activeId = PACT_ED.groups[ai].id;
  pactEdLayout();
  groups.forEach((gs, i) => {
    const g = PACT_ED.groups[i];
    const paths = Array.isArray(gs.tabs) ? gs.tabs.filter((p) => typeof p === "string") : [];
    const active = (gs.active && paths.includes(gs.active)) ? gs.active : (paths[0] || null);
    for (const p of paths) pactEdOpenInto(g, p, p === active, false);
    if (!paths.length) { g.active = null; pactEdRenderGroup(g); }
  });
  pactEdSyncTreeToActiveBox();   // if the restored active box is on a worktree, show its tree straight away (guarded on treeBody)
}
function pactRestoreChat(ch) {
  const tabs = ch.tabs.slice(0, 16).filter((t) => t && typeof t === "object");
  if (!tabs.length) return;
  PACT_CHAT.tabs = tabs.map((ts) => {
    const id = ++PACT_CHAT.seq;
    const key = (typeof ts.key === "string" && ts.key) ? ts.key : wsUuid();
    return { id, name: ts.name || PACT_CHAT_NAMES[key] || ("Chat " + id), key,
      msgs: [], live: "", status: "idle",
      // A restored tab's backend session already received the orienting preamble in its prior life —
      // don't re-inject it on the next message. (Full transcript rehydration + resume is P3.)
      started: true, perm: null, draft: typeof ts.draft === "string" ? ts.draft : "",
      // a resumed/loaded tab keeps its SDK resume target across reloads so continuing still has context —
      // but never a resume equal to the tab's own key (a bogus id that fails "No conversation found")
      resume: pactResumeIdOk(ts.resume, key),
      // the worktree this conversation runs in survives reloads (Stage-2 binding); null/"main" → primary checkout
      worktree: (ts.worktree && ts.worktree !== "main") ? ts.worktree : undefined,
      // recorded worktree-migration markers, re-injected into the transcript on rehydrate (see pactChatReinjectMigrations)
      migrations: Array.isArray(ts.migrations) ? ts.migrations.filter((m) => m && typeof m.at === "number") : [],
      // interrupted/discarded prompt states ({ <at>: "i" | "d" }) survive reloads (and sync via IDE state)
      promptStates: (ts.promptStates && typeof ts.promptStates === "object" && !Array.isArray(ts.promptStates)) ? ts.promptStates : {},
      bookmarks: Array.isArray(ts.bookmarks) ? ts.bookmarks.filter((x) => typeof x === "number") : [],   // starred responses (sync via IDE state)
      // the prime (undeletable) conversation flag survives reloads; ensurePrime backfills older layouts
      prime: !!ts.prime };
  });
  pactChatEnsurePrime();
  const ai = Number.isInteger(ch.activeIndex) && ch.activeIndex >= 0 && ch.activeIndex < PACT_CHAT.tabs.length ? ch.activeIndex : 0;
  PACT_CHAT.activeId = PACT_CHAT.tabs[ai].id;
  pactChatRender();
  // Now that the tabs are restored, (re)fetch the worktree list and reconcile bindings — a conversation
  // bound to a worktree that was merged & removed while you were away flips back to main on open. Re-run
  // here (not just from pactEdInit) so it can't miss the tabs by racing their restore. Guarded so it only
  // ever reconciles against the REAL fetched list, never the default [main] (which would revert everything).
  if (PACT_ED) pactEdLoadWorktrees();
  // Rehydrate every restored tab's transcript from disk (a reload otherwise leaves each tab EMPTY
  // even though its conversation is safely saved). Same mechanism a Resume uses: correlate the
  // returned `transcript` frame (keyed by the session's own id) to THIS tab via `_pendingOpen`, and
  // — since the tab's key IS its session key — reconnecting the live stream is automatic (the one
  // EventSource opened in pactChatInit routes future events here by key). A tab whose session no
  // longer exists on disk just gets a "could not be opened" reply, swallowed below, so it stays
  // empty rather than crashing (guarded in pactChatRoute's error path via `_pendingOpen`).
  PACT_CHAT._pendingOpen = PACT_CHAT._pendingOpen || {};
  for (const t of PACT_CHAT.tabs) {
    if (!t.key) continue;
    PACT_CHAT._pendingOpen[t.key] = t.id;
    pactChatSetLoading(t, true);   // show a loader in the chat box until this tab's transcript arrives
    // Scoped `open` (by session key) finds the conversation regardless of which worktree it now runs in — a
    // Pact conversation persists under repo@main even after migration (see workspace.mjs) — and ships only the
    // capped tail. The old worktree-specific `sessionOpen` looked in repo@<worktree>, so a migrated tab missed
    // its file entirely, AND it shipped the WHOLE transcript uncapped (a 2.2 MB Master tab = the mobile stall).
    wsPost("control", { action: "open", args: { sessionKey: t.key, scoped: true } });
  }
  // Close the persist-race window on a fresh reload: the sessionOpen rehydrate above can race the
  // daemon's turn-boundary persist for a turn that FINISHED during the downtime — the fresh-open
  // fetch then reads a transcript still missing that just-saved reply, so it never shows. A short
  // beat later, re-ask each tab for its authoritative state (the persist has landed by then); the
  // `event/resync` reply REPLACES the transcript (see pactChatRoute's "resync" case) and surfaces it.
  // (The stream's `hello` also resyncs, but on a full page reload it fires before these tabs exist —
  // this delayed pass is what covers the initial load; `hello` covers live re-connects.)
  const restoredKeys = PACT_CHAT.tabs.map((t) => t.key).filter(Boolean);
  setTimeout(() => {
    if (!PACT_CHAT) return;
    for (const key of restoredKeys) if (PACT_CHAT.tabs.some((t) => t.key === key)) wsPost("control", { action: "resync", args: { sessionKey: key, scoped: true } });
  }, 1500);
}
function pactRestoreCollapse(mode) {
  const right = document.querySelector(".pact-right"); if (!right) return;
  right.classList.remove("pr-chat-collapsed", "pr-term-collapsed");
  if (mode === "chat") right.classList.add("pr-chat-collapsed");
  else if (mode === "term") right.classList.add("pr-term-collapsed");
  pactSyncCollapseBtns();
}
// Fold the active chat tab's live compose text into its own `draft` before a render tears the shared
// textarea down (tab switch, new/close tab) or before a snapshot — so drafts survive per-tab.
function pactChatSaveDraft() {
  if (!PACT_CHAT || !PACT_CHAT.host) return;
  const ta = PACT_CHAT.host.querySelector(".pc-input");
  const a = pactChatActive();
  if (ta && a) a.draft = ta.value;
}
const PACT_CHAT_PREAMBLE = "[Pact IDE — auto-skill] You are working in the Ouronet Pact repo (your cwd). BEFORE anything else, read `OuronetInformational/SKILL.md` — it is the single load hook: it gives the load order, the StoicSyntax discipline (`StoicSyntax.md` + `ouronet/conventions/*`), the Pact 5 language layer (`pact5/`), the fast-recall rules, and the active-learning protocol. Follow its load order and become fully skilled from those files (they are the canonical authority). Use `OuronetInformational/MODULE-INDEX.md` for a one-glance map of every module (schemas/tables/public C_/A_/X entrypoints). Before writing code in any module, find it in the index then SCAN that module's `.pact` + its interface + its `.repl` tests to learn its real schemas/tables/prefixes/caps, and imitate sibling patterns — e.g. \"an info function for module X\" means mirror how the codebase exposes `UR_`/`INFO-` readers for X's schema (grep for the pattern rather than guessing). Run tests with `pact <file>.repl` (Pact 5.4); namespace `ouronet-ns`. Keep all code in the StoicSyntax discipline. When I correct you (\"do X instead of Y\"), capture it per SKILL.md's active-learning protocol (a dated `memories/` note + fold durable rules into the matching doc). WORKTREE HYGIENE: if I ask to move/switch/migrate this conversation to another git worktree (or to merge one back and return to main), FIRST commit ALL uncommitted changes in the current checkout (a clear `git add -A && git commit`) so nothing is lost or left behind — uncommitted work does NOT follow a worktree switch. Never migrate or merge with a dirty tree.";
let PACT_CHAT = null;   // { host, tabs:[t], activeId, seq, es, mode, conn }
                        // t = { id, name, key, msgs:[{role|kind,text,tools}], live, status, started, perm, bodyEl }
// Pact chat live-stream health, mirroring the Core cockpit (WS_LAST_MSG_AT + WS_STALE_TIMER). A mobile
// carrier's NAT / the relay tunnel can drop an idle SSE connection with NO FIN/RST — the browser's
// `onerror` never fires and the server keeps writing into a socket nobody reads, so the Pact chat used to
// sit on "thinking…" forever (the answer was ready; this stream just went deaf). The watchdog notices the
// silence and force-reconnects, which re-fires `hello` → pactChatResyncAll → the stuck tab gets its true
// current state. `PACT_TICK_TIMER` drives the 1s "thinking… M:SS" elapsed readout.
let PACT_STREAM_LAST_MSG_AT = 0;
let PACT_STREAM_STALE_TIMER = null;
let PACT_TICK_TIMER = null;
let PACT_HEAL_TIMER = null;   // heartbeat-INDEPENDENT self-heal — recovers a stuck "Working…" tab even if the stream goes silent (no heartbeats)
// ===== PACT DURATION — pure helper (unit-tested via lib/pactDuration.test.mjs) =====
// M:SS (or H:MM:SS past an hour) for the LIVE ticking timer. Junk/negative → "0:00".
function pactFmtDuration(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return (h ? h + ":" : "") + mm + ":" + String(sec).padStart(2, "0");
}
// Human phrasing for the "Thought for …" label on a finished reply: "23s" / "1m 23s" / "1h 5m". Rounds to
// the nearest second. Junk/negative → "0s".
function pactFmtThought(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return sec ? m + "m " + sec + "s" : m + "m";
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? h + "h " + mm + "m" : h + "h";
}
// ===== end PACT DURATION pure helper =====
// Collapse one right-zone pane (chat / REPL) so the other fills the whole column. Mutually
// exclusive — collapsing one un-collapses the other. State lives as a class on `.pact-right`.
function pactSyncCollapseBtns() {
  const right = document.querySelector(".pact-right"); if (!right) return;
  const chatC = right.classList.contains("pr-chat-collapsed");
  const termC = right.classList.contains("pr-term-collapsed");
  right.querySelectorAll(".pcx-chat").forEach((b) => { b.textContent = chatC ? "▸" : "▾"; b.title = chatC ? "Expand the chat" : "Collapse the chat — give the REPL the whole area"; });
  right.querySelectorAll(".pcx-term").forEach((b) => { b.textContent = termC ? "▸" : "▾"; b.title = termC ? "Expand the REPL" : "Collapse the REPL — give the chat the whole area"; });
}
function pactToggleCollapse(pane) {
  const right = document.querySelector(".pact-right"); if (!right) return;
  if (pane === "chat") { if (right.classList.toggle("pr-chat-collapsed")) right.classList.remove("pr-term-collapsed"); }
  else { if (right.classList.toggle("pr-term-collapsed")) right.classList.remove("pr-chat-collapsed"); }
  pactSyncCollapseBtns();
  pactStateSave();
}
// Rename a chat tab (double-click its name, or the history rename control). The chosen name is stored
// in the shared PACT_CHAT_NAMES map (keyed by the tab's sessionKey) so local + remote agree, and on
// the tab object for the live label.
function pactChatRenameTab(t) {
  if (!t) return;
  const next = window.prompt("Rename this chat", t.name || "");
  if (next == null) return;
  const name = next.trim().slice(0, 80);
  if (!name) return;
  t.name = name;
  if (t.key) PACT_CHAT_NAMES[t.key] = name;
  pactChatRender();
  pactStateSave();
}
// ---- P3: chat history panel + naming + resume ------------------------------------------------
// ===== PACT CHAT NAME — pure helper (sliced for lib/pactChatName.test.mjs) =====
// Derive a friendly chat name from the user's first message. The FIRST non-empty LINE becomes the
// title (up to ~40 chars, whitespace collapsed) — so you can type a short label like "ATS Audit" on
// line 1 and the real prompt on the lines below, and the tab is named from that label with no later
// rename. A single-line prompt just names itself (truncated), unchanged from before. Any leaked
// auto-skill preamble the Pact IDE prepends is stripped FIRST so the name reflects what the USER
// wrote, not the orienting boilerplate (and stripped before whitespace is collapsed, so the `\n\n`
// boundary is still there to find).
function pactDeriveChatName(text) {
  let s = String(text || "");
  if (/^\s*\[Pact IDE/.test(s)) { const i = s.indexOf("\n\n"); if (i >= 0) s = s.slice(i + 2); }
  const firstLine = (s.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0)) || "";
  const name = firstLine.replace(/\s+/g, " ").trim();
  return name.length > 40 ? name.slice(0, 40).trim() + "…" : name;
}
// ===== end PACT CHAT NAME pure helper =====
// A saved transcript turn → the chat's own message shape (drop store bookkeeping; keep conversation).
function pactTranscriptToMsgs(transcript) {
  const out = [];
  // Carry each turn's persisted `at` timestamp through the conversion. It's what anchors a worktree-migration
  // marker to the RIGHT spot on rehydrate: pactChatReinjectMigrations places the marker before the first
  // message with `at > mig.at`. Dropping `at` here (the old bug) left every rehydrated message timestamp-less,
  // so the marker could never find its anchor and always fell to the very bottom, below the latest answer.
  const at = (m) => (typeof m.at === "number" ? m.at : undefined);
  for (const m of Array.isArray(transcript) ? transcript : []) {
    if (!m) continue;
    if (m.role === "user") out.push({ role: "user", text: m.text || "", images: m.images || (m.image ? [m.image] : []), workspaceId: m.workspaceId || PACT_WORKSPACE_ID, at: at(m), worktree: (typeof m.worktree === "string" && m.worktree) ? m.worktree : undefined });
    else if (m.role === "assistant") out.push({ role: "assistant", text: m.text || "", elapsedMs: (typeof m.durationMs === "number" ? m.durationMs : (typeof m.elapsedMs === "number" ? m.elapsedMs : undefined)), at: at(m) });
    else if (m.kind === "tool_use") out.push({ kind: "tool_use", tools: m.tools || [], at: at(m) });
  }
  return out;
}
// ===== PACT PRESERVE-ELAPSED — pure helper (unit-tested via lib/pactPreserveElapsed.test.mjs) =====
// Carry a live-stamped "Thought for …" duration across a resync/rehydrate. The persisted transcript is
// authoritative for TEXT, but a duration stamped from a live turn can be lost if the daemon that persisted
// the turn predates the duration-persist change (it just hasn't been restarted since the deploy). Copy
// elapsedMs from the CURRENT assistant messages onto the incoming ones by ordinal position, but only where
// the incoming lacks it — so a real persisted duration always wins, and an un-persisted one still survives.
function pactPreserveElapsed(prevMsgs, incoming) {
  if (!Array.isArray(prevMsgs) || !Array.isArray(incoming)) return incoming;
  const prevA = prevMsgs.filter((m) => m && m.role === "assistant");
  const inA = incoming.filter((m) => m && m.role === "assistant");
  for (let i = 0; i < inA.length && i < prevA.length; i++) {
    if (inA[i].elapsedMs == null && prevA[i].elapsedMs != null) inA[i].elapsedMs = prevA[i].elapsedMs;
  }
  return incoming;
}
// ===== end PACT PRESERVE-ELAPSED pure helper =====
// ===== PACT RESYNC DECISION — pure helper (sliced out for unit tests; see lib/pactResync.test.mjs)
// A resync reply is the server's AUTHORITATIVE current state for a session — its persisted transcript
// plus the live status. Reconciling it with what a chat tab already shows has two pure parts (no DOM,
// no module state, so a unit test can exercise them without booting the page):
//   • replace — REPLACE the tab's message list with the resync transcript, but ONLY when that can't
//     lose content: if the resync transcript is SHORTER than what's on screen, an in-flight turn's
//     optimistic user bubble / streaming reply simply hasn't been persisted yet, so keep the current
//     messages rather than clobber them. Replacing with an equal-or-longer transcript is idempotent —
//     a whole-list swap, never an append, so it can never DUPLICATE (unlike the fresh-open concat).
//   • keepLive — keep the transient streaming buffer (tt.live) while the session reports a busy/live
//     status (a turn genuinely in flight); drop it once the server says the turn is done (idle). That
//     drop is exactly what surfaces a reply COMPLETED during the web's downtime: the finished text is
//     now in the transcript, so the stale partial buffer must give way to it.
function pactResyncDecision(currentLen, incomingLen, status, live) {
  const busy = status === "thinking" || status === "deepwork" || status === "awaiting-permission";
  return { replace: incomingLen >= currentLen, keepLive: busy || !!live };
}
// ===== end PACT RESYNC DECISION pure helper =====
function pactAgo(ms) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
// Toggle the history overlay. Opening it requests the per-session list over the workspace stream
// (answered as a `pactSessions` state frame → pactChatRenderHistory fills the panel).
function pactChatToggleHistory() {
  if (!PACT_CHAT) return;
  const existing = document.querySelector(".pc-hist-overlay");
  if (existing) { existing.remove(); return; }
  const panel = el("div", { class: "pc-hist-panel" }, [el("div", { class: "hint", style: "padding:14px" }, ["Loading saved chats…"])]);
  const overlay = el("div", { class: "pc-hist-overlay" }, [panel]);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  wsPost("control", { action: "sessions", args: { repo: PACT_REPO } });
}
function pactChatCloseHistory() { const o = document.querySelector(".pc-hist-overlay"); if (o) o.remove(); }
function pactChatRenderHistory() {
  const panel = document.querySelector(".pc-hist-panel"); if (!panel) return;
  const rows = (PACT_CHAT && PACT_CHAT.sessions) || [];
  const refresh = el("button", { class: "pact-ed-ico", title: "Refresh" }, ["⟳"]);
  refresh.addEventListener("click", () => wsPost("control", { action: "sessions", args: { repo: PACT_REPO } }));
  const close = el("button", { class: "pact-ed-ico", title: "Close" }, ["×"]);
  close.addEventListener("click", pactChatCloseHistory);
  const head = el("div", { class: "pc-hist-hd" }, ["🕐 Pact chat history", el("span", { class: "ws-spacer" }, []), refresh, close]);
  const list = el("div", { class: "pc-hist-list" }, rows.length ? rows.map(pactHistRow) : [el("div", { class: "hint", style: "padding:14px" }, ["No saved Pact chats yet — send a first message to start one."])]);
  panel.replaceChildren(head, list);
}
function pactHistName(r) { return (r.sessionId && PACT_CHAT_NAMES[r.sessionId]) || r.name || pactDeriveChatName(r.firstPrompt) || "Untitled chat"; }
// ===== PACT PRIME ROW — pure helper (sliced for lib/pactPrimeRow.test.mjs) =====
// Which saved-history row is the undeletable "prime" (Master) conversation: the row whose sessionId
// equals the prime tab's OWN key — a history row's sessionId is the tab key that named its transcript
// file (see pactHistRename/pactChatOpenSaved, which both match `tab.key === r.sessionId`). Pure over
// (row, tabs) so it's unit-testable; the DOM callers pass PACT_CHAT.tabs. The prime row shows a ★ and
// a disabled delete button so it can't be removed by mistake — mirroring the tab's ★-instead-of-×.
function pactRowIsPrime(row, tabs) {
  if (!row || !row.sessionId || !Array.isArray(tabs)) return false;
  const p = tabs.find((t) => t && t.prime);
  return !!(p && p.key && row.sessionId === p.key);
}
// ===== end PACT PRIME ROW pure helper =====
function pactIsPrimeRow(r) { return pactRowIsPrime(r, PACT_CHAT && PACT_CHAT.tabs); }
function pactHistRow(r) {
  const prime = pactIsPrimeRow(r);
  const star = prime ? el("span", { class: "pc-tab-prime", title: "Prime conversation — always kept, can't be deleted" }, ["★ "]) : "";
  const wtBadge = (r.worktree && r.worktree !== "main") ? el("span", { class: "pc-hist-wt", title: "This conversation ran in worktree " + r.worktree }, ["⌥" + r.worktree]) : "";
  const nameEl = el("div", { class: "pc-hist-name", title: prime ? "Prime conversation" : "Double-click to rename" }, [star, pactHistName(r), wtBadge]);
  nameEl.addEventListener("dblclick", () => pactHistRename(r));
  const meta = el("div", { class: "pc-hist-meta" }, [`${r.turns || 0} msg${(r.turns || 0) === 1 ? "" : "s"}` + (r.updatedAt ? " · " + pactAgo(r.updatedAt) : "") + (r.realSessionId ? "" : " · no resume")]);
  const first = el("div", { class: "pc-hist-first" }, [r.firstPrompt || "(no prompt)"]);
  const resumeB = el("button", { class: "ws-ico", title: "Resume — continue this chat with full agent context" }, ["▶"]);
  resumeB.addEventListener("click", () => pactChatOpenSaved(r, true));
  const loadB = el("button", { class: "ws-ico", title: "Load into a new box (branch — continues with context, saved separately)" }, ["⧉"]);
  loadB.addEventListener("click", () => pactChatOpenSaved(r, false));
  const renameB = el("button", { class: "ws-ico", title: "Rename" }, ["✎"]);
  renameB.addEventListener("click", () => pactHistRename(r));
  const delB = el("button", { class: "ws-ico" + (prime ? " --nodelete" : ""), title: prime ? "The prime conversation can't be deleted" : "Delete this saved chat permanently" }, ["🗑"]);
  if (prime) { delB.disabled = true; delB.setAttribute("aria-disabled", "true"); }
  else delB.addEventListener("click", () => pactHistDelete(r));
  return el("div", { class: "pc-hist-row" }, [el("div", { class: "pc-hist-main" }, [nameEl, meta, first]), el("div", { class: "pc-hist-actions" }, [resumeB, loadB, renameB, delB])]);
}
// Open a saved chat into a tab. `adopt` = Resume: the tab ADOPTS the saved session key so its
// continuation appends to the SAME transcript file; otherwise Load-into-box mints a fresh key (a
// branch). Either way it rehydrates the transcript for display and carries the realSessionId as the
// `resume` target so the next message continues with full SDK context.
function pactChatOpenSaved(r, adopt) {
  if (!PACT_CHAT || !r || !r.sessionId) return;
  pactChatSaveDraft();
  const id = ++PACT_CHAT.seq;
  const key = adopt ? r.sessionId : wsUuid();
  const name = pactHistName(r);
  const t = { id, name, key, msgs: [], live: "", status: "idle", started: true, perm: null, draft: "", resume: pactResumeIdOk(r.realSessionId, key), worktree: (r.worktree && r.worktree !== "main") ? r.worktree : undefined };
  if (key) PACT_CHAT_NAMES[key] = name;
  PACT_CHAT.tabs.push(t);
  PACT_CHAT.activeId = id;
  PACT_CHAT._pendingOpen = PACT_CHAT._pendingOpen || {};
  PACT_CHAT._pendingOpen[r.sessionId] = id;   // route the transcript frame (keyed by sessionId) to THIS tab
  pactChatSetLoading(t, true);
  pactChatRender();
  wsPost("control", { action: "open", args: { sessionKey: r.sessionId, scoped: true } });   // capped, worktree-agnostic (see pactRestoreChat)
  pactChatCloseHistory();
  pactStateSave();
}
function pactHistRename(r) {
  if (!r || !r.sessionId) return;
  const next = window.prompt("Rename this chat", pactHistName(r));
  if (next == null) return;
  const name = next.trim().slice(0, 80); if (!name) return;
  PACT_CHAT_NAMES[r.sessionId] = name; r.name = name;
  const openT = PACT_CHAT.tabs.find((x) => x.key === r.sessionId); if (openT) openT.name = name;
  pactChatRenderHistory(); pactChatRender(); pactStateSave();
}
function pactHistDelete(r) {
  if (!r || !r.sessionId) return;
  if (pactIsPrimeRow(r)) return;   // the prime conversation is never deletable — belt to the disabled button's braces
  if (!window.confirm("Delete this saved chat permanently? This cannot be undone.")) return;
  wsPost("control", { action: "sessionDelete", args: { repo: PACT_REPO, worktree: (r.worktree || "main"), sessionId: r.sessionId } });
  if (PACT_CHAT.sessions) PACT_CHAT.sessions = PACT_CHAT.sessions.filter((x) => x.sessionId !== r.sessionId);
  delete PACT_CHAT_NAMES[r.sessionId];
  pactChatRenderHistory(); pactStateSave();
}
// Grow the compose textarea to fit its content, up to 80% of the chat box height; beyond that it
// scrolls internally. Called on input, on draft restore, and after send (which resets it).
let PACT_AS_RAF = 0, PACT_AS_TA = null;
function pactChatAutosize(ta, now) {
  if (!ta) return;
  // Coalesce to ONE resize per animation frame, OFF the keystroke path. Doing it synchronously in the
  // input handler forced a full layout flush (measuring .pact-chat + height:auto→scrollHeight) BEFORE
  // the typed character could paint — cheap on the light Core page, but laggy on the heavy Pact page
  // (editor grid of highlighted files + long message list). Deferring lets the character paint first.
  if (!now) {
    PACT_AS_TA = ta;
    if (PACT_AS_RAF) return;
    PACT_AS_RAF = (window.requestAnimationFrame || ((fn) => setTimeout(fn, 16)))(() => { PACT_AS_RAF = 0; pactChatAutosize(PACT_AS_TA, true); });
    return;
  }
  const box = ta.closest(".pact-chat");
  const avail = (box && box.clientHeight) || (ta.closest(".pact-right")?.clientHeight) || Math.round(window.innerHeight * 0.6);
  const cap = Math.max(72, Math.round(avail * 0.8));
  ta.style.maxHeight = cap + "px";
  ta.style.height = "auto";                                  // measure the true content height from a clean baseline
  const sh = ta.scrollHeight;
  ta.style.height = Math.min(sh, cap) + "px";
  ta.style.overflowY = sh > cap ? "auto" : "hidden";
}
let PACT_UNLOAD_HOOKED = false;
function pactChatInit(host) {
  PACT_CHAT = { host, tabs: [], activeId: null, seq: 0, es: null, mode: "bypassPermissions", conn: connIdentity() };
  // Flush the draft/layout on a page refresh or close too (keepalive lets the PUT outlive the page),
  // so a prompt typed right before reloading isn't lost. Registered once.
  if (!PACT_UNLOAD_HOOKED) { PACT_UNLOAD_HOOKED = true; window.addEventListener("pagehide", (e) => { if (PACT_STATE_READY) { if (!e.persisted) pactOutboxAbsorbQueues(); pactStateFlush(true); } }); }
  pactChatOpenStream();
  pactChatNewTab();
  pactChatEnsurePrime();   // the fresh tab becomes the prime (undeletable) conversation
  pactChatRender();        // re-render so the prime marker (★, no ×) shows immediately
  clearInterval(PACT_TICK_TIMER);
  PACT_TICK_TIMER = setInterval(pactChatTickTimer, 1000);   // live "thinking… M:SS" elapsed readout
  clearInterval(PACT_HEAL_TIMER);
  PACT_HEAL_TIMER = setInterval(pactChatSelfHeal, 4000);    // recover a stuck tab even if the stream stops delivering heartbeats (~8s with the WS_HEAL_ACTIVE_QUIET_MS throttle)
}
// Ask the server for the authoritative state of any tab that's stuck (marked busy but silent), or the
// active tab that looks idle right after a turn (a dropped deepwork status). Runs on the SSE heartbeat AND
// a local timer, so a desync between two clients (one stuck on "Working…", the other showing the finished
// reply) self-corrects even when this client's stream went quiet. Cheap + idempotent (resync just confirms
// when the tab really is still working).
function pactChatSelfHeal() {
  if (!PACT_CHAT) return;
  const now = Date.now();
  for (const t of PACT_CHAT.tabs) {
    if (!t.key) continue;
    // When the local transcript already exceeds the server cap, a capped resync is SHORTER than local, so the
    // `incoming >= local` guard would REJECT it — even when it carries the dropped reply. Fetch `full` then, so
    // incoming ≥ local and the reply surfaces. Busy branch only fires when stuck, so full is fine there; the
    // idle branch fires every ~8s, so it asks for full ONLY when actually stuck (a trailing unanswered prompt)
    // to avoid re-pulling a big history needlessly.
    const bigLocal = !!(t.msgs && t.msgs.length > PACT_RESYNC_CAP);
    if (pactChatBusy(t) && (now - (t._lastEventAt || 0)) > WS_HEAL_QUIET_MS && (now - (t._healAt || 0)) > WS_HEAL_QUIET_MS) {
      t._healAt = now;
      wsPost("control", { action: "resync", args: { sessionKey: t.key, scoped: true, full: bigLocal } });
    } else if (t.id === PACT_CHAT.activeId && !pactChatBusy(t) && (now - (t._lastActiveAt || t._lastResultAt || 0)) < WS_HEAL_ACTIVE_WINDOW_MS && (now - (t._statusSyncAt || 0)) > WS_HEAL_ACTIVE_QUIET_MS) {
      t._statusSyncAt = now;
      wsPost("control", { action: "resync", args: { sessionKey: t.key, scoped: true, full: bigLocal && pactInterruptedIdx(t) >= 0 } });
    }
  }
}
// Manual "sync now" — the page-reload-equivalent WITHOUT reloading: reconnect the live SSE stream, whose
// `hello` re-fetches every tab's authoritative state (pactChatResyncAll) and flushes the outbox — so a
// behind/stuck client catches up AND future events flow again (a dead stream is the usual cause). The
// resync is driven from `hello` (fired only once the fresh stream is subscribed, so its reply can't be
// dropped racing an unsubscribed stream).
function pactChatForceResync(btn) {
  if (!PACT_CHAT) return;
  // Visible feedback that the tap registered (the resync is async and may be a no-op if the server has no
  // newer state) — spin the button briefly and flash a transient note.
  if (btn) { btn.classList.add("pc-syncing"); setTimeout(() => btn.classList.remove("pc-syncing"), 1500); }
  pactChatFlashNote("↻ Syncing…");
  pactChatOpenStream();
}
// A tiny transient toast inside the active chat scroll (bottom), so an action like Sync gives feedback even
// when nothing visibly changes. Auto-removes.
function pactChatFlashNote(text) {
  if (!PACT_CHAT || !PACT_CHAT.host) return;
  const scroll = PACT_CHAT.host.querySelector(".pc-scroll"); if (!scroll) return;
  const wrap = scroll.parentNode || scroll;
  const n = el("div", { class: "pc-flash" }, [text]);
  (wrap.classList && wrap.classList.contains("stick-wrap-pc") ? wrap : scroll).appendChild(n);
  setTimeout(() => { try { n.remove(); } catch {} }, 1800);
}
// Start the response clock on ANY client the first time it sees this tab busy — the turn may have begun
// on another device, or been restored after a reload — so the timer shows everywhere, not only on the
// device that sent the prompt. Cleared on "result" (which also stamps the reply's total time).
function pactChatMarkTurnBusy(t) { if (t && (t.status === "thinking" || t.status === "deepwork") && !t._turnStartedAt) t._turnStartedAt = Date.now(); }
// Update the active tab's live elapsed timer in place (no full repaint) once a second while it's busy.
function pactChatTickTimer() {
  if (!PACT_CHAT || !PACT_CHAT.host) return;
  const t = pactChatActive(); if (!t) return;
  const node = PACT_CHAT.host.querySelector(".pc-timer");
  if (node && pactChatBusy(t) && t._turnStartedAt) node.textContent = pactFmtDuration(Date.now() - t._turnStartedAt);
}
// The Pact chat ALWAYS has exactly one "prime" conversation: it can never be closed, so there is never a
// state with zero conversations (a chat box always has one discussion open). If none is flagged yet (fresh
// init, or an older saved layout without the field), the first tab becomes prime. Called after any tab
// add / close / restore.
function pactChatEnsurePrime() {
  if (!PACT_CHAT || !PACT_CHAT.tabs.length) return;
  if (!PACT_CHAT.tabs.some((t) => t.prime)) PACT_CHAT.tabs[0].prime = true;
}
function pactChatStop() {
  // Persist the live draft/layout NOW before tearing down — otherwise the clearTimeout below cancels a
  // pending debounced save and a prompt typed in the last 800ms is silently lost on the way out.
  if (PACT_STATE_READY) pactStateFlush();
  PACT_STATE_READY = false; clearTimeout(PACT_STATE_TIMER);   // leaving Pact — stop persisting a torn-down layout
  clearInterval(PACT_STREAM_STALE_TIMER);   // the watchdog is per-stream — reopen re-arms it
  clearInterval(PACT_HEAL_TIMER);
  if (PACT_CHAT && PACT_CHAT.es) { try { PACT_CHAT.es.close(); } catch {} PACT_CHAT.es = null; }
}
function pactChatActive() { return PACT_CHAT && PACT_CHAT.tabs.find((t) => t.id === PACT_CHAT.activeId); }
function pactChatByKey(key) { return PACT_CHAT && PACT_CHAT.tabs.find((t) => t.key === key); }
// ===== PACT NEXT CHAT NAME — pure helper (sliced for lib/pactNextChatName.test.mjs) =====
// The default name for a NEW chat tab: "Chat N" where N reflects how many chats there ARE (count+1),
// not the ever-growing internal tab id. So with 2 chats open a new one is "Chat 3" — and closing it
// then opening another gives "Chat 3" again, never drifting up to "Chat 7". N is bumped past any
// existing "Chat N" so default names still never collide (e.g. after a middle chat was closed).
function pactNextChatName(tabs) {
  const list = Array.isArray(tabs) ? tabs : [];
  const taken = new Set(list.map((t) => t && t.name));
  let n = list.length + 1;
  while (taken.has("Chat " + n)) n++;
  return "Chat " + n;
}
// ===== end PACT NEXT CHAT NAME pure helper =====
function pactChatNewTab() {
  if (!PACT_CHAT) return;
  pactChatSaveDraft();   // keep the current tab's compose text before the shared textarea is torn down
  const id = ++PACT_CHAT.seq;   // a monotonic UNIQUE tab id (never reused) — distinct from the display name
  // `_queue`/`_pendingText` start empty and are only ever tied to THIS fresh session key — every tab
  // is a new object with its own key, so a message queued mid-turn can never fire into another
  // session (the Core cockpit resets p._queue on repo/worktree switch for the same reason).
  PACT_CHAT.tabs.push({ id, name: pactNextChatName(PACT_CHAT.tabs), key: wsUuid(), msgs: [], live: "", status: "idle", started: false, perm: null, draft: "", attachedImages: [], _queue: null, _pendingText: null, _pendingImages: null });
  PACT_CHAT.activeId = id;
  pactChatRender();
  pactStateSave();
}
function pactChatCloseTab(id) {
  const t = PACT_CHAT.tabs.find((x) => x.id === id);
  if (!t || t.prime) return;   // the prime conversation can never be closed — never a zero-chat state
  if (t.key) wsPost("control", { action: "delete", args: { sessionKeys: [t.key] } });   // let its session finish + save
  PACT_CHAT.tabs = PACT_CHAT.tabs.filter((x) => x.id !== id);
  if (!PACT_CHAT.tabs.length) { pactChatNewTab(); pactChatEnsurePrime(); return; }
  if (PACT_CHAT.activeId === id) PACT_CHAT.activeId = PACT_CHAT.tabs[0].id;
  pactChatEnsurePrime();
  pactChatRender();
  pactStateSave();
}
function pactChatOpenStream() {
  pactChatStop();
  // Use a subscriber id DISTINCT from the Core workspace stream (which registers under the bare conn
  // id). The server keys WS_SUBS by conn id, so sharing it let this stream's close handler evict the
  // Core stream's freshly-registered entry (same key) when switching views — starving the Core
  // workspace of live events until a manual refresh. The ":pact" suffix keeps the two independent.
  const q = "?conn=" + encodeURIComponent(PACT_CHAT.conn.id + ":pact") + "&label=" + encodeURIComponent(PACT_CHAT.conn.label + " (pact)");
  let es; try { es = new EventSource("/api/workspace/stream" + q); } catch { return; }
  PACT_CHAT.es = es;
  // The stream sends `event: hello` on every (re)connect. The browser's EventSource auto-reconnects
  // after a deploy/reload drops the connection, so this fires again once the web is back — catch up
  // every open tab on anything its previous connection silently missed. A turn that FINISHED while
  // disconnected emitted its live events into a dead stream and is otherwise lost to the UI; the
  // resync re-fetches the now-persisted reply. Mirrors the Core cockpit's resyncOpenPanes() on `hello`.
  PACT_STREAM_LAST_MSG_AT = Date.now();   // a fresh stream isn't already stale
  es.addEventListener("hello", () => { PACT_STREAM_LAST_MSG_AT = Date.now(); pactChatResyncAll(); pactOutboxFlush(); wsPost("control", { action: "usageLimits" }); });
  es.onmessage = (e) => { PACT_STREAM_LAST_MSG_AT = Date.now(); let m; try { m = JSON.parse(e.data); } catch { return; } pactChatRoute(m); };
  // Staleness watchdog — the fix for "desktop stuck on thinking while the phone shows the answer". Every
  // message AND the server's 25s heartbeat stamp PACT_STREAM_LAST_MSG_AT; if nothing arrives for
  // WS_STALE_MS the connection is a zombie (see the note where these vars are declared) — force-reconnect,
  // which re-fires `hello` → pactChatResyncAll and surfaces the reply the dead stream swallowed.
  clearInterval(PACT_STREAM_STALE_TIMER);
  PACT_STREAM_STALE_TIMER = setInterval(() => {
    if (!PACT_CHAT || !PACT_CHAT.es) return;
    if (Date.now() - PACT_STREAM_LAST_MSG_AT > WS_STALE_MS) pactChatOpenStream();
  }, 10_000);
}
// Ask the server for the CURRENT authoritative state of every keyed tab's session — the same
// reconnect catch-up the Core cockpit runs (see resyncOpenPanes + `_resync` server-side). Each reply
// arrives as an `event/resync` frame handled in pactChatRoute as a wholesale REPLACE (never the
// fresh-open `sessionOpen` concat, which assumes an empty tab and would duplicate on a filled one).
function pactChatResyncAll() {
  if (!PACT_CHAT) return;
  for (const t of PACT_CHAT.tabs) if (t.key) wsPost("control", { action: "resync", args: { sessionKey: t.key, scoped: true } });
}
// ===== PACT RESUME-LOST — pure helper (sliced for lib/pactResumeLost.test.mjs) =====
// Detects the SDK's "the session I tried to resume is gone" error — a Claude Code session that ended
// (or was interrupted before it finalized, e.g. by a daemon restart), so its `resume` id no longer
// resolves. When this fires, the Pact chat drops the stale resume id and restarts the chat FRESH
// rather than hard-erroring and losing the prompt.
function pactIsResumeLostError(text) {
  return /No conversation found with session ID/i.test(String(text || ""));
}
// ===== end PACT RESUME-LOST pure helper =====
function pactChatRoute({ kind, sessionKey, data }) {
  if (!PACT_CHAT) return;
  if (kind === "presence") return;
  if (kind === "heartbeat") {
    pactChatSelfHeal();   // also runs on a local timer (PACT_HEAL_TIMER) so a silent stream still self-heals
    return;
  }
  // Account-wide plan usage limits (5h/7d) — NOT tied to a tab (the engine answers it from any live
  // session and echoes with the requesting key, which may be null), so handle it before the tab lookup.
  if (kind === "event" && data && data.kind === "usageLimits") { PACT_CHAT.usageLimits = data.limits; pactRenderUsageLimits(); return; }
  // The per-session history list (state frame, no sessionKey) — refresh the history panel.
  if (kind === "state" && data && Array.isArray(data.pactSessions)) { PACT_CHAT.sessions = data.pactSessions; pactChatRenderHistory(); if (typeof PACT_MOBILE_SESSIONS_CB === "function") PACT_MOBILE_SESSIONS_CB(); return; }
  // A saved chat's transcript arriving to rehydrate a Resume / Load-into-box tab. The frame is keyed
  // by the session's OWN id; a "Load into new box" tab has a different key, so correlate via the
  // pending-open map first, then fall back to a direct key match (Resume, whose key IS the sessionId).
  if (kind === "transcript") {
    const targetId = PACT_CHAT._pendingOpen ? PACT_CHAT._pendingOpen[sessionKey] : undefined;
    const tt = targetId != null ? PACT_CHAT.tabs.find((x) => x.id === targetId) : (sessionKey ? pactChatByKey(sessionKey) : null);
    if (tt) {
      const incoming = pactTranscriptToMsgs(data && data.transcript);
      // Adopt the saved baseline as the tab's history — but NEVER wipe out a live/just-sent turn that
      // a race delivered before this (round-tripped) rehydrate landed. When this frame answers OUR OWN
      // open request (`targetId` set — the tab was FRESH/empty when we asked), anything now in `tt.msgs`
      // was added SINCE the open: a prompt the user just sent and/or its streaming reply. Prepend the
      // history baseline and keep that live tail, so "I sent a prompt right after opening and my
      // message vanished (only the answer showed)" can't happen. For an unsolicited refresh, fall back
      // to the safe length guard (a rehydrate reads only persisted turns, so it can be legitimately
      // shorter than what's live — clobbering there is what made resumed answers disappear).
      if (targetId != null) {
        let tail = tt.msgs;
        // If a slow rehydrate raced PAST our send, the user turn may be at the end of `incoming` AND
        // the start of the local tail — drop the duplicate so the prompt shows exactly once.
        const lastIn = incoming[incoming.length - 1];
        if (lastIn && tail[0] && lastIn.role === tail[0].role && (lastIn.text || "") === (tail[0].text || "")) tail = tail.slice(1);
        tt.msgs = pactPreserveElapsed(tt.msgs, incoming).concat(tail);
        tt._transcriptTruncated = !!(data && data.transcriptTruncated);   // baseline is the tail only — older history fetchable via "Show earlier"
        pactSetNumOffsets(tt, data);   // absolute P#/R# numbering: how many prompts/responses precede this window
      } else if (incoming.length >= tt.msgs.length) { tt.msgs = pactPreserveElapsed(tt.msgs, incoming); tt._transcriptTruncated = !!(data && data.transcriptTruncated); pactSetNumOffsets(tt, data); }
      pactChatReinjectMigrations(tt);   // splice the worktree-migration markers back into the rehydrated transcript
      pactChatHealWorktree(tt);         // recover a worktree binding the IDE-state layout may have lost
      pactChatSetLoading(tt, false);    // transcript arrived — drop the loader
      // Likewise don't yank a mid-turn tab back to idle — a live turn in flight owns the status.
      if (tt.status !== "thinking" && tt.status !== "deepwork" && tt.status !== "awaiting-permission") tt.status = "idle";
      tt._forceBottom = true;
      if (data && data.sessionId && !tt.resume) { const rid = pactResumeIdOk(data.sessionId, tt.key); if (rid) tt.resume = rid; }
      pactChatPaint(tt);
    }
    if (PACT_CHAT._pendingOpen) delete PACT_CHAT._pendingOpen[sessionKey];
    return;
  }
  const t = sessionKey ? pactChatByKey(sessionKey) : null;
  if (!t) return;
  if (kind === "state") { if (data && data.session) { if (data.session.status) t.status = data.session.status; if (data.session.usage) t.usage = data.session.usage; pactChatMarkTurnBusy(t); pactChatPaint(t); } return; }
  if (kind === "permission") { t.perm = { requestId: data.requestId, tool: data.tool || data.name || data.title || "a tool" }; t.status = "awaiting-permission"; pactChatPaint(t); return; }
  if (kind !== "event") return;
  const d = data || {};
  t._lastEventAt = Date.now();   // per-tab activity stamp — the heartbeat self-heal spots a stuck-busy tab by it
  // Last REAL content event, EXCLUDING a resync reply (which is itself an "event"). The idle-active self-heal
  // window is keyed to this: if we counted resync replies, verifying a genuinely-done tab would perpetually
  // re-arm its own window and never stop. Excluding them lets the window close after true silence.
  if (d.kind !== "resync") t._lastActiveAt = t._lastEventAt;
  switch (d.kind) {
    // Reconnect catch-up reply (see pactChatResyncAll + `_resync` server-side): the server's
    // AUTHORITATIVE current state. REPLACE the tab's messages with the persisted transcript (never
    // the fresh-open concat — that assumes an empty tab and would DUPLICATE here), guarding on length
    // so a still-unpersisted in-flight turn is never clobbered, and keeping the streaming buffer only
    // while the turn is genuinely still running. This is what surfaces a reply that FINISHED during a
    // deploy/reload's downtime. Also clear any leftover fresh-open pending entry for this tab so a
    // late sessionOpen reply can't re-concat what we just replaced.
    case "resync": {
      const incoming = pactTranscriptToMsgs(d.transcript);
      const dec = pactResyncDecision(t.msgs.length, incoming.length, d.status, d.live);
      if (dec.replace) { t.msgs = pactPreserveElapsed(t.msgs, incoming); pactChatReinjectMigrations(t); pactChatHealWorktree(t); t._transcriptTruncated = !!d.transcriptTruncated; pactSetNumOffsets(t, d); }   // keep a live-stamped "Thought for …" the daemon hasn't persisted yet; re-add migration markers; recover a lost worktree binding; refresh P#/R# offsets
      pactChatSetLoading(t, false);   // a resync also satisfies an in-flight load — drop the loader
      if (d.usage) t.usage = d.usage;
      if (d.status) t.status = d.status;
      pactChatMarkTurnBusy(t);   // restored mid-turn (e.g. after reload) → show the timer here too
      if (!dec.keepLive) t.live = "";
      if (d.sessionId && !t.resume) { const rid = pactResumeIdOk(d.sessionId, t.key); if (rid) t.resume = rid; }
      if (PACT_CHAT._pendingOpen && PACT_CHAT._pendingOpen[t.key] != null) delete PACT_CHAT._pendingOpen[t.key];
      // Do NOT force the bottom here. A resync fires mid-session (stream reconnect, the stale-stream
      // watchdog, the heartbeat self-heal on a long/quiet turn) — forcing the tail yanked a reader who'd
      // scrolled up back down on every one. Let the stick controller decide: if they were at the bottom,
      // it follows the tail; if they'd scrolled up, it stays put and lights the "↓ New output" pill.
      pactChatPaint(t);
      pactChatDrainQueue(t);   // a turn that finished during downtime just landed — release any queued follow-up
      // A bookmark jump to a response not in the loaded window triggered a full resync — now complete the jump.
      if (t._pendingBookmarkScroll != null) { const at = t._pendingBookmarkScroll; t._pendingBookmarkScroll = null; requestAnimationFrame(() => pactChatScrollToResponse(t, at)); }
      return;
    }
    // A prompt echoed from ANOTHER device (own sends are guarded out) → a turn is starting here: (re)start
    // the response clock so the timer shows on this client too, not only where it was typed.
    case "user": if (!(d.by && d.by === PACT_CHAT.conn.id)) { t._turnStartedAt = Date.now(); t.msgs.push({ role: "user", text: d.text || "", images: d.images || [], workspaceId: d.workspaceId || PACT_WORKSPACE_ID }); pactChatPaint(t); } return;
    case "assistant_delta": if (!t._turnStartedAt) t._turnStartedAt = Date.now(); t.live = (t.live || "") + (d.text || ""); pactChatPaintLive(t); return;
    case "assistant": t.live = ""; t._pendingText = null; t._pendingImages = null; t.msgs.push({ role: "assistant", text: d.text || "" }); pactChatPaint(t); return;
    case "tool_use": if (!t._turnStartedAt) t._turnStartedAt = Date.now(); t.live = ""; t.msgs.push({ kind: "tool_use", tools: d.tools || [] }); pactChatPaint(t); return;
    case "result":
      t.live = ""; t.status = "idle"; t._pendingText = null; t._pendingImages = null;
      // Stamp the turn time onto this turn's reply ("Thought for …"). Prefer the SDK's own duration (from
      // the result event — authoritative + identical on every device + the same value the server persists,
      // so it matches after a reload); fall back to our local clock if it's absent. Attaches to the last
      // assistant bubble; the tool rounds sit above it.
      {
        const dur = (typeof d.durationMs === "number") ? d.durationMs : (t._turnStartedAt ? Date.now() - t._turnStartedAt : null);
        if (dur != null) { const last = [...t.msgs].reverse().find((m) => m.role === "assistant"); if (last) { last.elapsedMs = dur; last._node = null; } }   // clear the cached node so the "Thought for…" header re-renders once
        t._turnStartedAt = null;
      }
      if (d.usageTotal) t.usage = d.usageTotal;
      // Context usage changes every turn — refresh it once a turn actually finishes (not on every
      // streamed chunk), exactly like the Core cockpit (see paintPane's contextUsage request).
      wsPost("control", { action: "contextUsage", args: { sessionKey: t.key } });
      wsPost("control", { action: "usageLimits" });   // account-wide plan usage moves each turn — refresh the badge
      t._lastResultAt = Date.now();   // a deepwork/background phase can follow a "result" — see the heartbeat
      pactChatPaint(t); pactEdCheckAgentEdits(); pactEdCheckChangedFiles(); pactEdLoadWorktrees();   // a turn may have created/merged/removed a worktree — refresh + reconcile bindings
      pactChatDrainQueue(t);   // turn done → release anything typed mid-turn, merged into one prompt
      pactOutboxFlush();       // …and any queue recovered from a deploy/reload that was waiting on this turn
      return;
    // Context-window usage answer for this tab's session — store + repaint the header indicator.
    case "contextUsage": t.contextUsage = d.usage; pactChatPaint(t); return;
    // A prompt sent while this session was still finishing its current turn is refused with `busy`
    // (see lib/workspace.mjs's single-writer turn lock). Normally pactChatSend already queues a
    // mid-turn message rather than POSTing it, so this only fires on a genuine race — a turn started
    // between our busy check and the server receiving the POST. Re-queue the just-sent prompt (with
    // its images) exactly as if pactChatSend had seen the turn coming; drainQueue releases it when the
    // running turn ends. Keep the spinner (a turn IS running) — don't reset to idle, or nothing would
    // drain the re-queued message.
    case "busy":
      t.live = "";
      // A `busy` refusal PROVES the session is mid-round even though the visible turn may have looked done
      // (the "Send button says ready but a send got refused" case). Reflect that so the indicator stops
      // lying, and ask the server for its authoritative status so the button settles on the truth (Deep
      // Work… while it keeps producing, or idle the instant it finishes) instead of a stuck "Working…".
      if (!pactChatBusy(t)) t.status = "deepwork";
      wsPost("control", { action: "resync", args: { sessionKey: t.key, scoped: true } });
      if (t._pendingText != null) {
        // The optimistic bubble dispatch pushed was NOT accepted (the server had a turn running) — retract
        // it so the message appears ONCE, as the queued bubble below, instead of twice (the double-send
        // the UI showed). Roll back the first-message flag so the preamble is re-added on the real send.
        if (t._optimisticUserMsg) { t.msgs = t.msgs.filter((m) => m !== t._optimisticUserMsg); if (t._optimisticFirst) t.started = false; t._optimisticUserMsg = null; t._optimisticFirst = false; }
        t._queue = t._queue || [];
        t._queue.push({ text: t._pendingText, images: t._pendingImages || [] });
        t._pendingText = null; t._pendingImages = null;
        t._forceBottom = true;
        pactChatPaint(t);   // surface the re-queued message as a pending bubble
      } else {
        t.msgs.push({ kind: "note", text: "⏳ Busy finishing the current reply — your message will send once it lands." });
        pactChatPaint(t);
      }
      return;
    case "error": {
      const emsg = d.text || d.message || "error";
      // A "could not be opened" reply to a rehydrate/resume in flight (the session no longer exists on
      // disk) must leave the tab quietly empty, not push a scary error bubble into a freshly-restored
      // tab. Any OTHER error (a real turn failure) still surfaces normally.
      if (PACT_CHAT._pendingOpen && sessionKey && PACT_CHAT._pendingOpen[sessionKey] != null) { delete PACT_CHAT._pendingOpen[sessionKey]; pactChatSetLoading(t, false); t.live = ""; t.status = "idle"; t._pendingText = null; t._pendingImages = null; pactChatPaint(t); return; }
      // Resume-lost: the Claude Code session this tab was continuing is gone (typically interrupted by a
      // restart before it finalized). Drop the stale resume id so it's never reused, and — if a prompt
      // was in flight — AUTO-RETRY it as a FRESH conversation (resume cleared → the send goes out as
      // fresh:true, so no bad-id reuse) instead of hard-erroring and losing it. The agent restarts
      // without Claude Code's prior context, but the shown transcript stays and the prompt is answered.
      if (pactIsResumeLostError(emsg)) {
        t.resume = null;
        if (t._pendingText != null) {
          const retryText = t._pendingText, retryImages = t._pendingImages || [];
          if (t._optimisticUserMsg) { t.msgs = t.msgs.filter((m) => m !== t._optimisticUserMsg); t._optimisticUserMsg = null; }
          t.live = ""; t.status = "idle"; t._pendingText = null; t._pendingImages = null; t.started = false;
          if (typeof pactChatFlashNote === "function") pactChatFlashNote("↻ Prior session expired — restarting this chat fresh…");
          pactChatDispatch(t, retryText, retryImages);
          return;
        }
        t.live = ""; t.status = "idle"; t.msgs.push({ kind: "note", text: "↻ The prior agent session expired — your next message starts a fresh conversation." });
        pactChatPaint(t); pactStateSave(); pactChatDrainQueue(t);
        return;
      }
      t.live = ""; t.status = "idle"; t._pendingText = null; t._pendingImages = null; t.msgs.push({ kind: "error", text: emsg });
      pactChatPaint(t);
      pactChatDrainQueue(t);   // a failed turn still ends the turn — don't strand a queued follow-up
      return;
    }
    case "status":
      t.status = d.status;
      pactChatPaint(t);
      pactChatDrainQueue(t);   // e.g. status→idle after an interrupt: release any queued message
      return;
    case "interrupted":
      t.status = "idle"; t.msgs.push({ kind: "note", text: "■ interrupted" });
      pactChatPaint(t);
      pactChatDrainQueue(t);
      return;
    default: return;
  }
}
// ---- Pact chat image attach ------------------------------------------------------
// Mirrors the Core cockpit's attach flow (📎 / paste / drag-drop) but stores state on the active
// TAB (t.attachedImages) rather than a pane, and reuses the MODULE-scope encode/cap helpers
// (wsCompressImage, wsDataUrlToAttachment, WS_IMG_* caps) so both surfaces encode identically.
function pactShowImgErr(t, msg) {
  if (!PACT_CHAT || !t || t.id !== PACT_CHAT.activeId) return;
  const errEl = PACT_CHAT.host.querySelector(".pc-img-err"); if (!errEl) return;
  errEl.textContent = msg || ""; errEl.hidden = !msg;
}
function pactImgChip(t, img, idx) {
  const thumb = el("img", { class: "pc-img-thumb", alt: "attached image" });
  thumb.src = img.dataUrl;
  const removeBtn = el("button", { class: "pc-img-x", type: "button", title: "Remove this image" }, ["×"]);
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    t.attachedImages = (t.attachedImages || []).filter((_, i) => i !== idx);
    pactShowImgErr(t, "");
    pactPaintAttachment(t);
  });
  return el("div", { class: "pc-img-chip" }, [thumb, removeBtn]);
}
function pactPaintAttachment(t) {
  if (!PACT_CHAT || !t || t.id !== PACT_CHAT.activeId) return;
  const wrap = PACT_CHAT.host.querySelector(".pc-img-preview"); if (!wrap) return;
  const imgs = t.attachedImages || [];
  wrap.hidden = !imgs.length;
  wrap.replaceChildren(...imgs.map((img, idx) => pactImgChip(t, img, idx)));
}
// Serialize all attach ops for a tab through one promise chain so two entry points (e.g. a fast
// double-paste) can't interleave their read-modify-write of t.attachedImages — same guarantee as
// the Core wsAttachImageFiles.
function pactAttachImageFiles(t, files) {
  if (!t) return Promise.resolve();
  t._attachChain = (t._attachChain || Promise.resolve())
    .then(async () => { for (const f of files) await pactAttachImageFile(t, f); })
    .catch(() => {});
  return t._attachChain;
}
async function pactAttachImageFile(t, file) {
  pactShowImgErr(t, "");
  const existing = t.attachedImages || [];
  if (existing.length >= WS_IMG_MAX_COUNT) { pactShowImgErr(t, `You can attach up to ${WS_IMG_MAX_COUNT} images per message.`); return; }
  if (!file || !/^image\//.test(file.type || "")) { pactShowImgErr(t, "That isn't an image file."); return; }
  let attachment = null;
  try {
    if (WS_IMG_ALLOWED_TYPES.includes(file.type)) {
      const dataUrl = await wsReadFileAsDataUrl(file);
      attachment = wsDataUrlEncodedSize(dataUrl) <= WS_IMG_MAX_ENCODED_BYTES ? wsDataUrlToAttachment(dataUrl) : await wsCompressImage(file);
    } else {
      attachment = await wsCompressImage(file);
    }
  } catch { attachment = null; }
  if (!attachment) { pactShowImgErr(t, "That image is too large to attach, even after compression — try a smaller one."); return; }
  // Re-check the cap right before committing — two async attach paths could both have passed the
  // early check while `existing` was still under the cap.
  if ((t.attachedImages || []).length >= WS_IMG_MAX_COUNT) { pactShowImgErr(t, `You can attach up to ${WS_IMG_MAX_COUNT} images per message.`); return; }
  t.attachedImages = [...(t.attachedImages || []), attachment];
  pactPaintAttachment(t);
}
// A tab is "busy" (a turn is running) whenever it's thinking, in deep work, or waiting on a tool
// permission — the exact set the Core cockpit's paneBusy() uses. Mirroring it keeps the "queue a
// message typed mid-turn" behaviour identical across the two chat surfaces.
function pactChatBusy(t) { return !!t && (t.status === "thinking" || t.status === "deepwork" || t.status === "awaiting-permission"); }
// The per-conversation status light shown in the mobile switcher (and anywhere a `.pactm-frow-state` dot is
// mounted). It MIMICS the send button's colour so a single glance tells you which agents still need you:
//   • idle/done   → accent (the send-ready colour) — this one is waiting on YOUR next prompt
//   • working     → amber  (thinking / awaiting a permission you must grant)
//   • deep work   → red    (the SDK is still producing after the visible turn ended)
// Loading state for a tab whose transcript is being fetched (page load / history resume). Drives the chat-box
// loader so a big/tunnelled conversation shows "loading…" instead of a blank box for the seconds it takes to
// arrive. Self-clears after a timeout so a dropped/errored reply never wedges the loader up forever.
function pactChatSetLoading(t, on) {
  if (!t) return;
  clearTimeout(t._loadTimer); t._loadTimer = null;
  t._loading = !!on;
  if (on) t._loadTimer = setTimeout(() => { if (t._loading) { t._loading = false; pactChatPaint(t); } }, 12000);
}
// Catch a tab up to the server's authoritative state the moment you switch to it — the fix for "I had to
// refresh to see the latest reply." A background tab only updates from live stream events; if any were
// dropped (flaky mobile link) it can sit stale until a reload. Re-asking on activate makes simply LOOKING at
// a tab enough to see its newest turns. Cheap + idempotent (the resync only repaints if something changed).
function pactChatCatchUp(t) {
  // `full` when this tab already holds its COMPLETE history (not truncated): a capped catch-up would be
  // SHORTER than what's on screen, so the resync length-guard would reject it and a new tail turn would be
  // missed. A truncated tab (showing only the tail) takes the cheap capped catch-up.
  // `full` when the tab already holds its complete history, OR when its local transcript exceeds the server
  // cap (so a capped resync would be rejected by the length-guard and a dropped reply would never land).
  // Switching to a tab is on-demand, so a one-off full fetch to guarantee it's current is worth it.
  if (t && t.key) wsPost("control", { action: "resync", args: { sessionKey: t.key, scoped: true, full: t._transcriptTruncated === false || !!(t.msgs && t.msgs.length > PACT_RESYNC_CAP) } });
}
function pactChatConvoStateCls(t) { return t && t.status === "deepwork" ? " --deep" : (pactChatBusy(t) ? " --busy" : ""); }
function pactChatConvoStateLabel(t) {
  if (!t) return "";
  if (t.status === "deepwork") return "deep work — still producing";
  if (t.status === "awaiting-permission") return "waiting on a permission";
  if (pactChatBusy(t)) return "working…";
  return "idle — ready for your prompt";
}
// Live-refresh every mounted conversation status dot from the current tab statuses. Cheap + idempotent
// (only rewrites an attribute when it actually changed), driven by a self-terminating interval while the
// switcher sheet is open AND by pactChatPaint, so it tracks background tabs too — not just the active one.
function pactChatSyncConvoDots() {
  if (!PACT_CHAT) return;
  const dots = document.querySelectorAll(".pactm-frow-state[data-tabid]");
  for (const dot of dots) {
    const t = PACT_CHAT.tabs.find((x) => String(x.id) === dot.getAttribute("data-tabid"));
    if (!t) continue;
    const cls = "pactm-frow-state" + pactChatConvoStateCls(t);
    if (dot.className !== cls) dot.className = cls;
    const lbl = pactChatConvoStateLabel(t);
    if (dot.getAttribute("title") !== lbl) dot.setAttribute("title", lbl);
  }
}
// ===== PACT QUEUE MERGE — pure helper (sliced out for unit tests; see lib/pactQueue.test.mjs)
// Merge N queued { text, images } entries (typed while the agent was mid-turn) into ONE prompt: the
// texts joined by a blank line (double-newline, exactly like the Core drainQueue), the images
// concatenated in the order they were typed and capped at `imgCap` (the same per-message image limit
// a single send respects). `overflow` flags that images past the cap were dropped, so the caller can
// warn. Pure — no DOM, no module state — so a unit test can exercise the merge without booting the page.
function pactMergeQueued(items, imgCap) {
  const list = Array.isArray(items) ? items : [];
  const text = list.map((i) => (i && i.text) || "").join("\n\n");
  const allImages = list.flatMap((i) => (i && i.images) || []);
  const cap = Number.isFinite(imgCap) ? imgCap : Infinity;
  return { text, images: allImages.slice(0, cap), overflow: allImages.length > cap };
}
// ===== end PACT QUEUE MERGE pure helper =====
// The actual dispatch: POST one prompt (with its own text/images) and do the round-trip bookkeeping.
// Split out of pactChatSend — exactly like the Core cockpit's dispatchPrompt/send split — so a queued
// item (pactChatDrainQueue) can be sent identically once the tab goes idle, not only a prompt typed
// while the tab was already free. First-message preamble/auto-name + resume handling live here so both
// entry points inherit them.
async function pactChatDispatch(t, text, images) {
  if (!PACT_CHAT || !t) return;
  images = images || [];
  let payload = text;
  const firstMsg = !t.started;
  if (firstMsg) { t.started = true; payload = PACT_CHAT_PREAMBLE + "\n\n" + text; }   // orient the agent on the first message
  // If interrupted prompts sitting just above were DISCARDED, tell the agent to skip them — this is what
  // "the next prompt won't include it in its processing" means. Rides the PAYLOAD only, never the visible
  // bubble (userMsg.text below stays clean).
  const _discarded = pactTrailingDiscarded(t);
  if (_discarded.length) {
    const snips = _discarded.map((m) => `“${(m.text || "").replace(/\s+/g, " ").slice(0, 70)}”`).join("; ");
    payload = `(Please DISREGARD my discarded message(s) above — do not act on ${_discarded.length > 1 ? "them" : "it"}: ${snips}. Act only on what follows.)\n\n` + payload;
  }
  // Auto-name a still-default chat from its FIRST real user line (the clean `text`, never the skill
  // preamble). Keeps the tab + history readable; stored in the shared names map so both surfaces agree.
  if (firstMsg && t.key && !PACT_CHAT_NAMES[t.key] && /^Chat \d+$/.test(t.name || "")) {
    const nm = pactDeriveChatName(text);
    if (nm) { t.name = nm; PACT_CHAT_NAMES[t.key] = nm; }
  }
  // Stash the just-sent images on the local user message as raw dataUrls (the server won't echo
  // this prompt back to us — see the "user" event's `by` guard — so this render is authoritative
  // until a reload replaces it with the persisted turn's /api/workspace/image paths). Held by
  // reference so a failed send can RETRACT it (it was never really sent).
  const userMsg = { role: "user", text, images: images.length ? images.map((a) => ({ dataUrl: a.dataUrl })) : undefined };
  t.msgs.push(userMsg);
  // Track this optimistic bubble so a server `busy` refusal (a race — a turn was already running) can
  // RETRACT it: the message wasn't accepted, it's being re-queued, and it must show once (as the queued
  // bubble), not twice. `_optimisticFirst` rolls back the first-message flag on retract so the orienting
  // preamble is re-added when the queued copy actually sends.
  t._optimisticUserMsg = userMsg; t._optimisticFirst = firstMsg;
  t.status = "thinking"; t.live = "";
  t._turnStartedAt = Date.now();   // start the response timer (ticks live; final elapsed shown on the reply)
  // Safety net for a busy race: if the server refuses THIS dispatch with `busy` (its turn lock caught a
  // turn we couldn't yet see), pactChatRoute's `busy` case needs the exact text + images back to
  // re-queue rather than drop them. Cleared once the prompt is accepted (assistant/result) or errors.
  t._pendingText = text; t._pendingImages = images;
  pactChatRender();   // reflect a fresh auto-name on the tab (also re-paints the active conversation)
  pactStateFlush();   // persist the just-sent tab/key IMMEDIATELY so it's restorable even if you navigate away at once
  t._forceBottom = true;   // your own just-sent message lands at the bottom + re-pins, even if you'd scrolled up
  pactChatPaint(t);
  // `scoped: true` — a Pact tab is ALWAYS one specific conversation. The engine must seed/replay AND
  // auto-resume ONLY this session's own turns, never the merged/latest workspace session (which, since
  // every Pact tab shares one workspace id, is a SIBLING like Master — that's what made SWP answer as
  // the AQP/Master audit). `resume` continues a specific saved session (set when opened from history);
  // `fresh: firstMsg` is true ONLY on a tab's genuinely-first message so a brand-new conversation starts
  // blank — a restored/existing tab (firstMsg=false) lets the engine auto-resume its OWN saved session,
  // so continuing a chat keeps ITS context, never a sibling's. (Core sends no scoped/fresh — unchanged.)
  // Stage-2 worktree binding: the agent runs with cwd = this tab's worktree, so its Edit/Bash act on
  // that isolated checkout (and an editor box bound to the same worktree shows those edits). Fixed per
  // conversation — the head selector only lets you set it before the first message.
  const body = { sessionKey: t.key, repo: PACT_REPO, worktree: t.worktree || "main", text: payload, mode: PACT_CHAT.mode, by: PACT_CHAT.conn.id, resume: t.resume || undefined, fresh: firstMsg, scoped: true };
  if (images.length) body.images = images.map((a) => ({ mediaType: a.mediaType, base64Data: a.base64Data }));
  const r = await wsPost("prompt", body);
  if (!r || r.ok === false) {
    // The prompt NEVER reached the work machine (offline, or the login lapsed). Don't leave a bubble
    // that looks sent, and don't lose the text: retract the optimistic bubble, stash it in the outbox
    // (survives reload/relogin, auto-retries when healthy), refill the compose box, and show an
    // actionable note with Retry. `started` is rolled back if this was the very first message so its
    // orienting preamble is re-added on the eventual successful send.
    t.msgs = t.msgs.filter((m) => m !== userMsg);
    t._optimisticUserMsg = null; t._optimisticFirst = false;
    if (firstMsg) t.started = false;
    t.status = "idle"; t.live = ""; t._pendingText = null; t._pendingImages = null;
    const boxId = pactOutboxAdd(t.key, text, images);
    const why = (r && r._status === 401)
      ? "Your login expired — this message was NOT sent, but it's saved. Re-login and it retries automatically."
      : (r && r._offline)
        ? "Not connected — this message was NOT sent, but it's saved and retries when you're back online."
        : "This message couldn't be sent, but it's saved. It'll retry automatically — or press Retry.";
    t.msgs.push({ kind: "error", text: why, retry: () => { pactOutboxRemove(boxId); pactChatDispatch(t, text, images); } });
    const ta = PACT_CHAT.host && PACT_CHAT.host.querySelector(".pc-input");
    if (ta && !ta.value.trim()) { ta.value = text; t.draft = text; pactChatAutosize(ta); pactStateSave(); }
    t._forceBottom = true; pactChatPaint(t);
    if (r && r._status === 401) sessionSetExpired(true);
  }
}
// One place that records a worktree move on a conversation: flips its cwd (future turns), drops the marker
// line, and remembers it (t.migrations) so it's re-injected in time order on reload (see pactRestoreChat).
function pactChatRecordMigration(t, from, to) {
  t.worktree = (to && to !== "main") ? to : undefined;
  // Stamp the marker strictly AFTER the newest message it follows. The marker's clock is the browser's, but
  // messages are timestamped on the work machine — a small clock skew could otherwise sort the marker BEFORE
  // the last answer it should sit under (the reinject places it by `at`). Anchoring to the last known message
  // timestamp makes placement robust regardless of which clock is ahead, while later messages (persisted with
  // a larger server `at`) still land below it.
  const lastAt = (t.msgs || []).reduce((mx, m) => (typeof m.at === "number" && m.at > mx ? m.at : mx), 0);
  const rec = { kind: "migration", from: from || "main", to: to || "main", at: Math.max(Date.now(), lastAt + 1) };
  t.msgs.push(rec);
  (t.migrations = t.migrations || []).push({ from: rec.from, to: rec.to, at: rec.at });
  t._forceBottom = true;
  pactStateSave(); pactChatRender(); pactChatPaint(t); pactEdLoadWorktrees();
}
// ===== PACT MIGRATION-PLACEMENT — pure helper (sliced out for unit tests; see lib/pactMigrationPlace.test.mjs)
// A worktree-migration marker is a CLIENT-side annotation — it is NOT in the server transcript — so after
// every rehydrate (sessionOpen / resync replaces the message list wholesale) the client must splice its
// recorded markers back in. Each marker lands before the first message with `at > marker.at`; a marker with no
// later message goes at the end. Drops any markers already present first, so repeated rehydrates never
// duplicate them. Returns the SAME array reference untouched when there's nothing to do (no markers present
// and none to add) so an unrelated resync doesn't needlessly churn the list. The load-bearing precondition:
// the transcript messages must carry their persisted `at` (see pactTranscriptToMsgs — dropping it was the bug
// that made every marker fall to the very bottom, below the latest answer, because none had a timestamp to
// anchor against).
function pactPlaceMigrations(msgs, migrations) {
  const arr = Array.isArray(msgs) ? msgs : [];
  const stripped = arr.filter((m) => !(m && m.kind === "migration"));
  // PRIMARY source of markers: the transcript itself. Each turn now records the worktree it ran in (server
  // stamps `worktree` on user turns), so a change between consecutive turns' worktrees IS a migration — this
  // reconstructs the "migrated to worktree X" separators straight from the persisted history, surviving even
  // if the IDE-state layout (t.migrations, the old only home) is dropped or corrupted. The recorded
  // t.migrations are unioned in as a fallback (older turns predating the worktree stamp), deduped by `at`.
  const derived = pactDeriveMigrations(stripped);
  const seenAt = new Set(derived.map((m) => m.at));
  const extra = (Array.isArray(migrations) ? migrations : []).filter((m) => m && typeof m.at === "number" && !seenAt.has(m.at));
  const migs = derived.concat(extra).sort((a, b) => a.at - b.at);
  if (!migs.length) return arr.some((m) => m && m.kind === "migration") ? stripped : arr;
  const out = stripped;
  for (const mig of migs) {
    let idx = out.findIndex((m) => typeof m.at === "number" && m.at > mig.at);
    if (idx < 0) idx = out.length;
    out.splice(idx, 0, { kind: "migration", from: mig.from || "main", to: mig.to || "main", at: mig.at });
  }
  return out;
}
// Reconstruct migration records from worktree transitions in a transcript. Walk turns in order; each time the
// effective worktree changes (main⇄a named worktree, or between two named ones) emit a marker at the FIRST
// turn of the new worktree. Only user turns carry `worktree`; a turn without one is "main". Returns records
// shaped like the stored ones ({ from, to, at }).
function pactDeriveMigrations(msgs) {
  const out = [];
  let cur = "main";
  for (const m of Array.isArray(msgs) ? msgs : []) {
    if (!m || m.role !== "user" || typeof m.at !== "number") continue;
    const wt = (typeof m.worktree === "string" && m.worktree) ? m.worktree : "main";
    // `at - 1` so the marker sorts strictly BEFORE the first turn of the new worktree (pactPlaceMigrations
    // inserts before the first message with `at > marker.at`). Matches the convention the record side uses,
    // so a transcript-derived marker and a stored one for the same migration dedupe cleanly.
    if (wt !== cur) { out.push({ from: cur, to: wt, at: m.at - 1 }); cur = wt; }
  }
  return out;
}
// ===== end PACT MIGRATION-PLACEMENT pure helper =====
// Re-inject a conversation's recorded migration markers into its transcript in chronological order — the
// server rehydrate (sessionOpen / resync) replaces t.msgs wholesale, so the client-side markers must be
// spliced back each time by their `at` timestamp. Idempotent (drops any markers already present first).
function pactChatReinjectMigrations(t) {
  if (!t || !Array.isArray(t.msgs)) return;
  t.msgs = pactPlaceMigrations(t.msgs, t.migrations);
}
// Recover a LOST worktree binding from the transcript. Each turn records the worktree it ran in, so if the
// IDE-state layout dropped a tab's binding (the "my migrated tab reverted to main" bug), the last turn that
// carries a worktree is the ground truth of where this conversation actually runs — adopt it and re-persist,
// so the next prompt uses the right checkout instead of silently falling back to main. Only fills an EMPTY
// binding: a set one may reflect a just-issued migration that has no turn on the new worktree yet.
function pactChatHealWorktree(t) {
  if (!t || t.worktree || !Array.isArray(t.msgs)) return;
  const lastWt = [...t.msgs].reverse().find((m) => m && typeof m.worktree === "string" && m.worktree)?.worktree;
  // Only restore a binding to a worktree that STILL EXISTS. If the conversation's last turn ran in a worktree
  // that has since been merged+removed, it belongs on main now — restoring the dead binding would just make
  // the next prompt fail "worktree not found".
  const exists = (name) => (PACT_ED && Array.isArray(PACT_ED.worktrees)) ? PACT_ED.worktrees.some((w) => w.name === name) : true;
  if (lastWt && lastWt !== "main" && exists(lastWt)) { t.worktree = lastWt; pactStateSave(); }
}
// The head ⇄ menu for a STARTED conversation: migrate to another worktree, merge back + return to main, or
// return to main without merging.
function pactChatWorktreeMenu(t, x, y) {
  if (!t) return;
  const on = t.worktree || "main";
  const started = !!(t.started || (t.msgs && t.msgs.length));
  const items = [];
  if (!started) {
    // Not started yet → BIND: pick the checkout this conversation will start in (or create a new one).
    // Uncommitted work isn't in play yet, so this is a plain, reversible choice (no migrate/merge needed).
    items.push({ label: "Run this conversation in:", disabled: true });
    for (const w of ((PACT_ED && PACT_ED.worktrees) || [{ name: "main", isMain: true }])) {
      const nm = w.name;
      items.push({ label: (w.isMain ? "⌂ main" : "⌥ " + nm) + (nm === on ? "   ✓" : ""),
        onClick: () => { t.worktree = w.isMain ? undefined : nm; pactStateSave(); pactChatRender(); } });
    }
    items.push("---");
    items.push({ label: "＋ New worktree…", onClick: async () => {
      const name = await showModal({ title: "＋ New worktree", sub: "An isolated checkout + branch off HEAD. This conversation will start in it. Letters, digits, . _ - only.", editable: true, value: "", confirmLabel: "Create & bind" });
      if (name == null || !name.trim()) return;
      const c = await pactWorktreeAct("create", name.trim());
      if (c.ok || /already exists/i.test(c.error || "")) { t.worktree = name.trim(); pactEdLoadWorktrees(); pactStateSave(); pactChatRender(); }
      else await pactNotify("Couldn't create worktree", c.error || "could not create worktree", true);
    } });
  } else {
    // Started → its cwd can't just be re-picked (uncommitted work wouldn't follow): MIGRATE / MERGE-RETURN.
    if (on !== "main") {
      items.push({ label: `Merge "${on}" into main & return`, onClick: () => pactChatMergeReturn(t) });
      items.push({ label: "Return to main (no merge)", onClick: () => pactChatMigrate(t, "main") });
      items.push("---");
    }
    items.push({ label: on === "main" ? "Migrate to a worktree…" : "Migrate to another worktree…", onClick: () => pactChatMigrate(t) });
  }
  pactShowCtxMenu(x, y, items);
}
// Migrate a RUNNING conversation to a different worktree (or back to main): its context is unbroken (the
// SDK session continues — only the agent's cwd changes for future turns). `toArg` skips the prompt (used by
// "Return to main"). Uncommitted work in the current checkout is flagged (it stays behind; commit to carry it).
async function pactChatMigrate(t, toArg) {
  if (!t) return;
  const cur = t.worktree || "main";
  let to = toArg;
  if (to == null) {
    const existing = (PACT_ED && PACT_ED.worktrees ? PACT_ED.worktrees : []).filter((w) => !w.isMain).map((w) => w.name);
    const hint = existing.length ? "Existing: " + existing.join(", ") + "." : "None yet — type a name to create one.";
    const raw = await showModal({ title: `Migrate "${(PACT_CHAT_NAMES[t.key] || t.name)}"`, sub: `Type a NEW worktree name to create it, an existing worktree, or "main" to return.  ${hint}`, editable: true, value: cur === "main" ? "" : "main", confirmLabel: "Migrate" });
    if (raw == null) return;
    to = raw.trim();
  }
  if (!to || to === cur) return;
  // What's uncommitted in the current checkout won't follow the migration (a new worktree is a clean
  // checkout off HEAD). Distinguish real edits (tracked — worth committing to carry) from NEW/UNTRACKED
  // files (`?`, often scratch/probe/draft files), so a pile of untracked scratch doesn't read as "your
  // committed work is at risk" — the exact confusion where a `git commit` (which doesn't add new files)
  // leaves the count non-zero.
  let changed = [];
  try { const d = await (await fetch("/api/pact/changed" + (cur !== "main" ? "?worktree=" + encodeURIComponent(cur) : ""))).json(); if (d && d.ok) changed = d.files || []; } catch {}
  const modified = changed.filter((f) => f && f.status !== "?");
  const untracked = changed.filter((f) => f && f.status === "?");
  if (changed.length) {
    const bits = [];
    if (modified.length) bits.push(`${modified.length} modified tracked file(s)`);
    if (untracked.length) bits.push(`${untracked.length} new/untracked file(s)` + (untracked.length <= 6 ? " — " + untracked.map((f) => f.path.split("/").pop()).join(", ") : ""));
    const msg = `"${cur}" has ${bits.join(" + ")}.\nThese stay in "${cur}" and won't follow to "${to}".\n\n`
      + (modified.length
        ? `The modified files are real edits — commit them first (ask the agent) if you want them in "${to}". Untracked files are usually scratch and safe to leave.`
        : `These are all new/untracked files (scratch, drafts, probes) — safe to leave; migrating won't touch them.`)
      + `\n\nProceed?`;
    if (!(await showModal({ title: "Some files stay behind", sub: msg, confirmLabel: "Proceed" }))) return;
  }
  // Ensure the target exists (create a new worktree if the name is new; "main" always exists).
  if (to !== "main" && !(PACT_ED && PACT_ED.worktrees || []).some((w) => w.name === to)) {
    const c = await pactWorktreeAct("create", to);
    if (!c.ok && !/already exists/i.test(c.error || "")) { await pactNotify("Couldn't create worktree", c.error || `could not create worktree "${to}"`, true); return; }
  }
  pactChatRecordMigration(t, cur, to);
  pactEdSaveStatus('conversation now runs in "' + to + '" — its next turn uses that checkout' + (modified.length ? ` (${modified.length} modified file(s) left in "${cur}")` : ""), false);
}
// Merge this conversation's worktree into main and RETURN the conversation to main. Conflict-safe: the
// server aborts and leaves main untouched on a conflict. Offers to remove the now-merged worktree.
async function pactChatMergeReturn(t) {
  if (!t || !t.worktree) return;
  const wt = t.worktree;
  if (!(await showModal({ title: `Merge "${wt}" into main & return?`, sub: "Both checkouts must be committed-clean (a merge only takes committed work — ask the agent to commit first if needed). If it would conflict, it's aborted and main is left exactly as it is.", confirmLabel: "Merge & return" }))) return;
  pactEdSaveStatus(`merging "${wt}" into main…`, false);
  const d = await pactWorktreeAct("merge", wt);
  if (!d.ok) { await pactNotify("Merge not done", d.error || "merge failed", true); return; }
  pactChatRecordMigration(t, wt, "main");
  pactEdSaveStatus(`✓ merged "${wt}" into ${d.mainBranch || "main"} (${d.merged || 0} commit${d.merged === 1 ? "" : "s"}) — conversation returned to main`, false);
  if (await showModal({ title: `Remove the "${wt}" worktree now?`, sub: "Its branch + commits stay; only the checkout folder is deleted. You've already merged it into main.", confirmLabel: "Remove worktree" })) {
    const r = await pactWorktreeAct("remove", wt);
    if (r.ok) { for (const g of PACT_ED.groups) if (g.worktree === wt) { g.worktree = undefined; for (const tt of g.tabs) tt.worktree = "main"; } pactEdLoadWorktrees(); pactStateSave(); }
    else pactEdSaveStatus("⚠ " + (r.error || "could not remove worktree"), true);
  }
}
function pactChatSend(t) {
  if (!PACT_CHAT || !t) return;
  const ta = PACT_CHAT.host.querySelector(".pc-input");
  const text = (ta ? ta.value : "").trim();
  if (!text) return;
  const attachedImages = t.attachedImages || [];
  // One-shot: clear the compose input + attachments up front. Neither path restores them — a queued
  // entry keeps its OWN copy, a dispatch already captured them — and the re-render rebuilds the (now
  // empty) preview.
  t.attachedImages = [];
  if (ta) { ta.value = ""; ta.style.height = ""; ta.style.overflowY = "hidden"; pactChatAutosize(ta); }
  t.draft = "";   // the draft was just sent/queued — clear it so a reload doesn't resurrect it
  // While a turn is already running, don't POST (the server would refuse it with `busy` anyway) —
  // queue it locally instead: shown as its own dim pending bubble, sent automatically the instant the
  // current turn finishes (pactChatDrainQueue). Mirrors typing ahead in Claude's own desktop app, and
  // the Core cockpit's send()/drainQueue().
  if (pactChatBusy(t)) {
    t._queue = t._queue || [];
    t._queue.push({ text, images: attachedImages });
    pactChatRender();   // reflect the cleared compose/attachment preview (also repaints the conversation)
    t._forceBottom = true;
    pactChatPaint(t);    // show the queued bubble at the tail
    pactStateSave();
    return;
  }
  pactChatDispatch(t, text, attachedImages);
}
// The moment the tab genuinely stops being busy (its turn-end `result`, or any other idle transition),
// release whatever queued while it was working — MERGED into ONE prompt (Core drainQueue parity), not
// fired as N separate turns. Draining one-at-a-time would answer each queued message in isolation,
// missing the context the later ones added. `t._draining` guards against a re-entrant route/paint
// draining the same queue twice.
// Remove one message still sitting in the queue (mis-sent / no longer wanted) before it's dispatched.
function pactChatUnqueue(t, q) {
  if (!t || !t._queue) return;
  t._queue = t._queue.filter((x) => x !== q);
  if (!t._queue.length) t._queue = null;
  pactChatPaint(t);
}
function pactChatDrainQueue(t) {
  if (!t || pactChatBusy(t) || !t._queue || !t._queue.length || t._draining) return;
  t._draining = true;
  try {
    const items = t._queue;
    t._queue = null;
    const merged = pactMergeQueued(items, WS_IMG_MAX_COUNT);
    if (merged.overflow) t.msgs.push({ kind: "note", text: `⚠ Only the first ${WS_IMG_MAX_COUNT} images across your queued messages were sent — Claude's own per-message limit.` });
    pactChatDispatch(t, merged.text, merged.images);
  } finally {
    t._draining = false;
  }
}
function pactChatDecide(t, decision) {
  if (!t || !t.perm) return;
  wsPost("permission", { requestId: t.perm.requestId, decision });
  t.perm = null; t.status = decision === "allow" ? "thinking" : "idle";
  pactChatPaint(t);
}
// The Pact chat renders assistant markdown via window.mdRender (→ `.md-pre` code blocks), which — unlike
// the Core cockpit's own renderer — has no copy affordance. Add a ⧉ copy button to each code block so a
// handed-off block (e.g. an agent's copy-paste window) can be copied in one tap. Idempotent (a cached
// node repaint won't double-add). Reuses the existing `.ws-copy` button style, absolutely positioned.
function wsCopyFallback(text, done) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;top:-9999px;left:0;opacity:0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand("copy"); document.body.removeChild(ta); if (done) done(ok);
  } catch { if (done) done(false); }
}
function wsAttachCopyButtons(container) {
  if (!container || !container.querySelectorAll) return;
  container.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(".ws-copy")) return;
    const b = el("button", { class: "ws-copy ws-copy-abs", type: "button", title: "Copy code" }, ["⧉"]);
    const flash = (ok) => { b.textContent = ok ? "✓" : "✗"; b.classList.toggle("copied", !!ok); setTimeout(() => { b.textContent = "⧉"; b.classList.remove("copied"); }, 1200); };
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const text = (pre.querySelector("code") || pre).textContent || "";
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => flash(true), () => wsCopyFallback(text, flash));
      else wsCopyFallback(text, flash);
    });
    pre.classList.add("ws-pre-copy");
    pre.appendChild(b);
  });
}
// ===== PACT USAGE LIMITS — pure helper (sliced for lib/pactUsageLimits.test.mjs) =====
// Format the plan's rate-limit utilization (5h / 7d rolling windows + per-model) into a compact
// "5h X% · 7d Y%" badge label + a multi-line tooltip. Account-wide and EXPERIMENTAL (the SDK's own
// usage_EXPERIMENTAL… surface). Returns null when there's nothing to show (unavailable / no windows).
function pactUsageLimits(limits) {
  if (!limits || !limits.rate_limits_available || !limits.rate_limits) return null;
  var rl = limits.rate_limits;
  var pct = function (w) { return (w && typeof w.utilization === "number") ? Math.round(w.utilization) : null; };
  var resets = function (w) { return (w && w.resets_at) ? new Date(w.resets_at).toLocaleString() : null; };
  var five = pct(rl.five_hour), seven = pct(rl.seven_day);
  var parts = [];
  if (five !== null) parts.push("5h " + five + "%");
  if (seven !== null) parts.push("7d " + seven + "%");
  if (!parts.length) return null;
  var detail = [];
  if (five !== null) detail.push("5-hour: " + five + "%" + (resets(rl.five_hour) ? ", resets " + resets(rl.five_hour) : ""));
  if (seven !== null) detail.push("7-day: " + seven + "%" + (resets(rl.seven_day) ? ", resets " + resets(rl.seven_day) : ""));
  if (pct(rl.seven_day_opus) !== null) detail.push("7-day (Opus): " + pct(rl.seven_day_opus) + "%");
  if (pct(rl.seven_day_sonnet) !== null) detail.push("7-day (Sonnet): " + pct(rl.seven_day_sonnet) + "%");
  (rl.model_scoped || []).forEach(function (m) { if (m && typeof m.utilization === "number") detail.push((m.display_name || "model") + ": " + Math.round(m.utilization) + "%"); });
  return { text: parts.join(" · "), title: "Plan usage limits (experimental) — account-wide" + (detail.length ? "\n" + detail.join("\n") : ""), max: Math.max(five || 0, seven || 0) };
}
// ===== end PACT USAGE LIMITS pure helper =====
function pactRenderUsageLimits() {
  if (!PACT_CHAT || !PACT_CHAT.host) return;
  const elMain = PACT_CHAT.host.querySelector(".pc-usage-limits");
  if (!elMain) return;
  const r = pactUsageLimits(PACT_CHAT.usageLimits);
  if (!r) { elMain.hidden = true; return; }
  elMain.hidden = false;
  elMain.textContent = r.text;
  elMain.title = r.title;
  elMain.classList.toggle("--warn", r.max >= 80 && r.max < 95);   // amber as you approach a limit
  elMain.classList.toggle("--hot", r.max >= 95);                  // red when nearly capped
}
// Store the ABSOLUTE numbering offsets from a transcript/resync reply: how many prompts (user) and responses
// (assistant) precede the loaded window. Lets P#/R# count the messages that weren't shipped, so a number
// refers to the same turn no matter how much of the history is on screen.
function pactSetNumOffsets(t, data) { if (!t) return; t._promptOffset = (data && data.promptOffset) || 0; t._responseOffset = (data && data.responseOffset) || 0; }
// Stamp each prompt/response with its absolute number (P#n / R#n), counting from the offset. Skips tool rows,
// migration markers, notes, etc. Invalidates a cached node whose number changed so the badge re-renders.
function pactStampNumbers(t) {
  if (!t || !Array.isArray(t.msgs)) return;
  let p = t._promptOffset || 0, r = t._responseOffset || 0;
  for (const m of t.msgs) {
    if (!m) continue;
    if (m.role === "user") { const n = ++p; if (m._pnum !== n) { m._pnum = n; m._node = null; } }
    else if (m.role === "assistant") { const n = ++r; if (m._rnum !== n) { m._rnum = n; m._node = null; } }
  }
}
// Format a position number with thousand separators (locale-independent): 1349 → "1,349".
function wsNumFmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
// A corner badge: P#12 on a prompt, R#1,349 on a response. Non-interactive — just a positional label.
function pactNumBadge(kind, n) { return (typeof n === "number") ? el("span", { class: "pc-num pc-num-" + kind.toLowerCase(), title: (kind === "P" ? "Prompt" : "Response") + " #" + wsNumFmt(n) + " in this conversation" }, [kind + "#" + wsNumFmt(n)]) : ""; }
// ===== INTERRUPTED PROMPTS =====================================================================
// A prompt whose turn never produced a reply (an engine restart / dropped connection cut it off) is an
// INTERRUPTED prompt: the tab is IDLE and this user message is the trailing one with no assistant reply after
// it. We MARK it (persisted in t.promptStates by its `at`, so it survives reloads and — Pact — syncs across
// devices) and colour it DARK BLUE. State per prompt: "i" = interrupted (dark blue), "d" = discarded (red).
// The two corner buttons (only on the still-actionable trailing interrupted prompt): ▶ resume (tells the
// agent it was interrupted and to continue it — no re-paste) · ✕ discard (marks it dead; the NEXT prompt
// tells the agent to disregard it). Once a reply lands it's no longer trailing, so the buttons drop but the
// dark-blue "was interrupted" record stays.
function pactInterruptedIdx(t) {   // index of the trailing unanswered user prompt on an idle tab, or -1
  if (!t || pactChatBusy(t) || !Array.isArray(t.msgs)) return -1;
  for (let i = t.msgs.length - 1; i >= 0; i--) { const m = t.msgs[i]; if (!m) continue; if (m.role === "assistant") return -1; if (m.role === "user") return i; }
  return -1;
}
function pactMarkInterrupt(t) {
  if (!t || !Array.isArray(t.msgs)) return;
  t.promptStates = t.promptStates || {};
  const idx = pactInterruptedIdx(t);
  let changed = false;
  if (idx >= 0) { const at = t.msgs[idx].at; if (typeof at === "number" && !t.promptStates[at]) { t.promptStates[at] = "i"; changed = true; } }   // auto-recognise
  t.msgs.forEach((m, i) => {
    if (!m || m.role !== "user") return;
    const st = (typeof m.at === "number") ? t.promptStates[m.at] : undefined;   // "i" | "d" | undefined
    const btns = (i === idx) && st === "i";                                     // actionable only on the trailing, non-discarded one
    if (m._intrState !== (st || "") || m._intrBtns !== btns) { m._intrState = st || ""; m._intrBtns = btns; m._node = null; }
  });
  if (changed) pactStateSave();
}
const PACT_RESUME_MSG = (n) => `↻ Resume: my message${typeof n === "number" ? " (P#" + wsNumFmt(n) + ")" : ""} above was interrupted before you finished it — please resume and complete exactly what it asked, as written (don't make me repeat it).`;
function pactChatResumeInterrupted(m) {
  const t = pactChatActive(); if (!t || !m) return;
  m._intrBtns = false; m._node = null;   // being handled now → drop the buttons (stays dark blue as a record)
  pactChatDispatch(t, PACT_RESUME_MSG(m._pnum), []);   // a short continue instruction — never a re-paste of the original text
}
function pactChatDiscardInterrupted(m) {
  const t = pactChatActive(); if (!t || !m || typeof m.at !== "number") return;
  t.promptStates = t.promptStates || {};
  t.promptStates[m.at] = "d"; m._intrState = "d"; m._intrBtns = false; m._node = null;
  pactStateSave(); pactChatPaint(t);
}
// The trailing DISCARDED prompts (after the last reply) whose exclusion the next real prompt must carry, so
// the agent skips them. Returns [] when none.
function pactTrailingDiscarded(t) {
  const out = []; const ms = (t && t.msgs) || []; const ps = (t && t.promptStates) || {};
  for (let i = ms.length - 1; i >= 0; i--) { const m = ms[i]; if (!m) continue; if (m.role === "assistant") break; if (m.role === "user" && typeof m.at === "number" && ps[m.at] === "d") out.unshift(m); }
  return out;
}
// ---- bookmark a Pact response (★) + jump to it (mirrors the Core cockpit; bookmarks sync via IDE state) ----
function pactMarkBookmarks(t) {
  if (!t || !Array.isArray(t.msgs)) return;
  const bm = new Set(Array.isArray(t.bookmarks) ? t.bookmarks : []);
  for (const m of t.msgs) { if (!m || m.role !== "assistant") continue; const b = typeof m.at === "number" && bm.has(m.at); if (m._bookmarked !== b) { m._bookmarked = b; m._node = null; } }
}
function pactChatToggleBookmark(m) {
  const t = pactChatActive(); if (!t || !m || typeof m.at !== "number") return;
  t.bookmarks = Array.isArray(t.bookmarks) ? t.bookmarks : [];
  const i = t.bookmarks.indexOf(m.at);
  if (i >= 0) t.bookmarks.splice(i, 1); else t.bookmarks.push(m.at);
  m._bookmarked = i < 0; m._node = null;
  pactStateSave(); pactChatPaint(t);
}
function pactChatRemoveBookmark(t, at) {
  if (!t) return;
  t.bookmarks = (Array.isArray(t.bookmarks) ? t.bookmarks : []).filter((x) => x !== at);
  const m = t.msgs.find((x) => x && x.role === "assistant" && x.at === at);
  if (m) { m._bookmarked = false; m._node = null; }
  pactStateSave(); pactChatPaint(t);
}
function pactChatScrollToResponse(t, at) {
  if (!t) return;
  const idx = t.msgs.findIndex((x) => x && x.role === "assistant" && x.at === at);
  if (idx < 0) { if (t.key) { t._pendingBookmarkScroll = at; wsPost("control", { action: "resync", args: { sessionKey: t.key, scoped: true, full: true } }); } return; }
  t._showFrom = 0;   // reveal older messages so the target is in the DOM
  pactChatPaint(t);
  const m = t.msgs[idx];
  requestAnimationFrame(() => { if (m && m._node && m._node.scrollIntoView) { m._node.scrollIntoView({ behavior: "smooth", block: "center" }); m._node.classList.add("ws-bm-flash"); setTimeout(() => m._node.classList.remove("ws-bm-flash"), 1600); } });
}
function pactBookmarkRows(t, onPick, refresh) {
  const marks = (Array.isArray(t.bookmarks) ? t.bookmarks : []).slice().sort((a, b) => a - b);
  if (!marks.length) return [el("div", { class: "ws-bm-empty" }, ["No bookmarks yet — tap the ☆ on any response."])];
  return marks.map((at) => {
    const m = t.msgs.find((x) => x && x.role === "assistant" && x.at === at);
    const label = m ? ("R#" + wsNumFmt(m._rnum || 0)) : "R#?";
    const snip = m ? String(m.text || "").replace(/[#*`>_~-]/g, "").replace(/\s+/g, " ").trim().slice(0, 76) : "(older — loads on open)";
    const del = el("button", { class: "ws-bm-del", type: "button", title: "Remove this bookmark" }, ["×"]);
    const remove = (e) => { e.preventDefault(); e.stopPropagation(); pactChatRemoveBookmark(t, at); if (refresh) refresh(); };
    del.addEventListener("click", remove); del.addEventListener("touchend", remove);
    const row = el("div", { class: "ws-bm-row" }, [el("span", { class: "ws-bm-rn" }, [label]), el("span", { class: "ws-bm-snip" }, [snip || "(empty)"]), del]);
    const pick = () => { pactChatScrollToResponse(t, at); if (onPick) onPick(); };
    row.addEventListener("click", pick); row.addEventListener("touchend", (e) => { e.preventDefault(); pick(); });
    return row;
  });
}
function pactRenderBookmarkPop(pop, t) {   // fill the Pact head's ★ popup (same --show lifecycle as Core)
  const refresh = () => pop.replaceChildren(el("div", { class: "ws-bm-hd" }, ["★ Bookmarked responses"]), ...pactBookmarkRows(t, () => pop.classList.remove("--show"), refresh));
  refresh();
}
function pactChatMsgNode(m) {
  if (m.role === "user") {
    // `m.images` ride two shapes: a just-sent message carries raw { dataUrl } (rendered inline);
    // a persisted/reloaded turn carries { path } + m.workspaceId (rendered via /api/workspace/image).
    // `m.image` (singular) is a pre-multi-image history shape, still read so old rows keep rendering.
    const imgs = m.images || (m.image ? [m.image] : []);
    const kids = [];
    if (imgs.length) {
      kids.push(el("div", { class: "pc-user-images" }, imgs.map((img) => {
        const src = img.dataUrl || (img.path && m.workspaceId ? `/api/workspace/image?workspaceId=${encodeURIComponent(m.workspaceId)}&path=${encodeURIComponent(img.path)}` : null);
        if (!src) return el("span", {}, []);
        return el("a", { href: src, target: "_blank", rel: "noopener noreferrer", class: "pc-user-image-link" }, [
          el("img", { class: "pc-user-image", src, alt: "attached image" }, []),
        ]);
      })));
    }
    kids.push(m.text);
    const cls = "pc-msg pc-user" + (m._intrState === "d" ? " pc-discarded" : m._intrState === "i" ? " pc-interrupted" : "");
    const extra = [];
    if (m._intrBtns) {
      const resume = el("button", { class: "pc-intr-btn pc-intr-resume", title: "Resume — tell the agent this prompt was interrupted and to continue it (no re-paste)" }, ["▶"]);
      resume.addEventListener("click", (e) => { e.stopPropagation(); pactChatResumeInterrupted(m); });
      const discard = el("button", { class: "pc-intr-btn pc-intr-discard", title: "Discard — mark it dead; your next prompt won't include it" }, ["✕"]);
      discard.addEventListener("click", (e) => { e.stopPropagation(); pactChatDiscardInterrupted(m); });
      extra.push(resume, discard);
    }
    return el("div", { class: cls }, [pactNumBadge("P", m._pnum), ...kids, ...extra]);
  }
  if (m.role === "assistant") {
    const kids = [];
    // "Thought for …" header above the reply (like ChatGPT/Claude) — the total time this turn took,
    // stamped when it finished (see the "result" case) and persisted so it survives a reload.
    if (m.elapsedMs != null) kids.push(el("div", { class: "pc-thought", title: "Total time for this response" }, ["💭 Thought for " + pactFmtThought(m.elapsedMs)]));
    const body = el("div", { class: "pc-asst-body" });
    if (typeof window.mdRender === "function") body.innerHTML = window.mdRender(m.text); else body.textContent = m.text;
    wsAttachCopyButtons(body);   // ⧉ copy on every code block (handoff windows etc.)
    kids.push(body);
    const star = el("button", { class: "ws-bm-star" + (m._bookmarked ? " on" : ""), title: m._bookmarked ? "Bookmarked — click to remove" : "Bookmark this response" }, [m._bookmarked ? "★" : "☆"]);
    star.addEventListener("click", (e) => { e.stopPropagation(); pactChatToggleBookmark(m); });
    return el("div", { class: "pc-msg pc-asst" }, [pactNumBadge("R", m._rnum), star, ...kids]);
  }
  if (m.kind === "tool_use") {
    // Expandable, like the Core cockpit: the tool names show at a glance; tap to reveal each call's
    // input so you can see exactly what the agent is doing before the reply lands.
    const tools = m.tools || [];
    const caret = el("span", { class: "pc-tool-caret" }, ["▸"]);
    const head = el("div", { class: "pc-tool-head" }, [caret, "⚙ " + (tools.map((x) => x.name).join(", ") || "tool")]);
    const inner = tools.map((x) => {
      const inp = x.input == null ? "" : (typeof x.input === "string" ? x.input : (() => { try { return JSON.stringify(x.input, null, 2); } catch { return String(x.input); } })());
      return el("div", { class: "pc-tool-call" }, [el("b", {}, [x.name || "tool"]), inp ? el("pre", { class: "pc-tool-input" }, [inp.length > 2000 ? inp.slice(0, 2000) + "…" : inp]) : ""]);
    });
    const bodyEl = el("div", { class: "pc-tool-body" }, inner); bodyEl.hidden = true;
    head.addEventListener("click", () => { const willOpen = bodyEl.hidden; bodyEl.hidden = !willOpen; caret.textContent = willOpen ? "▾" : "▸"; });
    return el("div", { class: "pc-tool" }, [head, bodyEl]);
  }
  if (m.kind === "error") {
    const kids = ["⚠ " + m.text];
    if (typeof m.retry === "function") { const b = el("button", { class: "pc-retry", type: "button" }, ["Retry"]); b.addEventListener("click", (e) => { e.stopPropagation(); m.retry(); }); kids.push(b); }
    return el("div", { class: "pc-err" }, kids);
  }
  if (m.kind === "note") return el("div", { class: "pc-note" }, [m.text]);
  // A worktree-migration separator: a full-width labeled line marking where this conversation moved
  // between checkouts (main ⇄ a worktree). Context is unbroken across it — only the agent's cwd changed.
  if (m.kind === "migration") {
    const from = m.from || "main", to = m.to || "main";
    const label = to === "main"
      ? "⌥ returned to main" + (from && from !== "main" ? ' (merged "' + from + '")' : "")
      : '⌥ migrated to worktree "' + to + '"' + (from && from !== "main" ? ' (from "' + from + '")' : "");
    const when = m.at ? new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    return el("div", { class: "pc-migration" + (to === "main" ? " --tomain" : "") }, [
      el("span", { class: "pc-migration-lbl" }, [label + (when ? "  ·  " + when : "")]),
    ]);
  }
  return el("div", {}, []);
}
function pactChatPaint(t) {
  if (!PACT_CHAT || t.id !== PACT_CHAT.activeId) return;
  const scroll = PACT_CHAT.host.querySelector(".pc-scroll");
  const compose = PACT_CHAT.host.querySelector(".pc-compose");
  if (!scroll) { pactChatRender(); return; }
  // Token/context indicator — shared formatter with the Core cockpit (wsUsageLabel); hidden until
  // this tab has usage data.
  const usageEl = PACT_CHAT.host.querySelector(".pc-usage");
  if (usageEl) { const usg = wsUsageLabel(t.usage, t.contextUsage); usageEl.textContent = usg.text; usageEl.title = usg.title; usageEl.hidden = !usg.text; }
  // Cache each message's rendered node on the message object. A message's content is immutable once
  // added (only `elapsedMs` is stamped once, on result — which clears `_node` there), so re-parsing its
  // markdown + code-highlighting on EVERY event (user echo / tool_use / assistant / result / status /
  // resync…) was the Pact-chat stall on a long conversation. Now a paint renders only the NEW message(s);
  // existing ones reuse their node — which also preserves the tool-call expand state you'd opened.
  // Cap the standing DOM to a window that GUARANTEES the last ~PACT_TEXT_RENDER_CAP readable messages
  // (user/assistant text), with tool_use rows riding along free — so a tool-heavy turn no longer crowds
  // the readable text out of view (see pactVisibleStart). t._showFrom reveals older messages 100 at a time. Mirrors the Core
  // cockpit's "show earlier" chip. The tail always shows; older messages hide behind the chip.
  // "Show earlier" reveals the previous 100 messages at a time (NOT all at once) and keeps your scroll
  // where it is — the stick controller's anchor restore holds the message you're reading in place while
  // the older ones load in above it. `t._showFrom` is the revealed start index; it sticks as new messages
  // arrive at the tail, and never exceeds the cap start (so the tail always shows).
  pactStampNumbers(t);   // assign each prompt/response its absolute P#/R# before rendering the badges
  pactMarkInterrupt(t);  // recognise/paint interrupted (dark blue) + discarded (red) prompts and their buttons
  pactMarkBookmarks(t);  // stamp which responses are starred
  const capStart = pactVisibleStart(t.msgs);
  const start = (typeof t._showFrom === "number") ? Math.max(0, Math.min(t._showFrom, capStart)) : capStart;
  const visibleMsgs = t.msgs.slice(start);
  const hiddenCount = start;
  const nodes = visibleMsgs.map((m) => m._node || (m._node = pactChatMsgNode(m)));
  // Beyond the messages hidden locally, the server may hold OLDER ones it didn't ship — a resync/open sends
  // only the tail (WS_RESYNC_MSG_CAP) so a big conversation appears instantly on mobile. Keep the chip offered
  // while truncated, and when the reader reaches the local floor, fetch the rest whole (`full: true`).
  const moreOnServer = !!t._transcriptTruncated;
  if (hiddenCount > 0 || moreOnServer) {
    const chunk = Math.min(100, hiddenCount);
    const label = hiddenCount > 0
      ? (`▲ Show ${chunk} earlier message${chunk === 1 ? "" : "s"}` + (hiddenCount > chunk ? `  ·  ${hiddenCount} older` : (moreOnServer ? "  ·  more" : "")))
      : "▲ Show earlier messages";
    const btn = el("button", { class: "ws-show-earlier" }, [label]);
    btn.addEventListener("click", () => {
      if (start - 100 <= 0 && t._transcriptTruncated && t.key) wsPost("control", { action: "resync", args: { sessionKey: t.key, scoped: true, full: true } });
      t._showFrom = Math.max(0, start - 100);
      pactChatPaint(t);
    });
    nodes.unshift(btn);
  }
  if (t.perm) {
    const bar = el("div", { class: "pc-perm" }, [
      el("span", {}, ["⏸ Allow " + t.perm.tool + "?"]), el("span", { class: "ws-spacer" }, []),
      (() => { const b = el("button", { class: "pc-allow" }, ["Allow"]); b.addEventListener("click", () => pactChatDecide(t, "allow")); return b; })(),
      (() => { const b = el("button", { class: "pc-deny" }, ["Deny"]); b.addEventListener("click", () => pactChatDecide(t, "deny")); return b; })(),
    ]);
    nodes.push(bar);
  }
  const timerSpan = () => el("span", { class: "pc-timer", title: "Time on this response" }, [t._turnStartedAt ? pactFmtDuration(Date.now() - t._turnStartedAt) : ""]);
  if (t.live) nodes.push(el("div", { class: "pc-msg pc-asst pc-live" }, [el("div", { class: "pc-asst-body" }, [t.live]), el("div", { class: "pc-live-meta" }, ["▍ ", timerSpan()])]));
  else if (t.status === "thinking" || t.status === "deepwork") nodes.push(el("div", { class: "pc-think" }, [(t.status === "deepwork" ? "🔴 still producing… " : "● thinking… "), timerSpan()]));
  // Queued messages — typed while the agent was mid-turn, held (not yet sent) until this turn
  // finishes (see pactChatSend/pactChatDrainQueue). Rendered AFTER the live/thinking indicator, in a
  // dim pending style, in the order they'll be sent; drainQueue merges several into ONE prompt, so the
  // tag says so when more than one is waiting. Images ride as raw local dataUrls (same bytes the real
  // send will carry) since they aren't uploaded yet. Mirrors the Core cockpit's .ws-queued nodes.
  if (t._queue && t._queue.length) {
    const many = t._queue.length > 1;
    const tag = many
      ? "queued — will be merged with the other" + (t._queue.length - 1 > 1 ? "s" : "") + " into one message once this turn finishes"
      : "queued — sending once this turn finishes";
    const cls = "pc-msg pc-user pc-queued" + (t.status === "deepwork" ? " pc-queued-deep" : "");
    for (const q of t._queue) {
      const kids = [];
      // A × to delete this queued message before it sends — for a mis-sent / no-longer-wanted one.
      const del = el("button", { class: "pc-queued-x", type: "button", title: "Remove this queued message" }, ["×"]);
      del.addEventListener("click", (e) => { e.stopPropagation(); pactChatUnqueue(t, q); });
      if (q.images && q.images.length) kids.push(el("div", { class: "pc-user-images" }, q.images.map((img) => el("img", { class: "pc-user-image", src: img.dataUrl, alt: "attached image (queued)" }, []))));
      kids.push(del, q.text, el("span", { class: "pc-queued-tag" }, [tag]));
      nodes.push(el("div", { class: cls }, kids));
    }
  }
  // "Read at your own pace" through the shared controller. This render REPLACES all children, so the
  // pinned-ness must be measured BEFORE replaceChildren (afterwards scrollTop is meaningless); a
  // just-sent message forces the tail via t._forceBottom.
  const stick = attachStickController(scroll, { wrapClass: "stick-wrap-pc", nearPx: 4 });
  const force = t._forceBottom; t._forceBottom = false;
  const wasNearBottom = force || stick.sample();
  // While a tab's transcript is still being fetched (page load / history resume), show a loader instead of a
  // blank box or the empty-state hint — so the seconds it takes to pull a big conversation through the tunnel
  // read as "loading", not "broken/empty". Once messages exist the loader is moot (real content replaces it).
  const empty = t._loading
    ? [el("div", { class: "pc-loading" }, [el("span", { class: "pc-loading-bar" }, []), el("span", { class: "pc-loading-lbl" }, ["Loading conversation…"])])]
    : [el("div", { class: "hint", style: "padding:10px" }, ["Ask the agent to explore, write, or test Pact in the Ouronet repo."])];
  scroll.replaceChildren(...(nodes.length ? nodes : empty));
  stick.apply(wasNearBottom);
  // Drive the send + stop buttons from this tab's status — an EXACT mirror of the Core cockpit's
  // paintPane: label Send/Working…/Deep Work…, the amber `busy` / red `deepwork` treatment, the
  // `work-pulse` ring, and the Stop button shown only while busy. Send stays enabled while busy so a
  // mid-turn send still queues (v1.2.4).
  if (compose) {
    const send = compose.querySelector(".pc-send");
    const stop = compose.querySelector(".pc-stop");
    const busy = pactChatBusy(t);
    const deep = t.status === "deepwork";
    if (send) {
      send.disabled = false;
      send.classList.toggle("busy", busy);
      send.classList.toggle("deepwork", deep);
      send.classList.toggle("work-pulse", busy);
      send.textContent = deep ? "Deep Work…" : busy ? "Working…" : "Send";
    }
    if (stop) stop.hidden = !busy;
  }
  // Sync the mobile control bar's send/stop + chat count to this tab (no-op on desktop).
  if (typeof PACT_MOBILE_PAINT_CB === "function") PACT_MOBILE_PAINT_CB();
}
function pactChatPaintLive(t) {
  if (!PACT_CHAT || t.id !== PACT_CHAT.activeId) return;
  const scroll = PACT_CHAT.host.querySelector(".pc-scroll"); if (!scroll) return;
  let live = scroll.querySelector(".pc-live .pc-asst-body");
  if (!live) { pactChatPaint(t); return; }
  const stick = attachStickController(scroll, { wrapClass: "stick-wrap-pc", nearPx: 4 });
  const wasNearBottom = stick.sample();   // measure before the live text grows the node
  live.textContent = t.live;
  stick.apply(wasNearBottom);
}
function pactChatRender() {
  if (!PACT_CHAT) return;
  const host = PACT_CHAT.host;
  const tabs = PACT_CHAT.tabs.map((t) => {
    const dot = el("span", { class: "pc-tab-dot" + (t.status === "thinking" || t.status === "deepwork" ? " busy" : "") });
    const label = (t.key && PACT_CHAT_NAMES[t.key]) || t.name;
    const nameEl = el("span", { class: "pc-tab-name", title: "Double-click to rename this chat" }, [label]);
    nameEl.addEventListener("dblclick", (e) => { e.stopPropagation(); pactChatRenameTab(t); });
    // A small worktree marker so parallel conversations on different checkouts are distinguishable at a glance.
    const wtMark = t.worktree ? el("span", { class: "pc-tab-wt", title: "Runs in worktree: " + t.worktree }, ["⌥" + t.worktree]) : "";
    // The prime conversation can't be closed — show a ★ marker instead of the × close.
    let tail;
    if (t.prime) { tail = el("span", { class: "pc-tab-prime", title: "Prime conversation — always open, can't be closed" }, ["★"]); }
    else { tail = el("span", { class: "pc-tab-x", title: "Close chat" }, ["×"]); tail.addEventListener("click", (e) => { e.stopPropagation(); pactChatCloseTab(t.id); }); }
    const tab = el("div", { class: "pc-tab" + (t.id === PACT_CHAT.activeId ? " --active" : "") + (t.prime ? " --prime" : "") + (t.worktree ? " --wt" : "") }, [dot, nameEl, wtMark, tail]);
    tab.addEventListener("click", () => { if (t.id === PACT_CHAT.activeId) return; pactChatSaveDraft(); PACT_CHAT.activeId = t.id; t._forceBottom = true; pactChatRender(); pactStateSave(); pactChatCatchUp(t); });
    return tab;
  });
  const add = el("button", { class: "pact-ed-ico", title: "New Pact chat" }, ["＋"]);
  add.addEventListener("click", () => pactChatNewTab());
  const hist = el("button", { class: "pact-ed-ico", title: "Pact chat history — resume a past conversation" }, ["🕐"]);
  hist.addEventListener("click", () => pactChatToggleHistory());
  const sync = el("button", { class: "pact-ed-ico", title: "Sync now — re-fetch this conversation's authoritative state (fixes a desync between two open clients)" }, ["↻"]);
  sync.addEventListener("click", () => pactChatForceResync(sync));
  const bm = el("button", { class: "pact-ed-ico pc-bm-ico", title: "Bookmarked responses — jump to a starred answer" }, ["★"]);
  const bmPop = el("div", { class: "ws-bm-pop --down" }, []);   // opens downward (the head is at the top)
  const bmWrap = el("span", { class: "ws-bm-wrap" }, [bm, bmPop]);
  bm.addEventListener("click", (e) => {
    e.stopPropagation();
    const a = pactChatActive();
    const show = !bmPop.classList.contains("--show");
    document.querySelectorAll(".ws-bm-pop.--show").forEach((x) => x.classList.remove("--show"));   // one open at a time
    if (show && a) { pactRenderBookmarkPop(bmPop, a); bmPop.classList.add("--show"); }
  });
  const modeSel = el("select", { class: "wsel wsel-sm pc-mode", title: "Permission mode for these Pact sessions" },
    WS_MODES.map((m) => el("option", { value: m.id }, [m.short])));
  modeSel.value = PACT_CHAT.mode;
  modeSel.addEventListener("change", () => { PACT_CHAT.mode = modeSel.value; });
  const chatCollapse = el("button", { class: "pact-ed-ico pact-collapse pcx-chat" }, ["▾"]);
  chatCollapse.addEventListener("click", () => pactToggleCollapse("chat"));
  // A subtle "N tok · P% ctx" readout for the active tab — same formatter/format as the Core pane
  // badge (wsUsageLabel). Hidden until this tab actually has usage data; filled by pactChatPaint.
  const usageEl = el("span", { class: "pc-usage" }, []);
  usageEl.hidden = true;
  // Account-wide plan usage limits now live in the dedicated Workspace → Usage tab (multi-key + failover),
  // so the Pact head no longer carries a usage badge. The Pact stream still requests `usageLimits` on
  // connect, which the engine uses to keep the active key's per-key usage record fresh (see _usageLimits).
  // Stage-2: bind THIS conversation's agent to a worktree — it runs there (its edits land in that
  // checkout; pair it with an editor box on the same worktree to review them). Only shown when a worktree
  // beyond main exists, and LOCKED once the conversation has started (changing cwd mid-chat is confusing).
  // The worktree control now lives ALWAYS-VISIBLE in the compose bar (lower-left, see `wtPill` below), so
  // you can always see + change which checkout a conversation runs in — even before any worktree exists.
  const headKids = [el("div", { class: "pc-tabs" }, tabs), add, hist, sync, bmWrap, el("span", { class: "ws-spacer" }, []), usageEl, modeSel, chatCollapse];
  const head = el("div", { class: "pact-zone-hd pc-head" }, headKids);
  const scroll = el("div", { class: "pc-scroll" }, []);
  const input = el("textarea", { class: "pc-input", rows: "1", placeholder: "Message the Pact agent… (⌘/Ctrl+Enter to send)" });
  const send = el("button", { class: "pc-send" }, ["Send"]);
  // "■ Stop" — interrupt the active tab's in-flight turn without ending the conversation, mirroring
  // the Core cockpit's stop button (same "stop" control → SDK interrupt in lib/workspace.mjs).
  // Hidden unless the active tab is busy (driven in pactChatPaint). Send stays clickable while busy
  // so a mid-turn send still queues (v1.2.4).
  const stop = el("button", { class: "pc-stop", title: "Stop the current response (keeps the conversation)" }, ["■ Stop"]);
  stop.hidden = true;
  stop.addEventListener("click", () => { const a = pactChatActive(); if (a && a.key) wsPost("stop", { sessionKey: a.key }); });
  const active = pactChatActive();
  if (active) input.value = active.draft || "";   // restore this tab's saved compose draft
  send.addEventListener("click", () => pactChatSend(active));
  // Enter inserts a newline (default textarea behavior) — sending is the button, or ⌘/Ctrl+Enter. This
  // matches the Core cockpit compose exactly so Enter behaves the same everywhere (v1.3.4).
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pactChatSend(pactChatActive()); } });
  input.addEventListener("input", () => { pactChatAutosize(input); const a = pactChatActive(); if (a) { a.draft = input.value; pactStateSave(); } });
  // Image attach: a hidden file input + 📎 button, plus paste (on the textarea) and drag-drop (onto
  // the compose row) — all three funnel into pactAttachImageFiles → the exact same attached state.
  const imgFileInput = el("input", { type: "file", accept: WS_IMG_ALLOWED_TYPES.join(","), multiple: "", class: "pc-img-input" });
  const attach = el("button", { class: "pact-ed-ico pc-attach", type: "button", title: `Attach up to ${WS_IMG_MAX_COUNT} images — click, paste, or drag onto the box` }, ["📎"]);
  attach.addEventListener("click", (e) => { e.stopPropagation(); imgFileInput.click(); });
  imgFileInput.addEventListener("change", () => {
    const files = imgFileInput.files ? [...imgFileInput.files] : [];
    imgFileInput.value = "";   // reset so re-picking the SAME file(s) still fires change next time
    pactAttachImageFiles(pactChatActive(), files);
  });
  input.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items; if (!items) return;
    const files = [...items].filter((it) => it.kind === "file" && /^image\//.test(it.type)).map((it) => it.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); pactAttachImageFiles(pactChatActive(), files); }
  });
  const imgPreview = el("div", { class: "pc-img-preview" }, []); imgPreview.hidden = true;
  const imgErr = el("div", { class: "pc-img-err" }, []); imgErr.hidden = true;
  const sendWrap = el("div", { class: "pc-send-wrap" }, [send]);   // relative host so the Live/Held bulb can dock above Send
  // Always-visible worktree pill (compose bar, lower-LEFT): shows which checkout THIS conversation runs in
  // (⌂ main by default) and, clicked, opens the state-aware worktree menu — bind (before first message),
  // migrate, or merge-&-return (after). Visible even before any worktree exists, so it's always discoverable.
  const a0 = pactChatActive();
  const wtPill = el("button", { class: "pc-wtpill" + ((a0 && a0.worktree) ? " --active" : ""), type: "button",
    title: "This conversation runs in this git worktree — click to bind, migrate, or merge back to main" },
    [(a0 && a0.worktree) ? "⌥ " + a0.worktree : "⌂ main", el("span", { class: "pc-wtpill-caret" }, ["▾"])]);
  wtPill.addEventListener("click", (e) => { e.stopPropagation(); const r = wtPill.getBoundingClientRect(); pactChatWorktreeMenu(pactChatActive(), r.left, r.top); });
  const compose = el("div", { class: "pc-compose" }, [imgFileInput, wtPill, attach, input, stop, sendWrap]);
  compose.addEventListener("dragover", (e) => { e.preventDefault(); compose.classList.add("pc-drag"); });
  compose.addEventListener("dragleave", () => compose.classList.remove("pc-drag"));
  compose.addEventListener("drop", (e) => {
    e.preventDefault(); compose.classList.remove("pc-drag");
    const files = e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : [];
    pactAttachImageFiles(pactChatActive(), files);
  });
  const composeExtras = el("div", { class: "pc-compose-extras" }, [imgPreview, imgErr]);
  host.replaceChildren(head, scroll, composeExtras, compose);
  const pcStick = attachStickController(scroll, { wrapClass: "stick-wrap-pc", nearPx: 4 });   // wrap now so the pill exists from the first paint
  pcStick.dockMode(sendWrap, "stick-mode--dock");   // Live/Held bulb sits above Send (desktop) — off the transcript text
  requestAnimationFrame(() => pactChatAutosize(input));   // size to any restored draft once the pane has real layout
  pactSyncCollapseBtns();
  pactRenderUsageLimits();   // the head was just rebuilt — restore the plan-usage badge from PACT_CHAT.usageLimits
  if (active) { pactChatPaint(active); pactPaintAttachment(active); }   // restore any attachments when switching tabs
}
function viewPact() {
  if (pactIsMobile()) return viewPactMobile();   // phone re-layout (v1.3.0 track) — desktop path below is unchanged
  const editorEl = el("div", { class: "pact-editor" });
  const treeBody = el("div", { class: "pact-tree-body" }, [el("div", { class: "hint", style: "padding:6px 8px" }, ["Loading tree…"])]);
  const treeFontBtns = (() => {
    const apply = () => { treeEl.style.setProperty("--pk-tree-font", PACT_TREE_FONT + "px"); };
    const minus = el("button", { class: "pact-ed-ico", title: "Smaller tree font" }, ["A-"]);
    const plus = el("button", { class: "pact-ed-ico", title: "Bigger tree font" }, ["A+"]);
    minus.addEventListener("click", () => { PACT_TREE_FONT = Math.max(9, PACT_TREE_FONT - 1); apply(); });
    plus.addEventListener("click", () => { PACT_TREE_FONT = Math.min(20, PACT_TREE_FONT + 1); apply(); });
    return [minus, plus];
  })();
  // Two tabs share the tree column: "Files" (the project tree) and "Changed (N)" (the agent's changed
  // files). Clicking a tab swaps the body below; the font A-/A+ controls belong to the Files view but
  // stay put in the header. The changed list uses the column's full height (see pactEdRenderChanged).
  const tabFilesBtn = el("button", { class: "pact-tree-tab --active", title: "Project file tree" }, ["📁 Files"]);
  const tabChangedBtn = el("button", { class: "pact-tree-tab", title: "Files changed by the agent (working tree vs HEAD)" }, ["Changed"]);
  tabFilesBtn.addEventListener("click", () => pactTreeSwitchTab("files"));
  tabChangedBtn.addEventListener("click", () => pactTreeSwitchTab("changed"));
  const treeRefreshBtn = el("button", { class: "pact-ed-ico", title: "Re-scan the file tree (pick up newly created/removed files)" }, ["↻"]);
  treeRefreshBtn.addEventListener("click", () => pactTreeRefresh());
  // Worktrees menu (Stage-3): create an isolated checkout, merge one into main, or remove it — without
  // leaving the Pact workspace. The isolation primitive for parallel agents (bind a box + a chat to it).
  const wtBtn = el("button", { class: "pact-ed-ico", title: "Git worktrees — create an isolated checkout, merge one into main, or remove it" }, ["⌥"]);
  wtBtn.addEventListener("click", (e) => { e.stopPropagation(); const r = wtBtn.getBoundingClientRect(); pactWorktreeMenu(r.left, r.bottom + 4); });
  // Shows which worktree the tree is currently reflecting (the active box's) — hidden on main. NOTE: it's
  // wired onto PACT_ED *after* pactEdInit runs (below), never here — PACT_ED doesn't exist yet at shell build.
  const treeHdWt = el("span", { class: "pact-tree-wt", title: "The tree + Changed panel are showing this worktree (the active box's)" }, []);
  treeHdWt.hidden = true;
  const changedList = el("div", { class: "pact-changed-list" }, [el("div", { class: "hint", style: "padding:8px 10px" }, ["No changes vs HEAD."])]);
  changedList.style.display = "none";
  const treeEl = el("aside", { class: "pact-tree" }, [
    el("div", { class: "pact-tree-hd pact-tree-tabs" }, [tabFilesBtn, tabChangedBtn, treeHdWt, el("span", { class: "ws-spacer" }, []), wtBtn, treeRefreshBtn, ...treeFontBtns]),
    treeBody,
    changedList,
  ]);
  treeEl.style.setProperty("--pk-tree-font", PACT_TREE_FONT + "px");
  const chatEl = el("div", { class: "pact-chat" }, []);   // filled by pactChatInit() below
  const termOut = el("pre", { class: "pact-terminal" }, ["Open a .repl file and press ▶ Run to stream it here.\n"]);
  const termClear = el("button", { class: "pact-term-clear", title: "Clear the terminal" }, ["clear"]);
  termClear.addEventListener("click", () => termOut.replaceChildren());
  const termCollapse = el("button", { class: "pact-ed-ico pact-collapse pcx-term" }, ["▾"]);
  termCollapse.addEventListener("click", () => pactToggleCollapse("term"));
  const termEl = el("div", { class: "pact-term" }, [
    el("div", { class: "pact-zone-hd" }, ["❯ REPL terminal", el("span", { class: "ws-spacer" }, []), termClear, termCollapse]),
    termOut,
  ]);
  const rightEl = el("div", { class: "pact-right" }, [chatEl, termEl]);
  const saveBtn = el("button", { class: "pact-save-all", title: "Save every changed file (Ctrl/⌘-S). Files also autosave 5 min after you stop typing." }, ["💾 Saved"]);
  saveBtn.disabled = true;
  saveBtn.addEventListener("click", () => pactEdSaveAll());
  const keepBtn = el("button", { class: "pact-keep-all", title: "Accept the agent's edits to open files (they're already on disk) and resume editing" }, ["✓ Keep All"]);
  keepBtn.style.display = "none";
  keepBtn.addEventListener("click", () => pactEdKeepAll());
  const saveStatus = el("span", { class: "pact-save-status" }, []);
  // Toolbar = ONE row: the action controls (Save All / Keep All / status) and the ONE shared StoicSyntax
  // band legend inline, so the color key reads as a single global key without wasting a second line. The
  // legend flexes and scrolls horizontally if the row gets tight; the autosave hint stays on the right.
  const toolbar = el("div", { class: "pact-ed-toolbar" }, [saveBtn, keepBtn, phCollapseBtn("pact-ed-ico"), saveStatus, pactLegend(),
    el("span", { class: "pact-save-hint" }, ["autosaves 5 min after you stop typing"])]);
  // The "files changed by the agent" list no longer lives here — it moved into the left tree column as
  // a "Changed (N)" tab (see treeEl above), so the editor grid keeps its full vertical space.
  const editorWrap = el("div", { class: "pact-editor-wrap" }, [toolbar, editorEl]);
  const workEl = el("div", { class: "pact-work" }, [editorWrap, rightEl]);
  const root = el("div", { class: "pact-ide" }, [treeEl, workEl]);
  PACT_STATE_READY = false;   // suppress persistence until the saved layout has been read + rebuilt
  pactEdInstallFindShortcut();   // global Ctrl/⌘-F/H → in-app find (bound once; self-guards to VIEW==="pact")
  pactEdInit(editorEl);
  PACT_ED.saveBtn = saveBtn; PACT_ED.keepBtn = keepBtn; PACT_ED.saveStatus = saveStatus;
  PACT_ED.treeBody = treeBody; PACT_ED.changedList = changedList; PACT_ED.tabFilesBtn = tabFilesBtn; PACT_ED.tabChangedBtn = tabChangedBtn; PACT_ED.treeTab = "files";
  PACT_ED.treeHdWt = treeHdWt;   // wired here — PACT_ED only exists after pactEdInit above (see the shell-build note)
  pactEdUpdateSaveBar();
  pactChatInit(chatEl);
  loadPactDir("", treeBody);
  // Rebuild the IDE from the shared server-side store (open files, boxes, chat tabs, drafts, collapse),
  // then arm persistence. Async + fire-and-forget so the view returns immediately; a fresh/empty or
  // unreachable store just leaves the default one-box / one-chat view and still arms saving.
  pactRestoreState();
  return root;
}

// ---- Pact workspace — MOBILE re-layout (v1.3.0 track). SAME PACT_ED/PACT_CHAT state as desktop
// viewPact(), rendered as a fixed app-shell: a top bar with a ☰ hamburger, ONE full-screen stage, and a
// left slide-menu (Twitter/X-style) that swaps the whole stage. Discrete — one element at a time. This is
// a re-LAYOUT of existing state, not a fork: the tree (loadPactDir), the editor (pactEdRenderBody/CM), the
// chat (pactChatRender) and the REPL terminal are all reused. M1 = shell + menu + stage routing. The
// per-box file up-arrow (M2), the tree→double-donut picker (M3) and the chat/history up-arrows (M4) are
// left as seams — see docs/work/pact-mobile/DESIGN.md.
function viewPactMobile() {
  PACT_STATE_READY = false;   // suppress persistence until restore has rebuilt the layout
  pactEdInstallFindShortcut();
  const edHost = el("div", { class: "pactm-edhost" });          // detached: PACT_ED lays its boxes out here; a box's CM is mounted into the stage on demand
  const chatHost = el("div", { class: "pact-chat pactm-pane" }); // PACT_CHAT renders into this; it moves in/out of the stage as selected

  const stage = el("div", { class: "pactm-stage" }, []);
  const title = el("span", { class: "pactm-title" }, ["Pact"]);
  const hb = el("button", { class: "pactm-hb", type: "button", "aria-label": "Menu" }, ["☰"]);
  const menu = el("div", { class: "pactm-menu" }, []);
  const drawerX = el("button", { class: "pactm-drawer-x", type: "button", "aria-label": "Close menu" }, ["×"]);
  const drawer = el("div", { class: "pactm-drawer" }, [
    el("div", { class: "pactm-drawer-hd" }, [el("span", { class: "pactm-drawer-ttl" }, ["Pact workspace"]), drawerX]),
    menu,
  ]);
  const backdrop = el("div", { class: "pactm-backdrop" }, []);
  const top = el("div", { class: "pactm-top" }, [hb, title]);
  const root = el("div", { class: "pactm" }, [top, stage, backdrop, drawer]);

  const openMenu = () => { renderMenu(); root.classList.add("pactm-open"); };
  const closeMenu = () => root.classList.remove("pactm-open");
  const toggleMenu = () => (root.classList.contains("pactm-open") ? closeMenu() : openMenu());
  // README §9 — one tap handler that (a) kills the ghost-tap double-fire (a touch's synthetic click firing
  // a SECOND time, which on a toggle re-closes it, and on a nav row lets the click fall THROUGH to whatever
  // the swap revealed under the finger) and (b) ignores a scroll-then-release inside a scrollable list (so
  // dragging the menu/sheet doesn't select the row you lifted off). preventDefault on a stationary touchend
  // suppresses the synthetic click; a moved touch falls through to native scroll and fires nothing.
  const onTap = (node, fn) => {
    let moved = false, y0 = 0;
    node.addEventListener("click", fn);
    node.addEventListener("touchstart", (e) => { moved = false; y0 = e.touches[0] ? e.touches[0].clientY : 0; }, { passive: true });
    node.addEventListener("touchmove", (e) => { const y = e.touches[0] ? e.touches[0].clientY : y0; if (Math.abs(y - y0) > 8) moved = true; }, { passive: true });
    node.addEventListener("touchend", (e) => { if (moved) return; e.preventDefault(); fn(e); });
  };
  onTap(hb, toggleMenu);
  onTap(drawerX, closeMenu);
  onTap(backdrop, closeMenu);

  // Reused stage elements so their state (tree expansion, terminal output, chat DOM) survives selection
  // swaps instead of being rebuilt from scratch each time.
  const cache = {};
  let userPicked = false;   // once the user taps a menu item, don't let the async restore reset their choice

  function currentSel() {
    if (!PACT_ED) return { kind: "tree" };
    const s = PACT_ED._mobileSel;
    const ok = s && (s.kind !== "box" || PACT_ED.groups.some((g) => g.id === s.boxId));
    if (!ok) PACT_ED._mobileSel = pactMobileDefaultSel(PACT_ED.groups, PACT_ED.activeId);
    return PACT_ED._mobileSel;
  }
  function select(sel) {
    userPicked = true;
    PACT_ED._mobileSel = sel;
    if (sel.kind === "box") PACT_ED.activeId = sel.boxId;
    closeMenu();
    renderStage();
  }

  function menuItem(icon, name, sub, active, onSel) {
    const kids = [el("span", { class: "pactm-item-ic" }, [icon]), el("span", { class: "pactm-item-name" }, [name])];
    if (sub) kids.push(el("span", { class: "pactm-item-sub" }, [sub]));
    const b = el("button", { class: "pactm-item" + (active ? " --active" : ""), type: "button" }, kids);
    onTap(b, onSel);
    return b;
  }
  function renderMenu() {
    if (!PACT_ED) return;
    const sel = currentSel();
    const items = [];
    // 1) Tree
    items.push(el("div", { class: "pactm-cat" }, ["Tree"]));
    items.push(menuItem("📁", "File tree", "", sel.kind === "tree", () => select({ kind: "tree" })));
    // 2) View boxes — the existing editor boxes as roman numerals I…VIII (max 8)
    items.push(el("div", { class: "pactm-cat" }, ["View boxes"]));
    if (!PACT_ED.groups.length) items.push(el("div", { class: "pactm-empty" }, ["No boxes open."]));
    PACT_ED.groups.slice(0, 8).forEach((g, i) => {
      const sub = g.active ? g.active.split("/").pop() : "empty box";
      items.push(menuItem(pactRoman(i + 1), "Box " + pactRoman(i + 1), sub, sel.kind === "box" && sel.boxId === g.id, () => select({ kind: "box", boxId: g.id })));
    });
    // 3) Chat + REPL
    items.push(el("div", { class: "pactm-cat" }, ["Chat + REPL"]));
    items.push(menuItem("💬", "Chat", "", sel.kind === "chat", () => select({ kind: "chat" })));
    items.push(menuItem("❯", "REPL", "", sel.kind === "repl", () => select({ kind: "repl" })));
    menu.replaceChildren(...items);
  }

  function treeStage() {
    if (!cache.tree) {
      const body = el("div", { class: "pactm-tree" }, [el("div", { class: "hint", style: "padding:8px" }, ["Loading tree…"])]);
      loadPactDir("", body);   // reuse the tree loader; on mobile a file tap opens the double-donut box picker (PACT_MOBILE_FILE_TAP → openDonut)
      cache.tree = body;
    }
    return cache.tree;
  }
  function boxStage(g) {
    if (!g) return el("div", { class: "pactm-empty" }, ["This box is gone."]);
    const body = el("div", { class: "pact-ed-body pactm-box" });
    g.bodyEl = body;   // repoint the group's body at the mounted editor (the desktop grid isn't shown on mobile)
    const active = g.tabs.find((t) => t.path === g.active);
    // Reuses the shared body renderer: CM for code, markdown preview for .md, the empty-box hint otherwise.
    // pactEdRenderBody schedules cm.refresh() on a requestAnimationFrame — by which point `body` is live in
    // the stage, so CM sizes correctly.
    pactEdRenderBody(g, active);
    // An Ouronet-style handle in the reserved strip above the tab bar (v1.4.0): a slim full-width bar with
    // a centered grabber + label; tap expands the full-screen "files in this box" list. Replaces the old
    // floating pill and uses the previously-dead strip.
    const riser = el("button", { class: "pactm-handle", type: "button", "aria-label": "Files in this box" }, [
      el("span", { class: "pactm-handle-grip" }, []),
      el("span", { class: "pactm-handle-lbl" }, ["▲ Files (" + g.tabs.length + ")"]),
    ]);
    const openFiles = () => openBoxFiles(g);
    riser.addEventListener("click", openFiles);
    riser.addEventListener("touchend", (e) => { e.preventDefault(); openFiles(); });   // README §9: kill the ghost-tap double-fire
    return el("div", { class: "pactm-boxwrap" }, [body, riser]);
  }
  // ---- M2: full-screen sheet (overlays the stage; reused by the donut picker in M3). ----
  let sheetEl = null;
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } }
  // Mount a full-screen sheet over the stage. `bodyEl` is the sheet's scrollable content; `panelClass`
  // lets the donut opt out of the default list padding. A backdrop tap or the ✕ dismisses it.
  function openSheet(titleText, bodyEl, panelClass) {
    closeSheet();
    const x = el("button", { class: "pactm-sheet-x", type: "button", "aria-label": "Close" }, ["✕"]);
    const dismiss = () => closeSheet();
    x.addEventListener("click", dismiss);
    x.addEventListener("touchend", (e) => { e.preventDefault(); dismiss(); });
    const hd = el("div", { class: "pactm-sheet-hd" }, [el("span", { class: "pactm-sheet-ttl" }, [titleText]), x]);
    const back = el("div", { class: "pactm-sheet-back" }, []);
    back.addEventListener("click", dismiss);
    const panel = el("div", { class: "pactm-sheet-panel" + (panelClass ? " " + panelClass : "") }, [hd, bodyEl]);
    sheetEl = el("div", { class: "pactm-sheet" }, [back, panel]);
    stage.appendChild(sheetEl);   // absolute inset:0 → sits above the mounted box, doesn't disturb the flex chain
    return sheetEl;
  }
  // The per-box file list: each row switches the box's active file; the × closes it (reusing pactEdCloseTab
  // so desktop + mobile stay consistent). Rebuilds in place on close so the sheet stays open.
  function openBoxFiles(g) {
    const list = el("div", { class: "pactm-sheet-list" }, []);
    const rebuild = () => {
      if (!g.tabs.length) { list.replaceChildren(el("div", { class: "pactm-empty" }, ["This box has no open files."])); return; }
      list.replaceChildren(...g.tabs.map((t) => {
        const name = el("span", { class: "pactm-frow-name" }, [t.name || t.path.split("/").pop()]);
        const x = el("button", { class: "pactm-frow-x", type: "button", "aria-label": "Close file" }, ["×"]);
        const closeFile = (e) => { e.stopPropagation(); pactEdCloseTab(g, t.path); rebuild(); };   // pactEdCloseTab re-renders the mounted box body + saves
        x.addEventListener("click", closeFile);
        x.addEventListener("touchend", (e) => { e.preventDefault(); closeFile(e); });
        const row = el("div", { class: "pactm-frow" + (t.path === g.active ? " --active" : "") }, [name, x]);
        onTap(row, () => { g.active = t.path; PACT_ED.activeId = g.id; closeSheet(); renderStage(); pactStateSave(); });
        return row;
      }));
    };
    const i = PACT_ED.groups.indexOf(g);
    openSheet("Box " + pactRoman(i + 1) + " — files", list);
    rebuild();
  }
  // ---- M3: the double-donut box picker. Tapping a FILE in the tree opens this instead of opening straight
  // into the active box. 8 wedges around an empty center; state per pactDonutSegments (open/next/disabled).
  const SVGNS = "http://www.w3.org/2000/svg";
  const svgNode = (tag, attrs) => { const nn = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) nn.setAttribute(k, v); return nn; };
  const donutPolar = (cx, cy, rad, angDeg) => { const a = (angDeg - 90) * Math.PI / 180; return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]; };
  // Open `path` into the box a wedge names — creating it first when the wedge is the 'next' one — then
  // navigate the stage to that full-screen box. Reuses pactEdOpenInto (box-targeted open); no fork.
  async function onWedge(seg, path) {
    let g;
    if (seg.state === "next") { pactEdAddGroup(); g = PACT_ED.groups[PACT_ED.groups.length - 1]; }
    else if (seg.state === "open") { g = PACT_ED.groups[seg.index - 1]; }
    if (!g) return;
    userPicked = true;
    PACT_ED.activeId = g.id;
    PACT_ED._mobileSel = { kind: "box", boxId: g.id };
    closeSheet();
    renderMenu();
    renderStage();                                // navigate to the box now (empty/Loading placeholder)
    await pactEdOpenInto(g, path, true, false);   // open the file INTO that specific box (fetch + render into its mounted body)
    if (!root.isConnected) return;
    renderStage();                                // re-mount with the loaded file (correct CM + riser count)
  }
  function openDonut(path) {
    const n = PACT_ED ? PACT_ED.groups.length : 0;
    const segs = pactDonutSegments(n);
    const cx = 150, cy = 150, R = 140, r0 = 60;
    const svg = svgNode("svg", { viewBox: "0 0 300 300", class: "pactm-donut", role: "img", "aria-label": "Choose a view box for " + path.split("/").pop() });
    segs.forEach((seg) => {
      const a0 = (seg.index - 1) * 45, a1 = seg.index * 45, am = (a0 + a1) / 2;
      const [x1, y1] = donutPolar(cx, cy, R, a0), [x2, y2] = donutPolar(cx, cy, R, a1);
      const [x3, y3] = donutPolar(cx, cy, r0, a1), [x4, y4] = donutPolar(cx, cy, r0, a0);
      const d = `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} `
        + `L${x3.toFixed(2)} ${y3.toFixed(2)} A${r0} ${r0} 0 0 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
      const enabled = seg.state === "open" || seg.state === "next";
      const wedge = svgNode("path", { d, class: "pactm-wedge --" + seg.state });
      const [lx, ly] = donutPolar(cx, cy, (R + r0) / 2, am);
      const label = svgNode("text", { x: lx.toFixed(2), y: ly.toFixed(2), class: "pactm-wedge-lbl --" + seg.state, "text-anchor": "middle", "dominant-baseline": "central" });
      label.textContent = seg.state === "next" ? "＋" + (pactRoman(seg.index) || seg.index) : (pactRoman(seg.index) || String(seg.index));
      if (enabled) {
        const act = (e) => { if (e) e.preventDefault(); onWedge(seg, path); };
        wedge.addEventListener("click", act);
        wedge.addEventListener("touchend", act);
        label.addEventListener("click", act);
        label.addEventListener("touchend", act);
      }
      svg.appendChild(wedge);
      svg.appendChild(label);
    });
    // Empty center = cancel/dismiss.
    const center = svgNode("circle", { cx, cy, r: r0 - 4, class: "pactm-donut-hole" });
    const centerX = svgNode("text", { x: cx, y: cy, class: "pactm-donut-hole-x", "text-anchor": "middle", "dominant-baseline": "central" });
    centerX.textContent = "✕";
    const cancel = (e) => { if (e) e.preventDefault(); closeSheet(); };
    center.addEventListener("click", cancel); center.addEventListener("touchend", cancel);
    centerX.addEventListener("click", cancel); centerX.addEventListener("touchend", cancel);
    svg.appendChild(center); svg.appendChild(centerX);
    const wrap = el("div", { class: "pactm-donut-wrap" }, [
      svg,
      el("div", { class: "pactm-donut-hint" }, ["Tap a box number to open here · the accented ＋ box creates a new one · center to cancel."]),
    ]);
    openSheet("Open " + path.split("/").pop() + " in…", wrap, "pactm-donut-panel");
  }
  PACT_MOBILE_FILE_TAP = (path) => openDonut(path);
  // ---- M4: the full-screen CHAT gets TWO up-arrow risers (conversations 💬 + history 🕐). Both are pure
  // re-layouts of the desktop chat's ＋/tab list and 🕐 history — same PACT_CHAT state + helpers, no fork.
  function chatStage() {
    // chatHost is the same node pactChatInit rendered into (reused across selection swaps). Instead of the
    // two big floating risers (which ate vertical space) + the in-compose 📎/Send (which ate the
    // textarea's width), a SINGLE compact control row holds everything: menu · upload · chats · history ·
    // stop · send. The in-compose 📎/Send/Stop are hidden on mobile (via .pactm-chatwrap CSS) and driven
    // from here, so the textarea gets the full width. (v1.3.7)
    const tbtn = (label, title, fn, cls) => {
      const b = el("button", { class: "pactm-cbtn" + (cls ? " " + cls : ""), type: "button", "aria-label": title, title }, [label]);
      b.addEventListener("click", fn); b.addEventListener("touchend", (e) => { e.preventDefault(); fn(); });   // README §9: kill the ghost-tap double-fire
      return b;
    };
    const menuB = tbtn("☰", "Menu", toggleMenu);
    const upB = tbtn("📎", "Attach image", () => { const inp = chatHost.querySelector(".pc-img-input"); if (inp) inp.click(); });
    const chatsB = tbtn("💬", "Conversations", openChatConvos, "pactm-cbtn-chats");
    chatsB.dataset.n = String((PACT_CHAT && PACT_CHAT.tabs.length) || 0);
    const histB = tbtn("🕐", "History", openChatHistory);
    const bmB = tbtn("★", "Bookmarked responses — jump to a starred answer", () => {
      const a = pactChatActive(); if (!a) return;
      const body = el("div", { class: "ws-bm-sheet" }, []);
      const refresh = () => body.replaceChildren(...pactBookmarkRows(a, closeSheet, refresh));
      refresh();
      openSheet("★ Bookmarked responses", body);
    }, "pactm-cbtn-bm");
    const syncB = tbtn("↻", "Sync now — re-fetch the latest state (no page reload)", () => pactChatForceResync(syncB));
    const stopB = tbtn("■", "Stop", () => { const a = pactChatActive(); if (a && a.key) wsPost("stop", { sessionKey: a.key }); }, "pactm-cbtn-stop");
    stopB.hidden = true;
    const sendB = tbtn("➤", "Send", () => pactChatSend(pactChatActive()), "pactm-cbtn-send");
    const spacer = el("span", { class: "ws-spacer" }, []);
    const bar = el("div", { class: "pactm-cbar" }, [menuB, upB, chatsB, histB, bmB, spacer, syncB, stopB, sendB]);
    // v1.3.8 — pin the compose to a single line so a long draft stops expanding upward into the
    // transcript. Toggle sits just before the send cluster; state persists across reloads.
    // A thin "drawer" strip UNDER the control bar that hosts the Live/Held scroll-mode bulb — always
    // visible so, on a phone, you can tell whether an incoming reply will scroll the chat or leave your
    // scrolled-up position put. Docked from the chat's shared stick controller once .pc-scroll exists.
    const modeBar = el("div", { class: "pactm-modebar" }, []);
    const dockModeBulb = () => { const sc = chatHost.querySelector(".pc-scroll"); if (sc && sc._stick) sc._stick.dockMode(modeBar, "stick-mode--bar"); };
    const wrap = el("div", { class: "pactm-chatwrap" + (PACT_COMPOSE_COLLAPSED ? " pactm-compose-collapsed" : "") }, [chatHost, bar, modeBar]);
    requestAnimationFrame(dockModeBulb);   // .pc-scroll + its controller are set up by pactChatRender; grab the bulb once laid out
    const collapseB = tbtn(PACT_COMPOSE_COLLAPSED ? "⌃" : "⌄", PACT_COMPOSE_COLLAPSED ? "Expand the compose box" : "Collapse the compose box to one line", () => {
      PACT_COMPOSE_COLLAPSED = !PACT_COMPOSE_COLLAPSED;
      try { localStorage.setItem("pact.compose.collapsed", PACT_COMPOSE_COLLAPSED ? "1" : "0"); } catch {}
      wrap.classList.toggle("pactm-compose-collapsed", PACT_COMPOSE_COLLAPSED);
      collapseB.textContent = PACT_COMPOSE_COLLAPSED ? "⌃" : "⌄";
      collapseB.title = PACT_COMPOSE_COLLAPSED ? "Expand the compose box" : "Collapse the compose box to one line";
      const ta = chatHost.querySelector(".pc-input"); if (ta) pactChatAutosize(ta);
    }, "pactm-cbtn-collapse");
    bar.insertBefore(collapseB, spacer);
    // Keep send/stop + the chat count in step with the active tab's live state — pactChatPaint fires this.
    PACT_MOBILE_PAINT_CB = () => {
      const a = pactChatActive(); const busy = !!(a && pactChatBusy(a)); const deep = !!(a && a.status === "deepwork");
      sendB.textContent = deep ? "🔴" : busy ? "…" : "➤";
      sendB.classList.toggle("busy", busy);
      stopB.hidden = !busy;
      chatsB.dataset.n = String((PACT_CHAT && PACT_CHAT.tabs.length) || 0);
      if (!modeBar.querySelector(".stick-mode")) dockModeBulb();   // ensure the bulb is homed here even if the first rAF raced .pc-scroll
    };
    PACT_MOBILE_PAINT_CB();
    return wrap;
  }
  // Riser #1 — the OPEN conversations (PACT_CHAT.tabs): a ＋New row, then one row per conversation (active
  // highlighted); tapping switches the active tab, the × closes it (reusing pactChatCloseTab so desktop +
  // mobile stay consistent). Rebuilds in place so the sheet stays open after a close.
  function openChatConvos() {
    if (!PACT_CHAT) return;
    const list = el("div", { class: "pactm-sheet-list" }, []);
    const rebuild = () => {
      const rows = [];
      const add = el("div", { class: "pactm-frow pactm-frow-new" }, [el("span", { class: "pactm-frow-name" }, ["＋ New conversation"])]);
      onTap(add, () => { pactChatNewTab(); closeSheet(); renderStage(); });
      rows.push(add);
      (PACT_CHAT.tabs || []).forEach((t) => {
        const label = (t.key && PACT_CHAT_NAMES[t.key]) || t.name;
        // A live, non-interactive status light mirroring the send button's colour — see it at a glance:
        // idle (ready for a prompt), working, or deep work. Kept current by pactChatSyncConvoDots.
        const state = el("span", { class: "pactm-frow-state" + pactChatConvoStateCls(t), title: pactChatConvoStateLabel(t) }, []);
        state.setAttribute("data-tabid", String(t.id));
        const name = el("span", { class: "pactm-frow-name" }, [label]);
        // The prime conversation can't be closed — a ★ marker replaces the × close button.
        let tail;
        if (t.prime) { tail = el("span", { class: "pactm-frow-prime", title: "Prime conversation" }, ["★"]); }
        else {
          tail = el("button", { class: "pactm-frow-x", type: "button", "aria-label": "Close conversation" }, ["×"]);
          const closeConv = (e) => { e.stopPropagation(); pactChatCloseTab(t.id); rebuild(); };   // pactChatCloseTab re-renders the chat + saves
          tail.addEventListener("click", closeConv);
          tail.addEventListener("touchend", (e) => { e.preventDefault(); closeConv(e); });
        }
        const row = el("div", { class: "pactm-frow" + (t.id === PACT_CHAT.activeId ? " --active" : "") + (t.prime ? " --prime" : "") }, [state, name, tail]);
        onTap(row, () => { if (t.id !== PACT_CHAT.activeId) { pactChatSaveDraft(); PACT_CHAT.activeId = t.id; pactChatRender(); pactStateSave(); pactChatCatchUp(t); } closeSheet(); renderStage(); });
        rows.push(row);
      });
      list.replaceChildren(...rows);
    };
    openSheet("Conversations", list);
    rebuild();
    // Keep the status lights live while the sheet is open. Self-terminates once the list leaves the DOM
    // (sheet closed / re-rendered) so it never leaks — no explicit close hook needed.
    const iv = setInterval(() => { if (!list.isConnected) { clearInterval(iv); return; } pactChatSyncConvoDots(); }, 900);
  }
  // Riser #2 — the saved-chat HISTORY (same 🕐 data as desktop). Fetch the session list over the workspace
  // stream, render PACT_CHAT.sessions with the SAME row data (name, first-prompt snippet, msg count,
  // updated-at); tapping a row resumes it INTO the chat via pactChatOpenSaved(row, true) — adopt+rehydrate,
  // mirroring desktop Resume — then closes the sheet and re-renders. Primarily to pick a past chat to
  // continue from an empty conversation.
  function openChatHistory() {
    if (!PACT_CHAT) return;
    const list = el("div", { class: "pactm-sheet-list" }, []);
    const rebuild = () => {
      const rows = (PACT_CHAT && PACT_CHAT.sessions) || null;
      if (!rows) { list.replaceChildren(el("div", { class: "pactm-empty" }, ["Loading saved conversations…"])); return; }
      if (!rows.length) { list.replaceChildren(el("div", { class: "pactm-empty" }, ["No saved conversations."])); return; }
      list.replaceChildren(...rows.map((r) => {
        const name = el("div", { class: "pactm-hrow-name" }, [pactIsPrimeRow(r) ? el("span", { class: "pc-tab-prime" }, ["★ "]) : "", pactHistName(r)]);
        const meta = el("div", { class: "pactm-hrow-meta" }, [pactChatMsgLabel(r.turns) + (r.updatedAt ? " · " + pactAgo(r.updatedAt) : "") + (r.realSessionId ? "" : " · no resume")]);
        const first = el("div", { class: "pactm-hrow-first" }, [r.firstPrompt || "(no prompt)"]);
        const row = el("div", { class: "pactm-frow pactm-hrow" }, [el("div", { class: "pactm-hrow-main" }, [name, meta, first])]);
        onTap(row, () => { pactChatOpenSaved(r, true); closeSheet(); renderStage(); });   // Resume — adopt the saved session key + rehydrate its transcript into a tab
        return row;
      }));
    };
    openSheet("Chat history", list);
    rebuild();
    PACT_MOBILE_SESSIONS_CB = () => { if (sheetEl) rebuild(); };   // re-render when the sessions frame lands
    // If the sheet is dismissed, drop the callback so a later fetch doesn't touch a gone sheet.
    const back = sheetEl && sheetEl.querySelector(".pactm-sheet-back");
    const xBtn = sheetEl && sheetEl.querySelector(".pactm-sheet-x");
    const drop = () => { PACT_MOBILE_SESSIONS_CB = null; };
    if (back) back.addEventListener("click", drop);
    if (xBtn) { xBtn.addEventListener("click", drop); xBtn.addEventListener("touchend", drop); }
    wsPost("control", { action: "sessions", args: { repo: PACT_REPO } });   // trigger the fetch → pactChatRoute sets PACT_CHAT.sessions + fires PACT_MOBILE_SESSIONS_CB
  }
  function termStage() {
    if (!cache.term) {
      const out = el("pre", { class: "pact-terminal" }, ["Open a .repl file and press ▶ Run to stream it here.\n"]);
      const clear = el("button", { class: "pact-term-clear", type: "button", title: "Clear the terminal" }, ["clear"]);
      clear.addEventListener("click", () => out.replaceChildren());
      cache.term = el("div", { class: "pact-term pactm-pane" }, [
        el("div", { class: "pact-zone-hd" }, ["❯ REPL terminal", el("span", { class: "ws-spacer" }, []), clear]),
        out,
      ]);
    }
    return cache.term;
  }
  function renderStage() {
    if (!PACT_ED) return;
    const sel = currentSel();
    let content, label;
    if (sel.kind === "tree") { content = treeStage(); label = "File tree"; }
    else if (sel.kind === "chat") { content = chatStage(); label = "Chat"; }
    else if (sel.kind === "repl") { content = termStage(); label = "REPL terminal"; }
    else {
      const g = PACT_ED.groups.find((x) => x.id === sel.boxId) || PACT_ED.groups[0];
      const i = PACT_ED.groups.indexOf(g);
      content = boxStage(g);
      label = "Box " + pactRoman(i + 1) + (g && g.active ? " · " + g.active.split("/").pop() : "");
    }
    title.textContent = label;
    root.dataset.stage = sel.kind || "box";   // CSS drops the top bar in chat (its menu lives in the control row)
    stage.replaceChildren(content);
    // Moving chatHost into the stage resets its scroll to the TOP — so when Chat is shown, jump the active
    // conversation to its latest message (its natural resting place), not the beginning. Deferred a frame so
    // the freshly-mounted node has a real scrollHeight. A later async transcript rehydrate keeps the tail via
    // its own _forceBottom (see pactChatRoute).
    if (sel.kind === "chat") {
      const a = pactChatActive();
      if (a) { a._forceBottom = true; requestAnimationFrame(() => { const cur = pactChatActive(); if (cur && cur.id === a.id) pactChatPaint(cur); }); }
    }
  }

  // ---- boot: SAME state init as desktop — this is a re-layout, not a fork ----
  pactEdInit(edHost);
  pactChatInit(chatHost);
  PACT_ED._mobileSel = pactMobileDefaultSel(PACT_ED.groups, PACT_ED.activeId);
  renderMenu();
  renderStage();
  treeStage();   // warm the tree (loads once) so it's instant when first opened
  // Restore the shared server-side layout (open boxes/tabs, chat tabs), then re-sync the menu + stage to
  // the restored boxes — unless the user has already picked something in the meantime.
  pactRestoreState().then(() => {
    if (!root.isConnected || !PACT_ED) return;
    if (!userPicked) {
      PACT_ED._mobileSel = pactMobileDefaultSel(PACT_ED.groups, PACT_ED.activeId);
      // Present the prime conversation (not whichever tab was last active) on reload, scrolled to latest.
      const prime = PACT_CHAT && PACT_CHAT.tabs.find((t) => t.prime);
      if (prime && PACT_CHAT.activeId !== prime.id) { PACT_CHAT.activeId = prime.id; pactChatRender(); }
    }
    renderMenu();
    if (!userPicked) renderStage();
  });
  return root;
}

// On a real unload (deploy/reload), fold each Core pane's still-QUEUED (orange) message into its persisted
// compose draft so it isn't lost — the draft is restored to the compose box on the way back. Set per mount
// (captures the live `st`/saveLayout); the listener is registered once.
let WS_PAGEHIDE_FN = null, WS_PAGEHIDE_HOOKED = false;
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
    // The model catalog (display name, description, effort/fast-mode support) — a property of the
    // CLI build/account, not per-pane, so it's ONE global list every pane's selector reads from
    // (mirrors the server's own cross-session _modelsCache — see lib/workspace.mjs).
    models: [],
    // claude.ai plan rate-limit utilization (5h/7d/per-model) — also account-wide, not per-pane.
    // EXPERIMENTAL per the SDK's own naming (see claudeSession.mjs getUsageLimits) — null until the
    // first live session answers, and may simply never populate on a non-claude.ai-subscriber build.
    usageLimits: null,
    // Every LIVE session on the work machine right now (across ALL clients, not just this one's
    // panes) — sessionKey → { workspaceId, repo, worktree, status }. Kept fresh from the sessions
    // snapshot (`data.sessions`), single-session updates (`data.session`), and per-session status
    // events. Drives the live-conversation stats readout and the green "active" mark on History.
    liveSessions: new Map(),
  };
  const CONN = connIdentity();
  // Upsert/replace the global live-sessions map, then refresh the readouts that depend on it.
  function setLiveSessions(list) {
    st.liveSessions = new Map((list || []).filter((s) => s && s.sessionKey).map((s) => [s.sessionKey, s]));
    renderLiveStats(); renderHistory();
  }
  function upsertLiveSession(s) {
    if (!s || !s.sessionKey) return;
    // An ended/errored session is no longer live — drop it rather than leaving a stale "active" row.
    if (s.status === "ended" || s.status === "error") st.liveSessions.delete(s.sessionKey);
    else st.liveSessions.set(s.sessionKey, { ...(st.liveSessions.get(s.sessionKey) || {}), ...s });
    renderLiveStats(); renderHistory();
  }
  // A session's status changed (from a "status"/"result" event) — keep the map in step so the
  // "working" count and per-row "working" mark don't lag until the next full snapshot.
  function noteSessionStatus(sessionKey, status) {
    const cur = st.liveSessions.get(sessionKey);
    if (!cur || cur.status === status) return;
    st.liveSessions.set(sessionKey, { ...cur, status });
    renderLiveStats(); renderHistory();
  }
  const WS_BUSY_STATUSES = new Set(["thinking", "awaiting-permission", "deepwork"]);
  // Set of workspaceIds that have a live session right now (for the History "active" mark).
  function activeWorkspaceIds() { const set = new Map(); for (const s of st.liveSessions.values()) if (s.workspaceId) set.set(s.workspaceId, s); return set; }
  // How many connected terminals are currently viewing a given workspace (presence `attach`).
  function clientsOnWorkspace(wsId) { return st.presence.filter((c) => c.workspaceId === wsId).length; }
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
  const newPane = () => ({ id: wsUuid(), sessionKey: wsUuid(), repo: "", worktree: "main", mode: st.defaultMode, model: null, effort: null, fastMode: false, transcript: [], usage: {}, status: "idle", readonly: false, resume: null, draft: "", _gen: 0, _expandedGroups: new Set(), attachedImages: [], contextUsage: null });
  let _draftTimer = 0;
  const saveDraftsSoon = () => { clearTimeout(_draftTimer); _draftTimer = setTimeout(saveLayout, 400); };   // persist typed-but-unsent compose text so a view switch doesn't lose it
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
        panes: st.panes.map((p) => ({ id: p.id, sessionKey: p.sessionKey, repo: p.repo, worktree: p.worktree || "main", mode: p.mode, draft: p.draft || "", promptStates: p.promptStates || {}, bookmarks: Array.isArray(p.bookmarks) ? p.bookmarks : [] })),
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
      mode: WS_MODE_IDS.has(p.mode) ? p.mode : st.defaultMode, draft: typeof p.draft === "string" ? p.draft : "",
      promptStates: (p.promptStates && typeof p.promptStates === "object" && !Array.isArray(p.promptStates)) ? p.promptStates : {},
      bookmarks: Array.isArray(p.bookmarks) ? p.bookmarks.filter((x) => typeof x === "number") : [],
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
  // Mobile (Phase 2): the grid gives way to a TAB strip — one chat box visible at a time, switch by
  // tapping a tab — and the sidebar (repos/history) becomes a slide-in drawer. Both are hidden on
  // desktop via CSS; renderMobileTabs()/syncMobile() below drive them.
  const mobileTabs = el("div", { class: "ws-mtabs" }, []);
  // Mobile bottom control bar (Stage 1 of the Pact-model overhaul): the active pane's actions move HERE
  // — send / stop / attach / history / sync — so the compose box gets the full width, and a thin mode
  // strip above it hosts the active pane's Live/Held bulb. Populated once by buildMobileBar(); both are
  // hidden on desktop via CSS and only shown under .ws-mobile.
  const wsMBar = el("div", { class: "ws-mcbar" }, []);
  const wsModeStrip = el("div", { class: "ws-mmodebar" }, []);
  const wsSheet = el("div", { class: "ws-sheet" }, []);   // mobile bottom sheet (conversations · pane settings)
  const sideBackdrop = el("div", { class: "ws-side-backdrop" }, []);
  const sideList = el("div", { class: "ws-side-list" }, []);
  const histList = el("div", { class: "ws-hist" }, []);
  const usageEl = el("span", { class: "ws-usage-total" }, ["—"]);
  // Live-conversation stats — how many conversations are live on the work machine RIGHT NOW, how
  // many are actively working, and how many terminals (clients) are connected across everywhere
  // (local + the relay). Derived from st.liveSessions + st.presence (see renderLiveStats).
  const liveStatsEl = el("span", { class: "ws-livestats", title: "Live across all clients: conversations open · working now · connected terminals" }, []);
  liveStatsEl.hidden = true;
  // Plan usage limits (5-hour/7-day/per-model) — account-wide, EXPERIMENTAL per the SDK's own
  // naming (see claudeSession.mjs getUsageLimits). Hidden entirely until the first real answer
  // arrives (a non-claude.ai-subscriber build, e.g. API-key auth, may never populate this at all —
  // that's expected, not an error, so there's no "unavailable" placeholder to show meanwhile).
  const usageLimitsEl = el("span", { class: "ws-usage-limits", title: "Plan usage limits (experimental)" }, []);
  usageLimitsEl.hidden = true;
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
    if (st.isMobile) { renderMobileTabs(); closeDrawer(); }   // reflect the new tab label; a repo pick is "done with the drawer"
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

  // ---- model/effort selector for a pane ---------------------------------------------
  // st.models is ONE global catalog (mirrors the server's cross-session cache — see
  // lib/workspace.mjs _models): a property of the CLI build/account, not per-pane, so every
  // pane's selector reads from the same list once any session anywhere has answered it.
  function modelInfoFor(value) { return st.models.find((m) => m.value === value) || null; }
  function fillModelSelect(sel, value) {
    const opts = [el("option", { value: "" }, ["Default"]), ...st.models.map((m) => el("option", { value: m.value }, [m.displayName]))];
    sel.replaceChildren(...opts);
    // A pane's already-chosen model may not (yet) be in a freshly-(re)fetched catalog — inject an
    // option so the dropdown still shows it rather than silently reverting to "Default".
    if (value && !st.models.some((m) => m.value === value)) opts.push(el("option", { value }, [value]));
    sel.value = value || "";
  }
  // Effort options depend on the CURRENTLY selected model — rebuilt every paint, not just on
  // model change, since st.models itself can arrive/refresh asynchronously after the pane exists.
  function fillEffortSelect(sel, p) {
    const info = modelInfoFor(p.model);
    const levels = info?.supportsEffort ? (info.supportedEffortLevels || []) : [];
    sel.hidden = !levels.length;
    if (!levels.length) return;
    sel.replaceChildren(el("option", { value: "" }, ["Default effort"]), ...levels.map((lv) => el("option", { value: lv }, [lv[0].toUpperCase() + lv.slice(1)])));
    sel.value = levels.includes(p.effort) ? p.effort : "";
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
  // Lightweight inline markdown for the PROSE around code fences — **bold**, *italic*, `code`,
  // [text](url). Deliberately not underscore-based (no __bold__/_italic_): this is a developer
  // chat where prose is full of snake_case_identifiers and file_names — treating `_` as an
  // emphasis marker would mangle `pythia_cronoton_keyset` into "pythia<em>cronoton</em>keyset".
  // Asterisks avoid that whole class of false positive, and are what Claude's own replies
  // actually use in practice. The emphasis patterns also refuse leading/trailing whitespace
  // right inside the markers (CommonMark's own rule) so "2 * 3 * 4" doesn't get read as italic.
  // Confirmed in production: without ANY of this, a real reply's **bold** markers, ### headers,
  // and - bullet lines all showed up as literal asterisks/hashes/dashes — this was never
  // intentional, "prose stays plain text" only ever meant "not a second code-block", not "no
  // markdown at all".
  const WS_INLINE_SRC = "(\\*\\*(?!\\s)[^*\\n]+?(?<!\\s)\\*\\*|`[^`\\n]+`|\\[[^\\]\\n]+\\]\\((https?://[^)\\s]+|mailto:[^)\\s]+)\\)|\\*(?!\\s)[^*\\n]+?(?<!\\s)\\*)";
  // `renderInline` recurses into itself (see the "**" branch below), and a shared, single global
  // RegExp's `lastIndex` is mutable cross-call state — a naive module-level `const WS_INLINE_RE =
  // /…/g` would have the recursive call's OWN loop clobber the OUTER call's position mid-scan
  // (both `.exec()` against the same object), corrupting or infinite-looping the outer text.
  // A fresh RegExp per call sidesteps that entirely — each invocation's `lastIndex` is its own.
  function renderInline(text) {
    const re = new RegExp(WS_INLINE_SRC, "g");
    const out = []; let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const tok = m[0];
      // Bold recurses one level (so **`code`** nests a real <code> inside the <strong> instead
      // of showing literal backtick characters — confirmed a real, actual shape in production:
      // "**`docs/HANDOFF-pact-pyth-ledger.md`**"). Inline code does NOT recurse — its whole point
      // is verbatim content, `**not bold**` inside backticks must stay literal text.
      if (tok.startsWith("**")) out.push(el("strong", {}, renderInline(tok.slice(2, -2))));
      else if (tok.startsWith("`")) out.push(el("code", { class: "ws-inline-code" }, [tok.slice(1, -1)]));
      else if (tok.startsWith("[")) {
        const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
        out.push(el("a", { href: lm[2], target: "_blank", rel: "noopener noreferrer" }, renderInline(lm[1])));
      } else out.push(el("em", {}, renderInline(tok.slice(1, -1))));
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  // Block-level: a leading `#`..`######` line becomes a heading (bold, a size step up); a
  // `-`/`*`/`1.` line keeps its own marker (prettified to "•" for bullets) but gets inline
  // formatting applied to its content. Everything rides on the SAME .ws-line's existing
  // `white-space: pre-wrap`, so newlines between these still lay out exactly as sent — this
  // only replaces individual LINES' content, never restructures the block into real <ul>/<p>
  // (which would fight that pre-wrap layout for no visual benefit in a chat transcript).
  const WS_HEADING_RE = /^(#{1,6})\s+(.*)$/;
  const WS_BULLET_RE = /^([-*])\s+(.*)$/;
  const WS_ORDERED_RE = /^(\d+\.)\s+(.*)$/;
  function renderProseBlock(text) {
    const lines = text.split("\n");
    const out = [];
    lines.forEach((raw, i) => {
      if (i > 0) out.push("\n");
      const h = WS_HEADING_RE.exec(raw);
      if (h) { out.push(el("strong", { class: "ws-md-heading" }, renderInline(h[2]))); return; }
      const b = WS_BULLET_RE.exec(raw);
      if (b) { out.push("•  ", ...renderInline(b[2])); return; }
      const o = WS_ORDERED_RE.exec(raw);
      if (o) { out.push(o[1] + "  ", ...renderInline(o[2])); return; }
      out.push(...renderInline(raw));
    });
    return out;
  }
  // Splits assistant text on ```fenced``` code blocks: each code block becomes its own bordered,
  // monospaced box with a copy button for JUST that block — not the whole message (matching
  // Claude's own rendering, not a copy button glued onto every reply) — and the prose AROUND
  // those blocks gets the lightweight markdown treatment above, instead of showing up as literal
  // **/`/#/- characters.
  const WS_FENCE_RE = /```([\w+-]*)\n?([\s\S]*?)```/g;
  function renderAssistantText(text) {
    if (typeof text !== "string") return [text];
    if (!text.includes("```")) return renderProseBlock(text);
    const parts = []; let last = 0, mtch;
    WS_FENCE_RE.lastIndex = 0;
    while ((mtch = WS_FENCE_RE.exec(text))) {
      if (mtch.index > last) parts.push(...renderProseBlock(text.slice(last, mtch.index)));
      const lang = mtch[1] || "";
      const code = mtch[2].replace(/\n$/, "");
      parts.push(el("div", { class: "ws-codeblock" }, [
        el("div", { class: "ws-codeblock-hd" }, [el("span", {}, [lang || "code"]), copyBtn(() => code)]),
        el("pre", { class: "ws-codeblock-body" }, [code]),
      ]));
      last = WS_FENCE_RE.lastIndex;
    }
    if (last < text.length) parts.push(...renderProseBlock(text.slice(last)));
    return parts;
  }
  // Absolute prompt/response numbering (P#n / R#n), stamped on the transcript so a cached turn node keeps its
  // number, counting from the server-sent offsets so it includes prompts/responses not currently loaded.
  function wsStampNumbers(p) {
    if (!p || !Array.isArray(p.transcript)) return;
    let pn = p._promptOffset || 0, rn = p._responseOffset || 0;
    for (const m of p.transcript) {
      if (!m) continue;
      if (m.role === "user" || m.kind === "user") m._pnum = ++pn;
      else if (m.role === "assistant" || m.kind === "assistant") m._rnum = ++rn;
    }
  }
  function wsNumBadge(kind, n) { return (typeof n === "number") ? el("span", { class: "ws-num ws-num-" + kind.toLowerCase(), title: (kind === "P" ? "Prompt" : "Response") + " #" + wsNumFmt(n) }, [kind + "#" + wsNumFmt(n)]) : ""; }
  // Interrupted-prompt handling (mirrors the Pact chat — see pactMarkInterrupt): recognise a prompt whose
  // turn never replied (idle pane, trailing user message, no assistant after) → DARK BLUE, persisted in
  // p.promptStates by `at`. "i" = interrupted (dark blue), "d" = discarded (red). Buttons only on the
  // still-trailing interrupted one: ▶ resume (continue it) · ✕ discard (mark dead; excluded from next prompt).
  function wsInterruptedIdx(p) {
    if (!p || paneBusy(p) || !Array.isArray(p.transcript)) return -1;
    for (let i = p.transcript.length - 1; i >= 0; i--) { const m = p.transcript[i]; if (!m) continue; if (m.role === "assistant" || m.kind === "assistant") return -1; if (m.role === "user" || m.kind === "user") return i; }
    return -1;
  }
  function wsMarkInterrupt(p) {
    if (!p || !Array.isArray(p.transcript)) return;
    p.promptStates = p.promptStates || {};
    const idx = wsInterruptedIdx(p);
    let changed = false;
    if (idx >= 0) { const at = p.transcript[idx].at; if (typeof at === "number" && !p.promptStates[at]) { p.promptStates[at] = "i"; changed = true; } }
    p.transcript.forEach((m, i) => {
      if (!m || !(m.role === "user" || m.kind === "user")) return;
      const st = (typeof m.at === "number") ? p.promptStates[m.at] : undefined;
      const wantState = st || "", wantBtns = (i === idx) && st === "i";
      if (m._intrState !== wantState || m._intrBtns !== wantBtns) { m._intrState = wantState; m._intrBtns = wantBtns; m._node = null; }   // re-render on change (state changes only in the live last turn, so the turn cache stays valid)
      m._paneId = p.id;
    });
    if (changed) saveLayout();
  }
  function wsTrailingDiscarded(p) {
    const out = []; const tr = (p && p.transcript) || []; const ps = (p && p.promptStates) || {};
    for (let i = tr.length - 1; i >= 0; i--) { const m = tr[i]; if (!m) continue; if (m.role === "assistant" || m.kind === "assistant") break; if ((m.role === "user" || m.kind === "user") && typeof m.at === "number" && ps[m.at] === "d") out.unshift(m); }
    return out;
  }
  const WS_RESUME_MSG = (n) => `↻ Resume: my message${typeof n === "number" ? " (P#" + wsNumFmt(n) + ")" : ""} above was interrupted before you finished it — please resume and complete exactly what it asked, as written (don't make me repeat it).`;
  function wsResumeInterrupted(m) {
    const p = st.panes.find((x) => x.id === m._paneId); if (!p) return;
    m._intrBtns = false; m._node = null;
    dispatchPrompt(p, WS_RESUME_MSG(m._pnum), []);   // short continue instruction, not a re-paste
  }
  function wsDiscardInterrupted(m) {
    const p = st.panes.find((x) => x.id === m._paneId); if (!p || typeof m.at !== "number") return;
    p.promptStates = p.promptStates || {};
    p.promptStates[m.at] = "d"; m._intrState = "d"; m._intrBtns = false; m._node = null;
    saveLayout(); paintPane(p);
  }
  // ---- bookmark a response (★) + jump to it -------------------------------------------------------
  // Each response can be starred (persisted per pane by its `at`). A ★ button in the pane controls opens a
  // list of starred responses; picking one reveals + scrolls to it. Stamped onto messages each render.
  function wsMarkBookmarks(p) {
    if (!p || !Array.isArray(p.transcript)) return;
    const bm = new Set(Array.isArray(p.bookmarks) ? p.bookmarks : []);
    p.transcript.forEach((m) => {
      if (!m) return;
      m._paneId = p.id;
      if (m.role === "assistant" || m.kind === "assistant") { const b = typeof m.at === "number" && bm.has(m.at); if (m._bookmarked !== b) { m._bookmarked = b; m._node = null; } }
    });
  }
  function wsToggleBookmark(m) {
    const p = st.panes.find((x) => x.id === m._paneId); if (!p || typeof m.at !== "number") return;
    p.bookmarks = Array.isArray(p.bookmarks) ? p.bookmarks : [];
    const i = p.bookmarks.indexOf(m.at);
    if (i >= 0) p.bookmarks.splice(i, 1); else p.bookmarks.push(m.at);
    m._bookmarked = i < 0; m._node = null;
    const ui = paneUI.get(p.id); if (ui) ui._txRef = null;   // force a full transcript re-render so a star on an OLD (cached) turn updates too
    saveLayout(); paintPane(p);
    if (ui && ui._bmPop) wsRenderBookmarkList(p);   // keep an open list in sync
  }
  function wsScrollToResponse(p, at) {
    p._showAllTurns = true;   // the target may be behind "show earlier" — reveal everything first
    paintPane(p);
    const m = p.transcript.find((x) => x && (x.role === "assistant" || x.kind === "assistant") && x.at === at);
    if (m && m._node) {
      requestAnimationFrame(() => { m._node.scrollIntoView({ behavior: "smooth", block: "center" }); m._node.classList.add("ws-bm-flash"); setTimeout(() => m._node.classList.remove("ws-bm-flash"), 1600); });
      return;
    }
    // Not in the loaded window (a big conversation ships only its tail) — fetch the whole history, then jump
    // once it lands (see the resync handler's p._pendingBookmarkScroll).
    if (p.sessionKey) { p._pendingBookmarkScroll = at; wsPost("control", { action: "resync", args: { sessionKey: p.sessionKey, full: true } }); }
  }
  function wsRemoveBookmark(p, at) {
    p.bookmarks = (Array.isArray(p.bookmarks) ? p.bookmarks : []).filter((x) => x !== at);
    const m = p.transcript.find((x) => x && (x.role === "assistant" || x.kind === "assistant") && x.at === at);
    if (m) { m._bookmarked = false; m._node = null; }
    const ui = paneUI.get(p.id); if (ui) ui._txRef = null;   // full re-render so the star clears on a cached turn
    saveLayout(); paintPane(p);
  }
  // Rows for the starred-responses list (R#n + snippet + a × to remove); picking one jumps to it. Shared by
  // the desktop popup and the mobile sheet. `onPick` closes the container; `refresh` rebuilds it after a delete.
  function wsBookmarkRows(p, onPick, refresh) {
    const marks = (Array.isArray(p.bookmarks) ? p.bookmarks : []).slice().sort((a, b) => a - b);
    if (!marks.length) return [el("div", { class: "ws-bm-empty" }, ["No bookmarks yet — tap the ☆ on any response."])];
    return marks.map((at) => {
      const m = p.transcript.find((x) => x && (x.role === "assistant" || x.kind === "assistant") && x.at === at);
      const label = m ? ("R#" + wsNumFmt(m._rnum || 0)) : "R#?";
      const snip = m ? String(m.text || "").replace(/[#*`>_~-]/g, "").replace(/\s+/g, " ").trim().slice(0, 76) : "(older — loads on open)";
      const del = el("button", { class: "ws-bm-del", type: "button", title: "Remove this bookmark" }, ["×"]);
      const remove = (e) => { e.preventDefault(); e.stopPropagation(); wsRemoveBookmark(p, at); if (refresh) refresh(); };
      del.addEventListener("click", remove); del.addEventListener("touchend", remove);
      const row = el("div", { class: "ws-bm-row" }, [el("span", { class: "ws-bm-rn" }, [label]), el("span", { class: "ws-bm-snip" }, [snip || "(empty)"]), del]);
      const pick = () => { wsScrollToResponse(p, at); if (onPick) onPick(); };
      row.addEventListener("click", pick); row.addEventListener("touchend", (e) => { e.preventDefault(); pick(); });
      return row;
    });
  }
  function wsRenderBookmarkList(p) {   // desktop: fill the popup anchored to the ★ button
    const ui = paneUI.get(p.id); if (!ui || !ui._bmPop) return;
    const refresh = () => wsRenderBookmarkList(p);
    ui._bmPop.replaceChildren(el("div", { class: "ws-bm-hd" }, ["★ Bookmarked responses"]), ...wsBookmarkRows(p, () => ui._bmPop.classList.remove("--show"), refresh));
  }
  function wsOpenBookmarkSheet(p) {   // mobile: the same list as a bottom sheet
    if (!p) return;
    const body = el("div", { class: "ws-bm-sheet" }, []);
    const refresh = () => body.replaceChildren(...wsBookmarkRows(p, closeSheet, refresh));
    refresh();
    openSheet("★ Bookmarked responses", body);
  }
  function renderItem(m) {
    if (m.role === "user" || m.kind === "user") {
      const kids = [wsNumBadge("P", m._pnum), el("b", {}, ["you  "])];
      // Root-caused a real "the image disappears from the UI the instant I hit send" report: the
      // image was always saved server-side and attached to the persisted turn — this pane just
      // never rendered it. `m.images`/`m.workspaceId` now ride the live "user" event AND the
      // stored turn record alike, so this covers both a just-sent prompt and reopening history.
      // `m.image` (singular) is the pre-multi-image shape — still read here so history rows
      // written before this feature landed keep rendering, never rewritten on disk.
      const imgs = m.images || (m.image ? [m.image] : []);
      if (imgs.length && m.workspaceId) {
        kids.push(el("div", { class: "ws-user-images" }, imgs.map((img) => {
          const src = `/api/workspace/image?workspaceId=${encodeURIComponent(m.workspaceId)}&path=${encodeURIComponent(img.path)}`;
          return el("a", { href: src, target: "_blank", rel: "noopener noreferrer", class: "ws-user-image-link" }, [
            el("img", { class: "ws-user-image", src, alt: "attached image" }, []),
          ]);
        })));
      }
      kids.push(m.text);
      // Sent right as a "deepwork" phase was wrapping up (see lib/workspace.mjs's
      // DEEP_WORK_RISK_GRACE_MS) — real chance that phase's own leftover output arrives
      // interleaved with (or instead of) a reply to THIS prompt. Flagged red rather than the
      // normal blue bubble, so "it looked captured but nothing seemed to happen" reads as "this
      // landed in a risky window, give it a moment (or just resend)" instead of looking lost.
      if (m.deepWorkRisk) {
        kids.push(el("span", { class: "ws-deepwork-risk-tag" }, ["⚠ sent as Deep Work was wrapping up — reply may still be catching up"]));
        return line("ws-user ws-deepwork-risk", kids);
      }
      if (m._intrBtns) {
        const resume = el("button", { class: "ws-intr-btn ws-intr-resume", title: "Resume — tell the agent this prompt was interrupted and to continue it (no re-paste)" }, ["▶"]);
        resume.addEventListener("click", (e) => { e.stopPropagation(); wsResumeInterrupted(m); });
        const discard = el("button", { class: "ws-intr-btn ws-intr-discard", title: "Discard — mark it dead; your next prompt won't include it" }, ["✕"]);
        discard.addEventListener("click", (e) => { e.stopPropagation(); wsDiscardInterrupted(m); });
        kids.push(resume, discard);
      }
      return line("ws-user" + (m._intrState === "d" ? " ws-discarded" : m._intrState === "i" ? " ws-interrupted" : ""), kids);
    }
    if (m.role === "assistant" || m.kind === "assistant") {
      const star = el("button", { class: "ws-bm-star" + (m._bookmarked ? " on" : ""), title: m._bookmarked ? "Bookmarked — click to remove" : "Bookmark this response" }, [m._bookmarked ? "★" : "☆"]);
      star.addEventListener("click", (e) => { e.stopPropagation(); wsToggleBookmark(m); });
      return line("ws-assistant", [wsNumBadge("R", m._rnum), star, ...renderAssistantText(m.text)]);
    }
    if (m.kind === "tool_use") return line("ws-tool", [el("i", { class: "ti ti-tool" }, []), " ", (m.tools || []).map((t) => t.name).join(", ")]);
    if (m.kind === "tool_result") return line("ws-toolres", ["✓ tool result"]);
    if (m.kind === "result") return line("ws-result", [`— done · ${(m.usage?.output_tokens || 0)} out tok`]);
    if (m.kind === "error") return line("ws-err", ["⚠ " + (m.text || m.message || "Unknown error")]);
    if (m.kind === "created") return line("ws-note", [`created ${m.what}: ${m.path}`]);
    return null;
  }
  // Cache each item's rendered node on the message. Transcript items are immutable once added
  // (append-only; assistant markdown/code-highlighting is the expensive part), so within the LIVE last
  // turn — the only turn re-rendered on every event — an item renders once and is then reused, the same
  // per-node caching the Pact chat uses. Finalized turns are already cached whole (ui._turnCache); a
  // resync/reopen swaps the transcript ARRAY, giving fresh message objects with no `_node`, so nothing
  // stale can be reused. `null` results (no-op items) aren't cached — they're cheap to re-evaluate.
  function renderItemCached(m) { return m._node || (m._node = renderItem(m)); }
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
      ...group.map(renderItemCached).filter(Boolean),
    ]);
  }
  // Renders a full transcript, grouping every tool_use/tool_result event within one TURN into a
  // single collapsed summary — a turn boundary is the next `user` item, not mere array adjacency,
  // so interim assistant commentary between two tool-call rounds of the same turn doesn't split
  // them into two summaries. Everything else still renders exactly as renderItem produces, inline,
  // in its natural chronological position (the tool-group's own position is reserved at its first
  // event and filled in once the group closes, so later-arriving tool events in the same turn still
  // land in the one group even though other items were emitted in between).
  // `keyBase` offsets each tool-group's key so it stays GLOBALLY unique/stable even when `items`
  // is only one turn's slice (see renderTurns' incremental rendering) — keyBase + localIndex ==
  // the item's index in the full transcript, exactly what a whole-array render produced before,
  // so persisted expand-state keys in `_expandedGroups` remain valid across the two call styles.
  function renderTranscript(items, expandedGroups, keyBase = 0) {
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
        if (!group) { group = []; groupKey = keyBase + i; groupSlot = out.length; out.push(null); }
        group.push(m);
      } else {
        const node = renderItemCached(m); if (node) out.push(node);
      }
    });
    closeGroup();
    return out.filter(Boolean);
  }

  // Split a transcript into turns — each begins at a turn boundary (a `user` item) and runs to the
  // next, so tool-grouping (which is per-turn) renders identically whether done whole or per-slice.
  // Items before the first user message (rare — a stray note/created event) form an initial turn.
  function splitTurns(items) {
    const turns = []; let cur = null;
    items.forEach((m, i) => {
      if (!cur || isTurnBoundary(m)) { cur = { start: i, items: [] }; turns.push(cur); }
      cur.items.push(m);
    });
    return turns;
  }
  // One turn's rendered lines, wrapped in a `display:contents` container so the wrapper is a single
  // DOM node to cache/insert/remove atomically WITHOUT disturbing the transcript's flat flex layout
  // (align-self on user bubbles, row gap) — the wrapper generates no box of its own.
  function renderTurnContainer(turn, expandedGroups) {
    return el("div", { class: "ws-turn" }, renderTranscript(turn.items, expandedGroups, turn.start));
  }
  // Incrementally reconcile a pane's transcript DOM. Two things bound the work:
  //  • CAP: only the most recent WS_TURN_RENDER_CAP turns are in the DOM; older ones hide behind a
  //    "show earlier" button (p._showAllTurns lifts the cap). This keeps the standing DOM small so
  //    a weak/software-rendering browser never lays out/paints thousands of nodes at once.
  //  • INCREMENTAL: among the visible turns, FINALIZED ones (all but the last) are immutable
  //    (append-only transcript) so their rendered container nodes are cached and the unchanged
  //    leading run is left untouched — only the growing last turn re-renders each paint.
  // `lead` = the optional show-earlier button + the finalized turn containers (the stable prefix);
  // `tailExtras` = the live-typing preview + queued-message nodes that trail the real turns. Falls
  // back to a full replaceChildren whenever the stable prefix can't be trusted.
  function renderTranscriptInto(ui, p, tailExtras) {
    const t = ui.transcriptEl;
    wsStampNumbers(p);   // assign each prompt/response its absolute P#/R# before turns render
    wsMarkInterrupt(p);  // recognise/paint interrupted (dark blue) + discarded (red) prompts + their buttons
    wsMarkBookmarks(p);  // stamp which responses are starred (+ each message's pane id, for jump-to)
    const allTurns = splitTurns(p.transcript);
    const showAll = !!p._showAllTurns;
    const turns = showAll ? allTurns : allTurns.slice(-WS_TURN_RENDER_CAP);
    const hidden = allTurns.length - turns.length;
    // Beyond the locally-hidden turns, the server may be holding OLDER history it didn't ship: a resync/open
    // sends only the tail (see WS_RESYNC_MSG_CAP) so a big conversation appears instantly on mobile. When it's
    // truncated, the chip must stay offered even after every local turn is revealed, and clicking it fetches
    // the rest whole (`full: true`) — the resync reply swaps in the complete transcript and repaints.
    const moreOnServer = !!p._transcriptTruncated;
    // Invalidate all cached nodes if the transcript array itself was swapped (resync/reopen give a
    // brand-new array) — reused nodes from a different conversation would be flat-out wrong.
    if (ui._txRef !== p.transcript) { ui._txRef = p.transcript; ui._turnCache = new Map(); ui._domLead = []; ui._showEarlierNode = null; }
    const cache = ui._turnCache;
    const lead = [];
    // The show-earlier button — cached and reused across paints (stable node ⇒ the fast path can
    // keep it in place), rebuilt only when the hidden-count changes so its label stays accurate.
    if (hidden > 0 || moreOnServer) {
      if (!ui._showEarlierNode || ui._showEarlierHidden !== hidden || ui._showEarlierMore !== moreOnServer) {
        const label = hidden > 0 ? `▲ Show ${hidden} earlier message${hidden === 1 ? "" : "s"}` : "▲ Show earlier messages";
        const btn = el("button", { class: "ws-show-earlier" }, [label]);
        btn.addEventListener("click", () => {
          p._showAllTurns = true;
          if (p._transcriptTruncated && p.sessionKey) wsPost("control", { action: "resync", args: { sessionKey: p.sessionKey, full: true } });
          paintPane(p);
        });
        ui._showEarlierNode = btn; ui._showEarlierHidden = hidden; ui._showEarlierMore = moreOnServer;
      }
      lead.push(ui._showEarlierNode);
    } else { ui._showEarlierNode = null; ui._showEarlierHidden = 0; ui._showEarlierMore = false; }
    for (let i = 0; i < turns.length - 1; i++) {
      const turn = turns[i];
      // Keyed by global start index + item count — both stable for an append-only prefix, so a hit
      // is guaranteed reusable; a miss (first sight, or a turn that grew before being finalized)
      // renders once and caches.
      const key = turn.start + ":" + turn.items.length;
      let node = cache.get(key);
      if (!node) { node = renderTurnContainer(turn, p._expandedGroups); cache.set(key, node); }
      lead.push(node);
    }
    const lastTurn = turns[turns.length - 1];
    const lastNode = lastTurn ? renderTurnContainer(lastTurn, p._expandedGroups) : null;
    const domLead = ui._domLead || [];
    // Fast path: the leading run already in the DOM is unchanged (same node refs, still attached) —
    // leave it, append any newly-added lead nodes, and swap only the trailing section (last turn +
    // live/queued extras). The lead only changes when the visible window shifts (a new turn past
    // the cap) or "show earlier" is clicked — infrequent; streaming just grows the last turn.
    const prefixIntact = domLead.length <= lead.length
      && domLead.every((n, i) => n === lead[i] && n.parentNode === t);
    if (prefixIntact && t.childNodes.length >= domLead.length) {
      while (t.childNodes.length > domLead.length) t.removeChild(t.lastChild);   // drop old tail
      for (let i = domLead.length; i < lead.length; i++) t.appendChild(lead[i]);
      if (lastNode) t.appendChild(lastNode);
      for (const n of tailExtras) t.appendChild(n);
    } else {
      t.replaceChildren(...lead, ...(lastNode ? [lastNode] : []), ...tailExtras);
    }
    ui._domLead = lead;
  }

  // ---- image attach ---------------------------------------------------------------
  // The encode/cap/attachment helpers (WS_IMG_ALLOWED_TYPES, WS_IMG_MAX_COUNT,
  // WS_IMG_MAX_ENCODED_BYTES, WS_IMG_COMPRESS_STEPS, wsReadFileAsDataUrl, wsDataUrlEncodedSize,
  // wsDataUrlToAttachment, wsLoadDrawable, wsCompressImage) now live at MODULE scope (see the "WS
  // IMAGE — pure attach/encode helpers" block) so the Pact chat encodes images identically — this
  // pane only keeps the pane-stateful pieces (attach chain, preview chips, error line).
  // The compose box grows with what you type — up to WS_PROMPT_MAX_ROWS lines — instead of
  // staying a fixed 2-line box, matching Claude Code's own desktop compose box. Computed from the
  // textarea's OWN computed line-height/padding (getComputedStyle), not a hardcoded pixel guess,
  // so a future CSS tweak to .ws-prompt can't silently desync the cap from what's actually drawn.
  const WS_PROMPT_MIN_ROWS = 2;
  const WS_PROMPT_MAX_ROWS = 10;
  function wsAutoResizePrompt(el) {
    const cs = getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 18;
    const extra = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    // Cap at WS_PROMPT_MAX_ROWS lines — but never let the box grow past ~40% of the viewport
    // height. On a phone, 10 lines could otherwise push the Send button (bottom of the compose
    // row) out of the fixed-height pane and off-screen; this keeps it visible and scrolls the
    // text instead. On a normal desktop the row cap is far smaller than 40vh, so nothing changes.
    const rowCap = lineHeight * WS_PROMPT_MAX_ROWS + extra;
    const maxHeight = Math.min(rowCap, Math.round((window.innerHeight || 900) * 0.4));
    const minFloor = lineHeight * WS_PROMPT_MIN_ROWS + extra;
    el.style.height = "auto";   // collapse first — scrollHeight only shrinks correctly measured from a fresh baseline
    const needed = el.scrollHeight;
    if (needed <= minFloor) {
      // Empty / short: clear the inline height so CSS takes over — on mobile that lets the box
      // stretch to fill the button column's height (a big, inviting typing area) instead of being
      // pinned to a fixed inline pixel value that leaves an awkward gap next to the round buttons.
      el.style.height = "";
      el.style.overflowY = "hidden";
    } else {
      el.style.height = Math.min(needed, maxHeight) + "px";
      el.style.overflowY = needed > maxHeight ? "auto" : "hidden";
    }
  }
  /** Attach a whole batch (a multi-select from the file picker, a multi-file drop, or several
   *  clipboard image items) ONE AT A TIME, awaiting each before starting the next — wsAttachImageFile
   *  does a read-modify-write of p.attachedImages, so firing them concurrently would race (two
   *  calls both reading the same "existing" array before either commits, silently dropping one). */
  function wsAttachImageFiles(p, files) {
    // Serialize ALL attach operations for this pane through one promise chain, so two entry points
    // firing close together (e.g. two quick pastes, or a pick landing while a drop is still
    // decoding) can never interleave their read-modify-write of p.attachedImages and clobber each
    // other — a hard guarantee against "I added several images but only the last stuck", regardless
    // of timing.
    p._attachChain = (p._attachChain || Promise.resolve())
      .then(async () => { for (const f of files) await wsAttachImageFile(p, f); })
      .catch(() => {});
    return p._attachChain;
  }
  /** Entry point for all three attach paths (file-picker, paste, drag-drop) — same file-in,
   *  same attached-state-out, so they're functionally equivalent per the design. Skips
   *  recompression for an already-under-cap PNG/JPEG/WebP (keeps a small screenshot crisp);
   *  anything else (oversized, or an unsupported clipboard/drop type) goes through
   *  wsCompressImage, which always emits an allowed mediaType. */
  async function wsAttachImageFile(p, file) {
    wsShowImgErr(p, "");
    const existing = p.attachedImages || [];
    if (existing.length >= WS_IMG_MAX_COUNT) { wsShowImgErr(p, `You can attach up to ${WS_IMG_MAX_COUNT} images per message.`); return; }
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
    // Re-check the cap: two attach paths (e.g. a fast double-paste) can both start this async
    // function while `existing` was still under the cap — read `p.attachedImages` fresh here,
    // right before committing, not the possibly-stale `existing` captured above.
    if ((p.attachedImages || []).length >= WS_IMG_MAX_COUNT) { wsShowImgErr(p, `You can attach up to ${WS_IMG_MAX_COUNT} images per message.`); return; }
    p.attachedImages = [...(p.attachedImages || []), attachment];
    wsPaintAttachment(p);
  }
  function wsShowImgErr(p, msg) {
    const ui = paneUI.get(p.id); if (!ui) return;
    ui.imgErr.textContent = msg || ""; ui.imgErr.hidden = !msg;
  }
  /** Build one preview chip (thumbnail + its own remove ×) for an attached image at `idx` —
   *  removing it splices just that index out of p.attachedImages, unlike the old single-image
   *  design's one fixed remove button. */
  function wsImgChip(p, img, idx) {
    const thumb = el("img", { class: "ws-img-thumb", alt: "attached image" });
    thumb.src = img.dataUrl;
    const removeBtn = el("button", { class: "ws-img-x", type: "button", title: "Remove this image" }, ["×"]);
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      p.attachedImages = (p.attachedImages || []).filter((_, i) => i !== idx);
      wsShowImgErr(p, "");
      wsPaintAttachment(p);
    });
    return el("div", { class: "ws-img-chip" }, [thumb, removeBtn]);
  }
  /** Sync the preview thumbnails + remove controls to p.attachedImages — called after every
   *  attach, remove, and a successful/failed send (see wsAttachImageFile, the remove button,
   *  and send()). */
  function wsPaintAttachment(p) {
    const ui = paneUI.get(p.id); if (!ui) return;
    const imgs = p.attachedImages || [];
    ui.imgPreviewWrap.hidden = !imgs.length;
    ui.imgPreviewWrap.replaceChildren(...imgs.map((img, idx) => wsImgChip(p, img, idx)));
  }

  // ---- one pane ------------------------------------------------------------------
  function buildPane(p) {
    const repoSel = el("select", { class: "wsel wsel-sm" }, []); fillRepoSelect(repoSel, p.repo);
    const wtSel = el("select", { class: "wsel wsel-sm wsel-wt", title: "Worktree — a separate checkout for a parallel workspace on this repo" }, []);
    fillWorktreeSelect(wtSel, p);
    const modeSel = el("select", { class: "wsel wsel-mode", title: "Permission mode for this pane" },
      WS_MODES.map((m) => el("option", { value: m.id }, [m.short])));
    modeSel.value = p.mode;
    // Model + effort + fast mode — matches Claude Code Desktop's own selector (model, then a
    // reasoning-effort level for models that support one, then a fast-mode toggle for models that
    // support that). st.models populates once ANY session anywhere has answered "models" (see
    // fillModelSelect) — until then this just shows "Default", same as never having picked one.
    const modelSel = el("select", { class: "wsel wsel-sm wsel-model", title: "Model for this pane" });
    fillModelSelect(modelSel, p.model);
    const effortSel = el("select", { class: "wsel wsel-sm wsel-effort", title: "Reasoning effort" });
    fillEffortSelect(effortSel, p);
    const fastModeLabel = el("label", { class: "ws-fastmode", title: "Fast mode — quicker, lighter-weight responses" }, [
      el("input", { type: "checkbox", class: "ws-fastmode-cb" }, []), " Fast",
    ]);
    const fastModeCb = fastModeLabel.querySelector("input");
    fastModeCb.checked = !!p.fastMode;
    // The pane's turn-lock status icon — a plain CSS spinner (no glyph, no dependency):
    // a bordered ring that rotates while the pane's session is busy, and sits still
    // (idle/done) otherwise. Driven by paintPane() from p.status, which onPayload keeps
    // in sync with the existing busy/status/result/error event stream (see onPayload).
    const dot = el("span", { class: "ws-status" });
    const badge = el("span", { class: "ws-usage" }, ["—"]);
    const closeBtn = el("button", { class: "ws-x", title: "Clear this pane (ends its session)" }, ["×"]);
    const histBtn = el("button", { class: "ws-ico", title: "History for this repo" }, ["⏱"]);
    const transcriptEl = el("div", { class: "ws-transcript" }, []);
    const promptEl = el("textarea", { class: "ws-prompt", rows: String(WS_PROMPT_MIN_ROWS), placeholder: "Message Claude… (Ctrl+Enter)" });
    // Auto-resize on a rAF, not synchronously on every keystroke: wsAutoResizePrompt reads
    // scrollHeight, which forces a synchronous layout flush — cheap alone, but on a weaker client
    // with several panes it's per-keystroke work that competes with painting the character. Coalesced
    // to at most once per frame, the keystroke handler returns immediately and the box still grows
    // smoothly a frame later.
    let _resizeRAF = 0;
    promptEl.addEventListener("input", () => {
      p.draft = promptEl.value; saveDraftsSoon();   // remember typed-but-unsent text across a view switch
      if (_resizeRAF) return;
      _resizeRAF = (window.requestAnimationFrame || ((fn) => setTimeout(fn, 16)))(() => { _resizeRAF = 0; wsAutoResizePrompt(promptEl); });
    });
    const sendBtn = el("button", { class: "loginbtn ws-send" }, ["Send"]);
    // "■ Stop" — interrupt the current turn mid-flight (Claude Code's stop button) without ending
    // the conversation. Shown only while the pane is working (see paintPane); sends the "stop"
    // action, which the work machine turns into an SDK interrupt (see lib/workspace.mjs _stop).
    const stopBtn = el("button", { class: "ws-stop", title: "Stop the current response (keeps the conversation)" }, ["■ Stop"]);
    stopBtn.hidden = true;
    stopBtn.addEventListener("click", () => { assignKey(p); wsPost("stop", { sessionKey: p.sessionKey }); logActivity(p, "■ Stopping…"); });
    // Attach affordance: a file-picker button (hidden native <input type=file>) plus paste and
    // drag-drop straight onto the compose row — all three funnel into wsAttachImageFile, so they
    // end up in the exact same attached/preview state (see design's "functionally equivalent
    // entry points").
    const imgFileInput = el("input", { type: "file", accept: WS_IMG_ALLOWED_TYPES.join(","), multiple: "", class: "ws-img-input" });
    const attachBtn = el("button", { class: "ws-ico ws-attach", type: "button", title: `Attach up to ${WS_IMG_MAX_COUNT} images — click, paste, or drag onto the box` }, ["📎"]);
    // Filled dynamically by wsPaintAttachment() — one chip (thumbnail + its own ×) per attached
    // image, up to WS_IMG_MAX_COUNT — not fixed single elements the way one-image-only used to be.
    const imgPreviewWrap = el("div", { class: "ws-img-preview" }, []);
    imgPreviewWrap.hidden = true;
    const imgErr = el("div", { class: "ws-img-err" }, []);
    imgErr.hidden = true;
    // Actions grouped in their own wrapper: a horizontal cluster on desktop, but on mobile a
    // VERTICAL column of round icon buttons (attach / stop / send) beside a full-width text box —
    // WhatsApp-style — so the typing area isn't squeezed to nothing when Stop and Send both show.
    const sendWrap = el("div", { class: "ws-send-wrap" }, [sendBtn]);   // relative host so the Live/Held bulb can dock above Send
    // ★ Bookmarks — a button that opens a list of this conversation's starred responses; picking one jumps to it.
    const bmBtn = el("button", { class: "ws-bm-btn", type: "button", title: "Bookmarked responses — jump to a starred answer" }, ["★"]);
    const bmPop = el("div", { class: "ws-bm-pop" }, []);
    const bmWrap = el("div", { class: "ws-bm-wrap" }, [bmBtn, bmPop]);
    bmBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const show = !bmPop.classList.contains("--show");
      document.querySelectorAll(".ws-bm-pop.--show").forEach((x) => x.classList.remove("--show"));   // one open at a time
      if (show) { wsRenderBookmarkList(p); bmPop.classList.add("--show"); }
    });
    const composeBtns = el("div", { class: "ws-compose-btns" }, [bmWrap, attachBtn, stopBtn, sendWrap]);
    const composeRow = el("div", { class: "ws-compose" }, [imgFileInput, promptEl, composeBtns]);
    const composeExtras = el("div", { class: "ws-compose-extras" }, [imgPreviewWrap, imgErr]);
    // A slim, ALWAYS-visible identity readout — plain text, not a control — so which
    // repo@worktree this pane is actually showing is never in doubt regardless of scroll
    // position or which conversation was just resumed into it. Kept separate from the
    // interactive controls below, which move to the bottom (see next block) to sit near the
    // compose row the way Claude's own UI keeps its controls near the input, not in a fixed
    // header far from where you're actually typing.
    const identityLabel = el("span", { class: "ws-identity" }, ["—"]);
    // "✓ Saved" badge — shown when the conversation is fully persisted and idle (see p._saved,
    // set from the server's `persisted` result flag), so it's clear at a glance that closing this
    // pane or continuing on another machine is safe. Hidden while working or before the first save.
    const savedBadge = el("span", { class: "ws-saved", title: "This conversation is saved — safe to close, or continue it on another machine." }, ["✓ Saved"]);
    savedBadge.hidden = true;
    // "⚙ N background" badge — shown when the chat is free but agent-spawned work (a workflow /
    // backgrounded task) is still running, so hidden work is discoverable, not just felt via the
    // Send button's blinking border. Hover lists what's running.
    const bgBadge = el("span", { class: "ws-bgwork" }, []);
    bgBadge.hidden = true;
    const topBar = el("div", { class: "ws-pane-hd" }, [dot, identityLabel, el("span", { class: "ws-spacer" }), bgBadge, savedBadge, closeBtn]);
    const controlsBar = el("div", { class: "ws-pane-controls" }, [repoSel, wtSel, modeSel, modelSel, effortSel, fastModeLabel, histBtn, el("span", { class: "ws-spacer" }), badge]);
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
    // Model/effort/fast-mode: applied immediately to a LIVE session (setModel/setEffort/
    // setFastMode no-op harmlessly server-side if there's no live session yet — the choice still
    // rides the NEXT prompt's own body either way, see dispatchPrompt).
    modelSel.addEventListener("change", () => {
      p.model = modelSel.value || null;
      wsPost("control", { action: "setModel", args: { sessionKey: p.sessionKey, model: p.model } });
      paintPane(p); saveLayout();   // repaint: the effort/fast-mode controls depend on the new model
    });
    effortSel.addEventListener("change", () => {
      p.effort = effortSel.value || null;
      wsPost("control", { action: "setEffort", args: { sessionKey: p.sessionKey, effort: p.effort } });
      saveLayout();
    });
    fastModeCb.addEventListener("change", () => {
      p.fastMode = fastModeCb.checked;
      wsPost("control", { action: "setFastMode", args: { sessionKey: p.sessionKey, enabled: p.fastMode } });
      saveLayout();
    });
    histBtn.addEventListener("click", (e) => { e.stopPropagation(); loadHistory(p.repo || null); });
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); clearPane(p); });
    sendBtn.addEventListener("click", () => send(p));
    promptEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(p); } });
    // Attach path 1: file-picker button opens the hidden native input; its change event is the
    // one place ALL browsers report the chosen file(s) — `multiple` lets one dialog pick several
    // at once, up to WS_IMG_MAX_COUNT.
    attachBtn.addEventListener("click", (e) => { e.stopPropagation(); imgFileInput.click(); });
    imgFileInput.addEventListener("change", () => {
      const files = imgFileInput.files ? [...imgFileInput.files] : [];
      imgFileInput.value = "";   // reset so re-picking the SAME file(s) still fires change next time
      wsAttachImageFiles(p, files);
    });
    // Attach path 2: paste an image straight into the textarea — mirrors Claude Desktop.
    // Only intercepted when the clipboard actually carries an image; a text paste (the common
    // case) is left completely alone. Every image item on the clipboard is attached, not just
    // the first — some browsers/OSes report a multi-image copy as several file items.
    promptEl.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items; if (!items) return;
      const files = [...items].filter((item) => item.kind === "file" && /^image\//.test(item.type)).map((item) => item.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); wsAttachImageFiles(p, files); }
    });
    // Attach path 3: drag-and-drop one or more image files onto the compose row.
    composeRow.addEventListener("dragover", (e) => { e.preventDefault(); composeRow.classList.add("ws-drag"); });
    composeRow.addEventListener("dragleave", () => composeRow.classList.remove("ws-drag"));
    composeRow.addEventListener("drop", (e) => {
      e.preventDefault(); composeRow.classList.remove("ws-drag");
      const files = e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : [];
      wsAttachImageFiles(p, files);
    });

    // _liveNode: the currently-rendered live-streaming-text DOM node, if any (set by paintPane,
    // read+updated directly by onPayload's assistant_delta handler — see there for why).
    // _txRef/_turnCache/_domLead back the incremental transcript renderer (renderTranscriptInto):
    // the transcript array last rendered, a cache of finalized-turn container nodes, and the
    // leading (show-earlier button + finalized) nodes currently in the DOM (untouched-prefix fast path).
    // "Read at your own pace" for the transcript: wrap it in the shared stick-to-bottom controller
    // (pill + blink + near-bottom follow). transcriptEl is already a child of paneRoot here, so the
    // controller can insert its relative wrapper in place around it.
    const stick = attachStickController(transcriptEl, { wrapClass: "stick-wrap-ws" });
    stick.dockMode(sendWrap, "stick-mode--dock");   // move the Live/Held bulb from the transcript to just above Send (doesn't obstruct text)
    paneUI.set(p.id, { root: paneRoot, transcriptEl, stick, promptEl, repoSel, wtSel, modeSel, modelSel, effortSel, fastModeLabel, fastModeCb, usageEl: badge, dot, sendBtn, stopBtn, attachBtn, savedBadge, bgBadge, imgPreviewWrap, imgErr, identityLabel, activityLine, activityLog, _bmPop: bmPop, _liveNode: null, _liveTextNode: null, _liveRAF: 0, _txRef: null, _turnCache: null, _domLead: [], _showEarlierNode: null });
    if (p.draft) { promptEl.value = p.draft; wsAutoResizePrompt(promptEl); }   // restore the saved compose draft after a view switch / reload
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

  // Coalesce repaints. paintPane() rebuilds a pane's ENTIRE transcript DOM (~30ms for a long
  // conversation — measured). During an active agentic turn the server streams many events a
  // second (tool_use, tool_result, assistant, result); calling paintPane synchronously on each
  // (see onPayload) means several full rebuilds per second, saturating the single JS main thread
  // badly enough to visibly lag typing anywhere on the page — the reported bug, and the part
  // 0.9.31's delta-only fix didn't cover (it removed the per-CHUNK repaints but left the
  // per-EVENT ones). schedulePaint() marks a pane dirty and flushes at most ONCE per animation
  // frame, so a burst of N events in a frame collapses to one rebuild and the main thread stays
  // free between frames for input. User-driven actions (send, control changes) still call
  // paintPane directly for instant feedback — only the high-frequency stream path is coalesced.
  let _paintDirty = new Set();
  let _paintRAF = 0;
  function flushPaints() {
    _paintRAF = 0;
    const ids = _paintDirty; _paintDirty = new Set();
    // A throw in one pane's paint must NOT abort the loop (the other panes would go stale) nor bubble out
    // of the rAF and freeze every future scheduled paint (a stuck-until-reload symptom). Isolate + log each.
    for (const id of ids) { const pane = st.panes.find((x) => x.id === id); if (pane) { try { paintPane(pane); } catch (e) { console.error("paintPane failed", e); } } }
  }
  function schedulePaint(p) {
    _paintDirty.add(p.id);
    if (_paintRAF) return;
    _paintRAF = (window.requestAnimationFrame || ((fn) => setTimeout(fn, 16)))(flushPaints);
  }
  // The live-streaming preview shows only the TAIL of the in-progress reply, not the whole thing.
  // A long reply (agent replies are often 50–150KB) in ONE `pre-wrap` text node is expensive to
  // lay out (~7ms for 120KB, measured) — and any forced layout re-triggers it: e.g. typing in a
  // SECOND pane reads that pane's textarea height, which flushes the whole document's layout and
  // re-lays-out the giant node on EVERY keystroke (the "2 panes lag but 1 doesn't" report). Bound
  // the rendered node to WS_LIVE_TAIL_CHARS so its layout stays cheap regardless of reply length;
  // the COMPLETE text still lands as a normal transcript entry the moment the turn's real
  // "assistant" event arrives and replaces this preview.
  const WS_LIVE_TAIL_CHARS = 6000;
  const liveTail = (s) => (s && s.length > WS_LIVE_TAIL_CHARS ? "…" + s.slice(-WS_LIVE_TAIL_CHARS) : (s || ""));
  const _raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
  // Update the live node's (capped) text AND keep the transcript pinned to bottom — both at most
  // ONCE per animation frame, not once per streamed chunk. Per-chunk work is then just an O(1)
  // string append to `p._liveText` + scheduling this; the (bounded) text set + the one forced
  // layout happen per frame. `_liveRAF` guards against more than one scheduled flush per frame.
  function scheduleLiveRender(ui, p) {
    if (ui._liveRAF) return;
    ui._liveRAF = _raf(() => {
      ui._liveRAF = 0;
      const t = ui.transcriptEl; if (!t || !ui._liveNode) return;
      const text = liveTail(p._liveText);
      // Was the reader at the tail BEFORE this frame's text grew the node? Sample first, then apply
      // through the shared controller so a reader scrolled up keeps their spot (and sees the pill).
      const wasNearBottom = ui.stick ? ui.stick.sample() : (t.scrollHeight - t.scrollTop - t.clientHeight < WS_SCROLL_NEAR_BOTTOM_PX);
      if (ui._liveTextNode) ui._liveTextNode.nodeValue = text; else ui._liveNode.textContent = text;
      if (ui.stick) ui.stick.apply(wasNearBottom); else if (wasNearBottom) t.scrollTop = t.scrollHeight;
    });
  }

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
    // Model/effort/fast-mode: rebuilt every paint (cheap — a handful of <option>s), since
    // st.models can arrive/refresh asynchronously well after the pane and its selects exist.
    fillModelSelect(ui.modelSel, p.model);
    fillEffortSelect(ui.effortSel, p);
    const modelInfo = modelInfoFor(p.model);
    ui.fastModeLabel.hidden = !modelInfo?.supportsFastMode;
    ui.fastModeCb.checked = !!p.fastMode;
    const busy = paneBusy(p);
    const deep = p.status === "deepwork";
    ui.dot.classList.toggle("spinning", busy);
    ui.dot.classList.toggle("deepwork", deep);
    ui.dot.title = deep ? "Deep Work — the visible turn ended but Claude is still producing more (a backgrounded task settling)…" : busy ? "Claude is working this turn…" : "Idle";
    // "✓ Saved" shows only when the pane is genuinely at rest AND its latest turn is persisted —
    // never mid-turn (nothing to promise) and never before the first save.
    if (ui.savedBadge) ui.savedBadge.hidden = busy || !p._saved;
    // Busy is a visual-only signal on the Send button (color + label), distinct from `disabled`:
    // the button stays clickable while busy so a prompt typed mid-turn still round-trips to the
    // server's `busy` refusal (see send()), which is what restores the typed text today. Turning
    // it fully unclickable is a bigger behavior change (queuing) that hasn't landed yet.
    // Deep Work gets its own red treatment, layered on top of (not instead of) `busy` — it's the
    // same turn-lock, just flagged as open-ended background activity rather than an ordinary
    // "one moment" foreground turn, so you're never misled into thinking it's actually idle.
    ui.sendBtn.classList.toggle("busy", busy);
    ui.sendBtn.classList.toggle("deepwork", deep);
    // Hidden background work: a workflow / backgrounded task the agent spawned that runs
    // INDEPENDENTLY of the chat turn — so it can be active even while the chat is idle ("free") and
    // you'd otherwise have no idea. A blinking border on the Send button means "work is happening":
    // it pulses in every working state (busy/deep-work) AND when the chat is free but background
    // work is still running — the case you couldn't see before. The button stays a normal "Send"
    // (the chat genuinely IS free — you can talk) but its blinking border says "…and something's
    // still cooking in the background."
    const bg = Array.isArray(p._background) ? p._background : [];
    const bgActive = bg.length > 0;
    ui.sendBtn.classList.toggle("work-pulse", busy || bgActive);
    ui.sendBtn.textContent = deep ? "Deep Work…" : busy ? "Working…" : "Send";
    // The Stop button appears only while the pane is actively working a turn (thinking / deep work /
    // awaiting permission) — it interrupts that turn without ending the conversation.
    if (ui.stopBtn) ui.stopBtn.hidden = !busy || !!p.readonly;
    const bgLine = bgActive ? `⚙ ${bg.length} background ${bg.length === 1 ? "task" : "tasks"} running` + (bg.some((t) => t.description) ? ": " + bg.map((t) => t.description).filter(Boolean).join(", ") : "") : "";
    ui.sendBtn.title = deep
      ? "Claude finished the visible turn but is still doing background work — more output is expected. Sending now will be held until it finishes."
      : busy ? "Claude is still working this turn — sending now will be held until it finishes."
      : bgActive ? (bgLine + " — the chat is free, so you can keep talking; this runs on its own.")
      : "";
    if (ui.bgBadge) { ui.bgBadge.hidden = !bgActive || busy; ui.bgBadge.textContent = bgActive ? `⚙ ${bg.length} background` : ""; ui.bgBadge.title = bgLine; }
    ui.promptEl.disabled = !!p.readonly;
    ui.sendBtn.disabled = !!p.readonly;
    ui.attachBtn.disabled = !!p.readonly;
    ui.promptEl.placeholder = p.readonly ? "Read-only — pick the repo above or Resume from history to continue" : (p.resume ? "Resuming saved session — your next message continues it" : "Message Claude… (Ctrl+Enter)");
    const usg = wsUsageLabel(p.usage, p.contextUsage);
    ui.usageEl.textContent = usg.text || "—";
    ui.usageEl.title = usg.title;
    // paintPane fires on every streamed event during a turn — a full replaceChildren() would
    // otherwise (a) blow away any tool-group a user just expanded (fixed by handing the pane's
    // persisted `_expandedGroups` into renderTranscript) and (b) yank the scroll position back to
    // the bottom even for someone who deliberately scrolled up to read earlier history. Snap to
    // the bottom only when the pane was already there (or is short enough to be there already) —
    // someone actively watching a live response keeps following it either way.
    // A freshly (re)opened conversation should land at the bottom (latest message), even though
    // the pane wasn't scrolled there before — a one-shot flag set where the transcript is replaced.
    const forceBottom = !!p._scrollBottomNext; p._scrollBottomNext = false;
    // Sample the "were they following the tail?" state BEFORE the transcript is re-rendered below.
    // forceBottom (a fresh open/resume, or a just-sent message) overrides it — that lands at the
    // bottom and re-pins, as expected.
    const wasNearBottom = forceBottom || (ui.stick ? ui.stick.sample() : (ui.transcriptEl.scrollHeight - ui.transcriptEl.scrollTop - ui.transcriptEl.clientHeight < WS_SCROLL_NEAR_BOTTOM_PX));
    const hasQueue = p._queue && p._queue.length;
    if (!p.transcript.length && !p._liveText && !hasQueue) {
      ui.transcriptEl.replaceChildren(el("div", { class: "hint" }, [p.repo ? "Send a message — Claude runs in " + shortRepo(p.repo) + " on your machine." : "Pick a repository (dropdown, or the sidebar) to start."]));
      ui._domLead = []; ui._txRef = null; ui._liveNode = null; ui._liveTextNode = null; ui._showEarlierNode = null;   // reset incremental cache (see renderTranscriptInto)
    } else {
      // Trailing extras that always sit AFTER the real turns: the live-typing preview, then any
      // queued (typed-while-busy) messages.
      const tailExtras = [];
      // The live-typing preview — text streamed so far this turn, not yet the authoritative
      // complete line (that replaces it the moment the real "assistant" event lands; see
      // onPayload's assistant_delta handling). The node reference is stashed on `ui` so the
      // assistant_delta handler can update just its textContent directly on every SUBSEQUENT chunk
      // of this turn (O(1)) instead of repainting — see the streaming-lag fix there.
      if (p._liveText) { const liveNode = line("ws-assistant ws-live", [liveTail(p._liveText)]); tailExtras.push(liveNode); ui._liveNode = liveNode; ui._liveTextNode = liveNode.firstChild; }
      else { ui._liveNode = null; ui._liveTextNode = null; }
      // Queued messages — typed while Claude was still working, "frozen in cache" until this
      // turn finishes (see send()/drainQueue()). Rendered distinctly (orange, or pink during
      // "deepwork") so it's obvious these haven't gone out yet, in the order they'll be sent.
      // Several queued at once are shown individually but drainQueue() merges them into ONE prompt.
      const queuedTag = hasQueue && p._queue.length > 1
        ? "queued — will be merged with the other" + (p._queue.length - 1 > 1 ? "s" : "") + " into one message once this turn finishes"
        : "queued — sending once this turn finishes";
      const queuedCls = "ws-user ws-queued" + (p.status === "deepwork" ? " ws-queued-deep" : "");
      if (hasQueue) for (const q of p._queue) {
        const kids = [el("b", {}, ["you  "])];
        // A queued message's images are still local blobs (not yet uploaded/saved) — render
        // straight from their own dataUrl, the same bytes the real send will carry.
        if (q.images && q.images.length) kids.push(el("div", { class: "ws-user-images" }, q.images.map((img) => el("img", { class: "ws-user-image", src: img.dataUrl, alt: "attached image (queued)" }, []))));
        kids.push(q.text, el("span", { class: "ws-queued-tag" }, [queuedTag]));
        tailExtras.push(line(queuedCls, kids));
      }
      renderTranscriptInto(ui, p, tailExtras);
    }
    if (ui.stick) ui.stick.apply(wasNearBottom); else if (wasNearBottom) ui.transcriptEl.scrollTop = ui.transcriptEl.scrollHeight;
    // A forced jump to the bottom (fresh open / view-enter / app-open initial load) can land short if the
    // transcript's layout is still settling (code blocks, wrapping) — re-pin on the next frame so it's truly
    // at the latest message, not a few lines above it.
    if (forceBottom) _raf(() => { const el2 = ui.transcriptEl; if (el2) { if (ui.stick && ui.stick.pin) ui.stick.pin(); else el2.scrollTop = el2.scrollHeight; } });
    syncMobileTabDots();   // keep the mobile tab's status dot in step (cheap; no-op on desktop)
    if (st.isMobile && p.id === st.activeId) syncMobileBar();   // reflect the active pane's busy state in the bottom bar
  }

  function setActive(id) {
    if (st.activeId === id) return;
    st.activeId = id;
    for (const p of st.panes) paneUI.get(p.id)?.root.classList.toggle("on", p.id === id);
    renderSidebar();
    if (st.isMobile) {
      renderMobileTabs(); syncMobileBar();
      // On a phone every pane is in the DOM but CSS-hidden; a pane whose transcript loaded WHILE hidden
      // couldn't scroll (scrollHeight was ~0), so it sits at the top. Now it's the visible one — re-follow the
      // tail so switching to a chat lands on its latest response. Only when it was pinned to the bottom (i.e.
      // the reader hadn't scrolled up in it), so a deliberately-scrolled-up pane keeps its place.
      const ui = paneUI.get(id);
      if (ui && ui.stick) requestAnimationFrame(() => { if (ui.stick.pinned && ui.stick.pin) ui.stick.pin(); });
    }
    saveLayout();
    reportAttach();   // presence follows the active pane's workspace
  }

  // ---- mobile: tabs + drawer (Phase 2) --------------------------------------------
  // 900px, not 760: many large / low-DPI Android phones report a CSS viewport width around 800px
  // even though they're physically phone-sized, so a 760 cutoff left them on the desktop layout.
  const WS_MOBILE_MQ = window.matchMedia ? window.matchMedia("(max-width: 900px), (pointer: coarse) and (max-width: 1180px)") : { matches: false, addEventListener() {} };
  function openDrawer() { root.classList.add("ws-drawer-open"); }
  function closeDrawer() { root.classList.remove("ws-drawer-open"); }
  // One chat box at a time on a phone: a tab per pane (status dot + short label + close), a menu
  // button that opens the repos/history drawer, and a "＋" to add a chat box. CSS shows only the
  // active pane; this strip is how you move between them.
  function renderMobileTabs() {
    const menuBtn = el("button", { class: "ws-mtab-menu", title: "Repositories & history" }, ["☰"]);
    menuBtn.addEventListener("click", openDrawer);
    const tabs = st.panes.map((p) => {
      const label = p.repo ? shortRepo(p.repo) + (p.worktree && p.worktree !== "main" ? "@" + p.worktree : "") : "New chat";
      const busy = paneBusy(p);
      const dotCls = "ws-mtab-dot" + (busy ? " busy" : "") + (p.status === "deepwork" ? " deep" : "");
      const kids = [el("span", { class: dotCls }, []), el("span", { class: "ws-mtab-lbl" }, [label])];
      if (st.panes.length > 1) {
        const x = el("span", { class: "ws-mtab-x", title: "Close this chat box" }, ["×"]);
        x.addEventListener("click", (e) => { e.stopPropagation(); removePaneMobile(p); });
        kids.push(x);
      }
      const t = el("button", { class: "ws-mtab" + (p.id === st.activeId ? " on" : ""), "data-pid": p.id }, kids);
      t.addEventListener("click", () => setActive(p.id));
      return t;
    });
    const addBtn = el("button", { class: "ws-mtab-add", title: "New chat box" }, ["＋"]);
    addBtn.addEventListener("click", addPaneMobile);
    mobileTabs.replaceChildren(menuBtn, el("div", { class: "ws-mtabs-scroll" }, tabs), addBtn);
  }
  // ---- mobile bottom sheets (Stage 2): a slide-up panel reused for the conversations switcher and the
  // active pane's settings. One sheet element; openSheet swaps its title + body. `_sheetReturn` restores
  // any DOM borrowed into the sheet (the pane's live controls) when it closes.
  const sheetBody = el("div", { class: "ws-sheet-body" }, []);
  const sheetTitle = el("span", { class: "ws-sheet-ttl" }, [""]);
  let _sheetReturn = null;
  function openSheet(title, bodyEl) { if (_sheetReturn) { _sheetReturn(); _sheetReturn = null; } sheetTitle.textContent = title; sheetBody.replaceChildren(bodyEl); wsSheet.classList.add("open"); }
  function closeSheet() { wsSheet.classList.remove("open"); if (_sheetReturn) { _sheetReturn(); _sheetReturn = null; } }
  {
    const x = el("button", { class: "ws-sheet-x", type: "button", "aria-label": "Close" }, ["✕"]);
    x.addEventListener("click", closeSheet);
    const back = el("div", { class: "ws-sheet-back" }, []);
    back.addEventListener("click", closeSheet);
    wsSheet.replaceChildren(back, el("div", { class: "ws-sheet-panel" }, [el("div", { class: "ws-sheet-hd" }, [sheetTitle, x]), sheetBody]));
  }
  // The conversations switcher (was the top tab strip) as a sheet: one row per open pane + a "＋ New".
  function convosSheetBody() {
    const rows = st.panes.map((p) => {
      const label = p.repo ? shortRepo(p.repo) + (p.worktree && p.worktree !== "main" ? "@" + p.worktree : "") : "New chat";
      const busy = paneBusy(p);
      const dot = el("span", { class: "ws-mtab-dot" + (busy ? " busy" : "") + (p.status === "deepwork" ? " deep" : "") }, []);
      const row = el("button", { class: "ws-sheet-row" + (p.id === st.activeId ? " --active" : ""), type: "button" }, [dot, el("span", { class: "ws-sheet-row-lbl" }, [label])]);
      row.addEventListener("click", () => { setActive(p.id); closeSheet(); });
      if (st.panes.length > 1) {
        const x = el("span", { class: "ws-sheet-row-x", title: "Close this conversation" }, ["×"]);
        x.addEventListener("click", (e) => { e.stopPropagation(); removePaneMobile(p); openSheet("Conversations", convosSheetBody()); });
        row.appendChild(x);
      }
      return row;
    });
    const addRow = el("button", { class: "ws-sheet-row ws-sheet-add", type: "button" }, ["＋ New conversation"]);
    addRow.addEventListener("click", () => { addPaneMobile(); closeSheet(); });
    return el("div", { class: "ws-sheet-list" }, [...rows, addRow]);
  }
  // The active pane's own controls (repo / worktree / model / effort / mode) — BORROW the live
  // .ws-pane-controls node into the sheet (all its handlers come with it), and put it back on close.
  function openSettingsSheet() {
    const ui = paneUI.get(st.activeId); if (!ui) return;
    const controls = ui.root.querySelector(".ws-pane-controls"); if (!controls) return;
    const extras = ui.root.querySelector(".ws-compose-extras");
    openSheet("Pane settings", controls);
    _sheetReturn = () => { if (extras && extras.parentNode === ui.root) ui.root.insertBefore(controls, extras); else ui.root.appendChild(controls); };
  }
  // Build the mobile bottom control bar ONCE — its buttons act on whatever pane is active at click time.
  function buildMobileBar() {
    const mb = (label, title, fn, cls) => {
      const b = el("button", { class: "ws-mcbtn" + (cls ? " " + cls : ""), type: "button", "aria-label": title, title }, [label]);
      b.addEventListener("click", fn); b.addEventListener("touchend", (e) => { e.preventDefault(); fn(); });   // kill the ghost-tap double-fire
      return b;
    };
    const menuB = mb("☰", "Repositories & history", openDrawer);
    const chatsB = mb("💬", "Conversations — switch, add, or close", () => openSheet("Conversations", convosSheetBody()), "ws-mcbtn-chats");
    const setB = mb("⚙", "Pane settings — repo, worktree, model, effort, mode", openSettingsSheet);
    const attachB = mb("📎", "Attach image", () => { const ui = paneUI.get(st.activeId); if (ui && ui.attachBtn) ui.attachBtn.click(); });
    const bmB = mb("★", "Bookmarked responses — jump to a starred answer", () => wsOpenBookmarkSheet(activePane()), "ws-mcbtn-bm");
    const syncB = mb("↻", "Sync now — re-fetch the latest state (no page reload)", () => { const p = activePane(); if (p && p.sessionKey) wsPost("control", { action: "resync", args: { sessionKey: p.sessionKey, full: !!p._showAllTurns } }); });
    const stopB = mb("■", "Stop the current response (keeps the conversation)", () => { const p = activePane(); if (p && p.sessionKey) wsPost("stop", { sessionKey: p.sessionKey }); }, "ws-mcbtn-stop");
    stopB.hidden = true;
    const sendB = mb("➤", "Send", () => send(activePane()), "ws-mcbtn-send");
    wsMBar._sendB = sendB; wsMBar._stopB = stopB; wsMBar._chatsB = chatsB;
    wsMBar.replaceChildren(menuB, chatsB, setB, attachB, bmB, el("span", { class: "ws-spacer" }, []), syncB, stopB, sendB);
  }
  // Keep the bottom bar's send/stop in step with the active pane, and home that pane's Live/Held bulb in
  // the mode strip (each pane owns its own bulb; only the visible pane's belongs in the shared strip).
  function syncMobileBar() {
    if (!st.isMobile) return;
    if (!wsMBar._sendB) buildMobileBar();
    const p = activePane(); const ui = p && paneUI.get(p.id);
    const busy = p ? paneBusy(p) : false;
    wsMBar._sendB.textContent = p && p.status === "deepwork" ? "🔴" : busy ? "…" : "➤";
    wsMBar._sendB.classList.toggle("busy", busy);
    wsMBar._stopB.hidden = !busy;
    if (wsMBar._chatsB) wsMBar._chatsB.dataset.n = String(st.panes.length);
    if (ui && ui.stick && ui.stick.modeTag && wsModeStrip.firstChild !== ui.stick.modeTag) {
      wsModeStrip.replaceChildren();                       // drop any prior pane's bulb
      ui.stick.dockMode(wsModeStrip, "stick-mode--bar");   // and home the active pane's
    }
  }
  function addPaneMobile() {
    const p = newPane(); st.panes.push(p);
    st.cols = 1; st.rows = st.panes.length;   // on a phone the grid is a flat 1×N — one pane per "tab"
    st.activeId = p.id;
    rebuildGrid(); renderLayoutPicker(); renderMobileTabs(); saveLayout(); reportAttach();
  }
  function removePaneMobile(p) {
    if (st.panes.length <= 1) { clearPane(p); renderMobileTabs(); return; }   // last one: reset, don't remove
    if (paneBusy(p) && !window.confirm("Claude is still working here. Close this chat box and let it finish in the background? The reply is saved — reopen the conversation anytime.")) return;
    endSessions([p.sessionKey]);
    st.panes = st.panes.filter((x) => x !== p);
    st.cols = 1; st.rows = st.panes.length;
    if (!st.panes.some((x) => x.id === st.activeId)) st.activeId = st.panes[0].id;
    rebuildGrid(); renderLayoutPicker(); renderMobileTabs(); saveLayout(); reportAttach();
  }
  // Cheap per-paint update of the tab status dots (busy/deepwork) + active highlight WITHOUT
  // rebuilding the whole strip — so streaming doesn't thrash the tab DOM (or reset its scroll).
  function syncMobileTabDots() {
    if (!st.isMobile) return;
    for (const t of mobileTabs.querySelectorAll(".ws-mtab")) {
      const p = st.panes.find((x) => x.id === t.dataset.pid); if (!p) continue;
      const dot = t.querySelector(".ws-mtab-dot"); if (dot) { const busy = paneBusy(p); dot.classList.toggle("busy", busy); dot.classList.toggle("deep", p.status === "deepwork"); }
      t.classList.toggle("on", p.id === st.activeId);
    }
  }
  function syncMobile() {
    st.isMobile = !!WS_MOBILE_MQ.matches;
    root.classList.toggle("ws-mobile", st.isMobile);
    closeSheet();   // rotating between phone/desktop: never strand a borrowed controls node in a hidden sheet
    if (st.isMobile) { renderMobileTabs(); buildMobileBar(); syncMobileBar(); }
    else closeDrawer();
  }
  WS_MOBILE_MQ.addEventListener("change", syncMobile);
  sideBackdrop.addEventListener("click", closeDrawer);

  function rebuildGrid() {
    closeSheet();   // the settings sheet may have borrowed a pane's controls node — put it back before the panes are rebuilt
    grid.dataset.cols = String(st.cols);
    grid.dataset.rows = String(st.rows);
    grid.style.setProperty("--ws-cols", st.cols);
    grid.style.setProperty("--ws-rows", st.rows);
    paneUI.clear();
    grid.replaceChildren(...st.panes.map(buildPane));
    // A rebuild makes fresh transcript DOM (scrollTop 0), so entering the workspace / a layout change would
    // otherwise leave each conversation scrolled to the TOP. Land at the bottom (latest message) instead.
    for (const p of st.panes) { p._scrollBottomNext = true; paintPane(p); }
    if (st.isMobile) syncMobileBar();   // panes were rebuilt → re-home the active bulb + refresh send/stop
  }

  /** Tell the work machine a session is finished with. Without this a pane that goes away
   *  (trimmed by the grid, or cleared) left its SDK session running there forever, streaming
   *  into a pane that no longer exists. */
  function endSessions(keys) {
    const live = keys.filter(Boolean);
    if (live.length) wsPost("control", { action: "delete", args: { sessionKeys: live } });
  }
  // "deepwork" is a Claude session whose visible turn already ended but whose underlying SDK
  // query is still producing content — a backgrounded Bash/Task settling and the model
  // auto-continuing with no new prompt sent (see claudeSession.mjs's re-arm-from-idle comment).
  // It counts as busy (blocks a same-pane send, keeps the turn-lock), but paints distinctly.
  const paneBusy = (p) => p.status === "thinking" || p.status === "awaiting-permission" || p.status === "deepwork";

  /** × on a pane: end its session and give the pane a clean key, so the next message starts a
   *  genuinely new conversation rather than appending to the one you just cleared. */
  function clearPane(p) {
    // A busy pane no longer LOSES its in-flight reply on close — the work machine lets the turn
    // finish and saves it (see lib/workspace.mjs's graceful delete). So the confirm is reassuring,
    // not a warning: it'll finish in the background and be waiting when you reopen the conversation.
    if (paneBusy(p) && !window.confirm("Claude is still working here. Close the pane and let it finish in the background? The reply is saved to the conversation — reopen it anytime to see the result.")) return;
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
      if (dropped.some(paneBusy) && !window.confirm(`${dropped.filter(paneBusy).length} pane(s) being dropped are still working. Close them and let those turns finish and save in the background?`)) return;
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
    let tok = 0;
    for (const p of st.panes) { tok += (p.usage?.inputTokens || 0) + (p.usage?.outputTokens || 0); }
    usageEl.textContent = `${st.cols}×${st.rows} = ${st.panes.length} pane(s) · ${tok.toLocaleString()} tok`;
  }
  // Compact "5h X% · 7d Y%" badge — full per-model/reset-time breakdown in the tooltip, since a
  // popover for account-wide data used maybe a few times a session isn't worth the extra chrome.
  // "N conversations · M working · K clients" — the live cross-client picture. Hidden when nothing
  // is live and only this terminal is connected (nothing worth showing).
  function renderLiveStats() {
    if (!liveStatsEl) return;
    const live = st.liveSessions.size;
    let working = 0; for (const s of st.liveSessions.values()) if (WS_BUSY_STATUSES.has(s.status)) working++;
    const clients = st.presence.length || 1;
    if (!live && clients <= 1) { liveStatsEl.hidden = true; return; }
    liveStatsEl.hidden = false;
    const conv = `${live} conversation${live === 1 ? "" : "s"}`;
    const work = working ? ` · ${working} working` : "";
    const cli = ` · ${clients} client${clients === 1 ? "" : "s"}`;
    liveStatsEl.replaceChildren(
      el("span", { class: "ws-livestats-dot" + (working ? " on" : "") }, []),
      conv + work + cli,
    );
  }
  function renderUsageLimits() {
    const limits = st.usageLimits;
    if (!limits || !limits.rate_limits_available || !limits.rate_limits) { usageLimitsEl.hidden = true; return; }
    const rl = limits.rate_limits;
    const pct = (w) => (w && typeof w.utilization === "number" ? Math.round(w.utilization) : null);
    const resets = (w) => w?.resets_at ? new Date(w.resets_at).toLocaleString() : null;
    const parts = [];
    if (pct(rl.five_hour) !== null) parts.push(`5h ${pct(rl.five_hour)}%`);
    if (pct(rl.seven_day) !== null) parts.push(`7d ${pct(rl.seven_day)}%`);
    if (!parts.length) { usageLimitsEl.hidden = true; return; }
    usageLimitsEl.hidden = false;
    usageLimitsEl.textContent = parts.join(" · ");
    const detail = [];
    if (pct(rl.five_hour) !== null) detail.push(`5-hour: ${pct(rl.five_hour)}%` + (resets(rl.five_hour) ? `, resets ${resets(rl.five_hour)}` : ""));
    if (pct(rl.seven_day) !== null) detail.push(`7-day: ${pct(rl.seven_day)}%` + (resets(rl.seven_day) ? `, resets ${resets(rl.seven_day)}` : ""));
    if (pct(rl.seven_day_opus) !== null) detail.push(`7-day (Opus): ${pct(rl.seven_day_opus)}%`);
    if (pct(rl.seven_day_sonnet) !== null) detail.push(`7-day (Sonnet): ${pct(rl.seven_day_sonnet)}%`);
    for (const m of rl.model_scoped || []) if (typeof m.utilization === "number") detail.push(`${m.display_name}: ${Math.round(m.utilization)}%`);
    usageLimitsEl.title = "Plan usage limits (experimental)" + (detail.length ? "\n" + detail.join("\n") : "");
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
    // Is this conversation LIVE right now (a session on its workspace, on this machine, across any
    // client)? If so, mark it green — and, if working, note it. `snippet` rows are search results
    // keyed by session, not workspace, so the live-mark only applies to the plain workspace list.
    const liveSession = snippet == null && h.workspaceId ? activeWorkspaceIds().get(h.workspaceId) : null;
    const liveWorking = liveSession && WS_BUSY_STATUSES.has(liveSession.status);
    const openCount = liveSession ? clientsOnWorkspace(h.workspaceId) : 0;
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
    return el("div", { class: "ws-hist-item" + (missing ? " missing-worktree" : "") + (liveSession ? " ws-hist-live" : "") }, [
      el("div", { class: "ws-hist-line1" }, [
        el("span", { class: "ws-hist-label" }, [
          el("b", {}, [label + (h.worktree && h.worktree !== "main" ? "@" + h.worktree : "")]),
          // A green "live" badge on conversations with a session running right now — mirrors the
          // orange "removed worktree" mark, but for "active", with how many chat boxes it's open in.
          liveSession ? el("span", { class: "ws-hist-livebadge" + (liveWorking ? " working" : "") },
            [liveWorking ? "● working" : "● live", ...(openCount > 1 ? [` · ${openCount} open`] : [])]) : "",
        ]),
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
    if (st.isMobile) closeDrawer();   // opening a conversation is "done with the drawer"
  }

  // ---- SSE handling --------------------------------------------------------------
  function onPayload({ kind, sessionKey, data }) {
    // A real (not comment-only) pulse from the server — see the matching server-side comment.
    // No pane state to update here; `WS_ES.onmessage` (below) already stamped `lastStreamMsgAt`
    // for EVERY message including this one, which is this event's entire purpose.
    if (kind === "heartbeat") { wsSelfHeal(); return; }
    if (kind === "presence") { st.presence = Array.isArray(data.connections) ? data.connections : []; renderPresence(); renderLiveStats(); renderHistory(); return; }
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
        // The Ouronet Pact repo is OFF-LIMITS in the Core cockpit — it's only worked via the Pact tab
        // (which uses PACT_REPO directly + the StoicSyntax-skilled agent). Hide it from Core's repo
        // picker + sidebar so a Core pane can't open it unskilled.
        st.repos = flattenRepos(data.tree, "", []).filter((r) => r.localPath !== PACT_REPO);
        if (!st.treeExpanded.size) st.treeExpanded.add(data.tree.name);   // start with the root expanded
        for (const p of st.panes) { const ui = paneUI.get(p.id); if (ui) fillRepoSelect(ui.repoSel, p.repo); }
        renderSidebar();
      }
      if (Array.isArray(data.history)) {
        // Segregate the Ouronet Pact repo out of Core: its conversations are worked only from the Pact
        // workspace, so they never appear in the Core history (matches the repo-picker filter above).
        st.history = data.history.filter((h) => !wsIsPactRow(h, PACT_REPO)); renderHistory();
        // First history payload after boot — now we know which saved keys exist, so restored
        // panes can re-attach without guessing.
        if (bootRestorePending) { bootRestorePending = false; restorePanes(); }
      }
      if (Array.isArray(data.search)) { st.searchResults = data.search.filter((h) => !wsIsPactRow(h, PACT_REPO)); renderHistory(); }
      if (Array.isArray(data.dataSizes)) { st.dataSizes = Object.fromEntries(data.dataSizes.map((d) => [d.repo, d])); renderSidebar(); }
      // The model catalog — ONE global list (see st.models above); a fresh answer replaces it and
      // every pane's selector is repainted so a newly-available model shows up everywhere at once,
      // not just in whichever pane happened to ask.
      if (Array.isArray(data.models) && data.models.length) { st.models = data.models; for (const p of st.panes) paintPane(p); }
      if (Array.isArray(data.sessions)) { setLiveSessions(data.sessions); for (const s of data.sessions) for (const p of panesOf(s.sessionKey)) { p.status = s.status || p.status; if (s.mode) p.mode = s.mode; if (s.usage) p.usage = s.usage; if (s.background) p._background = s.background; paintPane(p); } }
      if (data.session) { upsertLiveSession(data.session); for (const p of panesOf(data.session.sessionKey)) { Object.assign(p, { status: data.session.status ?? p.status, mode: data.session.mode ?? p.mode, usage: data.session.usage ?? p.usage }); if (data.session.background) p._background = data.session.background; paintPane(p); } }
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
        p.transcript = wsBackfillTurnWorkspace(data.transcript || [], data.workspaceId || wsWorkspaceId(data.repo || p.repo, data.worktree || p.worktree));
        p._transcriptTruncated = !!data.transcriptTruncated;   // server sent only the tail — more is fetchable via "Show earlier"
        p._promptOffset = data.promptOffset || 0; p._responseOffset = data.responseOffset || 0;   // absolute P#/R# numbering (counts the un-shipped ones)
        p._expandedGroups = new Set();   // a freshly-(re)opened transcript has no expand state yet
        p._showAllTurns = false;         // a (re)opened conversation starts capped to recent turns
        p._scrollBottomNext = true;      // …and lands at the bottom (latest), not scrolled up
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
      // The turn lock refused this prompt. `_pendingText` set on a target pane here means THIS
      // client's OWN dispatchPrompt() raced: paneBusy() read idle a moment before the server's
      // real status (often "deepwork" — its transition has no client-side optimistic set the way
      // a fresh send() does, only an incoming event, so the window to race it is real) caught up.
      // That's never a genuinely different terminal's send — a pane's `_pendingText` only reflects
      // an attempt THIS browser tab itself made. Previously this just dumped the typed TEXT back
      // into the input box and silently dropped any attached IMAGES — "captured, then handed back
      // to you" instead of "captured and queued", exactly the reported bug. Re-queue it instead,
      // precisely as if paneBusy() had seen this coming in the first place — drainQueue() releases
      // it automatically the instant the turn genuinely ends, same as any other queued message.
      if (data.kind === "busy") {
        for (const p of targets) {
          if (p._pendingText) {
            p._queue = p._queue || [];
            p._queue.push({ text: p._pendingText, images: p._pendingImages || [] });
            p._pendingText = null; p._pendingImages = null;
            paintPane(p);
            logActivity(p, "⏳ Queued — sending once the current turn finishes…");
          } else {
            logActivity(p, "⏳ Still working on the previous turn…");
          }
        }
        note("⏳ " + (data.message || "This workspace is working — wait for the current turn."));
        return;
      }
      // Reconnect catch-up reply (see `resync()` below, and `_resync` server-side): a wholesale
      // replace of this pane's transcript/status/usage with whatever's actually true right now,
      // not one more item to append. Fixes events a disconnected stream silently dropped — the
      // whole reason a resync was requested in the first place.
      if (data.kind === "resync") {
        for (const p of targets) {
          const prevStatus = p.status, prevLen = (p.transcript || []).length;
          if (Array.isArray(data.transcript)) { p.transcript = wsBackfillTurnWorkspace(data.transcript, data.workspaceId || wsWorkspaceId(p.repo, p.worktree)); p._transcriptTruncated = !!data.transcriptTruncated; p._promptOffset = data.promptOffset || 0; p._responseOffset = data.responseOffset || 0;
            // Initial load (this pane was empty until now — the app-open path fills it via resync on `hello`,
            // AFTER the grid was built): land at the bottom (latest), not scrolled up at the top.
            if (prevLen === 0 && p.transcript.length > 0) p._scrollBottomNext = true; }
          if (data.status) p.status = data.status;
          if (data.usage) p.usage = data.usage;
          if (data.mode) p.mode = data.mode;
          p._liveText = "";   // stale relative to whatever actually streamed before the reconnect
          paintPane(p);
          // Only announce a catch-up when the resync ACTUALLY changed something — the periodic idle-active
          // verification (below, in the heartbeat self-heal) resyncs a quiet pane every ~20s, and logging
          // "Reconnected — caught up" on each of those no-op confirmations would spam the activity rail.
          if (p.status !== prevStatus || (p.transcript || []).length !== prevLen) logActivity(p, "↻ Reconnected — caught up", "ws-act-ok");
          // A resync is how a pane recovers when its turn's `result` event was dropped (stream hiccup) —
          // it silently went idle. If a message was queued during that turn, the drain that should have
          // fired on the (lost) result never did, so it'd sit "queued" forever. Release it here now that
          // the true status is known. (No-op if still busy or nothing's queued.)
          drainQueue(p);
          // A bookmark jump to a response that wasn't loaded triggered a full resync (wsScrollToResponse) —
          // now that the whole history has landed, complete the jump.
          if (p._pendingBookmarkScroll != null) { const at = p._pendingBookmarkScroll; p._pendingBookmarkScroll = null; requestAnimationFrame(() => wsScrollToResponse(p, at)); }
        }
        return;
      }
      // Context-window usage is per-conversation — stored on the requesting pane(s) only.
      if (data.kind === "contextUsage") { for (const p of targets) { p.contextUsage = data.usage; paintPane(p); } return; }
      // Plan usage limits are account-wide, not per-conversation (see lib/workspace.mjs
      // _usageLimits) — stored globally so ANY pane's usage display reflects the latest answer,
      // not just whichever pane happened to ask.
      if (data.kind === "usageLimits") { st.usageLimits = data.limits; renderUsageLimits(); return; }
      for (const p of targets) {
        p._lastEventAt = Date.now();   // per-pane activity stamp — the heartbeat self-heal uses it to spot a stuck-busy pane
        // Live typing preview (see lib/claudeSession.mjs's `includePartialMessages`/`stream_event`
        // handling): each chunk just extends a transient, per-pane buffer — never pushed into
        // `p.transcript` itself, so it's never persisted/resynced as real history. Any OTHER event
        // kind means whatever was streaming is now either superseded by the real, complete line
        // (the "assistant" event below) or the turn moved on (a tool call, the end of the turn) —
        // either way the transient buffer's job is done, so every non-delta kind clears it.
        if (data.kind === "assistant_delta") {
          const chunk = data.text || "";
          p._liveText = (p._liveText || "") + chunk;
          // Logged once per turn, not once per chunk — a chunk can arrive many times a second.
          if (!p._streamingStarted) { p._streamingStarted = true; logActivity(p, "▸ Streaming reply…"); }
          // Per chunk: just extend the buffer (O(1) cons-string) and schedule a once-per-frame
          // render of its capped TAIL + scroll (scheduleLiveRender). This keeps three separate
          // costs bounded — all of which previously scaled with reply length and lagged typing:
          //  • re-writing the whole growing textContent per chunk was O(n)/chunk ⇒ O(n²);
          //  • forcing scrollHeight layout per chunk;
          //  • the rendered node growing unbounded, so any forced layout (even typing in ANOTHER
          //    pane) re-laid-out a 100KB+ node every keystroke.
          // The FIRST chunk still needs a full paintPane (nothing rendered yet to update).
          const ui = paneUI.get(p.id);
          if (ui && ui._liveNode) scheduleLiveRender(ui, p);
          else paintPane(p);
          continue;
        }
        p._liveText = "";
        if (data.kind === "status") {
          p.status = data.status;
          noteSessionStatus(sessionKey, data.status);   // keep the global live-conversation stats fresh for our own sessions immediately
          // A shared session can go "thinking" because ANOTHER terminal sent the prompt, not this
          // one's own dispatchPrompt() — reset the streaming-logged flag here too, or this pane
          // would never log "Streaming reply…" for a turn it didn't itself start. "deepwork" is
          // the same kind of fresh burst (a backgrounded task settling) and deserves the same
          // reset, or its own live-typing preview would never get its "Streaming reply…" log line.
          if (data.status === "thinking" || data.status === "deepwork") p._streamingStarted = false;
          const STATUS_TEXT = { thinking: "● Thinking…", "awaiting-permission": "⏸ Waiting for tool permission…", idle: "✓ Idle", ended: "✓ Turn ended", error: "⚠ Errored", deepwork: "🔴 Deep Work — still producing more…" };
          logActivity(p, STATUS_TEXT[data.status] || ("● " + data.status));
          schedulePaint(p); drainQueue(p); continue;
        }
        // Agent-spawned BACKGROUND work (a workflow, a backgrounded task) — runs independently of
        // the chat turn, so it's NOT transcript content and must NOT be pushed as such. It's the
        // one signal that hidden work is happening even while the chat sits idle/free (see
        // claudeSession.mjs). `background` REPLACES the live set; taskStarted/taskDone just narrate.
        if (data.kind === "interrupted") { logActivity(p, "■ Stopped — the response was interrupted; send another message anytime.", "ws-act-ok"); continue; }
        if (data.kind === "background") { p._background = data.tasks || []; schedulePaint(p); continue; }
        if (data.kind === "taskStarted") { if (!data.skipTranscript) logActivity(p, "⚙ Background " + (data.workflowName ? `workflow “${data.workflowName}”` : "task") + " started" + (data.description ? " — " + data.description : ""), "ws-act-ok"); continue; }
        if (data.kind === "taskDone") { if (!data.skipTranscript) logActivity(p, (data.status === "completed" ? "✓" : "⚠") + " Background task " + data.status + (data.summary ? " — " + data.summary : ""), data.status === "completed" ? "ws-act-ok" : "ws-act-err"); continue; }
        // A user turn echoed by the server: this pane sent it (clear the pending buffer) or a
        // shared pane in another terminal did (render it so both windows show the same thread).
        if (data.kind === "user" && data.by && data.by === CONN.id) { p._pendingText = null; p._pendingImages = null; p._scrollBottomNext = true; }   // YOUR own message must scroll into view even if you'd scrolled up (the dead-bottom threshold is strict now)
        // The server refused the prompt outright (bad path, no token, too many images, …) — a
        // rejection, not a "try again shortly" like `busy`, so retrying automatically would just
        // fail the same way again. Restore the typed text AND any attached images (previously
        // only the text came back — the images were silently dropped) so a manual retry, after
        // fixing whatever the error says, has everything to work with again.
        if (data.kind === "error" && p._pendingText) {
          const ui = paneUI.get(p.id);
          if (ui && !ui.promptEl.value) { ui.promptEl.value = p._pendingText; wsAutoResizePrompt(ui.promptEl); }
          if (p._pendingImages && p._pendingImages.length && !(p.attachedImages && p.attachedImages.length)) { p.attachedImages = p._pendingImages; wsPaintAttachment(p); }
          p._pendingText = null; p._pendingImages = null;
        }
        // The turn concludes here, success or failure — stop the spinner even though the
        // server doesn't always follow a result/error with its own "status" event (it stays
        // "thinking" internally between turns). Without this the spinner would only clear on
        // the NEXT status push (e.g. the following turn), which is exactly the stuck-spinner
        // gap this pane icon exists to avoid.
        if ((data.kind === "result" || data.kind === "error") && paneBusy(p)) p.status = "idle";
        // `persisted` (see lib/workspace.mjs _onEvent) means this turn is already durably on disk by
        // the time we see the result — so it's genuinely safe to close the pane / continue this
        // conversation on another machine. `p._saved` drives the "✓ Saved — safe to close" badge
        // (paintPane); it's cleared the moment a new prompt goes out (dispatchPrompt).
        if (data.kind === "result" && data.persisted) p._saved = true;
        if (data.kind === "tool_use") logActivity(p, "🔧 Running: " + (data.tools || []).map((t) => t.name).join(", "));
        else if (data.kind === "tool_result") logActivity(p, "✓ Tool finished — continuing…");
        else if (data.kind === "result") logActivity(p, `✓ Reply complete${data.persisted ? " & saved — safe to close" : ""} — ${(data.usage?.output_tokens || 0)} out tok`, "ws-act-ok");
        else if (data.kind === "error") logActivity(p, "⚠ " + (data.text || data.message || "Unknown error"), "ws-act-err");
        p.transcript.push(data);
        if (data.usageTotal) p.usage = data.usageTotal;
        // Context usage changes every turn — refresh it once a turn actually finishes (not on
        // every streamed chunk, which would spam the control channel for no visible benefit).
        if (data.kind === "result") wsPost("control", { action: "contextUsage", args: { sessionKey: p.sessionKey } });
        schedulePaint(p);
        drainQueue(p);
      }
      setUsageTotal();
    }
  }
  function primeControls() { wsPost("control", { action: "list" }); wsPost("control", { action: "tree" }); wsPost("control", { action: "history", args: {} }); wsPost("control", { action: "dataSizes" }); wsPost("control", { action: "models" }); wsPost("control", { action: "usageLimits" }); }
  // Reconnect catch-up: ask the server for the CURRENT live state of every pane this terminal
  // still has open (see `_resync` in lib/workspace.mjs). Every hop between a real event
  // happening and it reaching this browser — the local SSE fan-out, the tunnel socket, the
  // relay's per-browser fan-out — is fire-and-forget with no backlog, so a client that was
  // disconnected for even one event's duration loses it silently and permanently. This is the
  // fix: don't try to replay what was missed, just ask what's true right now.
  // Recover a pane whose stream events were dropped (mobile NAT / relay hiccup): a stuck-"Working…" pane whose
  // end-of-turn we missed, OR an idle-LOOKING pane that's secretly still in deepwork / whose reply never
  // rendered ("round looks done but nothing showed up"). Ask the server for the truth. Driven by BOTH the 25s
  // heartbeat AND a fast ~4s local timer (WS_HEAL_TIMER), throttled per-pane to ~8s, so a dropped reply
  // surfaces in ~8s instead of up to ~25s. `full` preserves a fully-revealed pane (see resyncOpenPanes).
  function wsSelfHeal() {
    if (VIEW !== "workspace") return;
    const now = Date.now();
    for (const p of st.panes) {
      if (!p.sessionKey || p.readonly) continue;
      const args = { sessionKey: p.sessionKey, full: !!p._showAllTurns };
      // Busy but silent: keep the longer 20s threshold — a pane legitimately mid-thought (before its first
      // token, or between tool calls) can be quiet for a bit, and we don't want to resync it every few seconds.
      if (paneBusy(p) && (now - (p._lastEventAt || 0)) > WS_HEAL_QUIET_MS && (now - (p._healAt || 0)) > WS_HEAL_QUIET_MS) {
        p._healAt = now;   // throttle so a resync round-trip can't stack
        wsPost("control", { action: "resync", args });
      // Idle-LOOKING but recently active: the fast path. A dropped "result"/reply leaves the pane showing
      // "done" with nothing under it — re-verify every ~8s so it surfaces quickly, not after the 25s heartbeat.
      } else if (!paneBusy(p) && (now - (p._lastEventAt || 0)) < WS_HEAL_ACTIVE_WINDOW_MS && (now - (p._statusSyncAt || 0)) > WS_HEAL_ACTIVE_QUIET_MS) {
        p._statusSyncAt = now;
        wsPost("control", { action: "resync", args });
      }
    }
  }
  function resyncOpenPanes() {
    // Default resync sends only the tail of the transcript (server caps it — see WS_RESYNC_MSG_CAP) so a
    // big conversation shows in a fraction of a second on mobile instead of transferring its whole history.
    // If this pane was already showing the full history ("Show earlier" was clicked), re-request it whole so
    // a reconnect doesn't silently drop the revealed older messages back off the top.
    for (const p of st.panes) if (p.sessionKey && !p.readonly) wsPost("control", { action: "resync", args: { sessionKey: p.sessionKey, full: !!p._showAllTurns } });
  }
  function openStream() {
    try { WS_ES && WS_ES.close(); } catch {}
    // Fast local self-heal — independent of the 25s heartbeat, so a dropped reply surfaces in ~8s even if the
    // stream goes quiet (no heartbeats). Re-armed per stream; cleared first so reopens don't stack timers.
    clearInterval(WS_HEAL_TIMER);
    WS_HEAL_TIMER = setInterval(wsSelfHeal, 4000);
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
  // The actual dispatch — POSTs one prompt (with its own text/images) and handles the round-trip.
  // Split out of send() so a queued item (drainQueue, below) can be dispatched identically once
  // the pane goes idle, not just a prompt typed while already idle.
  async function dispatchPrompt(p, text, images) {
    assignKey(p);
    // Discarded interrupted prompts sitting just above → instruct the agent to skip them ("the next prompt
    // won't include it in its processing"). Core echoes the sent text, so — unlike the Pact chat, where this
    // rides a hidden payload — this note is visible in the next prompt bubble, which also makes the skip explicit.
    const _disc = wsTrailingDiscarded(p);
    let sendText = text;
    if (_disc.length) { const snips = _disc.map((m) => `“${(m.text || "").replace(/\s+/g, " ").slice(0, 70)}”`).join("; "); sendText = `(Please DISREGARD my discarded message(s) above — do not act on ${_disc.length > 1 ? "them" : "it"}: ${snips}. Act only on what follows.)\n\n` + text; }
    // Don't append optimistically. The server echoes the accepted user turn to every terminal
    // (so a SHARED session shows the prompt in both windows), and refuses it with `busy` if a
    // turn is already running — appending here would show a prompt that was never actually sent.
    // `_pendingImages` rides alongside `_pendingText`: if the server's busy refusal DOES land
    // (see onPayload's "busy" handling), both are needed to re-queue this attempt exactly as if
    // paneBusy() had correctly seen it coming — not just the text.
    p._pendingText = text; p._pendingImages = images || [];
    const body = { sessionKey: p.sessionKey, repo: p.repo, worktree: p.worktree, text: sendText, mode: p.mode, by: CONN.id };
    if (images && images.length) body.images = images.map((img) => ({ mediaType: img.mediaType, base64Data: img.base64Data }));
    // Model/effort/fast-mode ride every prompt too — this is what actually applies them for a
    // BRAND NEW session (setModel/setEffort/setFastMode control actions only affect a session
    // that already exists; see lib/workspace.mjs _prompt's model/effort/fastMode handling).
    if (p.model) body.model = p.model;
    if (p.effort) body.effort = p.effort;
    if (p.fastMode) body.fastMode = true;
    if (p.resume) { body.resume = p.resume; p.resume = null; }
    // Optimistic busy: the real "status":"thinking" event confirms this shortly over the stream,
    // but setting it now closes a race — without it, a SECOND queued item could see paneBusy()
    // still false in the brief window before that event arrives and dispatch immediately behind
    // this one instead of waiting its turn.
    p.status = "thinking"; p._streamingStarted = false; p._saved = false; p._lastEventAt = Date.now(); p._scrollBottomNext = true; paintPane(p);   // jump to the bottom on send so you see your message + the Working state
    logActivity(p, "→ Sending your message…");
    const r = await wsPost("prompt", body);
    if (!r.ok) {
      // Couldn't even reach the work machine — restore the text (and any attached images) so
      // nothing is lost.
      if (images && images.length) { p.attachedImages = images; wsPaintAttachment(p); }
      const ui = paneUI.get(p.id);
      if (ui && ui.promptEl.value === "") { ui.promptEl.value = p._pendingText || ""; wsAutoResizePrompt(ui.promptEl); }
      p.draft = ui ? ui.promptEl.value : (p._pendingText || ""); saveDraftsSoon();   // keep the restored text across a view switch too
      p._pendingText = null; p._pendingImages = null;
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
    // Every queued message's images ride along too, in the order they were typed — a merged turn
    // is still just one prompt, so it respects the same WS_IMG_MAX_COUNT cap a single send does.
    const allImages = items.flatMap((i) => i.images || []);
    const images = allImages.slice(0, WS_IMG_MAX_COUNT);
    if (allImages.length > WS_IMG_MAX_COUNT) note(`Only the first ${WS_IMG_MAX_COUNT} images across your queued messages were sent — Claude's own per-message limit.`);
    paintPane(p);
    dispatchPrompt(p, text, images);
  }
  async function send(p) {
    if (p.readonly) return;
    const ui = paneUI.get(p.id); const text = ui.promptEl.value.trim(); if (!text) return;
    if (!p.repo) { note("Pick a repository for this pane first."); return; }
    // Same "clear optimistically, restore on failure" treatment either way — the attached images
    // (if any) are a one-shot per send, never left over for the next message.
    const attachedImages = p.attachedImages || [];
    ui.promptEl.value = ""; wsAutoResizePrompt(ui.promptEl); p.attachedImages = []; wsPaintAttachment(p);
    p.draft = ""; saveDraftsSoon();   // the draft was just sent — don't resurrect it on the next view switch
    // While a turn is already running, don't even attempt the round-trip (the server would refuse
    // it with `busy` anyway) — queue it locally instead: shown as its own orange box in the
    // transcript, sent automatically the instant the current turn actually finishes. Mirrors
    // typing ahead in Claude's own desktop app while it's still replying.
    if (paneBusy(p)) {
      p._queue = p._queue || [];
      p._queue.push({ text, images: attachedImages });
      paintPane(p);
      return;
    }
    dispatchPrompt(p, text, attachedImages);
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
  // Shared so the mobile drawer's actions row can trigger the same thing as the desktop toolbar buttons.
  const doNewFolder = () => { const name = window.prompt("New folder name:"); if (name == null) return; const parent = window.prompt("Parent path (blank = root):") || ""; wsPost("control", { action: "newFolder", args: { parent, name } }); };
  const doNewRepo = () => { const name = window.prompt("New repo name (git init):"); if (name == null) return; const parent = window.prompt("Parent path (blank = root):") || ""; wsPost("control", { action: "newRepo", args: { parent, name } }); };
  newFolderBtn.addEventListener("click", doNewFolder);
  newRepoBtn.addEventListener("click", doNewRepo);

  // ---- boot ----------------------------------------------------------------------
  if (!loadLayout()) { st.panes = [newPane()]; st.activeId = st.panes[0].id; }
  // Fold any still-queued (orange) messages into the pane draft on a real unload, so a deploy/reload
  // doesn't lose them — they come back in the compose box. (Core has no outbox; the draft is persisted.)
  WS_PAGEHIDE_FN = () => {
    for (const p of st.panes) {
      if (p._queue && p._queue.length) {
        const q = p._queue.map((x) => x && x.text).filter(Boolean).join("\n\n");
        if (q) p.draft = p.draft ? (p.draft + "\n\n" + q) : q;
        p._queue = null;
      }
    }
    saveLayout();
  };
  if (!WS_PAGEHIDE_HOOKED) { WS_PAGEHIDE_HOOKED = true; window.addEventListener("pagehide", (e) => { if (!e.persisted && typeof WS_PAGEHIDE_FN === "function") { try { WS_PAGEHIDE_FN(); } catch {} } }); }
  defaultModeSel.value = st.defaultMode;   // the picker was built before the saved layout loaded
  renderLayoutPicker(); renderModeToggle(); rebuildGrid(); renderSidebar(); renderHistory(); setUsageTotal();
  openStream();   // primeControls() fires from the hello handler once the stream is subscribed

  root.replaceChildren(
    // ONE controls row: the pane-config controls + the presence/terminals chips share it (presenceBar
    // flexes in-line and only wraps to a new line when genuinely tight), reclaiming the vertical space
    // the old separate presence row wasted. The collapse-header toggle sits here too, so the header can
    // be hidden to gain even more pane height (same control as the Pact toolbar).
    el("div", { class: "ws-toolbar" }, [
      layoutPicker,
      el("label", { class: "ws-trust", title: "The permission mode new panes start in. Each pane can then be switched on its own." }, ["New panes:", defaultModeSel]),
      applyAllBtn,
      presenceBar,
      el("span", { class: "ws-spacer" }, []),
      liveStatsEl, usageEl, usageLimitsEl, newFolderBtn, newRepoBtn, phCollapseBtn("ghost"),
    ]),
    mobileTabs,
    bridgeNote,
    el("div", { class: "ws-body" }, [
      sideBackdrop,
      el("aside", { class: "ws-side" }, [
        (() => { const c = el("button", { class: "ws-drawer-close", title: "Close" }, ["✕ Close"]); c.addEventListener("click", closeDrawer); return c; })(),
        // Mobile-only: New folder / New repo live here (the desktop toolbar that hosts them is hidden on
        // a phone). Same handlers as the toolbar buttons. Hidden on desktop via CSS.
        el("div", { class: "ws-drawer-actions" }, [
          (() => { const b = el("button", { class: "ghost", type: "button" }, ["＋ folder"]); b.addEventListener("click", () => { closeDrawer(); doNewFolder(); }); return b; })(),
          (() => { const b = el("button", { class: "ghost", type: "button" }, ["＋ repo"]); b.addEventListener("click", () => { closeDrawer(); doNewRepo(); }); return b; })(),
        ]),
        modeToggle, sideList, el("div", { class: "ws-side-sep" }, []), histList,
      ]),
      grid,
    ]),
    wsModeStrip,   // mobile-only: the active pane's Live/Held bulb (hidden on desktop via CSS)
    wsMBar,        // mobile-only: the bottom control bar (hidden on desktop via CSS)
    wsSheet,       // mobile-only: the slide-up sheet (conversations / pane settings)
    permHost,
  );
  syncMobile();   // apply the phone layout immediately if we loaded narrow
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
    const keep = el("input", { type: "number", id: "bkKeep", min: "1", max: "3650", value: String(c.keepLast ?? 7),
      style: "width:56px;background:var(--chip);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:5px 7px" });
    const saveBtn = el("button", { class: "ghost" }, ["Save settings"]);

    async function save(patch) {
      const body = { location: loc.value, hour: Number(hour.value), keepLast: Number(keep.value), enabled: toggle.checked, ...patch };
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
        el("div", { style: "display:flex;align-items:center;gap:6px", title: "Retention: how many of the newest archives to keep when you press “Prune” (below). Older ones are deleted." }, [el("span", { class: "was" }, ["keep last"]), keep, el("span", { class: "was" }, ["backups"])]),
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

  // Retention: keep the newest N (the "keep last" setting), delete the rest. Confirms with
  // the exact count first — this permanently removes .tar files.
  async function pruneBackups(btn) {
    let cfg; try { cfg = (await (await fetch("/api/backup/config")).json()).config || {}; } catch { cfg = {}; }
    const keepLast = cfg.keepLast || 7;
    let list; try { list = await (await fetch("/api/backups")).json(); } catch { list = { archives: [] }; }
    const total = (list.archives || []).length;
    const toDelete = Math.max(0, total - keepLast);
    out.style.display = "block";
    if (toDelete === 0) { out.textContent = `Nothing to prune — ${total} archive(s) present, keeping last ${keepLast}.`; return; }
    if (!window.confirm(`Prune backups?\n\nKeep the ${keepLast} newest, delete the ${toDelete} older archive(s). This permanently removes those .tar files and cannot be undone.`)) return;
    btn.disabled = true; const old = btn.textContent; btn.textContent = "… pruning";
    try {
      const r = await (await fetch("/api/backup/prune", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keepLast }) })).json();
      out.textContent = r.ok ? `🧹 Pruned ${r.deleted.length} archive(s), freed ${human(r.freedBytes)}. ${r.remaining} kept.` : "❌ Prune failed: " + (r.message || r.reason || "error");
    } catch (e) { out.textContent = "❌ Prune error: " + e; }
    btn.textContent = old; btn.disabled = false;
    refreshArchives();
  }

  // Delete ONE archive (the per-row 🗑). Locks every archive button while it runs so a
  // delete and a restore can't race over the same folder.
  async function deleteBackup(a) {
    if (!window.confirm(`Delete this backup?\n\n${a.file}\n${a.date} · ${human(a.bytes)}\n\nThis permanently removes the .tar file and cannot be undone.`)) return;
    const all = [...archiveBox.querySelectorAll("button"), backupBtn]; all.forEach((b) => (b.disabled = true));
    out.style.display = "block";
    try {
      const r = await (await fetch(`/api/backup/delete?id=${encodeURIComponent(a.id)}`, { method: "POST" })).json();
      out.textContent = r.ok ? `🗑 Deleted ${a.file}, freed ${human(r.freedBytes)}.` : "❌ Delete failed: " + (r.message || r.reason || "error");
    } catch (e) { out.textContent = "❌ Delete error: " + e; }
    all.forEach((b) => (b.disabled = false));
    refreshArchives();
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
      el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px" }, [
        el("span", { class: "hint", style: "margin:0" }, [`${d.archives.length} archive(s) · ${human(d.totalBytes)} total · ${d.root}`]),
        (() => { const b = el("button", { class: "ghost", title: "Keep the newest N archives (the “keep last” setting above) and delete the rest" }, ["🧹 Prune old backups"]); b.addEventListener("click", () => pruneBackups(b)); return b; })(),
      ]),
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
            el("button", { class: "ghost", title: "Delete this archive permanently", style: "color:#f87171", onclick: () => deleteBackup(a) }, ["🗑 Delete"]),
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
  // Wrap the (wide) table in a horizontal-scroll box so on a phone the TABLE scrolls sideways
  // rather than stretching the whole page pannable — matches the heatmap's own `overflow-x:auto`.
  return el("div", {}, [orgModeToggle(), el("div", { class: "hint" }, ["Every repo placed by its Pantheonic role (row) and organisation (column). Automatons + Constructors cluster in AncientPantheon under the 'shared machines' model."]), el("div", { class: "matrix-wrap" }, [table])]);
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

// Register the service worker (installability + offline fallback; it's network-first, so it never
// serves stale — see sw.js). Best-effort: a browser without SW support, or a refused registration,
// just means no "install" prompt, never a broken page. Only over HTTPS or localhost (SW requirement).
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}

// PWA install. Browsers fire `beforeinstallprompt` when the app is installable — but Chrome SUPPRESSES that
// event for a while right after you uninstall the app (anti-nag), and iOS Safari never fires it at all. So
// the in-app "⬇ Install" button is shown WHENEVER we're not already running as the installed app, and
// clicking it either fires the native dialog (if the event was captured) or shows the manual menu steps —
// so there's always a discoverable way to (re)install.
let DEFERRED_INSTALL_PROMPT = null;
function pwaIsInstalled() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
}
function pwaSyncInstall() {
  const existing = document.getElementById("pwaInstallBtn");
  if (pwaIsInstalled()) { if (existing) existing.remove(); return; }   // already running as the installed app
  if (existing) return;
  const host = document.querySelector("#phIdentity");
  if (!host || !host.parentNode) return;
  const btn = el("button", { id: "pwaInstallBtn", class: "ph-btn --ghost --sm", title: "Install Claudstermind as an app on this device (always runs the latest version)" }, ["⬇ Install"]);
  btn.addEventListener("click", () => pwaDoInstall());
  host.parentNode.insertBefore(btn, host);
}
async function pwaDoInstall() {
  if (DEFERRED_INSTALL_PROMPT) {
    try { DEFERRED_INSTALL_PROMPT.prompt(); await DEFERRED_INSTALL_PROMPT.userChoice; } catch {}
    DEFERRED_INSTALL_PROMPT = null; pwaSyncInstall();
    return;
  }
  // No native prompt available — guide to the manual path (works even when Chrome hides the auto-prompt).
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent || "");
  alert(ios
    ? "To install:\n\n1) Tap the Share button (the box with an ↑).\n2) Choose “Add to Home Screen.”\n\n(The installed app always runs the latest version.)"
    : "To install:\n\n1) Open your browser menu (⋮ / ≡, usually top-right).\n2) Choose “Install app” (or “Add to Home screen”).\n\nIf it isn't listed, your browser may be briefly hiding it after a recent uninstall — reload and try again in a moment. (The installed app always runs the latest version.)");
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); DEFERRED_INSTALL_PROMPT = e; pwaSyncInstall(); });
window.addEventListener("appinstalled", () => { DEFERRED_INSTALL_PROMPT = null; const b = document.getElementById("pwaInstallBtn"); if (b) b.remove(); });
pwaSyncInstall();   // show the button immediately (don't wait for a beforeinstallprompt that Chrome may withhold)

boot();
