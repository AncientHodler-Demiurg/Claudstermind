# State — StoicDigest

> Current-state snapshot. Updated at every session close. Authoritative for "what's the current version / what's in flight / what's outstanding".

- **Version at close:** **LIVE at https://read.stoachain.com** (2026-08-27). Astro 5 + Tailwind v4 + MDX static build; both security articles published (`draft:false`). Pantheonic shell, Medium homepage, topics, chapter-dot navigator, severity badges.
- **Open plan:** `StoicDigest/docs/WEBSITE-PLAN.md` (v0 mostly done). Domain **read.stoachain.com** set in `astro.config.mjs`; containerized (Dockerfile + compose, nginx static) and verified serving on `127.0.0.1:3014`; registered in `LocalHost/registry.json` (key `stoicdigest`, port 3014). Remaining: email provider; production deploy on StoaNodePrime (see `docs/DEPLOY.md`); generate issue images.
- **Last session (2026-08-26):** Rewrote the debut issue per the owner's handoff — `src/content/issues/issue-001.mdx` "The Bug That Could Not Exist" (Chainweb 3.2 / Pact 5.4.1 security release), `draft: true`, build green. Intro archived to `docs/drafts/`. (Earlier 2026-08-11: built the planning corpus + Astro site + container/port 3014; 4 folders out of scope.)
- **Awaiting owner:** confirm #001-vs-#002 numbering; optionally add finder name; flip `draft: false`; then deploy.
- **Known outstanding:**
  - Scaffold the Astro site + port the design system; ship Issue #001.
  - Reconcile the open flags in `ECOSYSTEM-FACTS.md` (genesis date, token-layer naming, etc.).
  - Decide email provider + register `digest.stoachain.com` in `links.ts`.
  - StoaVerify explored (in scope, EMBARGOED/on hold) — draft its concept article only when owner clears it.
  - Wire the activity-engine planning step + `stripMessages:true` public-safe rule into the build when scaffolding.
- **Drift notes:** `ECOSYSTEM-FACTS.md` numbers are a 2026-08-11 snapshot and will age. Repo had only an empty `.iz.md` before this session.
