// The connection registry — the single authoritative list of which terminals are connected and
// what each is looking at. It lives on the WORK MACHINE, not the relay, because:
//
//   • There are two front doors. A terminal reaches the workspace either through the live site
//     (the relay sees it) or straight through localhost:3001 (the relay has no idea it exists).
//     Only the work machine sees both.
//   • Every blue-green deploy replaces the relay container, resetting anything it held. The work
//     machine stays up across deploys.
//
// So the relay is a SENSOR: it watches its own browsers and reports them up the tunnel via
// merge(). The work machine owns the merged truth and broadcasts it back to everyone.
//
// Time is passed in explicitly (never read from a clock inside) so the whole thing is pure and
// deterministic under test — the same reason the rest of lib/ takes `now` as an argument.

export function createPresence() {
  // id → { id, label, origin, workspaceId, lastSeen }
  const local = new Map();     // connections attached DIRECTLY to this server (localhost + this box)
  let remote = [];             // the most recent set reported by the relay; replaced wholesale

  function add({ id, label = null, origin = "local", workspaceId = null } = {}, now = 0) {
    if (!id) return;
    const prev = local.get(id);
    local.set(id, { id, label: label ?? prev?.label ?? null, origin,
      workspaceId: workspaceId ?? prev?.workspaceId ?? null, lastSeen: now });
  }

  function touch(id, now = 0) { const c = local.get(id); if (c) c.lastSeen = now; }
  function remove(id) { local.delete(id); }

  /** Record which workspace a connection is viewing (or null when it leaves a workspace). */
  function attach(id, workspaceId, now = 0) {
    const c = local.get(id);
    if (!c) return;                       // unknown connection — a no-op, never a crash
    c.workspaceId = workspaceId || null;
    c.lastSeen = now;
  }

  /** Drop connections not seen since `cutoff` — local ones, AND remote ones. The relay normally
   *  self-corrects (each report replaces the whole remote set), but if the tunnel drops silently
   *  the last-reported browsers would otherwise linger forever; ageing them out makes ghosts
   *  disappear on their own. */
  function prune(cutoff) {
    for (const [id, c] of local) if ((c.lastSeen || 0) < cutoff) local.delete(id);
    remote = remote.filter((c) => (c.lastSeen || 0) >= cutoff);
  }

  /** Replace the remote-reported set wholesale. A terminal the relay stops reporting is gone;
   *  local connections are never touched by a remote report. `staleCutoff` drops remote entries
   *  the relay itself flagged as old (defensive — normally the relay only reports live ones). */
  function merge(remoteList = [], now = 0, staleCutoff = -Infinity) {
    remote = (remoteList || [])
      .filter((c) => c && c.id && (c.lastSeen ?? now) >= staleCutoff)
      .map((c) => ({ id: c.id, label: c.label ?? null, origin: c.origin || "relay",
        workspaceId: c.workspaceId ?? null, lastSeen: c.lastSeen ?? now }));
  }

  /** The merged, de-duped connection list. A local entry wins over a remote one of the same id
   *  (the work machine is closer to the truth for a connection it holds directly). */
  function list(now = 0) {
    const byId = new Map();
    for (const c of remote) byId.set(c.id, c);
    for (const c of local.values()) byId.set(c.id, c);   // local overrides remote
    return [...byId.values()].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  }

  /** The connections currently viewing a given workspace. */
  function whoOn(workspaceId, now = 0) {
    return list(now).filter((c) => c.workspaceId === workspaceId);
  }

  /** How many connections are live (local pruned at `cutoff`; remote taken as-is). */
  function count(now = 0, cutoff = -Infinity) {
    return list(now).filter((c) => (c.origin !== "local") || (c.lastSeen || 0) >= cutoff).length;
  }

  return { add, touch, remove, attach, prune, merge, list, whoOn, count,
    // Exposed for the relay's OWN registry, which reports its locals up: the raw local set.
    localList: () => [...local.values()] };
}
