/**
 * Snapshot TypeScript types -- mirrors the Phase 1 `/api/snapshot` contract.
 *
 * Source of truth: `plugins/bee/scripts/hive-snapshot.js` (T1.7 aggregator)
 * and the T1.2-T1.5 parser/reader/scanner shapes described in
 * `.bee/specs/2026-04-10-bee-board-dashboard/phases/01-server-and-data-api/TASKS.md`.
 *
 * Design rules:
 *   1. Every field the aggregator sets to `null` on missing data is typed as
 *      `| null` (not `?:`). The Phase 1 "never errors" contract guarantees
 *      those nulls appear in the JSON payload, so consumers must handle them.
 *   2. Fields that may be absent from a specific entry (but not the whole
 *      payload) use `?:` -- e.g. `NoteEntry.body`, `SeedEntry.trigger`.
 *   3. Interfaces are flat exports from a single `snapshot.ts` file. Consumers
 *      import via `import type { Snapshot, PhaseMetric } from '@/types/snapshot'`.
 *   4. `learnings` and `reviews` are typed as `Record<string, unknown> | null`
 *      because no Phase 3 panel consumes their structured shape -- forward
 *      compatible for Phase 4+.
 *   5. `PhaseMetric` intentionally includes an index signature so the velocity
 *      and code-quality charts (T3.9 / T3.10) can access experimental fields
 *      without TS errors while the Phase 1 metric shape is still stabilising.
 */

// ---------------------------------------------------------------------------
// Per-entry types (returned by T1.4 scanners and T1.2 state parser rows)
// ---------------------------------------------------------------------------

/**
 * A single phase row from the STATE.md phases table.
 * Each status column is a short string (e.g. `"DONE"`, `"TODO"`, or a date).
 */
export interface PhaseEntry {
    number: number;
    name: string;
    status: string;
    plan: string;
    planReview: string;
    executed: string;
    reviewed: string;
    tested: string;
    committed: string;
}

/**
 * STATE.md "Last Action" section. The whole field is nullable because
 * `parseStateMd` returns an object with `null` members when the section is
 * missing; downstream consumers may treat the entire object as absent.
 */
export interface LastAction {
    command: string | null;
    timestamp: string | null;
    result: string | null;
}

/**
 * STATE.md quick-task row (distinct from the file-based QuickTaskEntry that
 * T1.4 scanQuickTasks produces).
 */
export interface StateQuickTask {
    number: number;
    description: string;
    date: string;
    commit: string;
}

/**
 * T1.2 parseStateMd output. `currentSpec` is nullable per the "empty .bee/"
 * contract -- no active spec means `null`, not an empty object.
 */
export interface ProjectState {
    currentSpec: {
        name: string | null;
        path: string | null;
        status: string | null;
    } | null;
    phases: PhaseEntry[];
    quickTasks: StateQuickTask[];
    decisionsLog: string;
    lastAction: LastAction | null;
}

// ---------------------------------------------------------------------------
// Config (T1.3 readConfig) -- mirrors `.bee/config.json`
// ---------------------------------------------------------------------------

export interface BeeConfigStack {
    name: string;
    path: string;
    linter: string;
    testRunner: string;
}

export interface BeeConfigReview {
    against_spec: boolean;
    against_standards: boolean;
    dead_code: boolean;
    loop: boolean;
    max_loop_iterations: number;
}

export interface BeeConfigPhases {
    require_review_before_next: boolean;
}

export interface BeeConfigShip {
    max_review_iterations: number;
    final_review: boolean;
}

export interface BeeConfigQuick {
    review: boolean;
    fast: boolean;
}

export interface BeeConfig {
    stacks: BeeConfigStack[];
    implementation_mode: string;
    ci: string;
    context7: boolean;
    review: BeeConfigReview;
    phases: BeeConfigPhases;
    ship: BeeConfigShip;
    quick: BeeConfigQuick;
}

// ---------------------------------------------------------------------------
// Metrics (T1.3 readHealthHistory + readPhaseMetrics)
// ---------------------------------------------------------------------------

export interface HealthHistoryEntry {
    timestamp: string;
    overall_status: string;
    summary: {
        passed: number;
        warnings: number;
        failures: number;
    };
    checks: Record<string, string>;
}

/**
 * Phase metric shape. Intentionally loose: the Phase 1 T1.3 research notes
 * acknowledge that the per-phase metric JSON structure is still evolving. The
 * index signature lets consumers access experimental fields (e.g.
 * `execution_duration_ms`, `duration_ms`, `execution.duration_seconds`) without
 * forcing a schema change every time a new metric lands. See T3.9 VelocityChart
 * research for the defensive-access pattern.
 */
