/**
 * useActivityFeed — accumulates `ActivityEvent[]` from successive snapshots.
 *
 * Behaviour (T4.4 contract):
 *   - Accepts BOTH the latest snapshot and the connection status from
 *     `useSnapshot` (T3.4). The snapshot alone is not sufficient because
 *     T3.4 retains the last good snapshot during a `disconnected` state, so
 *     this hook needs the explicit status to detect a reconnect and force a
 *     re-baseline.
 *
 *   - Maintains a baseline snapshot in a ref (`useRef<Snapshot | null>`).
 *     The baseline is the snapshot we last diffed against; we only call
 *     `diffSnapshots` when a NEW snapshot timestamp arrives, never on
 *     incidental React re-renders.
 *
 *   - Effect logic (in order):
 *       1. If `connectionStatus === 'disconnected'`, reset the baseline ref
 *          to `null`. This is the critical reconnect guard: when the next
 *          snapshot eventually arrives, the hook will treat it as a fresh
 *          baseline (step 3) instead of diffing against a stale snapshot
 *          captured before the outage. Without this reset the feed would
 *          flood with phantom "added/removed" events the moment the server
 *          comes back online.
 *       2. If `snapshot === null`, return early — nothing to do until the
 *          first payload lands.
 *       3. If `prevRef.current === null`, seed the baseline with this
 *          snapshot and return WITHOUT emitting any events. The first
 *          snapshot is treated as ground truth, mirroring `diffSnapshots`'
 *          own baseline contract (which returns `[]` for a null `prev`).
 *       4. If `snapshot.timestamp !== prevRef.current.timestamp`, diff the
 *          two snapshots, prepend the new events to the accumulated buffer,
 *          and slice the buffer down to `DIFF_SNAPSHOTS_MAX_EVENTS`. Then
 *          advance the baseline ref to the new snapshot.
 *
 *   - Ring buffer: events are stored newest-first. The cap is enforced via
 *     `[...newEvents, ...prev].slice(0, DIFF_SNAPSHOTS_MAX_EVENTS)`. If a
 *     single tick produces more than the cap (e.g. a huge initial sync), the
 *     slice keeps only the first MAX newEvents and drops the prior buffer
 *     entirely — this matches the cap semantics defined in T4.1.
 *
 *   - The returned array is treated as read-only by consumers; the hook owns
 *     the buffer state and never accepts external mutation.
 *
 *   - Pure logic only — no DOM access, no `window` access, no timers. The
 *     hook is fully driven by its inputs and is therefore SSR-safe.
 */

import { useEffect, useRef, useState } from 'react';
import { diffSnapshots, DIFF_SNAPSHOTS_MAX_EVENTS } from '@/lib/diff-snapshots';
import type { ActivityEvent } from '@/types/activity';
import type { Snapshot } from '@/types/snapshot';

export function useActivityFeed(
    snapshot: Snapshot | null,
    connectionStatus: 'connecting' | 'connected' | 'disconnected',
): ActivityEvent[] {
    const prevRef = useRef<Snapshot | null>(null);
    const [events, setEvents] = useState<ActivityEvent[]>([]);

    useEffect(() => {
        // Step 1: reconnect guard. Reset the baseline so the next snapshot
        // received post-outage will reseed (step 3) instead of producing a
        // flood of stale-vs-fresh diff events.
        if (connectionStatus === 'disconnected') {
            prevRef.current = null;
            return;
        }

        // Step 2: nothing to diff until a snapshot arrives.
        if (snapshot === null) {
            return;
        }

        // Step 3: seed the baseline on first snapshot (or post-reset). The
        // first snapshot is treated as ground truth — emit nothing.
        if (prevRef.current === null) {
            prevRef.current = snapshot;
            return;
        }

        // Step 4: only diff when the snapshot timestamp actually changed.
        // Successive renders with the same payload (e.g. parent re-render)
        // must NOT push duplicate events into the buffer.
        if (snapshot.timestamp !== prevRef.current.timestamp) {
            const newEvents = diffSnapshots(prevRef.current, snapshot);
            if (newEvents.length > 0) {
                setEvents((prev) =>
                    [...newEvents, ...prev].slice(0, DIFF_SNAPSHOTS_MAX_EVENTS),
                );
            }
            prevRef.current = snapshot;
        }
    }, [snapshot, connectionStatus]);

    return events;
}
