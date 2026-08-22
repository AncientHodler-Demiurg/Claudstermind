# Architecture — StoicDigest

> Big-picture design. NOTE: the site is **not built yet** — this describes the intended architecture from the planning docs, not shipped code.

## Stack (recommended, not yet scaffolded)

Astro (content collections + islands) · Tailwind CSS v4 (inherit `@theme` tokens from `stoa-website`) · Markdown/MDX for issues · `@astrojs/rss` + `@astrojs/sitemap`. React islands only where interactivity is needed (reuse framer-motion / lucide-react components). Static build → Vercel or Netlify at `digest.stoachain.com`.

Rationale: a digest is many recurring articles → content-collection model beats the hand-coded Vite+React SPA used by `stoa-website`. See `docs/WEBSITE-PLAN.md` §2.

## Top-level layout (current — docs only)

```
StoicDigest/
├── README.md                  ← project brief + evidence table (what's built)
└── docs/
    ├── VISION.md              ← philosophy, Stoic principles, century thesis, brand voice
    ├── WEBSITE-PLAN.md        ← IA, stack, design system, workflow, checklist
    ├── ARTICLE-BACKLOG.md     ← article slate + launch sequence + reading list
    └── ECOSYSTEM-FACTS.md     ← grounded fact sheet + reconciliation flags (source of truth)
```

Intended site layout once scaffolded (see WEBSITE-PLAN §3):
```
src/
├── content/issues/           ← one .md/.mdx per weekly issue (frontmatter: issue, date, pillars, tags…)
├── components/               ← ported DocShell/Quote/Note/C, Glyphs, Colonnade, AnimatedBackground
├── layouts/                  ← issue + archive layouts
└── pages/                    ← /, /issues, /issues/[slug], /tags/[tag], /series/[topic], /about, rss.xml
```

## Key modules / boundaries (intended)

### Content collection (`issues`)
The heart of the site. Each issue is a file with typed frontmatter (title, issue #, date, summary, pillars[], tags[], hero, featured). Drives routing, archive, tags, RSS, reading-time.

### Design system (inherited)
Ported verbatim from `stoa-website`: tokens (`--color-stoa-*`, Inter), `DocShell` + `DocSection`/`DocSub`/`Quote`/`C`/`Note` article primitives, `Glyphs` (❖/✦), `Colonnade`, `AnimatedBackground`. This is what makes it read as a native sibling.

### The Ledger (live data, optional)
Reads `apiexplorer.stoachain.com` (as `stoa-website` does via `useStoaSupply`/`useChainStats`) to embed real-time chain stats + a "lines shipped this week" build metric inside issues.

## Data model

Content = flat files (Markdown/MDX) in `src/content/issues/`, validated by an Astro collection schema. No database. Email subscriptions handled by an external provider on `/subscribe`.

## External surfaces

- Reads (optional): `apiexplorer.stoachain.com` for live chain stats.
- Cross-links: register the site URL in `stoa-website/src/links.ts`.
- Distribution: RSS, email, X/Telegram syndication.

## Workflow / execution model

Author issue file → verify claims vs `ECOSYSTEM-FACTS.md` → PR → preview deploy → merge → auto-deploy (RSS/sitemap regen) → append durable facts to this brain's `LOG.md` and update any changed project brain entry → optional syndication. Weekly cadence is a hard promise.

## Known weak points

- Nothing built yet — all of the above is intended, not verified in code.
- `ECOSYSTEM-FACTS.md` is a point-in-time snapshot (2026-08-11); it will drift as the ecosystem ships. It must be refreshed periodically, ideally from live nodes / repo git stats.
- Inter font must be actually loaded (the existing sites reference but never load it).
