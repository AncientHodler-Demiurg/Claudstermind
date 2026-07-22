# Changelog

All notable changes to Claudstermind. The newest version's number must match
`package.json` (`changelog-version.test.mjs` enforces it — a bump can't merge undocumented).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are semver.

## [0.5.0] - 2026-07-22

### Added
- **LocalHost mirror** — a new **Mirror** section: view a dev server running on the work machine
  in your remote browser, proxied through the tunnel (`/mirror/<port>/`), with a `<base>` injected
  so relative asset paths resolve. Server list from `LocalHost/registry.json`. Ancient-only.
  (Best-effort: absolute-path SPA assets + live-reload WebSockets may not fully work.)

## [0.4.0] - 2026-07-22

### Added
- **Learning loop** — distil raw per-repo conversations into a brain knowledge base
  (`brain/<repo>/_distilled.md`). Two modes: **heuristic** (deterministic, free) and **Claude**
  (opt-in via a toggle, a one-shot summary into Facts/Decisions/Gotchas/Skills). Claude usage is
  tracked (runs / tokens / cost) and shown in a Learning panel on the Brain page. Raw transcripts
  are never pruned — this only adds a distilled layer.

## [0.3.0] - 2026-07-22

### Added
- **Searchable history** — a search box in the Workspace History does full-text search across a
  repo's saved conversations (bridge `search` control), with match counts + snippets; each result
  reopens/resumes.
- **Remote deploy** — the Deploy button now works from the **live site**: the trigger forwards down
  the tunnel, the work machine runs the pipeline, and the log streams back to the panel.

## [0.2.4] - 2026-07-22

### Changed
- Removed the manual "Cut a release" form from Admin → Deploy & Version. Per the Pantheonic §10
  discipline, the version bump + CHANGELOG entry are written by the agent when a change is built
  (as with Mnemosyne/Pythia); the panel now only ships the built version to the live site.

## [0.2.3] - 2026-07-21

### Fixed
- Overview lays out all organisation cardboards side by side (one equal column per org; repo rows ellipsize instead of forcing the cards wider). Reflows to as-many-as-fit below 1180px.

## [0.2.2] - 2026-07-21

### Fixed
- Workspace fills the full viewport width again (a flex-column regression had shrunk it to content width); the repo sidebar fills the height and scrolls internally.
- Brain cardboards show each repository's collected raw-conversation data (bytes / conversations / turns), sourced from the snapshot so it works on the live site too.

### Added
- Repository org cardboards in the Workspace sidebar are collapsible (open/close per organisation).

### Changed
- The redundant Workspace action button is hidden while already on the Workspace.

## [0.2.1] - 2026-07-21

### Fixed
- Workspace is now a single-screen fixed page (no page scroll); the sidebar + panes fill the viewport and scroll internally.
- stoa-js (stoa-chain-libs + ouronet-libs) appears in the Brain cardboards again (the paren-path filter was too broad).

### Changed
- Narrower Workspace repo sidebar (text-after-name removed); the Repositories | Tree toggle stays pinned atop the scrolling menu.
- The page fills the viewport height (footer sinks to the bottom).

## [0.2.0] - 2026-07-22

### Added
- **Pantheonic architecture** conformance: the standardized 3-level header (medallion + version
  chip + shared identity block; Tier-1 sections; Tier-2 sub-nav), canonical colour tokens, and a
  sidebar + content-pane **Admin** surface behind the AdminGate.
- **Versioning**: `GET /api/version` (version · git SHA · build time), the header version chip, this
  changelog, a release gate test, and `docs/RELEASING.md`.
- **Admin → Deploy & Version**: Live vs Pending version, semver release controls, and a one-click
  **Deploy** button that ships the build to the live box with a streamed log.
- **Per-repo raw-data** readout in the Workspace sidebar (bytes · conversations · turns).
- Remote Claude **Workspace** on the local dashboard too (direct, no relay tunnel).

### Changed
- Workspace sidebar: org-grouped Repositories (Brain-style), a Windows-style collapsible Tree
  (default view), a wider pane. Repository membership now via a git-ignored `.iz.md` marker.
- App-shell assets served `no-cache` so deploys are visible without a hard refresh.

## [0.1.0] - 2026-07-20

### Added
- Initial dashboard: master map, activity, packages, cascade, git-state, brain, tokens, ops, and the
  online relay tunnel with the first single-pane remote Workspace.
