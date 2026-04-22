# Foreign-chain nodes — cross-cluster spec

> **Status:** decided 2026-04-22. New hub capability scoped, no code yet.
> **Owners:** spec lives here in Claudstermind because it crosses two projects.
>   - **Caduceus** — *consumer.* Bridge services need RPC to a node it does not run.
>   - **AncientHoldings** — *provider.* Hub already deploys + supervises StoaChain
>     containers on operator-owned VPSes. This adds a second container type:
>     non-StoaChain L1 full nodes (BTC first, then 5 more own-node chains).
>
> Read this before writing any code in either repo that touches foreign-chain
> nodes. When this spec changes, edit it here and bump `cluster-map.md`.

---

## 1. Why this spec exists

Caduceus's first phase needs a `bitcoind` reachable over RPC for two services
(`btc-sniffer`, `btc-releaser`). Original sketch had `bitcoind` running in the
same Docker stack as the Caduceus website on `caduceus.ancientholdings.eu`.

That sketch is **wrong** for production. Reasons:

1. **Resource shape mismatch.** The Caduceus host is a small Node.js + nginx
   box (≈30 GB disk, ≈2 GB RAM). Even a *pruned* `bitcoind` is 15–20 GB on
   disk steady-state, plus ≥2 GB RAM, plus 24–48 h of cold-sync bandwidth on
   first boot. Dropping it next to the website inflates the host one tier.
2. **Lifecycle mismatch.** The website is stateless (rebuild = `git pull`).
   `bitcoind` is stateful (lose `chainstate/` and you re-sync from scratch).
   Different backup, different restart semantics, different upgrade cadence.
3. **Capability already exists.** AncientHoldings hub already does *exactly*
   this for StoaChain: deploy a container onto an operator-owned VPS, supervise
   it (start/stop/probe), watch disk + peer count, surface state in the admin
   panel. Adding a second container type is an *extension*, not new ground.
4. **Multi-chain scaling.** Caduceus eventually needs 6 own-node chains
   (BTC, LTC, DOGE, XMR, KAS, ADA). Co-locating all six on one VPS is silly;
   spreading them across the hub fleet is the same shape as the StoaChain
   fleet today.
5. **Hub UI integration is free.** The owner gets one dashboard for "what
   chain containers are running where," reusing the cards/tables/probes
   already built for StoaChain nodes.

**Decision:** foreign-chain nodes are a **hub-managed capability**, not part
of the Caduceus Docker stack. Caduceus is purely a *consumer* of these nodes
over private RPC.

---

## 2. The contract (Caduceus ↔ node)

This is the only surface Caduceus cares about. Anything below the line is a
hub-side implementation detail.

### What Caduceus provides

- **Caduceus host** runs on a separate VPS (`caduceus.ancientholdings.eu`).
  Only ships TS services + a small admin panel. Reaches the node over a
  private network.
- **Connectivity:** Caduceus opens an outbound connection. Tailscale,
  WireGuard, or an SSH tunnel — operator's choice, hub provisions it.
  **Never** a public RPC port.
- **Auth:** Caduceus reads node RPC creds from its own secrets store
  (`.secrets/`). Hub gives the operator a one-shot way to retrieve them
  during initial provisioning; rotation is a manual hub action.

### What Caduceus needs from the node

| Chain    | RPC interface     | Required capability                                                          |
| -------- | ----------------- | ---------------------------------------------------------------------------- |
| Bitcoin  | JSON-RPC + ZMQ    | `getblockhash`, `getblock`, `getrawtransaction`, `sendrawtransaction`, ZMQ `rawtx`+`hashblock`, wallet load (for `signrawtransactionwithwallet`) |
| Litecoin | JSON-RPC + ZMQ    | same shape as bitcoind (Litecoin is a fork)                                  |
| Dogecoin | JSON-RPC          | bitcoind-shaped RPC; ZMQ optional                                            |
| Monero   | `monerod` RPC     | `get_block`, `get_transactions`, `submit_raw_tx`, view-key scanning helpers   |
| Kaspa    | gRPC              | block + UTXO subscriptions, submit_transaction                               |
| Cardano  | cardano-node + Ogmios | Ogmios websocket for chain follow, submit-tx HTTP                          |

**Pruning is OK** for BTC/LTC/DOGE (`prune=10000` ≈ 15–20 GB; bridge ops
need ~6 confirmations, plenty of headroom). **txindex is NOT needed** —
Caduceus tracks deposits via wallet labels + ZMQ subscriptions to the
shared custody address, not by historical lookups.

### What Caduceus does NOT need

- Public-facing RPC. Ever.
- Mempool acceleration / rebroadcast services.
- Lightning, sidechains, oracle layers.
- Per-user wallets — Caduceus uses one shared custody address per chain,
  authored on the Caduceus side, imported into the node's wallet for receive
  visibility.

