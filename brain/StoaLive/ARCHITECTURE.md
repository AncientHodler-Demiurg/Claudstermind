# Architecture — StoaLive

> Big-picture design that takes reading several files to grasp. This is a **planned** architecture — the repo is spec-only, so everything below describes what the specs commit to, not what code exists.

## Stack

Not yet chosen. Phase 0 ("Discovery") selects language/framework for the backend collector + gateway, frontend framework, and the 3D library. Only hard constraints from the spec:

- Backend: must support WebSocket/SSE with a reconnect-safe cursor protocol, must expose REST snapshot + history endpoints, must be able to poll HTTP endpoints on 1–2 s loops and sample filesystem sizes on 15–60 s loops.
- Frontend: must provide **both** a 3D renderer and a 2D Canvas/SVG fallback (not optional), must hit 60 FPS on desktop / 30 FPS on fallback, must embed into an external explorer shell at `/live`.
- Shared: schemas/types shared between backend and frontend, canonical definitions in `DATA_MODEL_AND_APIS.md`.

## Top-level layout

Repo today (spec-only):

```
StoaLive/
├── README.md                             ← goal, scope, assumptions
├── CLAUDE.md                             ← hard constraints + derived-metric formulas
├── VISION_AND_UX.md                      ← visual encoding, fullscreen UX, a11y
├── TECHNICAL_ARCHITECTURE.md             ← collector → normalizer → gateway → UI
├── DATA_MODEL_AND_APIS.md                ← schemas, stream frames, formulas (source of truth)
├── INTEGRATION_WITH_EXISTING_EXPLORER.md ← /live route, click-through contract
└── IMPLEMENTATION_ROADMAP.md             ← Phase 0–5 plan + AI build brief
```

Planned deliverable layout (three intentionally separated artifacts):

```
stoa-live-api/      ← backend: collector + REST + WebSocket gateway
stoa-live-ui/       ← frontend: 3D renderer + required 2D fallback, embedded in explorer
stoa-live-shared/   ← schemas/types consumed by both sides (ChainTip, BlockVisualMetric, StorageSample, stream frames)
```

How the three map onto one or more repos is undecided (monorepo vs three repos vs extension of the explorer backend is a Phase 0 question).

## Key modules / boundaries

### Collector (backend)

Owns the poll loop, tip diff, block fetch, and derived-metric computation.

- Polls `GET /chainweb/0.0/stoa/cut` every 1–2 s
- Diffs current cut against last-seen tip heights per chain
- For each chain with a new tip, fetches `GET /chainweb/0.0/stoa/chain/<id>/block?...` and `GET /chainweb/0.0/stoa/chain/<id>/header/...` (for `adjacentRefs`)
- Computes derived metrics (formulas in `DATA_MODEL_AND_APIS.md`, copied into `../../../StoaLive/CLAUDE.md`)
- **Must** checkpoint last processed height per chain — idempotent across missed polls / restarts
- Storage sampler (separate cadence): walks the node's RocksDB dir + each `pact-v1-chain-<id>.sqlite` every 15–60 s, emits `storage.delta`
- **Never** parses RocksDB internals to derive block events — engine layout is unstable, node API is the stable contract

### Normalizer / Event Emitter

Converts raw block headers + filesystem stats into canonical `BlockVisualMetric` / `StorageSample` / `ChainTip` shapes and wraps them in stream frames (`block.new`, `chain.health`, `storage.delta`).

### Realtime Gateway (WebSocket + REST)

- `WS /stoa-live/v1/stream` — newline-delimited JSON frames, each carrying a `cursor` field (e.g. `"1713170100:1:105059"`). Client sends last seen cursor on reconnect; gateway replays from there without gaps or duplicates.
- `GET /stoa-live/v1/snapshot` — current combined view (tips, latest blocks, storage totals) for page load
- `GET /stoa-live/v1/history?from=...&to=...` — downsampled series for charts and replay
- `GET /stoa-live/v1/health` — collector/API health, lag status
- WS reverse-proxy idle timeout must be ≥ 5 min in deployment

### Time-series Store

Retains historical metrics for charts + replay. Implementation open (could be in-memory ring buffer for MVP, SQLite/TimescaleDB later).

### UI — Scene Renderer

