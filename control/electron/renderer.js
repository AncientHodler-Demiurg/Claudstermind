// Renderer for the Claudstermind server-app window. Isolated (no Node) — it only calls window.cm.* from the
// preload bridge. Two tabs: "Claudstermind" (the local stack, pushed from main every few seconds) and "DMP"
// (the satellite app's control plane, pulled on demand while its tab is active). Paints dots/probes and drives
// start/stop/restart through a styled confirm (no native popup, per house style).
"use strict";
const $ = (id) => document.getElementById(id);
let busy = false;        // a control action is in flight — pause the button set + poll churn
let activeTab = "cm";    // which tab owns the header badge + refresh cadence

// ---- shared bits -----------------------------------------------------------
function badge(overall) {
  const b = $("badge"); b.className = "badge " + (overall || "");
  $("badgeTxt").textContent = { up: "UP", degraded: "DEGRADED", failed: "FAILED" }[overall] || "UNKNOWN";
}
// One unit card, control buttons wired to its owning tab's control fn (kind: "cm" | "dmp").
function unitEl(u, kind) {
  const el = document.createElement("div"); el.className = "unit";
  const dotCls = u.state === "up" ? "up" : u.state === "failed" ? "failed" : u.state === "starting" ? "starting" : "";
  el.innerHTML =
    '<div class="row1"><span class="dot ' + dotCls + '"></span>' +
    '<span class="name"></span><span class="pid"></span></div>' +
    '<div class="blurb"></div>' +
    '<div class="uctl">' +
      '<button data-a="start">Start</button><button data-a="restart">Restart</button><button data-a="stop">Stop</button>' +
    '</div>';
  el.querySelector(".name").textContent = u.label;
  el.querySelector(".pid").textContent = u.pid ? "pid " + u.pid : (u.state === "up" ? "" : u.active || "");
  el.querySelector(".blurb").textContent = u.blurb;
  for (const b of el.querySelectorAll(".uctl button")) {
    b.disabled = busy;
    b.addEventListener("click", () => act(b.dataset.a, u.id, u.label, kind));
  }
  return el;
}
const pill = (label, cls, txt) => '<span class="p ' + cls + '"><b>' + label + '</b><span class="d"></span>' + txt + '</span>';
function fmtAge(ms) {
  if (ms == null) return "n/a";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s ago";
  const m = Math.round(s / 60); if (m < 60) return m + "m ago";
  return Math.round(m / 60) + "h ago";
}

// ---- Claudstermind tab -----------------------------------------------------
function paint(s) {
  badge(s.overall);
  const host = $("units"); host.replaceChildren();
  for (const u of s.units) host.appendChild(unitEl(u, "cm"));

  const p = s.probes || {};
  const probe = (label, pr) => {
    const disabled = pr && pr.disabled === true;               // bridge off in config → grey, not an error
    const cls = pr == null || disabled ? "" : pr.ok ? "ok" : "bad";
    const txt = pr == null ? "n/a"
      : disabled ? "off"
      : pr.ok ? (pr.state && pr.state !== "connected" ? pr.state : "ok")
      : (pr.error || (pr.status ? "http " + pr.status : "down"));
    return pill(label, cls, txt);
  };
  const tunnelHint = p.tunnel && p.tunnel.disabled === true
    ? '<span class="p" style="color:var(--dim)">(enable the bridge in the dashboard → Relay)</span>' : "";
  $("probes").innerHTML = probe("dashboard", p.dashboard) + probe("internet", p.internet) +
    probe("tunnel", p.tunnel) + probe("omniroute", p.omniroute) + tunnelHint;

  $("stamp").textContent = "updated " + new Date().toLocaleTimeString();
  for (const b of document.querySelectorAll("#viewCm .actions button")) b.disabled = busy;
}

