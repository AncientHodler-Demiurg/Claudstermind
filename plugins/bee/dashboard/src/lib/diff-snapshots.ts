/**
 * Snapshot diff utility -- converts two successive `Snapshot` payloads into
 * a list of `ActivityEvent`s for the live activity feed (Phase 4 T4.1).
 *
 * Design rules:
 *   1. **Pure function** -- no console output, no module-scope mutable state,
 *      deterministic: same inputs always yield the same outputs.
 *   2. **Baseline returns empty** -- `prev === null` (first load) never emits
 *      events. Otherwise the dashboard would dump dozens of "new" events on
 *      every page refresh.
 *   3. **Granular per-entry event ids** -- the id format
 *      `${type}:${source}:${key}:${snapshotTimestamp}` is unique across all
 *      events emitted for the same snapshot pair. This prevents React
 *      duplicate-key warnings when multiple events share source + timestamp
 *      (e.g. two notes added in the same hive tick).
 *   4. **Event timestamp uses `next.timestamp`** -- never `new Date()`, so the
 *      output is deterministic and replays cleanly in tests / debugging.
 *   5. **healthHistory diff uses `Set<timestamp>`** -- NOT length comparison.
 *      The server-side hive trims history to the last N entries; a naive
 *      length diff would miss additions when old entries are trimmed in the
 *      same tick. A Set-based diff detects genuine new entries regardless of
 *      trimming.
 *   6. **Null/undefined slices are tolerated** -- the Phase 1 "never errors"
 *      contract guarantees the aggregator returns `null` on missing data, so
 *      each slice access is coalesced with `?? []`.
 *
 */

import type {
    Snapshot,
    NoteEntry,
    SeedEntry,
    DiscussionEntry,
    ForensicsEntry,
    DebugSessionEntry,
    QuickTaskEntry,
    PhaseEntry,
    HealthHistoryEntry,
} from '@/types/snapshot';

// Re-export canonical types from @/types/activity (T4.2)
export type { ActivityEvent, ActivityEventType } from '@/types/activity';
import type { ActivityEvent, ActivityEventType } from '@/types/activity';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Hard cap on events returned from a single diff. The activity feed panel
 * only renders the most recent N, so computing more is wasted work. The
 * caller is responsible for truncating if it wants the newest-first slice.
 */
export const DIFF_SNAPSHOTS_MAX_EVENTS = 100;

// ---------------------------------------------------------------------------
// File-keyed slice descriptor
// ---------------------------------------------------------------------------

/**
 * Minimal shape we need for file-keyed diffing. Every scanner entry has a
 * `filePath`; the per-source labeller formats the rest. We intentionally do
 * NOT add an index signature here -- the scanner entry interfaces in
 * `@/types/snapshot` are declared without one, and an `[key: string]: unknown`
 * constraint would reject every concrete type at the call site.
 */
interface FileKeyedEntry {
    filePath: string;
}

