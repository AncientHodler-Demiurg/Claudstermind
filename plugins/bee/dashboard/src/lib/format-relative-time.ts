/**
 * formatRelativeTimestamp — render an ISO-8601 timestamp as a compact
 * relative time string ("2s ago", "5m ago", "3h ago", "1d ago").
 *
 * Extracted from ActivityFeed.tsx so multiple components (ActivityFeed,
 * LiveActivityPanel, and future feeds) can reuse the same logic without
 * duplication. Kept simple on purpose — no `Intl.RelativeTimeFormat`
 * dependency, no locale negotiation, no "just now" / "in the future"
 * special cases. The dashboard renders English only and all timestamps
 * come from the server so `diffMs` is always non-negative in practice.
 *
 * Contract:
 *   - Input is an ISO-8601 string (or anything Date.parse accepts).
 *   - Returns the empty string when the input does not parse — callers
 *     should handle this by showing nothing rather than "NaN ago".
 *   - Seconds are clamped to a minimum of 0 so tiny clock skew between
 *     client and server does not render a negative counter.
 *   - The breakpoints are: <60s → seconds, <60m → minutes, <24h → hours,
 *     otherwise days.
 */
export function formatRelativeTimestamp(timestamp: string): string {
  const then = Date.parse(timestamp);
  if (Number.isNaN(then)) {
    return '';
  }
  const diffMs = Date.now() - then;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return `${Math.max(seconds, 0)}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