- 10 chain lanes (one per chain ID `0..9`, fixed order for operator muscle memory)
- Blocks spawn as spheres at lane head and drift along timeline depth
- Sphere encoding: **radius** = `gasRatio`, **color** = interval health (green/yellow/red), **opacity** = empty vs heavy, **stroke/halo** = cross-chain `adjacentRefs` present
- Hover → tooltip (`height`, `hash`, `gasUsed`, `txCount`, `timestamp`)
- Click → opens explorer block detail page (existing explorer route, inline drawer or new tab)
- Optional "constellation mode" — chains as a circular graph with adjacency edges
- Fullscreen route `/live/fullscreen` with `F`/`Space`/`1..4` keyboard shortcuts

### UI — 2D Fallback (required, not optional)

Canvas/SVG renderer that exposes the same information. Spec-level requirement for low-power devices and accessibility.

## Data model

Canonical shapes live in `DATA_MODEL_AND_APIS.md`. Summary:

- **`ChainTip`** — `{ chainId, height, hash, timestamp }`
- **`BlockVisualMetric`** — `{ chainId, height, hash, parentHash, adjacentRefs, creationTimeMicros, intervalSec, txCount, gasUsed, blockGasLimit, gasRatio, isEmpty }`
- **`StorageSample`** — `{ timestamp, rocksDbBytes, sqliteBytesTotal, sqliteByChainBytes: { "0": …, "1": …, …, "9": … } }`

Stream frame envelope:

```json
{ "type": "<event>", "cursor": "<string>", "data": { … } }
```

Event types: `block.new` (carries cursor for replay), `chain.health` (e.g. `{ chainId, status: "normal"|"degraded"|"stalled", tipLagSec }`), `storage.delta` (windowed deltas).

### Derived metrics (canonical, do not improvise)

- `gasRatio = min(gasUsed / blockGasLimit, 1.0)` — drives sphere radius
- `intervalSec = block.creationTime - previousBlock.creationTime` — drives color bucket
- `stalled = intervalSec > stallThresholdSec` (default `180 s` per `VISION_AND_UX.md`)
- `heavyBlock = gasRatio ≥ 0.85`
- `emptyBlock = txCount == 0` (fallback: `gasUsed == 0` when tx count is unavailable)
- `adjacentRefs` from block headers → halo/stroke and the optional chain-adjacency graph

## External surfaces

- **Upstream (read):** StoaChain node at `/chainweb/0.0/stoa/cut` + per-chain block/header endpoints. Optional: explorer indexer for tx/gas enrichment. Filesystem: RocksDB directory and `pact-v1-chain-<id>.sqlite` per chain.
- **Downstream (serve):** REST snapshot/history/health + WS stream to browsers. Same origin as the host explorer if at all possible (CORS avoidance).
- **Secrets:** none. Read-only paths, no DB credentials exposed to the frontend. Any upstream DB connections (explorer indexer) terminate inside the backend.

## Workflow / execution model

```
            every 1–2 s                 per affected chain        derive         emit
┌─────────┐  GET /cut  ┌───────────┐  GET /chain/<id>/block   ┌───────────┐  cursor+frame  ┌──────────┐
│ chainweb│ ─────────► │ Collector │ ───────────────────────► │ Normalizer│ ─────────────► │   WS     │ ─► browser
│  node   │            │  (tip diff│  GET /chain/<id>/header  │  (metrics)│                │ Gateway  │
└─────────┘            │ + ckpt)   │                          └───────────┘                └──────────┘
                       └─────┬─────┘                                  ▲                           ▲
                             │ every 15–60 s                          │                           │ REST snapshot / history / health
                             ▼                                        │                           │
                       ┌───────────┐                                  │
                       │  Storage  │ ── walks RocksDB dir + ──────────┘
                       │  Sampler  │    pact-v1-chain-<id>.sqlite
                       └───────────┘

                             ┌─────── browser scene update ────────┐
                             │  3D renderer (Three.js-class) OR    │
                             │  2D Canvas/SVG fallback — same data │
                             └─────────────────────────────────────┘
```

End-to-end latency budget from "new block on chain" to "visible sphere in browser": **< 2 s**.

## Known weak points (spec-flagged risks)

- **Missing gas/tx fields in direct node API** — mitigation: enrich from explorer indexer when available, else fall back to `gasUsed == 0` for `emptyBlock`.
- **High render cost in browser** at scale — mitigation: cap active scene objects, use instancing, force-fall-back to 2D on low-end devices.
- **Ambiguous per-block storage growth** — RocksDB writes are not 1:1 with block production. Mitigation: show windowed growth trends (`storage.delta`), never per-block byte attribution.
- **WS reverse-proxy idle timeouts** shorter than 5 min will kill long-lived streams silently.
