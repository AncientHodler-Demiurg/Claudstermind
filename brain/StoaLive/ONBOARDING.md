# Onboarding — StoaLive

> Durable orientation. The `load-cluster` skill reads this after the cluster meta.

## One-line identity

Planned real-time, 3D "live pulse" of StoaChain — a read-only observability module that embeds into the existing block explorer at `/live` and renders all 10 chains as animated block-spheres keyed to gas/interval/storage metrics.

## Who owns it

- **Primary owner:** Mihai (bica.mihai.g@gmail.com)
- **Contributors:** none on record
- **Stakeholders:** StoaChain operators (health-at-a-glance), developers (click-through to explorer block detail), community viewers (fullscreen cinematic mode)

## What it does

Polls a StoaChain node's `/chainweb/0.0/stoa/cut` endpoint every 1–2 s, diffs the per-chain tips, fetches each new block, computes derived visual metrics (gas ratio, inter-block interval, cross-chain refs), and streams them over a reconnect-safe WebSocket to a browser scene. A 2D Canvas/SVG fallback is required, not optional. It also samples filesystem storage growth (RocksDB directory bytes + per-chain Pact SQLite bytes) at 15–60 s to drive coarse overlay charts. Observability only — never submits transactions, never writes to Chainweb storage, never replaces the explorer's existing block pages.

## How to run / develop it

- **Clone:** `git clone https://github.com/StoaChain/StoaLive.git D:/_Claude/StoaLive/`
- **Install / Dev server / Build / Test / Deploy:** **not yet applicable.** The repo is spec-only (six markdown files + git). Stack, language, build system, and test runner are deliberately undecided — selected during Phase 0 "Discovery" per `IMPLEMENTATION_ROADMAP.md`. Do not invent commands until that decision lands.

## Read-in-order list for a fresh agent

1. [`README.md`](../../../StoaLive/README.md) — goal, scope, assumptions
2. [`CLAUDE.md`](../../../StoaLive/CLAUDE.md) — hard constraints + derived-metric formulas (auto-loaded)
3. [`DATA_MODEL_AND_APIS.md`](../../../StoaLive/DATA_MODEL_AND_APIS.md) — **source of truth** for schemas, stream frames, and derived-metric formulas
4. [`TECHNICAL_ARCHITECTURE.md`](../../../StoaLive/TECHNICAL_ARCHITECTURE.md) — collector → normalizer → gateway → UI flow
5. [`VISION_AND_UX.md`](../../../StoaLive/VISION_AND_UX.md) — visual encoding, fullscreen UX, accessibility rules
6. [`INTEGRATION_WITH_EXISTING_EXPLORER.md`](../../../StoaLive/INTEGRATION_WITH_EXISTING_EXPLORER.md) — `/live` route contract, click-through navigation
7. [`IMPLEMENTATION_ROADMAP.md`](../../../StoaLive/IMPLEMENTATION_ROADMAP.md) — phased plan (Phase 0–5) + AI build brief

## Critical context — facts a fresh agent must internalise

- **Spec-only repo as of 2026-04-22.** No source code, no `package.json`, no tests. One commit (`262052b Add initial StoaLive architecture and implementation docs`). Anything asking "how do I run it" is a Phase 0 decision, not a lookup.
- **Three planned artifacts, deliberately separated:** `stoa-live-api` (backend collector + REST/WS gateway), `stoa-live-ui` (frontend 3D + 2D-fallback renderer), `stoa-live-shared` (schemas/types). Types come from `DATA_MODEL_AND_APIS.md` — don't invent shapes.
- **Read-only always.** No endpoint mutates chain state or writes to Chainweb storage. DB credentials never reach the frontend.
- **Live block events must come from the node API**, never from parsing RocksDB directly. Engine layout is unstable. RocksDB and per-chain `pact-v1-chain-<id>.sqlite` file sizes are only sampled (15–60 s) for storage-growth overlays.
- **WebSocket frames carry a `cursor`.** The client replays from its last-seen cursor on reconnect; gaps and duplicates are bugs. Collector checkpoints last processed height per chain and is idempotent across missed polls.
- **2D fallback renderer is required**, not optional. Low-power devices.
- **No color-only information.** Side panel always shows textual values (accessibility).
- **Performance budgets are contractual:** WS payload < 20 KB/s in normal activity, 60 FPS desktop target, 30 FPS fallback, end-to-end latency (new block → visible sphere) < 2 s.
- **Derived metric formulas are canonical** (see `DATA_MODEL_AND_APIS.md`): `gasRatio = min(gasUsed / blockGasLimit, 1.0)`, `intervalSec = block.creationTime - previousBlock.creationTime`, `stalled = intervalSec > 180s` (default), `heavyBlock = gasRatio ≥ 0.85`, `emptyBlock = txCount == 0` (fallback: `gasUsed == 0`). Cross-chain halo driven by `adjacentRefs` from block headers.
- **`AI_BUILD_BRIEF.md` referenced in `README.md` does not exist.** The canonical handoff lives at the bottom of `IMPLEMENTATION_ROADMAP.md`.

## Dependencies on other cluster projects

- Reads **StoaChain** node API (`/chainweb/0.0/stoa/cut`, `/chainweb/0.0/stoa/chain/<id>/block`, `/chainweb/0.0/stoa/chain/<id>/header/...`) and samples its on-disk RocksDB dir + Pact SQLite files. StoaChain itself is not yet linked to Claudstermind.
- Embeds into **StoaExplorer** (also not yet linked) via a new `/live` route; block-sphere clicks navigate to the existing explorer's block detail page — StoaLive does not build a replacement detail page.
- Optional enrichment from the explorer's indexer (tx counts, gas per tx, module tags) when it's available; otherwise hits the Chainweb node API directly for MVP.
- Independent of AncientHoldings hub and OuronetUI — shares only the underlying StoaChain network.

## Hard don'ts specific to this project

- **Do not parse RocksDB live for block events.** Only for coarse storage-size sampling.
- **Do not expose write endpoints.** Read-only data paths only.
- **Do not build a replacement block-detail page.** Click-through hands off to the existing explorer.
- **Do not skip the 2D fallback.** It is a hard accessibility/low-power requirement, not a nice-to-have.
- **Do not encode any piece of information in color alone.** Always pair with a textual value in the side panel.
- **Do not deploy API + WS on a different origin from the explorer** without accepting the CORS tax; the spec assumes same-domain deployment with a WS reverse-proxy idle timeout ≥ 5 min.

## Current phase / direction

Phase 0 (Discovery) — stack selection and integration-path decision have not happened yet. All six spec docs are landed; no code has been written. The roadmap ordering matters: Phase 1 (backend MVP) → Phase 2 (frontend MVP, 2D before 3D) → Phase 3 (storage overlays) → Phase 4 (fullscreen + replay) → Phase 5 (hardening). Don't pull work forward across phases without the prerequisite landing.

## Owner's note

_None on record — capture here when shared._
