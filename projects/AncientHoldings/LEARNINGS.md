# Learnings — AncientHoldings

> Durable facts and non-obvious rules accumulated across sessions. Append-only with edits-to-refine.

---

### Worker does not hot-reload under plain `npm run worker`

**Why:** burnt ~4 hours of debugging over multiple sessions when handler edits appeared not to take effect; the worker was running but using the pre-edit compiled code.
**How to apply:** Claude verifies `npm run worker:watch` is what's running (not `worker`). On every code change: bump `lib/version.ts` suffix, the watcher prints the new banner — if the banner doesn't print the new version, the watcher didn't pick up the change and must be restarted.
**Added:** 2026-04-21

### Owner does not manage the worker

**Why:** owner explicitly delegated this — "Claude owns the worker." Multiple incidents where the owner was asked to restart and the cycle became lossy.
**How to apply:** on every version bump, Claude kills the old worker, starts `worker:watch` in the background, verifies the banner. Do not ask the owner to restart.
**Added:** 2026-04-21

### Every manual Claude fix must become a UI feature

**Why:** production operators won't have Claude available to SSH into their boxes. If the hub requires manual help to stay healthy, the hub is broken.
**How to apply:** after any manual SSH fix (sudoers patch, compose file repair, DB edit), file a follow-up task to make the hub do it automatically. "It worked once by hand" is not done.
**Added:** 2026-04-21

### Label speculation vs fact

**Why:** owner has caught incorrect guesses presented as facts multiple times; it erodes trust.
**How to apply:** when reasoning beyond probed data, preface the statement with *"speculation:"* explicitly. Never round up an inference to a claim.
**Added:** 2026-04-21

### Ancient-admin override shows as ⚑ purple on OAS badge

**Why:** owner was confused when StoaNodeOne (codera-owned via override) showed no Ouronet even though codera had set a profile Ouronet — the scoring-state API was returning `nodes.ouronet_account` directly (which was stale / pre-refactor) instead of calling the resolver.
**How to apply:** any code path showing "the account this node earns into" must go through `resolveNodeOuronetAccount(nodeId).account` — never read `nodes.ouronet_account` directly. The OAS badge (Ouronet Account Supervision) uses purple ⚑ for per-node override, gold ★ for ancient-admin set without override, blue ◆ for modern, grey ◇ for client.
**Added:** 2026-04-22

### `docker compose down` deletes the container — restart path must fall back to compose file

**Why:** IonosFive Start action failed because `docker ps -a` returned nothing after a Stop — the compose file on disk was the only evidence of supervision. Before the fix, users couldn't restart a node they'd stopped.
**How to apply:** `inspectStoaNodeContainer()` now has Path A (docker inspect) + Path B (compose file parse from canonical roots). Any new docker-supervision code must handle both container-exists and container-removed-but-compose-exists states.
**Added:** 2026-04-22

### yabs.sh short-circuits silently on some VPS egress policies

**Why:** IonosFiveVPS benchmark showed "YABS completed in 1 sec" in the raw stdout — Geekbench didn't actually run (no internet egress for the uploader, or TLS handshake blocked). Falls back to `multiStats.mean × 20 = ~220k` for CPU raw, which when divided by the 5000 baseline inflates the contribution to ~8.8, producing a ServerScore of 13.8 that is *arithmetically correct but semantically wrong*.
**How to apply:** the 5000 baseline was calibrated against Geekbench6 multi-core. Don't substitute sysbench raw events against it. Fix on the roadmap: either (a) host the Geekbench tarball ourselves + install before yabs, (b) pin yabs.sh to a specific version with known fallback behavior, or (c) calibrate a separate sysbench baseline. Until fixed, partial/failed benchmarks on IonosFive-like boxes will score high.
**Added:** 2026-04-22

### librespeed-cli `latest` release tarball 404s

**Why:** the GitHub release URL scheme changed at some point; `https://github.com/librespeed/speedtest-cli/releases/latest/download/librespeed-cli_linux_amd64.tar.gz` now returns 404. Benchmarks on fresh boxes score 0 for network.
**How to apply:** pin a specific release tag in the benchmark script instead of `latest`. Also consider shipping the binary to the target from the hub (we already do this for other tools).
**Added:** 2026-04-22

### Partial benchmark runs must NOT update `nodes.server_score`

