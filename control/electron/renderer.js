// Renderer for the Claudstermind server-app window. Isolated (no Node) — it only calls window.cm.* from the
// preload bridge. Polls status every few seconds, paints the dots/probes, and drives the start/stop/restart
// buttons through a styled confirm (no native popup, per house style).
"use strict";
const $ = (id) => document.getElementById(id);
let busy = false;   // a control action is in flight — pause the button set + poll churn

function paint(s) {
  // Overall badge
  const badge = $("badge"); badge.className = "badge " + (s.overall || "");
  $("badgeTxt").textContent = { up: "UP", degraded: "DEGRADED", failed: "FAILED" }[s.overall] || "UNKNOWN";

  // Units
  const host = $("units"); host.replaceChildren();
  for (const u of s.units) {
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
      b.addEventListener("click", () => act(b.dataset.a, u.id, u.label));
    }
    host.appendChild(el);
  }

  // Probes
  const p = s.probes || {};
  const probe = (label, pr) => {
    const cls = pr == null ? "" : pr.ok ? "ok" : "bad";
    const txt = pr == null ? "n/a" : pr.ok ? "ok" : (pr.error || (pr.status ? "http " + pr.status : "down"));
    return '<span class="p ' + cls + '"><b>' + label + '</b><span class="d"></span>' + txt + '</span>';
  };
  $("probes").innerHTML = probe("dashboard", p.dashboard) + probe("internet", p.internet) +
    probe("tunnel", p.tunnel) + (p.tunnel == null ? '<span class="p" style="color:var(--dim)">(set CM_RELAY_URL)</span>' : "");

  $("stamp").textContent = "updated " + new Date().toLocaleTimeString();
  for (const b of document.querySelectorAll(".actions button")) b.disabled = busy;
}

async function refresh() {
  try { paint(await window.cm.status()); }
  catch (e) { $("badgeTxt").textContent = "app error"; }
}

// ---- styled confirm (Promise<boolean>) ----
function confirmBox(title, msg) {
  return new Promise((resolve) => {
    $("cTitle").textContent = title; $("cMsg").textContent = msg; $("scrim").classList.add("show");
    const done = (v) => { $("scrim").classList.remove("show"); $("cGo").onclick = $("cCancel").onclick = null; resolve(v); };
    $("cGo").onclick = () => done(true); $("cCancel").onclick = () => done(false);
  });
}
function toast(t) { const n = $("toast"); n.textContent = t; n.classList.add("show"); setTimeout(() => n.classList.remove("show"), 2200); }

async function act(action, id, label) {
  if (busy) return;
  const scope = id ? label : "the whole stack";
  // Stop/restart are disruptive; restarting the engine interrupts any in-flight agent turn (same as a deploy).
  if (action !== "start") {
    const warn = action === "stop"
      ? "Stop " + scope + "? Remote/website access stops until it's started again."
      : "Restart " + scope + "? Any in-flight agent turn is interrupted (like a deploy).";
    if (!(await confirmBox((action === "stop" ? "Stop " : "Restart ") + scope, warn))) return;
  }
  busy = true; for (const b of document.querySelectorAll("button")) b.disabled = true;
  try {
    const res = await window.cm.control(action, id || null);
    const bad = (res || []).filter((r) => !r.ok);
    if (!bad.length) toast(action + " ✓");
    else {
      const needsAuth = bad.some((r) => /auth|password|polkit|permission|interactive/i.test(String(r.stderr || r.error || "")));
      toast(needsAuth ? "Needs privilege — install the polkit rule (see control/README)" : (action + " failed: " + (bad[0].stderr || bad[0].error || "error")).slice(0, 80));
    }
  } catch (e) { toast("control error"); }
  busy = false;
  await refresh();
}

for (const b of document.querySelectorAll(".actions button")) b.addEventListener("click", () => act(b.dataset.act, null));
$("refresh").addEventListener("click", refresh);
// Main pushes a fresh snapshot every few seconds; paint those (unless a control action is mid-flight). Also
// do one immediate invoke so the window has content the instant it opens, before the next push lands.
if (window.cm.onStatus) window.cm.onStatus((s) => { if (!busy) paint(s); });
refresh();
