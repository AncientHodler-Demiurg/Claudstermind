# Claudstermind → Pantheonic architecture — plan

One project, built in waves (TDD where there's logic; the header/admin are DOM+routing). Ships as
release **0.2.0**. Reviewed once at the end, then deployed via the new Deploy button (dogfood).

## Wave 1 — Foundation (tokens, version, data sizes)
- [x] **T1.1 tokens** — `styles.css`: canonical `:root` names (`--ink-soft/--ink-mute/--panel-2/
  --accent-dim/--danger/--radius`), Claudstermind values preserved; alias old names, migrate usages,
  remove aliases. No visual change intended.
- [x] **T1.2 version API** — `GET /api/version` on BOTH servers → `{version, gitSha, builtAt}`
  (version from `package.json`; gitSha from a build stamp / `git rev-parse` fallback). Add to `/api/me`
  or standalone. Bump `package.json` to `0.2.0`.
- [x] **T1.3 CHANGELOG + gate** — root `CHANGELOG.md` (0.2.0 entry); `changelog-version.test.mjs`
  asserts package version === newest changelog entry. `docs/RELEASING.md`.
- [x] **T1.4 per-repo data sizes** — bridge control `dataSizes` → `[{repo, bytes, conversations,
  turns}]` from `.claude/workspace/*.json`; test in `workspace.test.mjs`.

## Wave 2 — The Pantheonic Header
- [x] **T2.1 `.ph` header** — `index.html` + `app.js`: sticky 3-level `.ph`, full-chrome-width
  separator, `.ph-inner` capped at `--maxw`. L1 medallion + version chip (→ changelog) + shared
  identity block (`renderIdentity()` from `/api/me`, `textContent`, ancient-gated Admin link, local-mode
  variant). L2 Tier-1 buttons + one memorable action. L3 fixed Tier-2 zone.
- [x] **T2.2 IA + routing** — map current views into Tier-1 (Overview/Map/Activity/Pipeline/Brain/
  Workspace) + Tier-2 (Map→org×role/graph/movements/tree/packages; Pipeline→cascade/git). URL is the
  source of truth: parse hash on load + `hashchange`; header buttons navigate; remove the old flat nav.
- [x] **T2.3 width shell** — `.shell`/`--maxw:1536`; Workspace opts out (documented full-width class,
  the sanctioned exception).

## Wave 3 — Admin surface
- [x] **T3.1 AdminGate** — four states from `/api/me` (checking/signed-out/not-ancient/ancient);
  `[hidden]`-wins guards. Local mode = ancient.
- [x] **T3.2 sidebar + pane** — `#admin` unselected prompt; `#admin/<section>` renders; static
  section-config `{id,icon,label,hash,enabled}`; active highlight; ≤820px → chip row.
- [x] **T3.3 move sections in** — Ops, Relay, Tokens become admin sections (reuse existing view fns);
  drop them from the header. Server mutations already re-gate.

## Wave 4 — Deploy & Version
- [x] **T4.1 deploy orchestration** — local `POST /api/deploy` (tar→scp→ssh rebuild relay-only,
  rollback tag, health-check, verify `/api/version`) + `GET /api/deploy/stream` (SSE log spool).
  Ancient/local-gated. Extract the steps from the manual flow into a `lib/deploy.mjs` (testable).
- [~] **T4.2 tunnel trigger (DEFERRED — deploy/release are local-only; live panel is read-only)** — live Admin Deploy → `WS_IN deploy` → local dashboard executes; log
  streams back over the workspace SSE. Refuse when the bridge is down.
- [x] **T4.3 release controls** — bump patch/minor/major writes `package.json` + CHANGELOG top entry
  (ancient/local); re-runs the gate.
- [x] **T4.4 Deploy & Version section** — Live vs Pending (both `/api/version`), diff hint, release
  buttons, Deploy button (lit when Pending≠Live), streamed log terminal.

## Wave 5 — Per-repo data in the Workspace
- [x] **T5.1** — request `dataSizes` on load; badge in the sidebar (Repositories org groups + Tree
  repo rows): `1.4 MB · 12 conv`.

## Wave 6 — Verify, review, ship
- [x] **T6.1** full `node --test` green; conformance checklist (§7) walked.
- [x] **T6.2** browser-verify locally (forged ancient): header 3 levels + version chip + identity;
  Tier-1/Tier-2 routing + deep links + Back; admin gate + sidebar + sections; deploy dry-run;
  per-repo badges; Workspace still full-width.
- [x] **T6.3** adversarial review pass → clean.
- [x] **T6.4** dogfood: cut 0.2.0 (bump+changelog) and **deploy via the new button**; verify live.

## Verification gate
- [x] Pantheonic conformance checklist (§7) satisfied (Workspace width exception documented).
- [x] Version gate test green; `/api/version` live == 0.2.0 after the button deploy.
- [x] Admin holds Ops/Relay/Tokens/Deploy; header slN; every view deep-linkable.