**Why:** IonosFiveVPS produced a ServerScore of 13.8 from a partial run (yabs.sh egress blocked → Geekbench null → CPU raw fell back to `sysbench × 20` = 220k, 44× the baseline). That inflated score got stamped as `nodes.server_score` and would have outranked a legitimate successful run on a better machine.
**How to apply:** `status === 'success'` is now the only condition that updates `nodes.server_score`. Partial runs (missing Geekbench OR fio OR librespeed) record to `benchmark_runs` for history but don't move the headline. CPU fallback also capped: `min(baseline=5000, sysbench/2)` instead of `sysbench × 20`. Breakdown carries `cpu.measurementSource: 'geekbench6' | 'sysbench-fallback'`.
**Added:** 2026-04-22

### Benchmark is meaningless without a provisioning commitment — gate it

**Why:** the ServerScore formula has `provisionContribution = WEIGHT_PROVISION × (committedGb / minRequiredGb)`. With committedGb = 0 that term is 0 and the formula is broken — you'd be scoring a node that isn't actually committed to anything. Worse, the disk-IO portion of the benchmark doesn't point at the committed volume without the path being declared.
**How to apply:** `POST /api/admin/nodes/[id]/benchmark` returns 400 when `committed_gb ≤ 0` or no effective provision path exists. The Run benchmark button in NodeScoringCard is disabled in the same situations with a tooltip directing the operator to Step 2. UI + API both gate.
**Added:** 2026-04-22

### yabs.sh `-g` and `-f` flags SKIP the tests, not enable them

**Why:** Handler's `BENCH_SCRIPT` had been invoking `/tmp/yabs.sh -i -n -g -f` since first ship. Upstream getopts parser: `-g` = SKIP geekbench (it's opt-OUT because Geekbench runs ~5 min), `-f` = SKIP fio. Net effect: yabs ran with every core test disabled. Every benchmark on every node produced null Geekbench + 0 fio, which the old CPU-fallback formula then inflated via sysbench × 20. This is why ALL old stamps were effectively commitment-ratio artifacts, not performance measurements.
**How to apply:** Correct invocation is `-i -n -6` (skip network noise, run fio via default, run Geekbench 6 explicitly). When depending on third-party wrapper scripts, verify flag semantics against upstream source — never trust memory of what flags "probably" do. For yabs specifically: `-b` force-prebuilt fio, `-d` or `-f` skip fio, `-i` skip iperf, `-g` skip geekbench, `-n` skip network, `-r` reduced iperf sites, `-4/-5/-6` geekbench version selection.
**Added:** 2026-04-22

### No "safe" restamp mode — always honest

**Why:** Owner pushed back on splitting restamp into safe + honest modes. Correct framing: a stamp that doesn't match current-algorithm reality is always wrong, regardless of whether the source row was "success" or "partial". Giving operators a "safe" mode that preserves the inflated value is a footgun — they may inadvertently keep earning off a wrong stamp.
**How to apply:** Restamp ALWAYS falls back to best-recomputed-partial when no success run exists under current rules. Never nulls the stamp (accrual is always preserved against SOME honest value). The API retains `mode` param for forward-compat but UI hardcodes `honest`. When designing similar "preserve vs correct" dichotomies in future, default to correction; preservation as user-facing option is anti-pattern.
**Added:** 2026-04-22

### Restamp (data recompute) ≠ re-benchmark (fresh SSH run) — keep the two operations distinct

**Why:** Owner conflated the two when asking for fleet-wide restamping to "only work for nodes with chainweb off + provisioning set." Restamp re-evaluates stored `benchmark_runs.breakdown_json` against the current algorithm — zero SSH, zero network, zero preconditions needed on the target. Re-benchmark actually runs yabs.sh etc. on the node — needs chainweb stopped + commitment declared, and is a 1000×-serial problem without worker concurrency.
**How to apply:** Name the two operations unambiguously. Restamp = pure data pipeline; Re-benchmark = job-queue SSH flow. UIs should not mix their preconditions. The fleet-wide action in `/admin/fleet-maintenance` is the restamp variant; a future "fleet re-benchmark" action should be a separate UI with node-eligibility filtering (skips chainweb-running nodes) and a concurrency-limited job enqueue.
**Added:** 2026-04-22

### Naive "clear all benchmark history" = accrual pause; always earning-preserve by default

