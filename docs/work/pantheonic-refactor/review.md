# Pantheonic refactor — review

Two adversarial lenses over the new surface (backend deploy/release/version; frontend header/admin/
deploy), then a fix loop to clean.

## Backend (security + correctness)
- **[MEDIUM] Deploy could report success on a container that builds but crash-loops at runtime**, and
  the tagged rollback image was never used — a runtime-broken build would take the live relay down and
  be reported `✓`. **Fixed** (lib/deploy.mjs): the box script now polls the Dockerfile HEALTHCHECK for
  ~45s and, on failure, restores `claudstermind-relay:rollback` → `:latest` and re-ups, exiting non-zero.
- Confirmed sound (no change): command-injection defended (only server-controlled version/sha/builtAt
  reach the remote script, double-stripped by `SAFE()`; release `summary` only ever hits a file write,
  never a shell); traversal-safe fixed file paths; `shell:false` arg-array spawns; POST gate correct
  (`/api/deploy` + `/api/release` are LOCAL_ONLY → sameOrigin + localActionsAvailable + canExecute, so
  they can't fire on the live relay or for a non-ancient); deploy concurrency guarded; log capped;
  `readVersion` re-reads live so a release shows immediately.

## Frontend (correctness + robustness + leaks)
- **[LOW] A gated section reached by URL** (e.g. `#workspace` for a non-ancient viewer) reset the view
  but left the address bar + `LAST_MAIN` on the gated hash. **Fixed**: `applyRoute` now `location.replace("#overview")`
  on a failed gate and sets `LAST_MAIN` only for a passing route.
- **[LOW] An invalid sub-id** (`#map/bogus`) rendered the first sub-view but highlighted no L3 button.
  **Fixed**: `applyRoute` normalizes `ROUTE.sub` to the resolved sub id.
- **[LOW] A failed deploy POST** left the just-opened `DEPLOY_ES` streaming. **Fixed**: closed in the
  `!r.ok` branch.
- Confirmed sound: the AdminGate truly blocks (returns before building the pane for a non-ancient live
  viewer); Workspace/action hidden for non-ancient (server `canExecute = ancient`); `DEPLOY_ES`/`WS_ES`
  closed on view-leave; `renderIdentity` uses `textContent` (no XSS from hub name); no dangling refs to
  the removed flat nav.

## Evidence
- `node --test`: **185/185** (adds version-gate, dataSizes, release, deploy tests).
- Browser-verified locally (forged ancient/local): 3-level header + version chip + identity; Tier-1/2
  routing + deep links + Back; admin gate + sidebar + section panes; Deploy panel (Live vs Pending,
  release, deploy button + log); per-repo data badges; existing views render; light/dark tokens resolve.

## Deferred (documented, not defects)
- **Remote deploy trigger over the tunnel** — the deploy/release endpoints are local-only (the local
  dashboard holds the source + SSH); from the live site the panel is a read-only version monitor. A
  tunnel-triggered deploy with streamed logs is a follow-up, alongside **zero-downtime blue-green**
  (v1 does a health-checked recreate with auto-rollback).