// ---- DMP tab ---------------------------------------------------------------
function paintDmp(s) {
  badge(s.overall);
  const host = $("dunits"); host.replaceChildren();
  for (const u of s.units) host.appendChild(unitEl(u, "dmp"));

  const main = s.main || {}, remote = s.remote || {};
  const mainTxt = main.ok ? ((main.version ? "v" + main.version + " " : "") + (main.mode || "live")) : (main.error || "down");
  const remoteTxt = remote.state === "unknown" ? "n/a" : remote.ok ? ("remote " + (remote.mode || "?")) : (remote.error || "unreachable");
  const tunnelTxt = s.tunnelOk ? "connected" : (remote.ok ? "down" : "n/a");
  const aiTxt = main.ok ? (main.aiEnabled ? "on" : "off") : "n/a";
  const fresh = s.snapshotAgeMs != null && s.snapshotAgeMs < 20 * 60000;   // <20 min = fresh
  $("dprobes").innerHTML =
    pill("main", main.ok ? "ok" : "bad", mainTxt) +
    pill("tunnel", s.tunnelOk ? "ok" : (remote.ok ? "bad" : ""), tunnelTxt) +
    pill("remote", remote.ok ? "ok" : (remote.state === "unknown" ? "" : "bad"), remoteTxt) +
    pill("snapshot", s.snapshotAgeMs == null ? "" : (fresh ? "ok" : "bad"), fmtAge(s.snapshotAgeMs)) +
    pill("ai (main)", main.ok && main.aiEnabled ? "ok" : "", aiTxt);

  $("dstamp").textContent = "updated " + new Date().toLocaleTimeString();
  for (const b of document.querySelectorAll("#viewDmp .actions button")) b.disabled = busy;
}

async function refresh() { try { paint(await window.cm.status()); } catch (e) { $("badgeTxt").textContent = "app error"; } }
async function refreshDmp() { try { paintDmp(await window.cm.dmpStatus()); } catch (e) { $("badgeTxt").textContent = "app error"; } }

// ---- styled confirm (Promise<boolean>) ----
function confirmBox(title, msg) {
  return new Promise((resolve) => {
    $("cTitle").textContent = title; $("cMsg").textContent = msg; $("scrim").classList.add("show");
    const done = (v) => { $("scrim").classList.remove("show"); $("cGo").onclick = $("cCancel").onclick = null; resolve(v); };
    $("cGo").onclick = () => done(true); $("cCancel").onclick = () => done(false);
  });
}
function toast(t) { const n = $("toast"); n.textContent = t; n.classList.add("show"); setTimeout(() => n.classList.remove("show"), 2200); }

// ---- control (shared by both tabs; `kind` picks the bridge fn + which view to refresh) ----
async function act(action, id, label, kind = "cm") {
  if (busy) return;
  const scope = id ? label : (kind === "dmp" ? "DMP" : "the whole stack");
  if (action !== "start") {   // stop/restart are disruptive
    const warn = action === "stop"
      ? "Stop " + scope + "? Remote/website access stops until it's started again."
      : "Restart " + scope + "? Any in-flight agent turn is interrupted (like a deploy).";
    if (!(await confirmBox((action === "stop" ? "Stop " : "Restart ") + scope, warn))) return;
  }
  busy = true; for (const b of document.querySelectorAll("button")) b.disabled = true;
  try {
    const control = kind === "dmp" ? window.cm.dmpControl : window.cm.control;
    const res = await control(action, id || null);
    const bad = (res || []).filter((r) => !r.ok);
    if (!bad.length) toast(action + " ✓");
    else {
      const needsAuth = bad.some((r) => /auth|password|polkit|permission|interactive/i.test(String(r.stderr || r.error || "")));
      toast(needsAuth ? "Needs privilege — install the polkit rule (see control/README)" : (action + " failed: " + (bad[0].stderr || bad[0].error || "error")).slice(0, 80));
    }
  } catch (e) { toast("control error"); }
  busy = false;
  await (kind === "dmp" ? refreshDmp() : refresh());
}

// ---- tab switching ----
function setTab(t) {
  activeTab = t;
  $("tabCm").classList.toggle("on", t === "cm");
  $("tabDmp").classList.toggle("on", t === "dmp");
  $("viewCm").hidden = t !== "cm";
  $("viewDmp").hidden = t !== "dmp";
  if (t === "cm") refresh(); else refreshDmp();
}
$("tabCm").addEventListener("click", () => setTab("cm"));
$("tabDmp").addEventListener("click", () => setTab("dmp"));

// ---- wiring ----
for (const b of document.querySelectorAll("#viewCm .actions button")) b.addEventListener("click", () => act(b.dataset.act, null, null, "cm"));
for (const b of document.querySelectorAll("#viewDmp .actions button")) b.addEventListener("click", () => act(b.dataset.dact, null, null, "dmp"));
$("refresh").addEventListener("click", refresh);
$("drefresh").addEventListener("click", refreshDmp);

// Main pushes a fresh Claudstermind snapshot every few seconds — paint it only while its tab is active (and not
// mid-control). The DMP tab is pulled on its own light interval while it's the one showing.
if (window.cm.onStatus) window.cm.onStatus((s) => { if (activeTab === "cm" && !busy) paint(s); });
setInterval(() => { if (activeTab === "dmp" && !busy) refreshDmp(); }, 3000);

refresh();