**Why:** The eligibility engine's gate #2 is `ServerScore > 0`. Clearing all `benchmark_runs` + nulling `nodes.server_score` makes gate #2 fail → accrual pauses until a new successful benchmark completes. An online operator typing "clear stale scores" doesn't expect their node to stop earning — the cure would be worse than the disease.
**How to apply:** Default reset/prune semantics MUST preserve the stamped score if any successful history exists. `DELETE /benchmarks/[runId]` recomputes stamp from best remaining success. `POST /benchmarks/reset` defaults to "keep best success run + stamp"; only nulls stamp when `{ clearStamp: true }` is explicitly set, and the UI double-confirms + password-gates that path (hidden inside a "⚠ danger zone" panel). The "algorithm changed, start clean" use case exists — but it's explicit opt-in, not default.
**Added:** 2026-04-22

### `.env.local` missing = silent state; local folder may lack dotfiles entirely

**Why:** D:/_Claude/AncientHoldings/ was found to have NO `.git`, NO `.env.local`, NO `.gitignore`, NO `.env.local.example` — ONLY `.next/` among dotfiles. Worker kept running because it had env loaded into its process memory at original startup time (Git Bash PID 72788 parent). Dev server crashed with *"IRON_SESSION_PASSWORD must be set"* as soon as it was restarted without the env in its new shell's scope.
**How to apply:** when a Next.js boot fails on missing env, first check **physical presence** of `.env.local` on disk (not just shell env). Windows file-copy operations (Explorer drag-copy) can silently drop hidden files — a common way folders end up "stripped" of dotfiles without the user knowing. For critical projects, a quick `ls -la | grep '^-.*\.'` at session-start catches this early.
**Added:** 2026-04-22

### Hub-generated SSH keys in `secrets_vault` ARE recoverable via `rotateMasterKey()` IF the original key is alive in memory

**Why:** [`lib/rotation.ts`](../../../AncientHoldings/lib/rotation.ts) has a full zero-downtime master-key rotation routine: decrypt every `secrets_vault` row with the OLD key (from `process.env.SECRETS_MASTER_KEY`), re-seal with a NEW key, rewrite every `.ahbk` archive header, persist new key to `.env.local`, flip `process.env` in-place. Used via the `/api/admin/security/rotate-master-key` endpoint.
**How to apply:** if `.env.local` is lost but the worker is still alive with env in memory, you can recover by enqueueing a rotation job (would need to add a `rotate-master-key` handler to the worker — doesn't exist yet but the underlying `rotateMasterKey()` lib is ready). Key window: the worker must not restart (no `.ts` file edits → no `tsx watch` reload). If tsx restart happens, the new child spawned inherits env ONLY IF the parent shell is still alive with the var set.
**Added:** 2026-04-22

### Server's `SECRETS_MASTER_KEY` will NOT match local vault — always diverges

**Why:** In this session tested the server's key against a local vault entry via `crypto_secretbox_open_easy` — decrypt FAILED. The dev and prod keys were generated independently at setup, and the server re-seals its own SSH keys after each node install.
**How to apply:** NEVER pull a full server `.env.local` down to local unless you're OK with local vault becoming unreadable. Pulling non-secret vars (`ANCIENT_ADMIN_EMAILS`, `MAILCOW_API_*`, `MAIL_IMAP_*`) is safe because they're endpoint config, not crypto.
**Added:** 2026-04-22

### Turbopack can lock up on big file trees — Ctrl+C + restart

**Why:** observed while editing `lib/handlers/*` during the v0.7.6q session — Next.js dev process (PID 66440) held 1.9 GB RAM with the browser stuck showing the "Compiling" medallion indefinitely. Typecheck passed independently; it was Turbopack's own pipeline stalled.
**How to apply:** Ctrl+C the `npm run dev` shell and re-run. Fresh compile finishes in ~5s. Don't try to recover the stuck process. The worker (`worker:watch`) is a separate process and isn't affected by Turbopack's state.
**Added:** 2026-04-22

### Home node must use DuckDNS, not raw IPv4

**Why:** Telekom (owner's home ISP) rotates IPs. Hard-coding the IP in the hub's node record breaks connectivity after any rotation.
**How to apply:** when adding the home Linux test machine, use `bytales.duckdns.org:2222`. The dev-box `id_ed25519` is installed for direct SSH (`bytales@192.168.2.112:2222` works locally but not from the hub).
**Added:** 2026-04-21

### Scoring-state must resolve Ouronet, not read the column

**Why:** per-login profile Ouronet refactor landed v0.7.6; per-node `nodes.ouronet_account` column is now an *override*, not the default. Code paths reading it directly see stale data.
**How to apply:** always call `resolveNodeOuronetAccount(nodeId)` which walks per-node → profile → none. Includes the scoring-state API, earnings snapshot, and the "Earning into:" indicator on the node detail page.
**Added:** 2026-04-22
