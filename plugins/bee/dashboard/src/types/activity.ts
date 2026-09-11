/**
 * ActivityEvent — T4.2 shared type for the Bee Board activity feed.
 *
 * The dashboard derives an `ActivityEvent[]` stream from successive
 * `/api/snapshot` payloads so users can see recent changes (files added,
 * files removed, phase status transitions, metric movements) in a single
 * chronological feed.
 *
 * This module is the single source of truth for the feed's shape. Both the
 * diff producer and the `ActivityFeed` presentation component import from
 * here so the contract stays aligned.
 *
 * Design rules:
 *   1. `timestamp` is an ISO-8601 string (not a `Date`) so events remain
 *      trivially serialisable / JSON-stable across renders. Sorting uses
 *      `localeCompare` which is correct for ISO-8601 lexicographic order.
 *   2. `id` is a stable unique key (e.g. `"${timestamp}-${source}-${type}"`)
 *      used as React list key — it must not collide across events.
 *   3. `source` identifies the origin of the change (e.g. a file path, a
 *      phase name, a metric key) and is surfaced as a muted sub-label.
 *   4. `ActivityEventType` is a closed union of four literals. Adding new
 *      kinds requires widening both this union and the badge-variant map
 *      in `ActivityFeed.tsx`.
 */

export type ActivityEventType =
  | 'file-added'
  | 'file-removed'
  | 'status-change'
  | 'metric-change';

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: ActivityEventType;
  description: string;
  source: string;
}
