# Log — StoicDigest

> Append-only timeline of sessions. Newest at top. Each entry: ~3–5 lines.

---

## 2026-09-01 — Grading reworked to 1–7 levels + pillar chips removed (live)

**What happened:** Owner wanted a **7-level** difficulty scale (1=newcomer/child → 7=internals expert) instead of 4 named tiers, plus pillar chips gone. Also debated and **dropped a rigour metric** — owner rightly noted a single article mixes opinion/sourced/measured, so rigour is per-claim, not whole-article; provenance stays **inline** (measured/inference/cited). Design principle recorded: *only grade whole-article aggregates (level=hardest rung, length=sum, kind=purpose); never per-claim epistemic status.*

**Implemented:** `content.config.ts` `level` → `z.number().int().min(1).max(7).default(4)`. `ReadingBadges.astro` rewritten: colour-graded 7-segment meter (`▰▰▰▰▰▰▱`, green→red, `LEVEL` map 1–7 with names Newcomer/General/Crypto-aware/Developer/Blockchain-dev/Chainweb-Pact/Expert + hints), kind badge, length band (Quick/Standard/Long/Treatise from readingTime), assumes line on full variant. Removed pillar chips from `StoryRow` + article header (kept pillar data + Topics nav). De-duped readingTime (issue-sub now date-only; ReadingBadges carries length). `docs/ARTICLE-GRADING.md` rewritten to the 7-level spec. `IssueCard` is unused (untouched).

**Grades (owner deferred to my call):** #001 **L4** Developer/announcement · #003 **L5** Blockchain-dev/explainer · #002 **L6** Chainweb-Pact/record. #003<#002 on purpose (teaches internals vs assumes them). Colour green→red kept (consistent w/ severity palette; L4–6 render amber→orange→red = gold-adjacent/on-brand). Deployed via `./scripts/deploy.sh`, live-verified.

## 2026-09-01 — Article grading (level / kind / assumes) shipped live

