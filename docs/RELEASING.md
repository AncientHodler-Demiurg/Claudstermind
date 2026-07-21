# Releasing Claudstermind

`package.json` `version` is the single source of truth (shown in the header medallion and returned by
`GET /api/version`). Every bump ships a matching `CHANGELOG.md` entry in the same commit — the
`lib/version.test.mjs` gate fails otherwise.

## From the Admin → Deploy & Version panel (the normal path)
1. Pick a bump — **patch / minor / major**. It writes the new `package.json` version and a new
   `CHANGELOG.md` top entry from the summary you type.
2. Review the diff (Live vs Pending updates).
3. Click **Deploy**. The local dashboard tars the build, ships it to StoaNodePrime, rebuilds the
   `relay` container (rollback image tagged first), health-checks, and verifies the new
   `/api/version`. The log streams live.

## By hand (fallback)
1. Edit `package.json` `version` and add a `## [x.y.z] - YYYY-MM-DD` entry at the top of `CHANGELOG.md`.
2. `node --test` (the gate is part of the suite).
3. Commit both together, then deploy (see `relay/DEPLOY.md` for the manual box steps).

## Semver
- **patch** — fixes, no behaviour change users must know about.
- **minor** — new features, backward-compatible.
- **major** — breaking changes to how the dashboard/relay behave.

## The build stamp
The image bakes `CM_VERSION`, `CM_GIT_SHA`, `CM_BUILT_AT` (Dockerfile build args). The deploy passes
them so the live `/api/version` reports exactly what was shipped — that's how the Deploy panel knows
Live vs Pending.
