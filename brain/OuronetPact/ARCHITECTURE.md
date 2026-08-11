# Ouronet architecture (module map + spine)

> How Ouronet is built in Pact. Source: `OuronetInformational/ouronet/architecture/*`, `CONTEXT.md`,
> module-build handoffs. Ouronet = a virtual DeFi system written **entirely in Pact**, deployed in
> stages onto **StoaChain** (a Chainweb-class fork, after Kadena LLC wound down) under `ouronet-ns`.
> `1_SOVEREIGN/` = canonical, project-authored; `2_SLAVE/` = anyone can write, calls sovereign APIs.
> Scale (approx): ~76 module files, ~3300 `defun`, ~755 `defcap`, ~175 `deftable`.

## Layering: Utilities → Core → Talos (Aggregator)

- **Utilities** (Stage 1 only) — shared helpers/consts/guards (`U|CT`, `U|DALOS`, `U|G`, `U|ST`, `U|INT`, `U|ATS`, …). Load first, no product tables.
- **Core** — business logic + domain tables + protected recipes (`C_`/`A_`/`X*`) + policy spine.
- **Talos (Aggregator)** — the **only supported client path**; thin `@event` shells composing core recipes into blessed sequences; owns no domain tables.

## Module families

**Stage 1:** **DALOS** (`DALOS`,`U|DALOS`) = account/identity/governance hub most policies anchor to (largest tier). **IGNIS** = virtual gas token (cumulators, fee collection). **Fungibles (TFT family)**: `DPTF` (true fungible), `DPOF` (orto/meta — the live meta-token path), `DPMF` (legacy, migration only), `TFT` (transfer orchestration), `BRD` (branding). **ELITE**. **Staking/vesting/liquid**: `ATS` (largest module), `ATSU`, `VST`, `LIQUID`, `OUROBOROS`. **Swapper stack** (split for deploy size): `SWPT`/`SWP`/`SWPI`/`SWPL`/`SWPLC`/`SWPU`/`MTX-SWP`. **Info**: `INFO-ZERO`/`INFO-ONE` (client-info objects Talos reads before core `C_`). **CODEX** (`22_CODEX`) = identity+StoicTags+Arweave registry (template for later registries). **PYTHIA** (`23_PYTHIA`) = on-chain metering ledger. **Talos S1**: `TS01-A`, `TS01-C1..C4`, `TS01-CP/P`.
**Stage 2:** **DPDC (collectables)** — sharded across `DPDC-UDC` (central schemas, `DpdcUdcV1`), `DPDC` (SFT vs NFT via `son:bool`), `DPDC-C/I/R/MNG/T/S/F/N`, `EQUITY`; table prefixes `DPSF|`/`DPNF|`. **DemiPad (launchpad)**: `DEMIPAD` + `-SPARK/-SNAKES/-CUSTODIANS/-STOICPAY`, `STOAICO`. **AQP (acquisition/earning pools)** — the convention-mature reference subsystem: `AQP-ANK` (anchors) → `AQP-SCORE` (scores/links) → `AQP-POOL` (pools/trackers/stake) → `AQP-FVT` (farms/vaults/treasuries) → `AQP-VCT` (vacate); **deploy order ANK→SCORE→POOL→FVT→VCT**. **INFO-TWO**. **Talos S2**: `TS02-C1/C2/C3`, `TS02-DPAD`.
**Slave:** `DPL-UR` (`DeployerReadsV7` UI read bundle), `AOZ`, `DSP`, content pipelines `NOSFERATU`/`KBunnies`/`Bloodshed`.

## Deploy / dependency structure

- Kadena's **~150k deploy-gas cap** (StoaChain runtime raised to ~2M block gas) forces **strict deploy order — a module may only call already-deployed modules.** Hence module-ref `::` (not `MODULE.fun`) and interfaces carrying almost the whole public API; big verticals (DPDC/SWP) are sharded to fit.
- **Interface versioning cascade:** interfaces end in `V1/V2/…`, +1 per revision. Bumping interface B forces every interface A that names B (`module{B}`, `object{B.Schema}`) to cascade, and all typed consumers update together. A module `implements` only the **latest**. Same-interface schemas unqualified; foreign schemas `object{OtherIface.Schema}`.
- **Deploy template:** Interfaces (bumped+new) → Utilities → Core → Talos → Executor/governance wiring (`P|A_Define`, keysets) → smoke REPLs. Each release classifies interfaces Bumped/New/Unchanged.

