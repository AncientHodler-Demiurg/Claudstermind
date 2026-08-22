# Log — StoicDigest

> Append-only timeline of sessions. Newest at top. Each entry: ~3–5 lines.

---

## 2026-08-11 — Domain + containerization + local port 3014

**What happened:** Owner chose **read.stoachain.com** (DNS → StoaNodePrime), wants it containerized + viewable locally on port 3014. Set `site: read.stoachain.com` in `astro.config.mjs` + dev port 3014 (reads `LocalHost/registry.json`). Added `docker/Dockerfile` (multi-stage node build → nginx static), `docker/nginx.conf`, `docker-compose.yml` (binds `127.0.0.1:3014:80`), `.dockerignore`, and `docs/DEPLOY.md` (host nginx vhost + certbot). Registered `stoicdigest` (port 3014, group StoaChain) in `LocalHost/registry.json` — which also auto-extends the SSH tunnel. **Verified:** `docker compose up --build` runs; `curl 127.0.0.1:3014` → HTTP 200 for home + issue page. Container left running.

**Non-obvious:**
- Convention (from Zarlo) confirmed: container binds `127.0.0.1:<port>`, host nginx reverse-proxies the domain + certbot TLS. Static site → stateless container, no DB/volumes.
- Port 3014 was the free next slot after the 3001–3013 ecosystem block; clients use 40xx (Zarlo=4001).
- Registry path from this project is `../../../LocalHost/registry.json` (3 levels up to ClaudeWS) — stoa-website's `../../` is Windows-era and wrong on Linux (relies on fallback).
- Docker is available in this env (29.1.3) — full build/run verified, not just config.

**Correction (same day):** Owner confirmed **no containers locally** — local = LocalHost board-started `npm run dev` on 3014; the Docker setup is **production-only** (StoaNodePrime). Removed the local container + image; verified `npm run dev` binds 3014 (HTTP 200) and the port is free for the board. README updated to say "containers are production-only."

**Follow-ups:** Deploy on StoaNodePrime (nginx vhost + certbot per docs/DEPLOY.md); generate + wire issue images; pick email provider.

## 2026-08-11 — Site scaffolded + Issue #001 drafted (intro lead)

**What happened:** Scaffolded the Astro site (Astro 5 + Tailwind v4 `@theme` tokens + MDX; Header/Footer/Colonnade/IssueCard; pages `/`, `/issues`, `/issues/[id]`, `/about`, RSS, sitemap). `npm install` + `npm run build` both green. Wrote **Issue #001** as `src/content/issues/issue-001.mdx` — owner asked the first article to be an **intro to StoaChain** ("What Is StoaChain?"), with this week's shipped items (explorer DeFi index, Talos zero-downtime deploy, Ouronet rich list, on-chain Pact) as the "This Week" section. Image prompts + metrics methodology in `docs/issue-001-production-notes.md` (not published).

**Non-obvious:**
- **Claudstermind Pact IDE is the owner's PRIVATE tool** — do NOT feature it publicly. Removed it from the issue; the Pact angle now covers only on-chain contracts (real product).
- Ran real git activity (since 2026-08-04) to pick features; ~150k+ hand-written lines shipped across ~10 in-scope repos this week. Churn honesty: StoaExplorer's 171k was ~49% lockfiles → ~88k real; Ouronet on-chain 24k was 0% generated (all Pact).
- Tailwind v4 via `@tailwindcss/vite` (not the deprecated `@astrojs/tailwind`); Inter now actually loaded (Google Fonts link) — fixing the gap both existing sites have.

**Follow-ups:** Generate the 5 issue images from the prompts; set real domain + deploy; wire a live "Ledger" from the activity engine; get owner sign-off on featuring Ouronet/OuronetUI.

## 2026-08-11 — StoaVerify explored + activity engine wired + stale repos marked

**What happened:** Owner refined scope: StoaVerify is **in scope** (EU-funded, on hold pending papers); only the 4 folders are excluded; StoaLive + StoaChain-Docs are stale/on-hold. Explored StoaVerify (public-safe framing only). Wired Claudstermind's activity engine into the digest workflow and marked stale repos, in `ECOSYSTEM-FACTS.md`, `WEBSITE-PLAN.md`, `ARTICLE-BACKLOG.md`.

