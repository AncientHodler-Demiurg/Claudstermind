# Changelog

All notable changes to Claudstermind. The newest version's number must match
`package.json` (`changelog-version.test.mjs` enforces it — a bump can't merge undocumented).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are semver.

## [0.9.16] - 2026-07-24

### Fixed
- **The "Login with AncientHub" button was missing on a mirrored site (confirmed against
  Mnemosyne) — root-caused past v0.9.13's routing fix.** That fix protected same-named routes
  (like `/api/me`) as long as the request's Referer still looked like `/mirror/<port>/…`. But the
  moment the mirrored app's OWN client-side router moves the address bar to some other
  root-absolute path (a `<Link>` click, or Next's own RSC navigation) — a "second hop" — that
  proof disappears: the request's Referer no longer shows `/mirror/…`, and the cookie fallback
  can't safely fill the gap either, since it can't tell that apart from the dashboard's OWN
  traffic (a stale mirror cookie rides along on that too). Confirmed directly: `/api/me` fell
  through to Claudstermind's own route, which answered `authenticated:true` with no name/role —
  reading as "already signed in," which is why the login button never appeared.
- Fixed at the source instead of guessing server-side: the mirror now injects a small runtime
  script into every mirrored HTML page (alongside the existing `<base>` tag) that patches
  `fetch`/`XMLHttpRequest.open` to rewrite root-absolute URLs under the `/mirror/<port>/` prefix
  before they ever leave the browser — landing on the explicit mirror route directly, no
  provenance guessing needed. Only the outgoing request target is touched, never
  `history`/`location`, so a framework's own client-side router (which tracks navigation state
  independently of what URL `fetch()` actually hits) can't be confused by it.

## [0.9.15] - 2026-07-24

### Added
- **Role color, at a glance.** Your own messages now sit in a solid blue bubble with white text;
  Claude's replies use its signature accent color instead of the plain neutral ink both used to
  share — the two were visually identical before except for the bubble background.

### Changed
- **Queued ("stasis") messages merge into ONE prompt on release, instead of firing one at a
  time.** Typing (and sending) several messages while Claude is still working queues each as its
  own orange box, same as before — but the moment the current turn finishes, everything queued is
  now joined into a single prompt (one blank line between each) and sent as one turn, not replayed
  as N separate round trips that would've answered each fragment in isolation. The orange queued
  text itself now also reads in orange (previously only the border/background and the "queued" tag
  were orange, not the message text) — and turns white the instant it's released, exactly the
  "held in stasis, then released" feedback that was asked for.

## [0.9.14] - 2026-07-24

### Fixed
- **The Reload button's pre-flight failed with "crashed" — root-caused after it correctly refused
  to touch the live process.** The sandboxed candidate `server.listen()` had no `error` handler,
  so a scratch-port collision (a random draw out of ~20000 ports lands, rarely, on one already in
  use) crashed it uncaught instead of failing gracefully — confirmed directly against the real
  restart log (`"crashed", {code:1, signal:null}`, the exact signature of an unhandled
  `EADDRINUSE`). Two fixes: the candidate's own listener now has a real `error` handler that logs
  clearly and exits instead of crashing with a raw stack trace; and `runSelfRestart` now retries
  once on a freshly-rolled port when the pre-flight reason is `"crashed"` — a genuine code defect
  would crash again just as fast on the retry and still get reported, but a one-in-20000 port
  collision now self-heals instead of forcing a second manual click. A `"timeout"` pre-flight is
  left alone; a hang isn't fixed by trying a different port.

## [0.9.13] - 2026-07-24

### Fixed
- **The mirror wasn't wired up right, in two separate ways — both confirmed by loading a real
  mirrored site (Mnemosyne) end to end:**
  - **No login button showed up.** Any route the mirrored app names the same as one of ours —
    `/api/me`, in Mnemosyne's case — was silently shadowed by our OWN route of that name, since
    ours always matched first regardless of provenance. The mirrored page's client-side
    auth-check JS was calling `/api/me` and getting OUR shape back, not its own, so it never knew
    it was logged in. Fixed by checking mirror provenance (Referer/cookie) BEFORE any
    same-named route, in both the local dashboard and the relay — the two places this routing
    happens.
  - **Clicking the codex button 404'd.** `mirrorFromReferer`/`mirrorFromCookie` deliberately
    excluded navigations (`sec-fetch-mode: navigate`) on the theory that a mistyped dashboard URL
    should 404 on the dashboard, not turn into the mirrored site. In practice this broke the most
    common interaction with a mirrored SPA there is: a framework router (Next.js's `<Link>`)
    navigating the iframe to a root-absolute path it has no idea is mirrored. Every in-app
    navigation 404'd on the dashboard instead of reaching the app. The "mistyped URL" risk turns
    out to already be covered without excluding navigations at all — protected routes are matched
    first regardless, and the cookie fallback only ever runs after every real route and static
    file has already refused the path — so the exclusion is gone.
- **LocalHost's Stop button was a silent no-op for any dev server it didn't start itself**
  (this Claudstermind release doesn't touch that code — it lives in the sibling LocalHost repo —
  but the symptom ("stop doesn't show it's stopped, then start gives no feedback") was reported
  and root-caused as part of this same investigation, so it's noted here too). `lsof -ti tcp:<port>`,
  the only thing the fallback kill used, returned nothing on this host for a socket `ss -ltnp` and
  `fuser` both found immediately — so Stop reported success while the process kept running, and the
  next Start crashed with `EADDRINUSE`. Fixed there by falling back through `fuser`/`ss` when `lsof`
  comes up empty; confirmed by starting Mnemosyne outside the panel and stopping it through the
  panel, port freed within a second.

## [0.9.12] - 2026-07-24

### Added
- **An expand button (⤢) on History** — opens a full-page view of every saved conversation across
  every repository, grouped by organisation then by repository (the same taxonomy the
  Repositories sidebar already uses), with collapsible org groups and the same search. The
  sidebar's cramped scrolling list stays as the quick-glance default; this is for when there are
  too many conversations to navigate in that small a space. Picking a conversation (Open/Resume)
  closes the expanded view automatically.

## [0.9.11] - 2026-07-24

### Added
- **A live activity feed on every pane** — "what's happening right now," separate from the chat
  itself: sending, thinking, streaming the reply, running a tool, waiting for permission, done,
  a connection hiccup and reconnect. A single always-visible line by default; tap it to expand
  the full scrolling, timestamped log. This is what the orange Send button alone couldn't tell
  you — real-time, granular feedback for the entire span between sending a prompt and getting an
  answer, including the boring-but-important parts (a dropped connection, a stale stream forcing
  a reconnect) that used to be invisible.

### Fixed
- **A recreated worktree could silently resurrect stale code** — reattaching to a branch left over
  from before the worktree was removed, however far behind it had fallen (confirmed in production:
  9 commits / a full day stale) with no indication anything was off. Recreating a worktree now
  fast-forwards its branch to the repo's current tip when that's safe (no unique commits would be
  lost), and clearly reports the situation instead — never silently discarding real work — when
  the branch has genuinely diverged.

### Note for the live site
- Both reach the live site only after the relay is redeployed; the work machine works immediately
  (the worktree fix needs the pending restart; the activity feed is pure frontend, no restart
  needed for it specifically).

## [0.9.10] - 2026-07-23

### Changed
- **Corrected the copy button from v0.9.8.** That shipped a copy button on every reply — not
  what was actually asked for. Replies are now parsed for fenced ` ``` ` code blocks; each one
  renders as its own bordered "copy paste window" with a copy button for just that block, while
  the surrounding prose stays plain text with no button at all.

### Added
- **Type ahead while Claude is still working.** A message sent while the pane is busy no longer
  waits or gets silently refused — it's queued locally, shown as its own orange box in the chat
  ("frozen" until the current turn finishes), and sent automatically the instant it's Claude's
  turn again. Several queued messages send one at a time, in order. Mirrors typing ahead in
  Claude's own desktop app.

## [0.9.9] - 2026-07-23

### Fixed
- **The `--resume ... is not a UUID` crash on "main" was still happening after v0.9.7 — because
  it was data corruption, not just code.** A past bug had briefly stamped the workspace id itself
  (`Claudstermind@main`) as the recorded "real session id" before any genuine one ever existed.
  v0.9.7 only handled a workspace with NO real id recorded; it never validated one that WAS
  recorded but corrupted. Worse, the lookup used the FIRST matching id in a file, not the most
  recent — so once a real session finally started and got recorded correctly, the earlier
  corrupted entry kept winning anyway. Confirmed directly against the actual affected file:
  resolves to the genuine session id now, not the corrupted one. Three layers, since this one
  cost enough already: the lookup now finds the most recent id and rejects a self-referential one
  outright; `_prompt` refuses to hand the SDK a resume value equal to the workspace id regardless
  of where it came from; `_persist` refuses to ever write one in the first place.

## [0.9.8] - 2026-07-23

### Fixed
- **A pane's worktree label could disagree with what it was actually showing.** Resuming a
  conversation updated the pane's repo but never its worktree — so a pane resumed onto a
  different worktree than whatever it happened to be showing before kept the OLD worktree's label
  forever, even though the content, session, and repo all correctly switched underneath it.

### Added
- **An always-visible identity readout** on each pane — repo@worktree, plain text, never a
  control — so what a pane is actually showing is never in doubt regardless of scroll position or
  what was just resumed into it.
- **Controls moved down to the compose row**, next to the input rather than pinned in a fixed
  header far away from it — matching Claude's own chat UI, which keeps its controls near where
  you're actually typing.
- **A copy button on every reply**, matching Claude's own copy affordance — always visible (not
  hover-only, so it works on touch), copies the message text with a brief confirmation.

### Note for the live site
- All three reach the live site only after the relay is redeployed; the work machine works
  immediately (no restart needed — these are pure frontend changes).

## [0.9.7] - 2026-07-23

### Fixed
- **Every prompt to a workspace could fail outright** with `Error: --resume requires a valid
  session ID or session title ... is not a UUID`. `listWorkspaces()`'s fallback for "no real Claude
  session id ever recorded" used the session file's own lookup key as a stand-in — but for the
  current per-workspace layout, that key IS the workspace id itself (`repo@worktree`), never a
  real Claude session id, so the SDK rejected it every time. Now falls back to "no known id"
  (starts a fresh session) instead of a value guaranteed to be rejected — the fallback still makes
  sense for old legacy flat-file conversations, where it could be a real key; only the new
  per-workspace layout gets the corrected behavior.
- **The "Reload" button always silently failed.** It ran a bare `systemctl restart claudstermind`
  with no `sudo` and never checked the command's exit code — confirmed in production: that command
  fails immediately ("Access denied — interactive authentication required") every time for a
  non-root process, yet the dashboard confidently logged "✓ restart triggered" and reported
  success regardless. The local process had in fact not restarted even once across this entire
  session despite being clicked repeatedly. Now uses `sudo -n` (fails fast and loud instead of
  hanging on a password prompt that can never arrive) and actually watches for a fast non-zero
  exit, reporting the real failure instead of assuming success — the same "never silence"
  principle as everywhere else this session. Requires the sudoers grant already documented in
  `docs/MIGRATION-LINUX-HANDOFF.md` (or equivalent).

### Note
- This fix needs the local host to actually restart to take effect — but the very thing it fixes
  is the Reload button not restarting anything. A one-time manual restart is needed to bootstrap
  it in; after that, Reload works as designed.

## [0.9.6] - 2026-07-23

### Added
- **Deploy & Version, restructured.** The panel now shows the Local host's actually-running
  version next to its Reload button, and the Live container's actually-running version next to
  its Deploy button, both wrapped in a "Pending" banner showing what either action would produce
  — so it's visually obvious whether the two targets are already caught up or which one needs the
  button next to it pressed.
- **The local host now honestly distinguishes "running" from "pending."** A long-running process
  can have newer code on disk than what it actually loaded at boot — `/api/version`'s new
  `runningVersion` field freezes at process start, separate from `version` (always read fresh off
  disk). The container needs no such distinction (an atomic rebuild-and-swap unit has only one
  version, ever), so this only shows up for the local host.

### Fixed
- **The Deploy log could go silent at the exact moment a deploy succeeded**, when viewed from the
  live site. The blue-green swap stops the OLD container only after the new one is healthy — but
  that's also the instant a successful deploy's confirmation would be written, and the relay's
  deploy-log stream (unlike the local dashboard's own) has no buffered replay, so a browser
  watching through the old container lost the connection with nothing to show for it: looked
  exactly like a hang. Deploy's log stream now has the same timeout-and-poll-until-confirmed
  fallback the Reload button already had, so it always reaches a clear "done" or "check manually"
  instead of silence — the "maximum feedback" principle from the automaton blueprint handoff
  (`04-automaton-blueprint.md` §3), applied to the one gap where it wasn't yet.

## [0.9.5] - 2026-07-23

### Added
- **History rows for a removed worktree are now marked, orange-bordered, as historical.** Resuming
  one no longer just fails — it asks to recreate the worktree (reattaching to its original branch,
  which git keeps even after a worktree is removed) and continues the conversation there once you
  confirm.

## [0.9.4] - 2026-07-23

### Fixed
- **A worktree pane never actually ran in its own worktree.** Selecting a worktree only changed
  which conversation history it was labeled/grouped under — the underlying Claude session always
  ran in the main repo checkout regardless, silently. This went unnoticed because the history
  sidebar still correctly showed two separate conversations (e.g. `Repo` and `Repo@my-worktree`),
  which looked exactly like real isolation even though both were editing the same directory the
  whole time. A worktree pane's session now genuinely runs in its own checkout under
  `.worktrees/`, matching what the UI has always implied.
- As a direct consequence: prompting a pane whose worktree has since been removed (or was never
  created) now fails with a clear "worktree not found" message instead of silently continuing in
  the main checkout. If you have an older conversation tied to a worktree that's gone, reattach
  that pane to "main" (or recreate the worktree) before sending it a new message — the past
  conversation itself is untouched and still viewable from History either way.

### Note for the live site
- Reaches the live site only after the relay is redeployed; the work machine works immediately.

## [0.9.3] - 2026-07-23

### Fixed
- **A just-sent prompt could disappear, replaced by an older reply you hadn't seen yet**,
  specifically after leaving the Workspace tab (for any other section of the dashboard) and
  coming back. Reopening a workspace always re-fetches its conversation from the durably-saved
  file — but that file only gets written when a turn actually finishes, so returning while a turn
  was still running (or had just finished, before the write landed) showed the *previous* completed
  exchange instead, with the new prompt and its reply nowhere to be seen. Reattaching a workspace
  now prefers its **live, in-memory state** when a session is still running, falling back to the
  saved file only once nothing live remains — so whatever's actually happening is always what you
  see, whether you left mid-turn or not. This is the same live-state idea 0.9.2 used for a dropped
  connection, now applied to the "leave the tab and come back" path too, which was the bigger gap.

### Note for the live site
- Reaches the live site only after the relay is redeployed; the work machine works immediately.

## [0.9.2] - 2026-07-23

### Fixed
- **Replies could silently vanish or arrive late/out of order**, especially over a remote/mobile
  connection. Every hop between a real event happening and it reaching a browser (the local SSE
  fan-out, the tunnel to the work machine, the relay's per-browser fan-out) was fire-and-forget
  with no backlog — a client disconnected for even one event's duration lost it for good, with no
  way to catch up short of a full page reload. Two fixes, working together:
  - A reconnecting client now asks the work machine for the CURRENT live state of every pane it
    still has open, straight from the in-memory session (not the persisted file, which only
    updates at turn boundaries) — so whatever happened while disconnected is recovered instead of
    lost.
  - The stream's keep-alive pulse is now a real, observable event instead of an invisible SSE
    comment, and the browser watches for it going quiet — if none arrive for a while (a mobile
    carrier can silently kill an idle connection with no error on either side), the client now
    reconnects proactively instead of waiting on a browser error that, in exactly this situation,
    never comes.

### Added
- **See Claude typing, live** — matching the desktop app instead of one big reply landing all at
  once with nothing visible in between. Assistant replies now stream into the chat as they're
  generated, word by word, with a small blinking cursor while a reply is still in progress.

### Note for the live site
- All of this reaches the live site only after the relay is redeployed; the work machine works
  immediately.

## [0.9.1] - 2026-07-23

### Fixed
- The workspace transcript showed `⚠ undefined` for real backend errors instead of the actual
  message — the renderer read the wrong field name (`text` instead of `message`) for error events
  streamed from the server. Errors now show their real text.

### Added
- **A louder busy signal.** The pane's Send button now turns orange and reads "Working…" while
  Claude is mid-turn, reverting the instant the turn ends — a bigger, harder-to-miss companion to
  the existing small header spinner dot.

### Note for the live site
- Both changes are pure `dashboard/public/` assets — the work machine (and anyone attached to it
  through the relay tunnel) sees them on next refresh, no restart needed. The standalone live
  container has its own baked-in copy of these files from its last image build, so it needs a
  redeploy to pick them up.

## [0.9.0] - 2026-07-23

### Added
- **Continuing conversations.** Starting a chat again on a workspace you've already talked to
  picks up the whole prior conversation as real context, not just a transcript that looks
  continuous while the model actually starts fresh. History shows one thread per repository +
  worktree instead of a new entry piling up every time you start a chat there.
- **A calmer chat view.** Tool activity collapses into one line per turn instead of spelling out
  every call; a status icon on each pane spins while Claude is working and stops the moment it's
  done.
- **Local and the live site, truly shared.** Chatting from the live site on a workspace, with the
  local dashboard open at the same time, now shows the exact same live conversation on both — not
  a copy — because they're the same session underneath. Purely local sessions stay local unless a
  remote party actually touches them.
- **Attach an image.** Paste, drag-drop, or pick a file to send Claude a picture along with your
  message, the same way Claude Desktop works.
- **A safe restart button**, on the local dashboard and the live site alike. It never touches the
  running dashboard directly — it boots a sandboxed copy of the current code on the side first,
  proves it actually starts up healthy, and only then restarts for real. If that check fails,
  nothing happens to the live process and you're told exactly why, not left staring at "Restarting…"
  forever.
- **The dashboard watches its own connection to the live site**, on top of the existing crash-only
  auto-restart — an optional watchdog timer (see the migration handoff doc) can now catch and heal
  the case where the process is alive but has silently lost its link to the tunnel.

### Fixed
- The "Resume" button in workspace history could fail with no error and no way to tell what
  happened; every outcome now ends in a clear result.
- Two panes sharing one live conversation could get stuck permanently read-only after a page
  reload.

### Note for the live site
- The shared-session view, image attach, and the restart button reach the live site only after
  the relay is redeployed; the work machine works immediately.

## [0.8.0] - 2026-07-23

### Added
- **Multi-terminal workspace.** Move between terminals — laptop, phone, the local dashboard, the
  live site — on one shared conversation. The work machine's server now owns every session; each
  terminal is a live view onto it.
  - **Same chat, live, in two places.** Two terminals that open the same repository (and worktree)
    share one conversation: a prompt typed on the laptop appears in the phone's pane, and Claude's
    reply streams to both. Session identity is the repository + worktree, minted by the server —
    it used to be a random id invented in each browser, which is why a second terminal could never
    see the first.
  - **Presence.** A strip shows which terminals are connected and what each is viewing, whether
    they arrived through the live site or straight through the local dashboard.
  - **Turn lock.** While a turn is running, a second prompt to the same conversation is refused
    with a "working…" notice (and your text is kept) rather than interleaving into the agent.
  - **Worktrees.** Start a second, parallel workspace on a repository as its own git worktree
    (under `.worktrees/`, invisible to the repo map and package views). A new worktree is flagged
    "needs install" rather than silently running a minutes-long dependency install.
- Raw conversation history is now stored **per repository per worktree**, appended turn by turn
  (append-only JSONL), so a crash can lose at most the last line instead of a whole conversation.
  A retired workspace keeps its history, capped with a retirement record. Existing history is read
  unchanged — nothing needs migrating.

### Note for the live site
- Presence and the shared-session view reach the live site only after the relay is redeployed;
  the work machine works immediately. (The relay carries the new presence signal but ships no new
  code paths beyond it.)

## [0.7.2] - 2026-07-22

### Fixed
- **The live site's Deploy panel showed the pending version as "unreachable".** The relay
  hardcoded `pending: null` and the client discarded it a second time, so the work machine's
  build was never displayed remotely. The snapshot now carries that machine's version up the
  tunnel, and the panel renders the same "what would ship" locally and live.

### Removed
- The Deploy panel's **Show live log** button. The log opens itself while a deploy runs and
  replays its tail afterwards; there was nothing for the button to reveal at any other time.

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