## The policy / IMC spine

Each module starts with policy tables (`P|T`/`P|MT`) — shared guard structures so modules authorize each other **without touching each other's caps** (the hard rule). `UEV_IMC` = the caller check every cross-module mutator runs first. `P|A_Define`/`P|A_Add`/`P|A_AddIMP` register caller guards (`create-capability-guard (P|MOD|CALLER)`, `P|TALOS-SUMMONER`) so `UEV_IMC` passes. **Load-cycle rule:** core `P|A_Define` wires IMP only to other core; Talos adds `P|TALOS-SUMMONER` to the cores it calls; any link needing both loaded runs at **executor time** (module refs resolve at load, so targets must pre-exist). Latest module interface ships **in the module's file**; only shared (`OuronetPolicyV1`, `OuronetInfoV1`, `IgnisCollectorV1/V2`, `DpdcUdcV1`, `BrandingV1`) + historical interfaces live in `0_Interfaces/`.

## Why Talos gates gas

`A_`/`C_` are locked inside their home module and can't self-invoke, so **Talos** composes them into blessed sequences and can force "run `C_` **then** collect IGNIS" — clients can't skip gas. The gas station pays only Talos-defined paths. **A new `A_`/`C_`/protected `X` isn't production-final until wired into the right Talos module.**

## Real build lessons (from the handoffs)

- **Immutable registry (`CODEX`):** `IMMUTABLE-GOV` = `(enforce false …)` (upgrade-impossible by design; bugfix = new module `CODEX-V2`), distinct from an `ADMIN` cap gating inserts. Rows immutable except a guard-rotation requiring **both** old (stored-guard cap) and new (`enforce-guard new`) to sign. Append-only Arweave log; "latest" derived via `select`, not a mutable pointer. Two-table bijection (name↔account) via `insert`-collision. Registration is **cost-gated (STOA fee), not admin-gated**. Gotcha: **Pact can't verify Apollo-curve sigs** — dual-Apollo is off-chain trust.
- **Bulk transfer (`coin.transfer-bulk`):** one `@managed TRANSFER_BULK(sender,total)` with a one-shot mgr consuming the whole budget; single debit of `total = (fold (+) 0.0 amounts)`, then `zip`/`map` credits — O(n), one tx pays thousands. **Loudly documented:** the cap authorizes a **budget, not a recipient list** (optionally bind `(hash [receivers amounts])`).
- **Ping-pong asymmetry (`APIARY`, PYTHIA):** the payer **cannot** self-activate — `C_Deploy…` is owner-capped + toll; `A_TurnOn/Off` is **Cronoton-keyset-only**. Keyless Pythia signals a keyed Automaton that executes `A_Flush`; reads are public/keyless. "Don't let the owner's guard satisfy the on/off cap" is a requirement, not an oversight.
- **PYTHIA ledger flush gas win (~800×):** move per-entry validation to a **single batch `fold` in the cap** (`UEV_FlushEntries`), existence checks via **`try`/`read` not `(keys …)`**, and never `enforce` inside `XI_`. Dropped ~80k → ~103–217 gas **per day-entry**. `pondus` stays `decimal` (never scale to int). Order-independent sharding: `total = total − oldDay + newDay`.
- **Binding-as-gate (Pythia dual-Apollo):** an unbound smart key is inert, so no admin needed; `consumer` set-once-then-immutable; `iz-active`/`iz-revoked` separate so the immutable link survives revocation; `C_Bind` needs both signatures; a cheap `URC_RevocationEpoch` monotonic counter is the fast-lane read.
- **AQP recipe law:** each public `C_*` owns one master cap holding ALL validation (via `UR_/URC_/URDC_`, never raw `read`/`select` in `C_`); `C_` body = `UEV_IMC → with-capability → let (compute only) → call X_*`, no enforce/write. `X`-writes never return `OutputCumulator` (that's built in `C_`/forward orchestrator). `XI` same-module (SECURE) / `XB` bidirectional (IMC replaces SECURE) / `XE` forward (`UEV_IMC` + named cap) — don't add a parallel `XE_+@event` when IMC + an existing recipe cap already authorizes.

> Caveat: the handoffs describe **specs/intended patterns**, some design-locked-not-yet-built; the archived `.pact` tree can drift from the deployed chain — verify against deployed modules.