interface FileSliceConfig<T extends FileKeyedEntry> {
    source: string;
    prev: T[];
    next: T[];
    /** Human-readable label for a new entry, e.g. "New note added: Title". */
    addedDescription: (entry: T) => string;
    /** Human-readable label for a removed entry. */
    removedDescription: (entry: T) => string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeEventId(
    type: ActivityEventType,
    source: string,
    key: string | number,
    snapshotTimestamp: string,
): string {
    return `${type}:${source}:${key}:${snapshotTimestamp}`;
}

function diffFileSlice<T extends FileKeyedEntry>(
    config: FileSliceConfig<T>,
    snapshotTimestamp: string,
): ActivityEvent[] {
    const { source, prev, next, addedDescription, removedDescription } = config;
    const events: ActivityEvent[] = [];

    const prevPaths = new Set(prev.map((entry) => entry.filePath));
    const nextPaths = new Set(next.map((entry) => entry.filePath));

    for (const entry of next) {
        if (!prevPaths.has(entry.filePath)) {
            events.push({
                id: makeEventId('file-added', source, entry.filePath, snapshotTimestamp),
                timestamp: snapshotTimestamp,
                type: 'file-added',
                description: addedDescription(entry),
                source,
            });
        }
    }

    for (const entry of prev) {
        if (!nextPaths.has(entry.filePath)) {
            events.push({
                id: makeEventId('file-removed', source, entry.filePath, snapshotTimestamp),
                timestamp: snapshotTimestamp,
                type: 'file-removed',
                description: removedDescription(entry),
                source,
            });
        }
    }

    return events;
}

function diffPhaseStatuses(
    prevPhases: PhaseEntry[],
    nextPhases: PhaseEntry[],
    snapshotTimestamp: string,
): ActivityEvent[] {
    const events: ActivityEvent[] = [];
    const prevByNumber = new Map<number, PhaseEntry>();
    for (const phase of prevPhases) {
        prevByNumber.set(phase.number, phase);
    }

    for (const phase of nextPhases) {
        const previous = prevByNumber.get(phase.number);
        if (!previous) {
            // New phase row appearing mid-project -- treat as a status change
            // from "(none)" to its current status, so the user sees the phase
            // landing on the board.
            events.push({
                id: makeEventId(
                    'status-change',
                    'state.phases',
                    phase.number,
                    snapshotTimestamp,
                ),
                timestamp: snapshotTimestamp,
                type: 'status-change',
                description: `Phase ${phase.number} ${phase.name}: (none) → ${phase.status}`,
                source: 'state.phases',
            });
            continue;
        }
        if (previous.status !== phase.status) {
            events.push({
                id: makeEventId(
                    'status-change',
                    'state.phases',
                    phase.number,
                    snapshotTimestamp,
                ),
                timestamp: snapshotTimestamp,
                type: 'status-change',
                description: `Phase ${phase.number} ${phase.name}: ${previous.status} → ${phase.status}`,
                source: 'state.phases',
            });
        }
    }

    return events;
}

function diffHealthHistory(
    prevHistory: HealthHistoryEntry[],
    nextHistory: HealthHistoryEntry[],
    snapshotTimestamp: string,
): ActivityEvent[] {
    // CRITICAL: use a Set of timestamps, NOT length comparison. The hive
    // server trims history to the last N entries; if a new entry is added
    // and an old one is dropped in the same tick, `length` would be
    // unchanged and we would miss the update.
    const prevTimestamps = new Set(prevHistory.map((entry) => entry.timestamp));
    const events: ActivityEvent[] = [];

    for (const entry of nextHistory) {
        if (!prevTimestamps.has(entry.timestamp)) {
            const summary = entry.summary
                ? `${entry.summary.passed} passed, ${entry.summary.warnings} warnings, ${entry.summary.failures} failures`
                : entry.overall_status;
            events.push({
                id: makeEventId(
                    'metric-change',
                    'healthHistory',
                    entry.timestamp,
                    snapshotTimestamp,
                ),
                timestamp: snapshotTimestamp,
                type: 'metric-change',
                description: `Health check: ${entry.overall_status} (${summary})`,
                source: 'healthHistory',
            });
        }
    }

    return events;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Diff two consecutive snapshots and return a list of activity events
 * describing the changes. Pure function.
 *
 * When `prev === null` (first load / baseline), returns `[]`: the initial
 * snapshot is treated as the ground truth, not a set of "new" events.
 */
export function diffSnapshots(
    prev: Snapshot | null,
    next: Snapshot,
): ActivityEvent[] {
    if (prev === null) {
        return [];
    }

    const snapshotTimestamp = next.timestamp;
    const events: ActivityEvent[] = [];

    // ---------- File-keyed slices ----------
    // Note: each slice is declared non-nullable on Snapshot, but we still
    // coalesce with `?? []` to honour the "handles null/undefined slices
    // gracefully" contract -- the runtime payload may legally be missing a
    // slice if an older hive version is still running.
    events.push(
        ...diffFileSlice<NoteEntry>(
            {
                source: 'notes',
                prev: prev.notes ?? [],
                next: next.notes ?? [],
                addedDescription: (entry) => `New note added: ${entry.title}`,
                removedDescription: (entry) => `Note removed: ${entry.title}`,
            },
            snapshotTimestamp,
        ),
    );

    events.push(
        ...diffFileSlice<SeedEntry>(
            {
                source: 'seeds',
                prev: prev.seeds ?? [],
                next: next.seeds ?? [],
                addedDescription: (entry) => `New seed planted: ${entry.title}`,
                removedDescription: (entry) => `Seed removed: ${entry.title}`,
            },
            snapshotTimestamp,
        ),
    );

    events.push(
        ...diffFileSlice<DiscussionEntry>(
            {
                source: 'discussions',
                prev: prev.discussions ?? [],
                next: next.discussions ?? [],
                addedDescription: (entry) => `New discussion started: ${entry.title}`,
                removedDescription: (entry) => `Discussion removed: ${entry.title}`,
            },
            snapshotTimestamp,
        ),
    );

    events.push(
        ...diffFileSlice<ForensicsEntry>(
            {
                source: 'forensics',
                prev: prev.forensics ?? [],
                next: next.forensics ?? [],
                addedDescription: (entry) => `New forensic report: ${entry.title}`,
                removedDescription: (entry) => `Forensic report removed: ${entry.title}`,
            },
            snapshotTimestamp,
        ),
    );

    events.push(
        ...diffFileSlice<DebugSessionEntry>(
            {
                source: 'debugSessions',
                prev: prev.debugSessions ?? [],
                next: next.debugSessions ?? [],
                addedDescription: (entry) => `New debug session: ${entry.slug}`,
                removedDescription: (entry) => `Debug session closed: ${entry.slug}`,
            },
            snapshotTimestamp,
        ),
    );

    events.push(
        ...diffFileSlice<QuickTaskEntry>(
            {
                source: 'quickTasks',
                prev: prev.quickTasks ?? [],
                next: next.quickTasks ?? [],
                addedDescription: (entry) =>
                    `New quick task #${entry.number}: ${entry.title}`,
                removedDescription: (entry) =>
                    `Quick task #${entry.number} removed: ${entry.title}`,
            },
            snapshotTimestamp,
        ),
    );

    // ---------- Phase status transitions (state.phases) ----------
    const prevPhases = prev.state?.phases ?? [];
    const nextPhases = next.state?.phases ?? [];
    events.push(...diffPhaseStatuses(prevPhases, nextPhases, snapshotTimestamp));

    // ---------- Health history (metric-change) ----------
    const prevHistory = prev.healthHistory ?? [];
    const nextHistory = next.healthHistory ?? [];
    events.push(...diffHealthHistory(prevHistory, nextHistory, snapshotTimestamp));

    return events;
}
