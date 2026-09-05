# HANDOFF — DMP Control Integration (Claudstermind side)

**Companion to:** `AncientClients/DemiourgosMotionPictures/site/docs/work/deployment-architecture/HANDOFF-mirror-architecture.md`
**Status:** ready to build **in parallel** with the DMP side. No dependency on DMP's code — only on the frozen
interface contract (§11 of the DMP handoff, restated in §4 below).
**Scope:** the Claudstermind half only — the **relay route** for DMP, the **DMP tab** in the Electron control
app, and **deploy (local + remote)**. Nothing in DMP's repo is touched here.

---

## 0. Context (one paragraph)

DMP runs as a Claudstermind-style app: **AncientIntel is the single main** (writable DB + AI), the **VPS is a
thin remote** (relay to the main when it's up; a read-only replica when it's down). DMP builds its own two roles
+ snapshot feed. **Our job** is to make DMP visible/controllable from the Linux app and reachable from the web —
exactly the way Claudstermind's own dashboard/tunnel/deploy already work. We talk to DMP **only** over the
contract in §4 (HTTP `/healthz` + systemd unit names + a version marker). No shared code, no merge step.

---

## 1. What to build

### 1a. Tunnel — how the DMP agent actually built it (reconciled with shipped code)
**We do not route DMP through `brain`** (its OIDC login is wrong for DMP's own auth + a non-ancient collaborator).
As shipped, `dmp-remote` (VPS) is a **transparent reverse-proxy to `DMP_MAIN_URL`** (default `http://127.0.0.1:4002`)
when the main is reachable, and serves its read-only replica when not — **there is no separate `dmp-bridge`
unit.** So the AncientIntel-side units the control tab manages are exactly **`dmp-main.service`** and the
**`dmp-snapshot`** timer/oneshot (see `site/deploy/systemd/`).

**Open ops choice (not built by either side yet):** what `DMP_MAIN_URL` points at so the VPS can reach the NAT'd
main — a dedicated reverse tunnel, or an existing relay. Until that's chosen, `dmp-remote` only works when it can
reach the main URL. **The control tab shows tunnel health as a *derived* signal** (`gatherDmpStatus.tunnelOk`
from the remote's `/healthz.mainReachable`) — no local bridge unit to control.

### 1b. "DMP" tab in the Electron control app (`control/electron/`)
Mirror the existing control-plane UX (`lib/controlPlane.mjs` `gatherStatus` + the renderer's status dots). Add a
tab that shows, with live dots:
- **`dmp-main.service`** — active? + `/healthz` on the main says `ok:true` (probe via the bridge). Show `version`.
- **Tunnel / relay route** — is the DMP public route connected to the main?
- **`dmp-snapshot.timer`** — enabled + last run OK; show snapshot freshness (from the remote's
  `/healthz.snapshotAt`; green if recent, amber if stale).
- **Remote (`dmp-remote.service`)** — reachable at its public URL? show its `/healthz.mode`
  (`relay` vs `readonly`) and `mainReachable`.
- **AI on AncientIntel** — reuse the existing OmniRoute/Claude probes (the "up"-path AI lives on AncientIntel;
  it's not on the VPS).

Model DMP's units the way `lib/controlPlane.mjs` models Claudstermind's (`id/unit/label/blurb/critical`). Suggest
extending/paralleling that module (e.g. a `DMP_SERVICES` list) rather than hardcoding in the renderer, so the
status logic stays testable.

### 1c. Deploy (local + remote) — mirror the admin Deploy section
- **Local (AncientIntel):** restart `dmp-main.service` and the snapshot units; confirm via `/healthz.version`
  flipping to the new `package.json` version (same confirmation pattern Claudstermind uses).
- **Remote (VPS):** build the **remote artifact** and push it, then restart `dmp-remote.service`; confirm via the
  remote's `/healthz.version` flip.
  - **CRITICAL:** the remote artifact must set `DMP_ROLE=remote` and **must exclude** `.secrets/` and the
    writable DB. The remote runs read-only with no AI. (Enforcement is DMP-side too, but the deploy packaging is
    ours — do not ship secrets to the VPS.)
- **Boot-start:** install the DMP systemd units so they start with the OS, exactly like Claudstermind's services.

---

## 2. Guardrails (do NOT)
- Do **not** put any AI credential, OAuth token, or OmniRoute key into the **remote** deploy artifact.
- Do **not** expose DMP's writable main publicly except through the authenticated/tunnelled relay.
- Do **not** re-implement DMP logic here — we only probe/relay/deploy. All DMP behaviour lives in DMP's repo.
- Do **not** block on DMP being finished — build against the stubbed contract (§4) and verify at the end.

---

## 3. Reuse (don't reinvent)
- **Status:** `lib/controlPlane.mjs` (`gatherStatus`, the per-service `{id,unit,label,blurb,critical}` shape,
  the health probes) — extend the pattern for DMP.
- **Deploy UX + version confirmation:** the existing admin Deploy section / deploy-marker mechanism.
- **Tunnel/relay bridge:** the same bridge that serves `brain` — add a DMP route to it.
- **Electron shell:** `control/electron/{main.cjs,renderer.js,index.html,preload.cjs}` — add the tab here.

---

## 4. THE CONTRACT (restated — build against this, not against DMP's code)

Frozen shapes (identical to §11 of the DMP handoff — keep them in sync if either changes):

- **Env:** `DMP_ROLE` = `main` | `remote`; **DMP main port = `4002`** (frozen; DMP's override env is
  `DEMIOURGOS_PORT`, not `PORT`). Relay + tab target `http://127.0.0.1:4002`.
- **`GET /healthz` (both roles) → JSON:**
  `{ role, ok, version, readOnly, aiEnabled, dbOk, mode, snapshotAt, mainReachable }`
  where `mode` is `"live"` on main, `"relay"|"readonly"` on remote; `aiEnabled` is always `false` on remote.
- **Systemd units:** AncientIntel → `dmp-main.service`, `dmp-snapshot.service`, `dmp-snapshot.timer`;
  VPS → `dmp-remote.service`.
- **Version marker:** `package.json` `version`, surfaced at `/healthz.version`; flips after deploy → confirmation.
- **Snapshot feed** is DMP-internal (`POST /internal/snapshot`); we only **read** `snapshotAt` for freshness.

Stub `/healthz` locally to develop the tab before DMP is live.

---

## 5. Build order (see DMP handoff §12) — PARALLEL
- **Phase 0:** contract frozen (this doc + DMP §11). No code.
- **Phase 1 (parallel):** DMP agent builds its half; **we** build §1a–§1c against §4 (stub as needed). No
  cross-waiting.
- **Phase 2 (one joint check):** point the real tab at the real DMP, run the DMP handoff §9 acceptance with
  AncientIntel **on** and **off**, fix any contract drift.

---

## 6. Acceptance (Claudstermind side)
1. The DMP tab shows accurate dots for all §1b items against a live DMP (main + remote).
2. The public `dmp.<domain>` route serves the live main when AncientIntel is up.
3. Local deploy restarts DMP main + snapshot units and confirms via version flip.
4. Remote deploy pushes a **secret-free, `DMP_ROLE=remote`** artifact, restarts `dmp-remote`, confirms via
   version flip.
5. DMP units are boot-started.
6. With AncientIntel off, the tab correctly shows main **down** and the remote in **readonly** mode (proving the
   probes read real state, not assumptions).