export interface PhaseMetric {
    phase?: number;
    phaseName?: string;
    execution_duration_ms?: number;
    review_findings_count?: number;
    [key: string]: unknown;
}

/** Runtime shape returned by hive-json-readers.js readPhaseMetrics */
export interface PhaseMetricGroup {
    spec: string;
    phases: PhaseMetric[];
}

// ---------------------------------------------------------------------------
// Directory scanner entries (T1.4)
// ---------------------------------------------------------------------------

export interface NoteEntry {
    filePath: string;
    title: string | null;
    date: string | null;
    body?: string | null;
}

export interface SeedEntry {
    filePath: string;
    id: string | null;
    title: string | null;
    idea: string | null;
    trigger?: string | null;
    planted?: string | null;
    status?: string | null;
}

export interface DiscussionEntry {
    filePath: string;
    title: string | null;
    date: string | null;
}

export interface ForensicsEntry {
    filePath: string;
    title: string | null;
    date: string | null;
    severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | string | null;
}

export interface DebugSessionEntry {
    filePath: string;
    slug: string;
    status: string | null;
    created: string | null;
    updated: string | null;
    current_focus?: string | null;
}

export interface QuickTaskEntry {
    filePath: string;
    number: number | string | null;
    title: string | null;
    date: string | null;
    status: string | null;
}

// ---------------------------------------------------------------------------
// Spec-scoped readers (T1.5)
// ---------------------------------------------------------------------------

export interface SpecDocument {
    goal: string;
    userStories: string[];
}

export interface PhaseDefinition {
    number: number;
    name: string;
    description?: string;
    deliverables?: string[];
    dependencies?: string[];
}

export interface RequirementsCoverageSection {
    name: string;
    checked: number;
    total: number;
}

export interface RequirementsCoverage {
    checked: number;
    total: number;
    sections: RequirementsCoverageSection[];
}

export interface RoadmapPhaseMapping {
    phase: number;
    goal: string;
    requirements: string[];
    successCriteria: string[];
}

export interface Roadmap {
    phaseMapping: RoadmapPhaseMapping[];
}

/**
 * Per-phase TASKS.md metadata. The exact shape produced by T1.5 readPhaseTasks
 * is not consumed by any Phase 3 panel directly, so the type is a loose record
 * for forward compatibility.
 */
export type PhaseTasks = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Top-level Snapshot (T1.7 buildSnapshot output)
// ---------------------------------------------------------------------------

/**
 * The full JSON payload returned by `GET /api/snapshot`. Every field that the
 * aggregator may leave `null` on missing input is declared as `| null` so
 * consumers are forced to handle the empty `.bee/` case at compile time.
 */
export interface Snapshot {
    timestamp: string;
    state: ProjectState | null;
    config: BeeConfig | null;
    healthHistory: HealthHistoryEntry[] | null;
    phaseMetrics: PhaseMetricGroup[];
    workspaces: Record<string, unknown> | null;
    notes: NoteEntry[];
    seeds: SeedEntry[];
    discussions: DiscussionEntry[];
    forensics: ForensicsEntry[];
    debugSessions: DebugSessionEntry[];
    quickTasks: QuickTaskEntry[];
    spec: SpecDocument | null;
    phases: PhaseDefinition[] | null;
    requirements: RequirementsCoverage | null;
    roadmap: Roadmap | null;
    phaseTasks: PhaseTasks[] | null;
    learnings: { filePath: string; phaseNumber: string | null; phaseName: string; content: string }[] | null;
    reviews: { filePath: string; phaseNumber: string | null; phaseName: string; content: string }[] | null;
    archivedSpecs: ArchivedSpec[];
    activeSpecs?: ActiveSpec[] | null;
    /** Present only when `buildSnapshot` caught an aggregation error. */
    error?: string;
}

// ---------------------------------------------------------------------------
// Archived spec summary
// ---------------------------------------------------------------------------

export interface ArchivedSpec {
    name: string;
    date: string | null;
    source: 'archived' | 'specs';
    goal: string | null;
    phaseCount: number;
    dirName: string;
}

// ---------------------------------------------------------------------------
// Active spec summary (multi-spec roster — Step 4 multispec-foundation)
// ---------------------------------------------------------------------------

export interface ActiveSpec {
    slug: string;
    title: string;
    stage: string;
    location: string;
    last_touched: string | null;
    inWorktree: boolean;
}