---

## 3. AncientHoldings hub — new container type

This section is the hub-side implementation brief. Familiar shape if you've
worked on `stoachain-control.ts`: same supervision pattern, different image.

### 3.1 New `nodes` table column / new table

Today `nodes` is StoaChain-flavoured (cut height, peer count, chainweb-specific
columns). Two options:

- **Option A** — add a `node_kind` column (`'stoachain' | 'bitcoind' | 'litecoind' | …`)
  and tolerate sparse columns per kind. Cheap, but `nodes` already has 52 columns.
- **Option B** *(recommended)* — new table `foreign_chain_nodes` with its own
  schema (host, kind, image tag, RPC port, wallet name, prune target, last
  block height, last sync %), and a `nodes_kind` discriminator only on listing
  queries.

Either way: **migration must be additive.** The StoaChain side cannot regress.

### 3.2 New driver: `lib/drivers/install-bitcoind.ts`

Mirror `lib/drivers/install-chainweb.ts`. Steps:

1. Pre-flight: ≥30 GB free, ≥2 GB RAM, Docker installed (reuse existing
   `ensure-docker` action).
2. Render `compose.bitcoind.yml` (template lives in `lib/drivers/templates/`)
   with operator-supplied: RPC port, RPC user, RPC password (vault-sealed,
   surfaced once for Caduceus enrolment), prune target (default `10000`),
   wallet name (default `caduceus-custody`).
3. Bootstrap path:
   - **Default:** AssumeUTXO (Bitcoin Core ≥27 native; ~6–12 h to tip).
   - **Fallback:** BTCPay snapshot import (slower, ~12 h, but tolerates older
     Core versions).
   - **Last resort:** cold sync (24–48 h on a decent VPS).
4. Image: **`lncm/bitcoind:v27.0`** (small, well-maintained, used by BTCPay).
   Not `bitcoin/bitcoin:27` — that one is for dev/CI only.
5. Healthcheck: `bitcoin-cli getblockchaininfo` succeeds AND `verificationprogress > 0.999`.

### 3.3 New handler: `lib/handlers/foreign-chain-control.ts`

Mirror `lib/handlers/stoachain-control.ts`. Operations:

- `start` / `stop` / `restart` — Docker compose up/down.
- `probe` — RPC ping + ZMQ ping + disk usage + sync %.
- `prune-now` — force `pruneblockchain <height>`.
- `wallet-load <name>` — for first-time custody-address import (Caduceus
  invokes this once per chain).
- `bootstrap-snapshot` — pull + verify a BTCPay snapshot if cold sync was
  not selected.

Same supervision-detection cascade as StoaChain (docker → compose fallback →
systemd → screen → unknown).

### 3.4 Admin UI

Add a second card-grid alongside the StoaChain node grid. Reuses
`ServerScoreCard`-style layout. Per-card:

- Chain name + image tag + version
- Sync % progress bar
- Last block height / block time
- Disk used (with prune target)
- Peer count
- Action buttons: Start / Stop / Restart / Probe / Bootstrap

Permission: `requireOwnedNodeApi()` for operator actions. Only `ancient`
role can enrol a Caduceus consumer (handing out RPC creds).

### 3.5 What this is NOT

- **Not** a StoicPower earner. Foreign-chain nodes do not accrue points,
  do not enter the `nodes` table for scoring purposes (or do, with a flag
  excluding them from the scoring worker — owner's call, but the simpler
  path is a separate table per § 3.1).
- **Not** a public RPC service. The hub only opens the RPC port to the
  Caduceus host on the private network it provisioned.
- **Not** a wallet manager. The custody address is authored by Caduceus's
  HSM-held operator key; the node is a *receive observer* and *transaction
  submitter*, not a signer.

---

## 4. Bitcoin specifics (Phase 1, the only chain that matters today)

| Setting              | Value                                              |
| -------------------- | -------------------------------------------------- |
| Image                | `lncm/bitcoind:v27.0`                              |
| Network              | `mainnet` (regtest only inside Caduceus dev compose) |
| Prune                | `prune=10000` (≈ 15–20 GB)                         |
| txindex              | **off** — wallet labels + ZMQ are enough           |
| ZMQ                  | `zmqpubrawtx=tcp://0.0.0.0:28332`, `zmqpubhashblock=tcp://0.0.0.0:28333` |
| RPC                  | `rpcbind=0.0.0.0`, `rpcallowip=<caduceus-private-ip>/32` |
| Wallet               | `caduceus-custody` (loaded post-install via handler) |
| Bootstrap            | AssumeUTXO; fallback BTCPay snapshot                |
| Disk steady-state    | 15–20 GB                                           |
| RAM                  | 2–4 GB                                             |
| First-sync time      | 6–12 h (AssumeUTXO) / 24–48 h (cold)               |

