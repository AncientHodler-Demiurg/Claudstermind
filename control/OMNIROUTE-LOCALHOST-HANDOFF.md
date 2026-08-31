# Handoff: add an OmniRoute Start/Stop button to the LocalHost aggregator

**To:** whoever maintains the **LocalHost aggregator** repo (the `server.mjs` that lives beside Claudstermind and renders the LocalHost panel).
**From:** Claudstermind.
**Goal:** show OmniRoute in the LocalHost panel with a health dot and **Start / Stop / Restart** buttons — same as any project, but backed by a systemd service instead of a spawned dev server.

---

## What OmniRoute is now (already done on the work machine)

OmniRoute is installed as a **systemd system service** — you don't spawn it, you just drive systemd:

| Fact | Value |
|---|---|
| Unit | `omniroute.service` (`/etc/systemd/system/omniroute.service`) |
| Runs as | `User=ancientbox`, `Restart=on-failure`, `WantedBy=multi-user.target` (auto-starts on boot) |
| Launcher | `ExecStart=/home/ancientbox/omniroute-app/start-omniroute.sh` (isolated Node 22, loopback bind) |
| Listens | `http://127.0.0.1:20128` (loopback only — not the LAN) |
| Health | `GET http://127.0.0.1:20128/api/health` → `{"status":"ok",...}` when serving |
| Data dir | `~/.omniroute` (providers/keys/settings persist here) |

**Privilege is already handled.** A polkit rule (`/etc/polkit-1/rules.d/49-claudstermind.rules`) lets the `ancientbox` user `start`/`stop`/`restart` **`omniroute.service`** with **no password**. So your action handlers can call `systemctl` directly — no `sudo`, no prompt.

---

## The integration (in the LocalHost aggregator repo)

Treat OmniRoute as a **managed-service entry** (not a port-spawned project). Suggested `key`: `"omniroute"`.

### Status (for the dot)
Prefer the HTTP health probe — green means *online AND serving*, which is stronger than "systemd active":
```js
// GET http://127.0.0.1:20128/api/health, 3s timeout, never throw
async function omnirouteStatus() {
  try {
    const r = await fetch("http://127.0.0.1:20128/api/health", { signal: AbortSignal.timeout(3000) });
    if (r.ok) { const j = await r.json(); return { up: j?.status === "ok", detail: "serving" }; }
    return { up: false, detail: "http " + r.status };
  } catch {
    // not serving — fall back to systemd so you can tell "stopped" from "starting/crashed"
    const sub = runOut("systemctl", ["is-active", "omniroute.service"]).trim(); // active|inactive|failed|activating
    return { up: false, detail: sub };
  }
}
```

### Actions (Start / Stop / Restart)
```js
function omnirouteAction(action) {           // action ∈ start|stop|restart
  if (!["start","stop","restart"].includes(action)) return { ok:false, message:"bad action" };
  const r = spawnSync("systemctl", [action, "omniroute.service"], { encoding:"utf8", timeout:30000 });
  return { ok: r.status === 0, code: r.status, stderr: (r.stderr||"").trim() };
}
```
No `sudo` needed thanks to the polkit rule. (If you ever run the aggregator as a *different* user than `ancientbox`, add that user to the polkit rule.)

### Wiring into your existing project list / action dispatch
Your `/api/status` should include an `omniroute` entry (key `"omniroute"`, `url` `http://localhost:20128`, `running` from `omnirouteStatus().up`), and your `/api/start|stop|restart` POST handlers should, when `key === "omniroute"`, call `omnirouteAction(action)` instead of the usual spawn/kill path.

That's the whole change — Claudstermind's side (`lhAction`) already forwards `start/stop/restart` with the project `key` to your `/api/<action>` endpoint, so nothing changes on the Claudstermind end.

---

## Working reference

Claudstermind already does exactly this in its own control app — copy the shape from **`lib/controlPlane.mjs`** in the Claudstermind repo:
- `UNITS` includes `{ id:"omniroute", unit:"omniroute.service", critical:false }`.
- `controlUnit(action, unit)` = the guarded `systemctl <action> <unit>` (only managed units allowed).
- `probeHttp("http://127.0.0.1:20128/api/health")` drives the "online AND serving" dot.

So OmniRoute can be operated from **both** the Claudstermind control app *and* the LocalHost panel — whichever is in front of the user. They're both just thin faces over the same `systemctl` + health probe.

---

## Test checklist
- [ ] OmniRoute shows in the LocalHost panel with a green dot when up (`/api/health` ok).
- [ ] **Stop** → dot goes red/grey, `:20128` stops answering.
- [ ] **Start** → dot goes green within ~2s.
- [ ] **Restart** → brief red then green.
- [ ] No password prompt (polkit rule active — `sudo systemctl restart polkit` once if it was just installed).
- [ ] Survives reboot on its own (it's `enabled`), independent of the panel.
