/**
 * useLiveEvents — polling hook that tails `/api/events` every 2 seconds and
 * accumulates the hook-emitted activity stream (Quick 10 producer) into an
 * in-memory, newest-first ring buffer.
 *
 * Design mirrors `useSnapshot.ts` (interval + AbortController + StrictMode
 * guard + cleanup) and `useActivityFeed.ts` (reset-on-disconnect + newest-
 * first slicing). The blend lets us reuse proven polling scaffolding without
 * rebuilding half of each from scratch.
 *
 * Contract:
 *   - On mount, an immediate fetch kicks off WITHOUT a `since` query param
 *     so the server defaults to today's UTC midnight — that lets a cold
 *     dashboard see the day's history at the first tick.
 *   - Every 2000ms thereafter, fetch `/api/events?since=<latestTsRef.current>`
 *     so the wire carries only new events. `latestTsRef` starts null and
 *     advances to the most recent event ts as events arrive.
 *   - Dedup uses a COMPOSITE key `ts|session|kind|tool|filePath`. The
 *     server's `since >= ts` filter is inclusive at the boundary so
 *     events written in the same millisecond as the previous tick's
 *     newest event are not silently dropped — the local dedup is then
 *     load-bearing to drop the steady-state boundary duplicate.
 *   - The buffer is newest-first: new events land at index 0 and the tail
 *     is sliced to LIVE_EVENTS_MAX_BUFFER (500). If a single tick produces
 *     more than 500 events we still only keep 500 — the oldest drop off.
 *   - `connectionStatus` transitions: initial 'connecting' → 'connected'
 *     on first success → 'disconnected' on any fetch error. On reconnect,
 *     `latestTsRef` is PRESERVED (not reset) so events emitted during
 *     the downtime window are fetched via `since >= latestTsRef` and the
 *     client dedup drops the boundary repeat.
 *   - Cleanup aborts the in-flight fetch, clears the interval, and nulls
 *     the ref — same shape as useSnapshot's cleanup.
 *
 * Scope notes:
 *   - No notifications, no unread badge — out of scope per the task plan.
 *   - No per-agent filter, no search — out of scope.
 *   - No SSE / WebSocket — 2s polling is imperceptible for a log-tail UX.
 *   - The `LiveEvent` shape matches the Quick 10 producer's 10-field schema
 *     exactly. Nullable fields stay nullable because the producer emits them
 *     that way and the UI renders a `—` fallback.
 */

import { useEffect, useRef, useState } from 'react';
import type { ConnectionStatusValue } from '@/hooks/useSnapshot';

/**
 * LiveEvent — exact 10-field shape emitted by the Quick 10 hook producer
 * (`.bee/events/YYYY-MM-DD.jsonl`). Must stay in sync with the producer.
 *
 * `session` and `cwd` are REQUIRED to be present by the producer, but the
 * producer's pickString helper emits `null` when the source field is
 * missing or empty — e.g. a Stop event with no stdin payload. The type
 * reflects wire reality, not aspirational non-nullability (E2E-002 audit
 * finding). Consumers must handle null for every nullable field.
 */
export interface LiveEvent {
  ts: string;
  session: string | null;
  kind: string;
  tool: string | null;
  agent: string | null;
  filePath: string | null;
  command: string | null;
  durationMs: number | null;
  success: boolean | null;
  cwd: string;
}

interface EventsApiResponse {
  events: LiveEvent[];
  latest_ts: string;
  count: number;
  has_more: boolean;
}

export const LIVE_EVENTS_INTERVAL_MS = 2000;
export const LIVE_EVENTS_MAX_BUFFER = 500;

export interface UseLiveEventsResult {
  events: LiveEvent[];
  connectionStatus: ConnectionStatusValue;
}

function dedupKey(ev: LiveEvent): string {
  return (
    ev.ts +
    '|' +
    (ev.session ?? '') +
    '|' +
    ev.kind +
    '|' +
    (ev.tool ?? '') +
    '|' +
    (ev.filePath ?? '')
  );
}

export function useLiveEvents(
  intervalMs: number = LIVE_EVENTS_INTERVAL_MS,
): UseLiveEventsResult {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatusValue>('connecting');

  // In-flight fetch controller — refs so the cleanup path can abort.
  const inFlightRef = useRef<AbortController | null>(null);
  // Most recent event timestamp seen — used as the `since` query param on
  // the next tick. null means "use server default" (today's midnight UTC).
  const latestTsRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function runFetch() {
      // Dedup concurrent ticks. The `!aborted` guard is required for
      // StrictMode remount safety — a torn-down controller still sits on
      // the ref but must not block new fetches.
      if (inFlightRef.current && !inFlightRef.current.signal.aborted) {
        return;
      }

      const controller = new AbortController();
      inFlightRef.current = controller;

      try {
        // Build URL with optional `since` param.
        let url = '/api/events';
        if (latestTsRef.current !== null) {
          url += '?since=' + encodeURIComponent(latestTsRef.current);
        }

        const response = await fetch(url, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as EventsApiResponse;

        // StrictMode / unmount guard.
        if (cancelled || controller.signal.aborted) {
          return;
        }

        // Merge new events into the newest-first buffer with dedup.
        if (Array.isArray(data.events) && data.events.length > 0) {
          setEvents((prev) => {
            // Seen-set seeded from the current buffer.
            const seen = new Set(prev.map(dedupKey));
            const fresh: LiveEvent[] = [];
            for (const ev of data.events) {
              const key = dedupKey(ev);
              if (seen.has(key)) continue;
              seen.add(key);
              fresh.push(ev);
            }
            if (fresh.length === 0) {
              return prev;
            }
            // Server returns oldest-first within a tick. Reverse so the
            // newest event lands at index 0 when prepended.
            fresh.reverse();
            const next = [...fresh, ...prev];
            if (next.length > LIVE_EVENTS_MAX_BUFFER) {
              return next.slice(0, LIVE_EVENTS_MAX_BUFFER);
            }
            return next;
          });
        }

        // Advance the baseline. Server's `latest_ts` is the ts of the
        // newest event in this response, or the input `since` when empty.
        // Using it directly keeps us aligned with server truth.
        if (typeof data.latest_ts === 'string' && data.latest_ts.length > 0) {
          latestTsRef.current = data.latest_ts;
        }

        setConnectionStatus('connected');
      } catch (_err) {
        // AbortError on unmount is expected — do not flip to disconnected.
        if (controller.signal.aborted) {
          return;
        }
        if (cancelled) {
          return;
        }
        // Preserve `latestTsRef` across disconnects (E2E-004 audit
        // finding). Resetting it to null caused the reconnect fetch to
        // fall back to the server default (today's midnight) and silently
        // dropped any events emitted during the downtime window. The
        // server's `>=` filter plus the client-side dedup-by-composite-key
        // make replay idempotent — there is no reason to throw away the
        // existing baseline.
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

    // Schedule polling.
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

  return { events, connectionStatus };
}
