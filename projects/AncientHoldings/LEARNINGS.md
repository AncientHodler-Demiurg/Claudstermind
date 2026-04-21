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

### Home node must use DuckDNS, not raw IPv4

**Why:** Telekom (owner's home ISP) rotates IPs. Hard-coding the IP in the hub's node record breaks connectivity after any rotation.
**How to apply:** when adding the home Linux test machine, use `bytales.duckdns.org:2222`. The dev-box `id_ed25519` is installed for direct SSH (`bytales@192.168.2.112:2222` works locally but not from the hub).
**Added:** 2026-04-21

### Scoring-state must resolve Ouronet, not read the column

**Why:** per-login profile Ouronet refactor landed v0.7.6; per-node `nodes.ouronet_account` column is now an *override*, not the default. Code paths reading it directly see stale data.
**How to apply:** always call `resolveNodeOuronetAccount(nodeId)` which walks per-node → profile → none. Includes the scoring-state API, earnings snapshot, and the "Earning into:" indicator on the node detail page.
**Added:** 2026-04-22
