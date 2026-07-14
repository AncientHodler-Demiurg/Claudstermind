# Conventions — StoaLive

> Project-specific norms that *override or extend* the cluster-wide conventions in [`../../meta/shared-conventions.md`](../../meta/shared-conventions.md).

## Extensions (StoaLive-specific, not cluster-wide)

- **`DATA_MODEL_AND_APIS.md` is the source of truth for shapes.** When writing TypeScript/JSON types in any of the three planned artifacts (`stoa-live-api`, `stoa-live-ui`, `stoa-live-shared`), don't improvise a `BlockVisualMetric` / `ChainTip` / `StorageSample` field name — copy from that file. If reality diverges, edit the doc first, then the code.
- **Derived-metric formulas are canonical.** `gasRatio`, `intervalSec`, `stalled`, `heavyBlock`, `emptyBlock` are specified in `DATA_MODEL_AND_APIS.md`. Re-deriving them differently (e.g. `gasRatio = gasUsed / 2_000_000` hard-coded) is a bug.
- **Read-only data paths only.** No endpoint in `stoa-live-api` may mutate chain state or write to Chainweb storage. No frontend bundle may carry DB credentials. This is load-bearing for the whole project's threat model.
- **Never parse RocksDB live for block events.** Use the node API. RocksDB + per-chain `pact-v1-chain-<id>.sqlite` file sizes are sampled (15–60 s) *only* for coarse storage-growth overlays.
- **WebSocket frames must carry a `cursor` and the client must resume from its last-seen cursor.** Gaps and duplicates on reconnect are bugs, not edge cases.
- **Collector must checkpoint last processed height per chain.** Must be idempotent across missed polls and restarts.
- **Never encode information in color alone.** Every piece of color-coded state in the 3D scene also appears as a textual value in the side panel. This is an accessibility requirement, not a nice-to-have.
- **2D Canvas/SVG fallback is required.** Not a future task, not optional, not gated on user request. The fallback renders the same information as the 3D view for low-power devices.
- **Performance budgets are contractual:** WS payload < 20 KB/s in normal activity, 60 FPS desktop, 30 FPS fallback, < 2 s end-to-end latency from new block to visible sphere.
- **Click-through to the existing explorer's block detail page.** Do not build a replacement detail page inside StoaLive; navigate out to the explorer's existing route.
- **Phase ordering matters.** Phase 1 (backend MVP) → Phase 2 (frontend MVP — 2D first, then 3D) → Phase 3 (storage overlays) → Phase 4 (fullscreen + replay) → Phase 5 (hardening). Don't pull Phase 3/4 work forward before Phase 1/2 lands.

## No overrides

Cluster-wide conventions in [`../../meta/shared-conventions.md`](../../meta/shared-conventions.md) apply verbatim — including Rule zero (continuous write-back), "label speculation vs fact", "never commit unless explicitly asked", and the safety rules around destructive git operations.

Once a stack is picked in Phase 0, expect additions here: lint/format choices, file-naming rules for the three artifacts, WS frame-versioning policy.