**What happened:** Implemented reader-signposting badges per `docs/ARTICLE-GRADING.md`. Owner had already built most of it (content.config `LEVELS`=general/informed/technical/deep, `KINDS`=announcement/explainer/record/essay, `assumes[]`, defaults informed/explainer/[]; `ReadingBadges.astro` card+full variants w/ tooltip hints; IssueCard; `[id].astro` full variant + assumes line; graded frontmatter on all 3). I finished the gaps: **StoryRow** now accepts+renders the badges (main list component), **homepage hero** shows them, **topics/[pillar]** passes them. Built (Linux `npx astro build` — real; the doc's "build exits 0 doing nothing" caveat is Windows-Z:-only) + deployed. Live-verified badges on home + articles, assumes line on #002.

**Gradings:** #001 technical/announcement, #002 deep/record, #003 technical/explainer (matches spec).
**Core rule honored:** badges grade the ARTICLE not the reader — no "experts only" copy; a `deep`/`record` badge just tells readers length/assumed-knowledge is deliberate (Alex's "newsletter vs blog vs documentation" fix). Grade UP when unsure. To add a level/kind: edit `LEVELS`/`KINDS` in content.config **and** the label/hint maps in ReadingBadges (both must agree).

## 2026-08-27 — Issue #003 written (local, draft): "Physiology of a Chainweb Transaction"

**What happened:** Wrote issue-003 from `.docs/.handoffs/2026-08-27-transaction-physiology.md` — a follow-up to CryptoPascal31's *Anatomy of a Kadena Transaction* (credited + linked early). Covers the two costs of a tx, the "invisible half" (`/local` vs `?preflight=true`) + the 777,189-vs-580M story, the **seventh-power** size penalty (shape, not pricing; split = 128×/halving), the **three-limits-at-three-layers** novel finding, cross-chain comparison, signers free→priced + CPU-seconds budget + the **"mempool is a filter, consensus is the law"** distinction, a Pact-lines table, and a close on 3 honest unknowns. `draft: true` (owner publishes Friday). Kept **local, not deployed** per owner ("construct locally first").

**Non-obvious:**
- **Verified the ⚠️ cross-chain figures** the handoff flagged (measure-over-assert ethos): EIP-2028 = 16 gas/non-zero byte, 4/zero (→ the ~1,600× vs Chainweb's 0.01 gas/byte holds); Bitcoin 4,000,000 weight units; Solana ~1,232 bytes (MTU-derived). Framed as "each chain's published parameters," EIP-2028 linked.
- Inference (the seventh-power rationale) labeled as inference every time, per handoff.
- ~2850 words → readingTime 15 (handoff guessed 17; dense/tabular). No severity badges (no SC/C/H/M table in this one). Build green, DoD all met.

**Published 2026-08-27:** owner said go → flipped `draft:false`, deployed via `./scripts/deploy.sh`. Live at read.stoachain.com/issues/issue-003; homepage + RSS now carry all 3. Also shipped **prominent gold issue numbers** (magazine-style `#003`): big `.issue-no` on article header + hero, `.story-num` leading each list row (owner: "so people see this is the 3rd article"). Verified live (HTTP 200, 3 RSS items).

**Correction (§3g gas table):** owner clarified default-vs-max. Kadena: 180,000 protocol max but every node runs 150,000 default → effective 150k. StoaChain: 1,600,000 default but all HUB/pool nodes run 2,000,000 max → effective 2M. Table now 4 rows (Kadena/StoaChain × default/max) with effective ceilings bolded; added the 180,000 row (~190 KiB / ~3,400 lines, **derived** from the article's own calibration — reproduces the 3 known rows exactly). Redeployed. NB: gas ratio 13× ≠ line ratio ~2.4× (non-linear size cost) — worded to avoid conflating them.

## 2026-08-27 — 🚀 PUBLISHED live at https://read.stoachain.com

**What happened:** Flipped both articles `draft:false`, prod-built, and deployed to **StoaNodePrime** (root@85.215.141.198, SSH `stoanodeprime`). Static Astro build served by **nginx**, fronted by **Cloudflare** (TLS at CF; origin HTTP:80) — matching the `stoachain.com` zone convention. Deploy = rsync `dist/` → `/var/www/read.stoachain.com/releases/<ts>/` + atomic `current` symlink; new vhost `sites-enabled/read.stoachain.com.conf` (`try_files $uri $uri/ =404`, `^~ /_astro/` immutable cache, cloudflare-realip snippet). `nginx -t` + `systemctl reload` clean. Verified: origin + public both serve StoicDigest; home/issues/topics/subscribe/rss all 200; chapter-dots, severity badges, red-team link all present publicly.

**Non-obvious:**
- `read.stoachain.com` was already DNS'd (Cloudflare, IPv6) serving default "Welcome to nginx"; adding the vhost took over the hostname. No certbot needed (CF terminates TLS; origin :80).
- **StoicDigest is NOT a git repo** — deploy is rsync of `dist/`, not git-pull. Recommend `git init` + remote for history (noted in DEPLOY.md).
- Added **`scripts/deploy.sh`** (build + rsync + symlink flip + keep-last-5 + rollback hint) — future deploys are one command. Rewrote `docs/DEPLOY.md` to the real method (was docker+certbot).
- Owner's edits stand: C-1 reworded to "published CVE / our own CRITICAL rating" (no CVSS 9.1 claim — none was published); finder named "Alex (Daisuke Flowers)" + Oberlius per the transparency-report thanks. Deployed text = owner's final.

## 2026-08-27 — Chapter dots: vertically centred in viewport (final)

**What happened:** Owner wanted the rail centred in the page height, not top-pinned. Made `.chapter-dots` a **full-height sticky wrapper** (`position: sticky; top: 0; height: 100vh; display:flex; align-items:center; justify-content:center; pointer-events:none`) that vertically centres an inner `.cd-inner` (the dots + track, `pointer-events:auto`). Net: rail hugs the text's right edge (flex sibling of the article) AND stays vertically centred in the viewport while scrolling. Build green, scroll-spy intact. (Edge: on articles shorter than 100vh the shell is forced to 100vh — irrelevant for these long pieces.)

## 2026-08-27 — Moved chapter dots from viewport-fixed to sticky-beside-text

**What happened:** Owner couldn't find the dots — they were `position: fixed; right: 20px` = pinned to the **viewport** edge, far from the text on a wide screen. Changed to a flex layout: `.article-shell { display:flex }` wraps `article.article-wide` (flex:1) + `nav.chapter-dots` (`position: sticky; top: 150px; align-self: flex-start`). Dots now sit at the article's right edge and stay pinned while scrolling the article. Build green; sticky confirmed; scroll-spy intact.

**Observed (unfixed, flagged to owner):** on a very wide viewport the content column (`.ph-main` / `.ph-inner`, `max-width:1536; margin:0 auto`) appears **left-aligned, not centered** — big empty right gutter. `margin:0 auto` inside `body.flex.flex-col` isn't centering as expected. Offered to fix (center or true-full-width) — awaiting owner call; likely remove body flex so `main` centers via normal block flow (trade-off: footer no longer pinned to viewport bottom on short pages).

## 2026-08-27 — Fixed the invisible dots + disabled Astro dev toolbar

**What happened:** Chapter dots weren't visible: `.cd-dot` was an inline `<span>`, and **inline elements ignore width/height** → zero-size dots. Fixed with `display: block` (11px, 2px ring, `background: var(--bg)`), added a faint vertical **track** (`.chapter-dots::before`), centered the column, and lowered the breakpoint to ≥1024px. Also owner saw a "No islands detected" popup — that's the **Astro dev toolbar** (dev-only, never in prod); disabled it via `devToolbar: { enabled: false }` in astro.config (needs a dev-server restart to drop). Build green; 8 dots #001 / 12 #002.

**Lesson:** for any pill/dot/badge built from a `<span>`, set `display: inline-block`/`block` or width/height silently no-op.

## 2026-08-27 — Fixed chapter-dot navigator (scroll-spy), replaced floated TOC

**What happened:** (owner) wanted the jump-TOC as an always-visible vertical "scroll button" on the right: points per chapter, hover-to-expand title, click-to-jump, active point tracks scroll — with full-width text kept. Implemented `.chapter-dots` (`position: fixed`, right edge, `align-items:flex-end`): one `a > .cd-dot` per h2, `.cd-label` (number + title) revealed on hover, anchor-jump on click. Scroll-spy via an inlined `<script type=module>` IntersectionObserver (rootMargin -40%/-55%) toggling `.active`. Removed the floated card. `.article-wide` gets `padding-right: 2.5rem` on ≥1100px so full-width text clears the rail; rail hidden < 1100px.

**Non-obvious:** Astro inlined the small script into the article HTML (not a separate _astro/*.js). Chapter numbering (CSS counter on `.prose h2::before`) still matches the dot-label numbers (index+1). Desktop-only (mobile edge-dots don't work — offered a mobile "chapters" sheet as a future add). Verified: 8 dots #001 / 12 #002, IntersectionObserver present, CSS in bundle, badges/links intact.

NB: owner edited both mdx files' copy (declined count 15→**20**, and a more careful "assessment not discovery" framing of the we-found-ten). Left intact.

## 2026-08-27 — Full-width article + floated numbered TOC (replaced the wasteful grid)

**What happened:** (owner feedback) The two-column grid wasted the entire lower-right column and kept the body width-constricted. Replaced it: article is now **full-width** (`.article-wide`), the TOC is a **floated top-right card** (`.toc-float`) that the body text **wraps beside then flows full-width beneath** — no wasted space. Added **chapter numbering** via CSS counter (`.prose h2::before { content: counter(ch) }`) matched to numbered TOC entries (index+1). `.prose table,pre { clear: right }` keeps wide blocks off the float.

**Non-obvious / trade-offs:**
- The floated TOC is **non-sticky** by necessity (float can't be sticky; text must flow beneath it). It's a top-of-article chapter index now, not a persistent rail. Offered a floating "chapters" button as an optional add if persistent jump-nav is wanted.
- Body lines are now full-width (~1500px) per owner's explicit "not width-constricted" request; readability cap (~100ch) offered but not applied.
- Build green; badges/links/counters verified.

## 2026-08-27 — Article two-column layout + honest Subscribe

**What happened:** (owner feedback) The article didn't use the wide shell — it was a narrow centered column disconnected from the wide header. Fixed with a **two-column article** (`article-grid`): reading column (`--reading` 46rem) left-aligned to the shell grid + a **sticky TOC rail** (`article-rail`) auto-built from h2 `headings` (shows when >2). Aligns the title under the brand and uses the width via the TOC, not by stretching prose (readability). Also: the header's primary button was a **fake "Subscribe" wired to /rss.xml** — owner (rightly) flagged it. Now points to a real honest **`/subscribe`** page: RSS (live), socials, and "Email edition — coming soon." No fake form; no mailer set up yet.

**Follow-ups:** wire a real email edition when owner picks a provider. Recommended: **self-hosted Listmonk** (on-brand/sovereign; runs in a container on StoaNodePrime; send via a transactional relay — SES/Postmark — for deliverability, since Hetzner SMTP IP reputation is poor) OR **Buttondown** (fast hosted, RSS-to-email). Prereq either way: SPF/DKIM/DMARC on stoachain.com. Then build the real double-opt-in form on /subscribe.

## 2026-08-27 — Ported the Pantheonic shell + Medium-style homepage

**What happened:** Ported the **Pantheonic Shell** (visual only, no auth/organ) from the Pythia reference impl into the Astro site: 3-level header (L1 brand medallion · L2 tier-1 `Latest/Archive/Topics/About` + primary "Subscribe" · L3 tier-2 = Seven Pillars on Topics, with the **fixed 42px reserved zone**), hash-routing replaced by real Astro routes. Widened the shell to **`--maxw: 1536px`** (`.ph-main`) with a `--reading: 46rem` column for article bodies. Rebuilt the homepage **Medium-style** (`StoryRow`: meta · title · 2-line excerpt · tags · thumbnail-with-placeholder; hero honors `featured`). Added `/topics` + `/topics/[pillar]` and a `series` schema field. Kept token *names*, swapped *values* to gold-on-black per their theming contract.

**Non-obvious:**
- The Pantheon **Next.js `websites/Pantheon` site is NOT the shell** — the real tier-1/tier-2 shell is the **Pythia** `public/` impl (`constructors/Pythia/apps/pythia/`). Design spec: `AncientPantheon/websites/Pantheon/docs/pantheonic-architecture/design/PANTHEONIC-DESIGN-ARCHITECTURE.md`.
- Stripped: `#authbox`, `loadMe`, `pantheon-header.js`, the landing "stage" — none needed for a public scrolling content site (that's their "Form B").
- Article body stays a readable ~46rem column even though the shell/listings go wide — "bigger width displays the *listings* better," not the prose measure.
- Build green; all pages generate (home, archive, 2 issues, /topics + 7 pillar pages); severity badges + source links intact; no out-of-scope leaks.

**Presentation/preservation advice recorded** in `docs/WEBSITE-PLAN.md` §8: Medium list ✅ → `/archive` pagination → **Pagefind** static search → `/series` pages → **Arweave/IPFS permanence** (on-thesis). Content stays flat MDX in git.

**Follow-ups:** (owner) flip drafts to see the Medium homepage populate (prod hides drafts); later: pagination, Pagefind, series pages, permaweb pinning, real hero images.

## 2026-08-27 — Rewrote both security articles from the revised handoffs

**What happened:** Both handoffs were substantially revised (each opens with a revision note). Re-read both in full, then rewrote both articles. **issue-001** ("The Bug That Could Not Exist") = announcement covering **the eight that reached us** (SC-1, SC-2, C-1, H-1, H-2, H-3, H-4, M-1), each explained, + ID-scheme + fork + gas-floor; links to 002 for the rest. **issue-002** ("Fourteen Findings") = **all fourteen** under tier headings (## SUPERCRITICAL/CRITICAL/HIGH/MEDIUM), incl. the six that missed us (H-5, M-2, M-3, M-4, M-5, M-6), + declined-15-commits (SPV fund-destruction etc.), + WebAuthn/2M-cap, + testing, + process bugs.

**Key changes / decisions:**
- **Retired the old #1–#14 numbering entirely** → severity-prefixed IDs (SC-/C-/H-/M-), severity order. Mapping applied per the user's table. Verified: zero `#N` finding refs remain.
- **No ID ranges** anywhere (grep-verified) — the Kadena-disclosed set (SC-1, SC-2, H-1, H-2) is non-contiguous because C-1 sits among them and was OURS; always written as explicit lists. 4-vs-10 split stated explicitly in both.
- Handoff-1's DoD §10 ("every one of the fourteen in issue-001") is stale/self-contradictory — followed the **authoritative user message**: 001 = the eight, 002 = all fourteen.
- Taught the rehype badge plugin the new `SUPERCRITICAL` spelling (no hyphen) → still maps to `sev-super-critical`.
- Kept Denascan gratitude beat + Kadena source links (Ad-Vitam report, CERT VU#862559) + severity badges. Name still omitted; WebAuthn usage still unverified; non-exploitation stated exactly.
- Word counts grew (all 14 findings): issue-001 ~3000w (readingTime 15), issue-002 ~4040w (readingTime 18). Build green, no out-of-scope leaks, both `draft: true`.

**Follow-ups:** Owner to review; optionally run WebAuthn scan; verify/add finder name against Ad-Vitam report; flip `draft: false`; deploy.

## 2026-08-26 — Color-coded severity badges (auto, via rehype plugin)

**What happened:** Added a `rehypeSeverity` plugin in `astro.config.mjs` that turns any table cell whose whole text is a severity word (+ optional `(note)`) into a styled pill. Styles in `global.css` (`.sev-*`). Ramp: **SUPER-CRITICAL** = filled glowing crimson-rose `#e11d48` (only filled badge → outranks by weight, not just hue), CRITICAL red `#f87171`, HIGH orange `#fb923c`, MEDIUM amber `#eab308`, LOW yellow `#fde047`. Marked capability theft (#2) SUPER-CRITICAL in **both** articles' tables (audit table keeps an honest note that the escalation is our emphasis, audited verdict = CRITICAL).

**Non-obvious:** The plugin keeps Markdown tables plain (no MDX-in-cell), matches only cells that are purely a severity token, and applies to all current + future issues automatically. Counts verified: super-critical 2, critical 4, high 9, medium 7, low 0 (no LOW findings in the data yet). Qualifiers like `(DoS)`/`(9.1)` render as muted `.sev-note` spans.

## 2026-08-26 — Cited both articles: real Kadena source links

**What happened:** Owner asked both articles to link the Kadena Medium transparency report + any quoted sources. Web search couldn't surface 2026 Medium URLs, so pulled the **real** URLs from our own audit docs (`stoa-chain/docs/stoa/`, branch `upgrade/chainweb-3.2.1`): Ad-Vitam report `medium.com/@communitykadena/chainweb-3-2-ad-vitam-transparency-report-cfcfff237f43` and CERT `kb.cert.org/vuls/id/862559` (= CVE-2026-9648 = finding #5, confirmed by context). Added inline links (issue-001: report + CVE; issue-002: report in credit + on the "most existing contracts…" quote + CVE). Recorded canonical URLs in ECOSYSTEM-FACTS. Build green.

**Non-obvious:** Did NOT fabricate URLs — sourced from our tree. Kadena Medium content isn't web-indexed (their org archived Jan 2026 per search), so the audit docs are the authoritative citation source for future issues. Optional future polish: add `rehype-external-links` so external links open in a new tab with `rel=noopener` (not yet added — needs a dep).

## 2026-08-26 — Issue #002 written: the full audit report ("Fourteen Findings")

**What happened:** Owner supplied a second handoff (`.docs/.handoffs/2026-08-26-full-audit-report.md`) for the in-depth audit companion. Wrote it as `src/content/issues/issue-002.mdx` ("Fourteen Findings"), ~3197 words / 16 min, `draft: true`. Made issue-001 point to it (new paragraph in "An audit, not a copy" → link to /issues/issue-002); issue-002 links back to /issues/issue-001. Build green, cross-links resolve, no out-of-scope leaks.

**Non-obvious / decisions:**
- **Numbering:** handoff suggested `issue: 3` (assuming intro=001, announce=002). Since we renumbered (announce=001), the audit is the owner's "second article" → **issue: 2**, date 2026-08-27.
- **Verified the ⚠️ grep (§3b) against source** on branch `upgrade/chainweb-3.2.1`: `validPPKSchemes` = 0 hits under `Pact5/`, all call sites Pact4; `_siAddress` = 0 hits in `src/`; `_versionMaxBlockGasLimit = 2_000_000` + petersen confirmed in Stoa.hs. Handoff facts accurate.
- **§3c WebAuthn usage:** written as unverified ("we are not aware of any WebAuthn-signed transaction on StoaChain") — no scan run. Do NOT upgrade to "nobody used it" until owner runs the scan.
- **§5 gap stated plainly** (exploits not demonstrated rejected — no funded key on rehearsal chain). Non-exploitation stated exactly. #2 kept audited-CRITICAL in the verdicts table with a note that "super-critical" is our editorial emphasis (consistent with issue-001).
- Both articles `draft: true` → prod homepage stays empty until owner flips. On the homepage the newest issue (currently #002) is the hero; `featured` flag is not yet honored by index.astro (could pin #001 if owner prefers the announcement to lead).

**Follow-ups:** Owner to review both; optionally run the WebAuthn scan to convert §3c to a number; flip `draft: false` on both; then deploy. Numbering of #001-vs-#002 for the announcement still owner's call.

## 2026-08-26 — Issue #001 rewritten: the Chainweb 3.2 / Pact 5.4.1 security release

**What happened:** Owner scratched the intro article and pointed to a detailed handoff at `.docs/.handoffs/2026-08-26-chainweb-security-release.md` for the real debut piece. **Archived** the intro to `docs/drafts/what-is-stoachain-intro.mdx` (not deleted). Wrote the security article as `src/content/issues/issue-001.mdx` ("The Bug That Could Not Exist") — ~1987 words / 9 min, `draft: true`. Build green; verified no out-of-scope leaks, no finder name.

**Non-obvious / decisions:**
- **Deviation from handoff:** it specified `issue: 2` (keep intro as #001). Since owner scratched the intro, I made this **#001** so the live site doesn't show "#002" with no "#001". One-line flip if owner prefers the handoff's plan.
- **Finder name omitted** per handoff ⚠️: the "Alex"/AI-red-team discovery story isn't verifiable from our sources (Kadena's Ad-Vitam Transparency Report is on Medium, not auto-fetchable). Wrote it as "a developer" + "an AI model." Owner can add the name only if they confirm it against the report.
- AI angle framed as "AI does not inherit our assumptions" (not "AI > engineers") per handoff trap #1. Non-exploitation stated exactly per trap #2.
- Facts cross-checked vs ECOSYSTEM-FACTS (10 chains, ~10–11× gas limit, ANU constants 10,000/400,000/10,800s, 1 STOA = 10¹² ANU). Gas-floor ≈133-year figure confirmed (390,000 intervals × 3h).
- `draft: true` retained → owner publishes. NOTE: prod build filters drafts, so the deployed homepage stays empty until owner flips `draft: false`.

**Refinement (same session):** Added a "Gratitude, made concrete" beat to the Kadena-credit section debuting **Denascan** — a Kadena mainnet explorer (`StoaExplorer/frontend-kadena`, v0.1.21) on the same architecture, live at `denascan.ancientholdings.eu` (confirmed in `frontend-ouronet/src/lib/explorers.ts`). Framed as a token of appreciation to Kadena + intro to our explorer tech (sibling of explorer.stoachain.com / ouroscan). readingTime bumped 9→10 (~2119 words). Recorded Denascan in ECOSYSTEM-FACTS (StoaExplorer now has 3 frontends). Build green, no leaks.

**Follow-ups:** Owner to (1) confirm #001-vs-#002 numbering, (2) optionally verify+add the finder name, (3) flip `draft: false` to publish, then deploy per `docs/DEPLOY.md`. Next canon piece: "Thinking in Centuries" (the article hands off to it).

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
