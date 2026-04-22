# State — StoaExplorer

- **Version at close:** `0.5.0` (from `frontend/src/constants/version.ts`, latest changelog entry dated 20.03.2026; backend has no separate version file)
- **Branch / HEAD:** `master` at `29fe515` (clean against `origin/master`); uncommitted: `CLAUDE.md` rewritten this session (see LOG)
- **Open plan:** none — project is in active-feature mode, no formal phase doc
- **Last session (2026-04-22):** rewrote CLAUDE.md (15 KB autonomous-workflow scaffold → 5 KB practical repo doc). Scaffolded this Claudstermind entry. No code changed.
- **Known outstanding:**
  - `CLAUDE.md` rewrite is unstaged — owner to review + commit (no version bump needed; docs-only)
  - `sync.service.ts:76` hardcodes `chainCount: 10`; older README prose says 20 — README is wrong, leave the code alone
  - `START_HEIGHT` is hardcoded at `6357351` in `sync.service.ts` — changing it is a full re-index decision
  - `configuration.ts` default `KADENA_NETWORK_ID` = `stoa` while README example `.env` says `mainnet01` — README example is stale; compose + config.ts are authoritative
  - README also quotes port `3100` / `5450` / `6400` in older copy paths — real ports are `3000` / `5432` / `6379`
- **Drift notes:** Only known drift is the README's stale ports + network ID (above). No manual DB edits reported, no uncommitted source changes pending.
