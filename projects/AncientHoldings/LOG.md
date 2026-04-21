# Log — AncientHoldings

---

## 2026-04-22 — Push skill added: `::cmpush` with `.secret/` token pattern

**What happened:** Added [`skills/push.md`](../../skills/push.md) documenting `::cmpush` — the operator-triggered command that commits + pushes Claudstermind to `github.com/StoaChain/Claudstermind`. Mirrors the OuronetUI pattern: token lives in `.secret/github-token.txt` (gitignored, owner creates it), skill reads it inline at push time, never persists it into `.git/config`. Added `.gitignore` to block `.secret/`, and `.secret/README.md` documenting the setup steps for the owner.

**Non-obvious:**
- The inline `https://${TOKEN}@github.com/...` URL is used once per push and discarded — avoids `git remote set-url` which would persist the token. The remote stays plain `https://github.com/StoaChain/Claudstermind.git`.
- Step 3 has a belt-and-suspenders staging-area scan for `.secret/`, `.env`, `*.key`, `*.pem`, `*.token`, `credentials` — aborts if any match. The `.gitignore` is defense #1; this is defense #2.
- Owner chose the `.secret/` pattern over the global `credential.helper store` for parity with OuronetUI's existing setup (per-repo isolation is clearer in his mental model than global-creds-for-all-repos).
- First-time git setup still requires the owner to say *y* explicitly — agents do not `git init` silently.

**Follow-ups:**
- Owner needs to create `D:/_Claude/Claudstermind/.secret/github-token.txt` with a PAT that has `repo` scope (or fine-grained write to `StoaChain/Claudstermind`)
- After that, the first `::cmpush` will trigger the first-time setup prompt and, on `y`, do `git init` + initial commit + first push

---

## 2026-04-22 — Sync keyword settled: `::cmsync`

**What happened:** Picked the canonical sync trigger. Considered `!sync` first but rejected — the `!` prefix is claimed by Claude Code's bash-mode (visible as a violet rectangle in the UI) so any `!`-prefixed word would collide. Settled on `::cmsync` (double-colon + Claudstermind-sync portmanteau): 8 keystrokes, unambiguous prefix that never appears in prose, doesn't collide with `/` slash-commands or `!` bash-mode. Updated all skill files + README + shared-conventions to use this keyword.

**Non-obvious:**
- The `::` prefix is worth preserving for future Claudstermind commands too — keeps the namespace clean. If we ever add more commands (e.g. `::cmstatus`, `::cmhelp`), they're all under the same unambiguous prefix.
- Claude Code's `!` prefix opens a bash-mode input, so any keyword starting with `!` triggers that UI before the keyword is even parsed as text. Good thing to remember for any future command design in this or other projects.

**Follow-ups:** none — keyword is now canonical across all Claudstermind docs.

---

## 2026-04-22 — Claudstermind operating-mode hardened to continuous write-back

**What happened:** Owner pushed back on the original "write at session close" model. Reframed the rule as *continuous write-back*: every response that contains a triggering event (fact shared, work landed, correction, etc.) writes to Claudstermind in the same turn, without being asked. Updated `README.md` §Operating mode, promoted this to `meta/shared-conventions.md` as **Rule zero**, and rewrote `skills/session-close.md` so it's explicit that most writes happen mid-session and the "close" is just a final sync.

**Non-obvious:**
- The owner's exact framing, preserved in session-close.md: *"working on a project that is participating should update knowledge there with every prompt — I don't want to have to tell you every time."* That quote is load-bearing for future agents reading the skill.
- Confirmation-line convention: one short `Claudstermind: LEARNING added (...)` at the end of a response. Not a header. Not a paragraph. The owner doesn't need the narration, just the receipt.
- The rule explicitly does NOT cover `git commit` / `git push` — those stay owner-driven so the owner chooses when to snapshot the cluster brain.

**Follow-ups:** none. This is a cluster-wide policy change; it applies to every project now and future, including projects not yet linked.

---

## 2026-04-22 — Claudstermind scaffold + benchmark UX + score card

**What happened:** Major cross-cutting session. (1) Rewrote the benchmark handler to emit phase markers (`===PHASE:X:start|done===`) and added granular `ctx.progress()` calls so the UI shows deps/sysinfo/cpu_single/cpu_multi/perf+stress/yabs/librespeed/parse as a checklist with live heartbeat age. (2) Built a 3DMark-style `ServerScoreCard` component with per-category tiles (CPU/Disk/Net/RAM/Commitment), formula line, contention verdict pill, history strip with sparkline, click-to-inspect past runs. New API endpoint `GET /api/admin/nodes/[id]/benchmarks` returns history + latest + stamped best. (3) Removed the 7-day benchmark cooldown; replaced with an in-flight guard. (4) Fixed the "docker container 'stoa-node' not found" error by adding a compose-file fallback path to `inspectStoaNodeContainer()` — nodes can now Start after Stop. (5) Scaffolded Claudstermind as a separate sibling repo with README, MANIFEST, meta/, skills/, and filled in `projects/AncientHoldings/`. Replaced the project's `docs/CLAUDE_ONBOARDING.md` pointer with a Claudstermind hook in `CLAUDE.md`.

**Non-obvious:**
- IonosFiveVPS benchmark "succeeded" on 22:07 UTC but yabs.sh short-circuited (YABS completed in 1 sec) — Geekbench never ran, CPU raw score fell back to sysbench × 20. ServerScore of 13.8 is arithmetically correct but semantically wrong because the baseline is Geekbench-calibrated. Not a v0.7.6p fix; added to LEARNINGS for a dedicated session.
- librespeed-cli `/releases/latest/download/…` URL 404s across all runs. Pinning a release tag is the fix.
- `tsx watch` restarts the worker on any `.ts` edit — which kills any in-flight SSH child. Mid-benchmark handler edits lose the run. Low priority but worth knowing.
- Worker concurrency is the bigger architectural bottleneck: 1 operator's benchmark blocks every other job in the queue for 8–12 min. v0.8 T2 plan item 7 covers this; proposed per-kind pools (benchmark max 4, install max 2, default max 8).

**Follow-ups:**
- yabs.sh Geekbench fallback fix (host the tarball ourselves, or pin a yabs version, or calibrate a sysbench-only baseline)
- librespeed pin to a specific release tag
- v0.8 T2 implementation — SSH pool + probe cache + bulk scheduler + WAL + per-kind concurrency
- ClaudeCurator v1 — error ingestion + triage page + `/curator` slash command
- StoaChain on-chain emission section in v0.8 plan was rewritten for 2M-gas reality; batched mint-and-register-in-AQP target Pact module sketched but not yet implemented

---

## 2026-04-22 — Session start: project linked to Claudstermind

**What happened:** AncientHoldings registered in Claudstermind as the first linked project. Knowledge base populated (ONBOARDING, STATE, ARCHITECTURE, CONVENTIONS, LEARNINGS, LOG). Existing `docs/CLAUDE_ONBOARDING.md` kept in place as fallback but superseded by this folder going forward.

**Non-obvious:**
- The owner's intent is that Claudstermind grows into a full memory of every project. Session-close updates are mandatory, not optional.
- Cross-project facts (StoaChain capacity, triple-one workflow, etc.) moved from the project-local onboarding into `meta/shared-facts.md` + `meta/shared-conventions.md`.

**Follow-ups:**
- Add StoaChain, OuronetCore, OuronetPact, OuronetUI, StoaExplorer, StoaLive to Claudstermind as they become active.
- `git init` + push Claudstermind to `github.com/StoaChain/Claudstermind` (left to the owner).
