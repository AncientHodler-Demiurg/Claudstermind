/**
 * useSnapshot — polling hook that fetches `/api/snapshot` every `intervalMs` ms.
 *
 * Behavior (T3.4 contract):
 *   - On mount: immediate fetch + schedule setInterval at `intervalMs` (default 5000).
 *   - Each interval tick triggers a fetch unless a prior fetch is still in-flight.
 *   - Dedup uses a `useRef<AbortController | null>(null)`. A request is considered
 *     in-flight when `inFlightRef.current && !inFlightRef.current.signal.aborted`.
 *     The `signal.aborted` check is CRITICAL for React StrictMode: when the effect
 *     runs, tears down, and re-runs, the previous controller lives on the ref as
 *     an aborted object. Without the aborted check, the second mount would treat
 *     that stale controller as a live in-flight request and skip fetching forever.
 *   - On HTTP 200 success: update snapshot + lastUpdated + connectionStatus='connected'.
 *   - On error (network or non-200): flip connectionStatus='disconnected' while
 *     RETAINING the last known snapshot so the UI degrades gracefully instead of
 *     blanking out.
 *   - On cleanup: clearInterval + abort the in-flight controller + null the ref
 *     synchronously (not in a finally) so the next mount starts from a clean slate.
 *   - `cache: 'no-store'` is passed to every fetch so the browser never serves a
 *     stale snapshot from disk cache — we want the latest server read every tick.
 */

import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '@/types/snapshot';

export type ConnectionStatusValue = 'connecting' | 'connected' | 'disconnected';

export interface UseSnapshotResult {
    snapshot: Snapshot | null;
    connectionStatus: ConnectionStatusValue;
    lastUpdated: Date | null;
}

export function useSnapshot(intervalMs: number = 5000): UseSnapshotResult {
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [connectionStatus, setConnectionStatus] =
        useState<ConnectionStatusValue>('connecting');
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    // Tracks the currently-running fetch so we can (a) dedup concurrent ticks and
    // (b) abort on unmount. MUST be a ref, not state, to avoid re-render loops.
    const inFlightRef = useRef<AbortController | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function runFetch() {
            // Dedup: skip if a previous fetch is still pending. The `!aborted`
            // guard is required for StrictMode remount safety — a torn-down
            // controller still sits on the ref but must not block new fetches.
            if (inFlightRef.current && !inFlightRef.current.signal.aborted) {
                return;
            }

            const controller = new AbortController();
            inFlightRef.current = controller;

            try {
                const response = await fetch('/api/snapshot', {
                    cache: 'no-store',
                    signal: controller.signal,
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data: Snapshot = await response.json();

                // Guard against state updates after unmount or abort.
                if (cancelled || controller.signal.aborted) {
                    return;
                }

                setSnapshot(data);
                setLastUpdated(new Date());
                setConnectionStatus('connected');
            } catch (err) {
                // AbortError on unmount is expected — do not flip to disconnected.
                if (controller.signal.aborted) {
                    return;
                }
                if (cancelled) {
                    return;
                }
                // Retain the last snapshot (graceful degradation) and flag the
                // connection as down so the UI can surface the outage.
                setConnectionStatus('disconnected');
            } finally {
                // Only clear the ref if this controller is still the current one.
                // During StrictMode remount the cleanup path may have already
                // swapped or nulled the ref — leave that alone.
                if (inFlightRef.current === controller) {
                    inFlightRef.current = null;
                }
            }
        }

        // Immediate fetch on mount.
        void runFetch();

        // Schedule polling every `intervalMs`.
        const id = setInterval(() => {
            void runFetch();
        }, intervalMs);

        return () => {
            cancelled = true;
            clearInterval(id);
            inFlightRef.current?.abort();
            inFlightRef.current = null;
        };
    }, [intervalMs]);

    return { snapshot, connectionStatus, lastUpdated };
}