The Caduceus dev compose (`infra/docker/compose.dev.yml`) uses
`bitcoin/bitcoin:27` in **regtest** mode for unit + integration testing
only. The DEV-ONLY warning block in that file points back to this spec.

---

## 5. Roadmap — the other 5 own-node chains

Decided per-chain, but the shape stays the same:

| Phase | Chain    | Image (recommended)              | Notes                                                      |
| ----- | -------- | -------------------------------- | ---------------------------------------------------------- |
| 1     | Bitcoin  | `lncm/bitcoind:v27.0`            | this doc                                                   |
| 2     | Litecoin | `litecoinproject/litecoin-core`  | bitcoind clone; same driver shape                          |
| 3     | Dogecoin | `dogecoinproject/dogecoin`       | bitcoind clone; ZMQ optional                               |
| 7     | Monero   | `sethforprivacy/simple-monerod`  | view-key wallet model; different scanning approach         |
| 8     | Kaspa    | `supertypo/rusty-kaspa`          | gRPC interface; very different from bitcoind shape         |
| 9     | Cardano  | `inputoutput/cardano-node` + `cardanosolutions/ogmios` | two containers; Ogmios websocket is the practical interface |

The other 7 Caduceus chains (ETH, BNB, TRX, EGLD, SOL, XRP, TAO) use a
**RPC-pool with ≥2-agreement**, NOT own-nodes — they are not part of this
spec. Hub does nothing for them.

---

## 6. Security boundary (the hard line)

- **No public RPC.** Foreign-chain node RPC ports are bound to the private
  network only. The Caduceus host is the only consumer.
- **No tunnel architecture for dApp traffic.** Same constraint that applies
  to StoaChain: hub manages the box, hub is not a gateway. Caduceus dApp
  traffic flows directly from the user to `caduceus.ancientholdings.eu`,
  never through the hub or through the node host.
- **Hub does not sign bridge txs.** The hub provisions + supervises the
  node. The HSM-held operator key that signs `finalize-*` / `void-*` and
  release transactions lives on the Caduceus host, not on the node host.
- **Vault-sealed RPC creds.** RPC user/password are stored vault-sealed
  on the hub (same `lib/vault.ts` mechanism used for SSH keys). Surfaced
  once during Caduceus enrolment, then opaque.

---

## 7. Open questions (flag during AncientHoldings implementation)

- **Operator role for foreign-chain nodes.** Should `client`-role operators
  be able to enrol a `bitcoind` and earn from it the way they do StoaChain
  nodes? Probably not in v1 (no scoring model defined). But the question
  needs an answer before the admin UI ships.
- **Multi-tenancy.** Can one `bitcoind` serve multiple Caduceus deployments
  (e.g., a future testnet Caduceus alongside mainnet)? Spec assumes 1:1
  for now.
- **Snapshot trust.** AssumeUTXO is upstream-signed; BTCPay snapshots are
  community-trusted. Should the hub maintain its own canonical snapshot for
  faster operator onboarding? Defer to v2.
- **Storage quota enforcement.** Pruned `bitcoind` *should* stay under
  20 GB, but the hub's existing disk-usage probe should still alert if a
  node creeps past a configurable cap.

---

## 8. Where else to look

- **Caduceus side** —
  - [`Caduceus/docs/HOSTING.md` § Foreign-chain nodes — operator-managed infra](../../Caduceus/docs/HOSTING.md)
  - [`Caduceus/docs/HANDOFF.md` § Node posture (hybrid, off-host)](../../Caduceus/docs/HANDOFF.md)
  - [`Caduceus/docs/modules/ouronet-bitcoin/DESIGN.md` § Open question 6 (RESOLVED)](../../Caduceus/docs/modules/ouronet-bitcoin/DESIGN.md)
  - [`Caduceus/infra/docker/compose.dev.yml`](../../Caduceus/infra/docker/compose.dev.yml) — dev-only; production note in header.
- **AncientHoldings side (existing patterns to mirror)** —
  - [`AncientHoldings/lib/drivers/install-chainweb.ts`](../../AncientHoldings/lib/drivers/install-chainweb.ts) — model for `install-bitcoind.ts`.
  - [`AncientHoldings/lib/handlers/stoachain-control.ts`](../../AncientHoldings/lib/handlers/stoachain-control.ts) — model for `foreign-chain-control.ts`.
  - [`AncientHoldings/lib/vault.ts`](../../AncientHoldings/lib/vault.ts) — RPC-cred sealing.
- **Cluster** —
  - [`shared-facts.md` § Operator authors Pact; integration teams consume it](shared-facts.md) — same separation-of-duties pattern applied here.
  - [`cluster-map.md` § Caduceus ↔ StoaChain + foreign L1s](cluster-map.md).
