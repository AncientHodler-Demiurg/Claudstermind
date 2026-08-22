# State — StoicDigest

> Current-state snapshot. Updated at every session close. Authoritative for "what's the current version / what's in flight / what's outstanding".

- **Version at close:** v0.1.0 — Astro site **scaffolded and building** (Astro 5 + Tailwind v4 + MDX; `npm run build` green, 4 pages + RSS + sitemap).
- **Open plan:** `StoicDigest/docs/WEBSITE-PLAN.md` (v0 mostly done). Domain **read.stoachain.com** set in `astro.config.mjs`; containerized (Dockerfile + compose, nginx static) and verified serving on `127.0.0.1:3014`; registered in `LocalHost/registry.json` (key `stoicdigest`, port 3014). Remaining: email provider; production deploy on StoaNodePrime (see `docs/DEPLOY.md`); generate issue images.
- **Last session (2026-08-11):** Created the StoicDigest planning corpus (README + VISION + WEBSITE-PLAN + ARTICLE-BACKLOG + ECOSYSTEM-FACTS) from a 4-agent ecosystem sweep; created this brain entry. Then clarified scope: **4 folders explicitly OUT of scope** (Zarlo, StoicEngine, AncientWisdom [private], WaspDev) — recorded in ECOSYSTEM-FACTS "Out of scope" + ONBOARDING don'ts.
- **Known outstanding:**
  - Scaffold the Astro site + port the design system; ship Issue #001.
  - Reconcile the open flags in `ECOSYSTEM-FACTS.md` (genesis date, token-layer naming, etc.).
  - Decide email provider + register `digest.stoachain.com` in `links.ts`.
  - StoaVerify explored (in scope, EMBARGOED/on hold) — draft its concept article only when owner clears it.
  - Wire the activity-engine planning step + `stripMessages:true` public-safe rule into the build when scaffolding.
- **Drift notes:** `ECOSYSTEM-FACTS.md` numbers are a 2026-08-11 snapshot and will age. Repo had only an empty `.iz.md` before this session.