**Non-obvious:**
- **StoaVerify = document-certification "seif"**: StoaChain/Ouronet/Pact = registry of record, Arweave = archive; only fingerprints on-chain, never file contents/PII. Pre-implementation (no product code — the repo is a grant-application authoring workspace). **Embargoed**: grant figures, submission strategy, partners, external-expert arrangement, feasibility "no-go"/TRL history, and personal/prior-entity names are PRIVATE — kept out of the digest repo entirely; a public article waits for owner clearance.
- **Activity engine = the issue-planning input:** `Claudstermind/lib/gitActivity.mjs` `repoCommitActivity(...)` returns repos sorted by commits/churn; call with `stripMessages:true` for public safety; repo list in `dashboard/data/map.json`, daily rollup in `brain/_daily.json`. Filter out the 4 exclusions + stale repos before publishing.
- Stale/on-hold: **StoaLive** (design-only), **StoaChain-Docs** (docs) — background only, not "this-week" momentum.

**Follow-ups:** Draft the StoaVerify concept article only when owner clears it. Scaffold the Astro site + Issue #001 when ready.

## 2026-08-11 — Scope boundary clarified (4 exclusions)

**What happened:** Explored four workspace folders the owner asked about (Zarlo, StoicEngine, AncientWisdom, WaspDev). Owner then clarified these are **exceptions — do NOT report on them**; StoicDigest covers StoaChain + StoaChain-related only. Recorded the exclusion in `ECOSYSTEM-FACTS.md` (new "Out of scope" section) and this brain (ONBOARDING hard-don'ts + LEARNINGS). Did **not** integrate them into any digest content.

**Non-obvious:**
- `AncientWisdom` is a **private** legal/tax repo (PII, tax-enforcement, contracts) — hard exclude, never publish.
- `StoicEngine` is unrelated hardware (free-piston generator); `Zarlo` is an unrelated Laravel e-commerce client; `WaspDev` is internal tooling (bee-dev fork).
- `AncientClients/StoaVerify` was NOT excluded → treat as in scope (StoaChain-related), explore later.
- Corporate structure (Demiourgos S.A. owns the chain; AncientHoldings GmbH operates it; collaborator co-authored the fork) is sensitive-adjacent — high-level/public-registry phrasing only if ever used.

**Follow-ups:** Explore `AncientClients/StoaVerify` when convenient (in scope).

## 2026-08-11 — Project genesis: planning corpus + brain entry

**What happened:** Stood up StoicDigest from an empty folder. Ran a 4-agent parallel sweep of the whole ecosystem (blockchain core, apps, philosophy/knowledge repo, existing web branding) plus web research on the Arweave-weekly-digest model and Pact. Wrote the planning corpus: `README.md`, `docs/VISION.md`, `docs/WEBSITE-PLAN.md`, `docs/ARTICLE-BACKLOG.md`, `docs/ECOSYSTEM-FACTS.md`. Created this brain entry (6 files).

**Non-obvious:**
- The ecosystem is far bigger than it looks publicly: ~500k+ measured lines across stoa-chain (~62k Haskell + Pact), StoaWallet (~65k), StoaExplorer (~55k), AncientHoldings/The Hub (~304k, production), plus stoa-js SDK (819 tests). A ~253k-line week is credible.
- Recommended stack decision: **Astro + Tailwind v4 + MDX** (not the existing Vite+React SPA) because a digest is content-collection-shaped.
- Captured 8 reconciliation flags (genesis date, token-layer naming, chain count, Blake3, century phrasing, lore, gas-floor status, source-vs-live drift) — see LEARNINGS + ECOSYSTEM-FACTS.

**Follow-ups:**
- Scaffold the Astro site, port the design system (load Inter), ship Issue #001.
- Resolve the reconciliation flags against live nodes before publishing.
- Register `digest.stoachain.com` in `stoa-website/src/links.ts`; pick an email provider.
