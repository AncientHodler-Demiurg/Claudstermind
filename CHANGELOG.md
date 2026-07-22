# Changelog

All notable changes to Claudstermind. The newest version's number must match
`package.json` (`changelog-version.test.mjs` enforces it — a bump can't merge undocumented).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are semver.

## [0.7.1] - 2026-07-22

### Fixed
- **Workspace pane-size picker did nothing when clicked.** Hovering a cell re-rendered the
  whole picker, which destroyed the very button the cursor was over — so `mousedown` and
  `mouseup` landed on different nodes and the browser never fired a `click` at all. The hover
  preview updated, which made it look responsive while the layout never changed. The cells are
  now built once and only re-styled; hover toggles classes instead of replacing nodes.

## [0.7.0] - 2026-07-22

### Added
- **LocalHost embedded as a tab.** The aggregator now lives *inside* Claudstermind instead of
  being a second thing to run. The dashboard supervises the process (spawning it on boot,
  **adopting** it when it's already listening, stopping only what it started) and frames it.
  LocalHost stays its **own repository** at `<root>/LocalHost` and remains fully usable
  standalone — nothing is vendored, so edits there show up here on a refresh with no sync step.
  - **Local**: the tab frames the aggregator's real origin (`http://localhost:<port>`) — the
    panel *as-is*, its own HTML/CSS/JS, off the same files on disk.
  - **Live**: the remote browser can't reach the work machine's port, so the same data is drawn
    from JSON relayed through the tunnel (new `lhStatus` / `lhAction` bridge commands). Its HTML
    is deliberately *not* proxied: the aggregator fetches root-absolute `/api/*`, which would
    resolve against the dashboard rather than itself.
- `CLAUDSTERMIND_LOCALHOST_DIR` to point at the repo when it isn't beside Claudstermind.

### Fixed
- **Mirror now works for real SPAs.** A mirrored site is served at `/mirror/<port>/` but was
  written assuming it owns the origin, so its root-absolute `/assets/app.js` and
  `fetch("/api/…")` landed on the *dashboard*. `<base href>` cannot fix this — it only
  rewrites *relative* URLs. Requests are now routed by **provenance**: an otherwise-unclaimed
  path whose `Referer` is a mirrored page goes to that mirror, with a `Path=/` cookie covering
  the nested cases Referer can't reach (a stylesheet's `@import`, a module's static import).
  Dashboard routes still win, navigations are excluded (a mistyped URL 404s on the dashboard
  rather than silently becoming the mirrored site), and only ports the registry lists are
  reachable, so a stale cookie can't aim the proxy at an arbitrary local service.
- Mirror accepts **any method**, forwarding the request body — form posts and JSON APIs work
  (it was GET-only).
- Mirror no longer forwards `content-encoding`/`content-length` from an already-decoded body
  (the browser was being handed a gzip header over plain bytes), and redirects are re-rooted
  into `/mirror/<port>/` instead of bouncing the frame to the dashboard's own path.
- Mirror no longer forwards the dashboard's session `Cookie`/`Authorization` to the mirrored
  dev server, nor lets that server's `Set-Cookie` / framing headers reach the dashboard origin.

### Changed
- The mirror proxy is one shared module (`lib/mirror.mjs`) used by both transports — the local
  dashboard's direct fetch and the relay's tunneled path — so a site behaves identically
  whichever surface you view it from. (HMR/live-reload still won't work: that needs a
  WebSocket, which the proxy doesn't carry.)
- LocalHost resolution is now one portable helper (`lib/localhost.mjs`): relative to the
  workspace root, no drive letters, tolerant of `localhost/` vs `LocalHost/` on case-sensitive
  filesystems, spawning via `process.execPath` with no shell so it behaves identically under
  Windows, a login shell, and a systemd unit. `/api/mirror/list` and the bridge's `mirrorList`
  both read through it instead of hand-rolling the path.
- The dashboard now stops the aggregator it spawned on SIGINT/SIGTERM — an orphan holding the
  port would be silently "adopted" on the next boot, so an edit to `LocalHost/server.mjs` would
  appear not to take effect.

## [0.6.0] - 2026-07-22

### Changed
- **Zero-downtime deploys (blue-green).** The deployer now builds the image, starts the new
  container on the inactive port (8088↔8089), health-checks it, then flips the nginx `cm_relay`
  upstream (gated by `nginx -t`, verified, auto-reverting on any failure) before retiring the old
  container. nginx is only touched once the new container is healthy, so a deploy never drops a
  request and a bad build can't take the live site down. (One-time box setup: an nginx upstream
  include; documented in `relay/DEPLOY.md`.)

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
