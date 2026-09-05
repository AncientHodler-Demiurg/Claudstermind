// lib/deployProcesses.mjs — pure helpers for the deploy admin "what's running" panel.
//
// All the actual I/O (spawning `systemctl` / `pgrep`, running `git`, calling the aggregator) lives
// in dashboard/server.mjs's /api/admin/processes route. These functions only PARSE and SHAPE those
// results into the process entries the client renders, so they're fully unit-testable with no
// process/socket/disk access. They also degrade gracefully — the sessiond daemon unit is NOT
// installed on the live box today, so "not installed" is a first-class, non-error outcome.

/** A process entry's status. running = up; stopped = installed but not active; not-installed =
 *  the unit/binary isn't there (fine — agents run in-process); unknown = couldn't determine. */
export const PROC_STATUS = Object.freeze({
  RUNNING: "running",
  STOPPED: "stopped",
  NOT_INSTALLED: "not-installed",
  UNKNOWN: "unknown",
});

/** Parse `k=v` newline output (e.g. `systemctl show -p LoadState -p ActiveState -p SubState`). */
export function parseKeyVals(stdout) {
  const out = {};
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

/**
 * Shape the `claudstermind-sessiond` daemon's process entry from whichever probe succeeded.
 *
 * @param {object} p
 * @param {boolean} p.systemctlOk — did `systemctl show` run successfully (systemd present)?
 * @param {string}  p.show        — its stdout (LoadState/ActiveState/SubState `k=v` lines).
 * @param {boolean|null} p.pgrepRunning — fallback when systemd is absent: is a sessiond process
 *        running (via pgrep)? `null` = pgrep also unavailable/unrun.
 */
export function sessiondProcess({ systemctlOk = false, show = "", pgrepRunning = null } = {}) {
  // `core: true` marks a Claudstermind CORE process (the web service + this daemon) — the two the
  // "Running locally" tab always shows, even when stopped / not installed, so the daemon row is never
  // hidden behind the collapse. Everything else (aggregator/localhost apps) is a non-core "other".
  const base = { key: "sessiond", name: "claudstermind-sessiond", role: "agent engine (survives a web restart)", core: true };
  if (systemctlOk) {
    const kv = parseKeyVals(show);
    const installed = kv.LoadState === "loaded";
    const active = kv.ActiveState || "";
    const sub = kv.SubState || "";
    if (!installed) {
      return { ...base, status: PROC_STATUS.NOT_INSTALLED, source: "systemctl",
        detail: "unit not installed — agents run in-process (daemon is optional until enabled)" };
    }
    if (active === "active") {
      return { ...base, status: PROC_STATUS.RUNNING, source: "systemctl", detail: `active (${sub || "running"})` };
    }
    return { ...base, status: PROC_STATUS.STOPPED, source: "systemctl",
      detail: `installed but ${active || "inactive"}${sub ? " · " + sub : ""}` };
  }
  // systemd absent / systemctl missing → best-effort pgrep.
  if (pgrepRunning === true) {
    return { ...base, status: PROC_STATUS.RUNNING, source: "pgrep", detail: "running (detected via pgrep; no systemd unit)" };
  }
  if (pgrepRunning === false) {
    return { ...base, status: PROC_STATUS.NOT_INSTALLED, source: "pgrep",
      detail: "not running and no systemd unit — agents run in-process" };
  }
  return { ...base, status: PROC_STATUS.UNKNOWN, source: "none", detail: "could not determine (no systemd, no pgrep)" };
}

/** The web process's own entry — it's always the process answering this request. */
export function webProcess({ version = null } = {}) {
  return {
    key: "web",
    name: "claudstermind (web)",
    role: "dashboard + relay bridge",
    status: PROC_STATUS.RUNNING,
    source: "self",
    core: true,   // a Claudstermind CORE process — always shown in "Running locally" (see sessiondProcess).
    detail: version ? `v${version} · this process` : "this process",
  };
}

/**
 * Map the aggregator's managed localhost apps to process entries. `projects` is registryProjects()
 * output (`{ key, name, port, group, managed }`); `liveProjects` is the aggregator's own
 * `/api/status` `.projects` (each `{ key, up }`), or `null` when the aggregator is down.
 */
export function localhostProcesses(projects, liveProjects) {
  const live = new Map((liveProjects || []).map((p) => [p.key, p]));
  const aggregatorDown = liveProjects == null;
  return (projects || []).map((p) => {
    const st = live.get(p.key) || {};
    const up = !!st.up;
    let status;
    if (aggregatorDown) status = PROC_STATUS.UNKNOWN;
    else status = up ? PROC_STATUS.RUNNING : PROC_STATUS.STOPPED;
    return {
      key: "app:" + p.key,
      name: p.name || p.key,
      role: "localhost app" + (p.group ? ` · ${p.group}` : ""),
      status,
      source: "aggregator",
      detail: aggregatorDown ? `:${p.port} · aggregator offline` : `:${p.port}${up ? "" : " · stopped"}`,
      // Claudstermind-related localhost apps (e.g. the Claudstermind Dashboard) are prioritized too —
      // shown in CORE with the web service + daemon, not hidden in the collapsed "others" group.
      core: /claudstermind/i.test(p.name || p.key) || undefined,
    };
  });
}

/**
 * Resolve the changed-file list a deploy would ship. Prefers a real diff against the LIVE build's
 * commit (`git diff --name-only <liveSha>..HEAD`); falls back to uncommitted working-tree changes
 * (`git status --porcelain`) when the live sha is unknown/unreachable or the diff couldn't run.
 *
 * @param {{ diffOut: string|null, porcelainOut: string }} args — `diffOut` is `null` when the diff
 *   command failed (so we fall back); an empty string means it ran and there were no changes.
 * @returns {string[]}
 */
export function changedFilesFromGit({ diffOut = null, porcelainOut = "" } = {}) {
  // UNION of committed changes (the `git diff <liveSha>..HEAD` lines) AND working-tree changes (porcelain).
  // Both matter for "will the running process be stale after it reloads the ON-DISK code": a reload loads the
  // working tree directly, and this repo's deploys ship it too — so an UNCOMMITTED edit to an engine file must
  // still count. (The old code returned early on a non-null `diffOut`, and `deployChangedFiles` passes `""` — not
  // null — for an empty committed diff, so any uncommitted engine change was silently dropped and sessiond was
  // never restarted. That's the "I reloaded but the engine kept running old code" bug.)
  const set = new Set();
  if (diffOut != null) {
    for (const s of String(diffOut).split(/\r?\n/)) { const t = s.trim(); if (t) set.add(t); }
  }
  for (const raw of String(porcelainOut || "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    // porcelain: `XY <path>` or `XY <old> -> <new>` for renames. Path starts at column 3.
    let p = raw.slice(3).trim();
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) p = p.slice(arrow + 4);
    p = p.replace(/^"(.*)"$/, "$1"); // porcelain quotes paths with odd chars
    if (p) set.add(p);
  }
  return [...set];
}
