# Claudstermind → Pantheonic architecture — design

Bring the Claudstermind dashboard into conformance with the **Pantheonic Design Architecture**
(`AncientPantheon/websites/Pantheon/docs/pantheonic-architecture/`), add real **versioning**, an
**Admin surface**, a **Deploy button**, and a **per-repo raw-data** readout. Claudstermind is the
overseer dashboard (vanilla-JS Node, like the Pythia design reference) — the design law (§1–7)
applies; the automaton container/codex machinery does not.

## Confirmed decisions
- **Workspace stays full-width** — a documented, sanctioned exception (like the standard's
  landing-width exception). Every OTHER surface caps at `--maxw: 1536px`.
- **Build all at once** — one project, waves below, one review, then ship.
- **Admin = settings only**: Ops, Relay, Tokens, Deploy & Version. **Workspace is NOT in admin**
  (it's a working pane, not a setting) — it's a Tier-1 header section.
- Keep Claudstermind's dark-blue identity; only **rename tokens** to the canonical names.

## Acceptance criteria (what exists after)

1. **Canonical colour tokens.** `:root` uses the canonical names (`--bg, --bg-2, --panel,
   --panel-2, --line, --ink, --ink-soft, --ink-mute, --accent, --accent-dim, --danger, --radius`);
   Claudstermind's current values are preserved, old names aliased then removed. No component
   restyled beyond token values.
2. **The 3-level Pantheonic Header** (`.ph`, sticky, full-chrome-width separator):
   - **L1** — medallion (Claudstermind wordmark, links home) + a **mono version chip `vX.Y.Z`**
     (links to the changelog/version notes) + the **shared identity block** on the right
     (`Signed in as <name> · <RoleBadge>`, then an **Admin** link that is a real `<a href="#admin">`
     only for `ancient`, else a disabled muted chip, then Log out). Rendered from `/api/me` via
     `textContent`; nothing until `/api/me` resolves. In **local mode** the identity block collapses
     to just the version chip + an Admin link (local is implicitly ancient).
   - **L2** — Tier-1 sections + exactly one memorable action.
   - **L3** — the active section's Tier-2 sub-views; a fixed-height zone that never resizes the header.
3. **Information architecture** (fewer top options; the rest grouped):
   - Tier-1: **Overview · Map · Activity · Pipeline · Brain · Workspace**
     - Map → Tier-2: Org×Role · Dependency graph · Movements · Tree · Packages
     - Pipeline → Tier-2: Cascade · Git state
   - One memorable action: **Deploy ↗** (opens Admin → Deploy) for ancient, else the Workspace.
   - Admin (sidebar): **Ops · Relay · Tokens · Deploy & Version**.
4. **Every view addressable.** Tier-1 `#overview … #workspace`; Tier-2 `#map/graph`; admin
   `#admin` (unselected prompt) and `#admin/deploy` etc. The URL is the source of truth (parsed on
   load + `hashchange`); Back works. Header buttons navigate to URLs; no in-panel nav mirror.
5. **Admin surface (§5).** Sidebar + content pane, driven by a static section-config
   `{id, icon, label, hash, enabled}`. `#admin` = unselected prompt; `#admin/<section>` renders it;
   planned/disabled sections greyed + inert. The whole admin sits behind the **AdminGate** (four
   states from `/api/me`: checking → signed-out → signed-in-not-ancient → ancient); **every admin
   mutation re-gates server-side** (already true on the relay). `[hidden]`-wins guard on every toggle.
6. **Versioning + release gate (§10).** `package.json.version` is the single source of truth, shown
   in the header chip and returned by a new **`GET /api/version`** (`{ version, gitSha, builtAt }`,
   stamped at build). A **`CHANGELOG.md`** at the repo root; a **test** asserts
   `package.json.version === newest CHANGELOG entry` (a bump can't merge undocumented).
   **`docs/RELEASING.md`** documents the bump→changelog→deploy procedure. First release: **0.2.0**.
7. **Deploy & Version admin section.**
   - Shows **Live** (from the relay's `/api/version`) vs **Pending** (local `/api/version`), each
     `X.Y.Z · <shortSha>`, and a diff hint ("3 commits ahead", "up to date").
   - **Release controls**: bump patch/minor/major (writes `package.json` + a new `CHANGELOG.md` top
     entry from a typed summary) — ancient/local only.
   - **Deploy button**: ships the local build to the live box and rebuilds, **streaming the log over
     SSE**. Lit when Pending ≠ Live.
8. **Per-repo raw-data readout.** A new bridge control `dataSizes` returns, per repo, the collected
   conversation volume from `.claude/workspace/` (`{ repo, bytes, conversations, turns }`). Shown as
   a badge in the Workspace sidebar (both Repositories groups and Tree repo rows) — e.g. `1.4 MB · 12`.
9. Full-width Workspace preserved; everything green; deployed live.

## Deploy mechanism (Claudstermind-specific, least-privilege)

The automaton blueprint's §3 puts the deployer on the box because the automaton *is* on the box.
Claudstermind is different: the **local dashboard runs on the work machine, holds the source, and
already has SSH to StoaNodePrime**. So the deploy orchestration lives on the **local dashboard**, not
in the live container — the live relay never gets docker power.

- **`POST /api/deploy`** (local dashboard, ancient/local-gated): tar the build context → `scp` to the
  box → `ssh` rebuild **`relay` only** (`docker compose up -d --build relay`, preserving `.env` +
  `docker-compose.override.yml`), tag a rollback image first, health-check, verify the new
  `/api/version`. Streams progress to an SSE spool the browser tails (`GET /api/deploy/stream`).
- **From the live site**, the Admin Deploy button sends the trigger **down the existing tunnel**
  (`WS_IN` → the local dashboard executes; it has the source + SSH). Live never deploys itself.
- Downtime: the current recreate blips ~1 min. v1 keeps the simple recreate but the deployer
  health-checks + can roll back to `claudstermind-relay:rollback`; zero-downtime blue-green is noted
  as a follow-up (the shared box already fronts many services via nginx, so a careful upstream swap
  is a separate, riskier change — out of scope for this pass).
- Cache-busting: app-shell assets already served `no-cache` (done); the version chip gives humans a
  visible "am I on the new build" signal.

## Not included
- Zero-downtime blue-green (documented follow-up).
- Converting `/opt/claudstermind` to a git checkout (the tar+ssh deployer needs no box-side git).
- Any change to the codex/constructor/automaton machinery (N/A to this dashboard).

## References
- `pantheonic-architecture/design/PANTHEONIC-DESIGN-ARCHITECTURE.md` (§1 width, §2 tokens, §3 header,
  §5 admin, §6 identity, §7 conformance).
- `pantheonic-architecture/automaton/04-automaton-blueprint.md` (§3 deploy, §9 admin, §10 versioning).
- Reference impl: Pythia (`constructors/Pythia/apps/pythia/public/{index.html,app.js,admin.js,styles.css}`).
