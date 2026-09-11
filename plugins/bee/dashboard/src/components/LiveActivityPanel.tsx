// LiveActivityPanel — renders the `useLiveEvents()` stream as a newest-first
// scrollable list inside the hive-themed Card scaffold.
//
// Design mirrors ActivityFeed.tsx's Card + ScrollArea scaffold but speaks the
// LiveEvent shape (Quick 10 producer schema) instead of ActivityEvent.
//
// Row layout:
//   [icon]  tool · agent                                 12s ago
//           …/src/App.tsx
//
// Icon is kind-specific (pre_tool_use / post_tool_use / stop / subagent_stop /
// user_prompt_submit / notification). A sensible fallback icon handles any
// kind we haven't anticipated — better than showing nothing for an unknown
// hook event.
//
// Theming: hive theme tokens only (`text-hive-muted`, `text-hive-text`,
// `border-hive-surface/60`, `text-hive-accent`). No new tokens introduced.
//
// Sort: newest-first via lexicographic `localeCompare` on ISO-8601 `ts` —
// matches ActivityFeed and avoids Date allocations per comparison. NO auto-
// scroll: the list pins its most recent event at the top and the scroll area
// stays where the user left it. This is intentional per R8 in the plan —
// auto-scroll fights a reading user.
//
// Empty state: explicit friendly message so a cold dashboard (no events in
// `.bee/events/*.jsonl` yet) still looks intentional instead of broken.
//
// File-path shortening: use the trailing `parent/file` idiom (e.g.
// `src/App.tsx` for `plugins/bee/dashboard/src/App.tsx`) when the path has
// more than one segment. The full path is exposed via `title` attribute for
// hover-to-inspect. This avoids the left-truncation CSS contortion and gives
// users the most informative fragment (filename + one ancestor).

import {
  Check,
  Circle,
  MessageSquare,
  Square,
  UserX,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTimestamp } from '@/lib/format-relative-time';
import type { LiveEvent } from '@/hooks/useLiveEvents';
import type { ConnectionStatusValue } from '@/hooks/useSnapshot';

export interface LiveActivityPanelProps {
  events: LiveEvent[];
  connectionStatus: ConnectionStatusValue;
}

// Kind → icon mapping. Keep the allowlist narrow so unknown kinds fall back
// to a neutral dot (Circle). Adding a new kind here is a one-line change.
const KIND_ICON: Record<string, LucideIcon> = {
  pre_tool_use: Zap,
  post_tool_use: Check,
  stop: Square,
  subagent_stop: UserX,
  user_prompt_submit: MessageSquare,
};

function iconForKind(kind: string): LucideIcon {
  return KIND_ICON[kind] ?? Circle;
}

// Trailing two-segment shortening — "parent/file" — for compact file path
// display. Full path exposed via the `title` attribute for hover inspection.
// Always normalizes separators to `/` regardless of input (POSIX or Windows),
// so the visible short form is consistent across path lengths. The producer
// emits POSIX-style paths in practice, but we defensively handle backslashes
// too in case a Windows host ever feeds the pipeline.
function shortenFilePath(filePath: string): string {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) {
    return filePath;
  }
  return segments.slice(-2).join('/');
}

// Kind → connection-status badge mapping is shared with the main page's
// ConnectionStatus, so we keep a tiny inline mapper instead of importing that
// whole component (which has its own lastUpdated logic that doesn't apply
// here).
function connectionBadge(status: ConnectionStatusValue) {
  if (status === 'connecting') {
    return (
      <Badge variant="muted" className="animate-pulse">
        Connecting...
      </Badge>
    );
  }
  if (status === 'disconnected') {
    return <Badge variant="danger">Disconnected</Badge>;
  }
  return <Badge variant="success">Connected</Badge>;
}

export function LiveActivityPanel({
  events,
  connectionStatus,
}: LiveActivityPanelProps) {
  // Collapse pre/post pairs by hiding `pre_tool_use` events entirely. At
  // the 2s polling cadence, by the time a pre event reaches the panel its
  // matching post is already en route in the next tick — showing both
  // doubles the row count without adding information. `post_tool_use`
  // carries the same `tool`/`filePath`/`command`/`session` fields as its
  // pre half plus the completion signal, so it's the right canonical row.
  // Stop/SubagentStop/UserPromptSubmit events don't have a pre pair and
  // flow through unchanged.
  const visibleEvents = events.filter((ev) => ev.kind !== 'pre_tool_use');

  if (!visibleEvents || visibleEvents.length === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Live Activity</CardTitle>
          {connectionBadge(connectionStatus)}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hive-muted">
            No activity yet. Perform any tool action in Claude Code to see
            events appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  // The hook already maintains the buffer newest-first (see
  // useLiveEvents.ts: new events are unshifted after reverse), so we
  // iterate the array in place. A prior version re-sorted on every
  // render, costing O(n log n) per render for zero benefit — removed
  // per F-PERF-003 audit finding.

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Live Activity</CardTitle>
        {connectionBadge(connectionStatus)}
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-80 pr-4">
          <ul className="flex flex-col gap-3">
            {visibleEvents.map((ev) => {
              const Icon = iconForKind(ev.kind);
              const toolLabel = ev.tool ?? '—';
              const fullPath = ev.filePath ?? '';
              const shortPath = ev.filePath ? shortenFilePath(ev.filePath) : '';
              // Composite key mirrors the hook's dedup key so React can
              // stably identify rows across re-renders even when two events
              // share a millisecond.
              const rowKey =
                ev.ts +
                '|' +
                (ev.session ?? '') +
                '|' +
                ev.kind +
                '|' +
                (ev.tool ?? '') +
                '|' +
                (ev.filePath ?? '');
              return (
                <li
                  key={rowKey}
                  className="flex flex-col gap-1 border-b border-hive-surface/60 pb-2 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      className="h-3.5 w-3.5 flex-shrink-0 text-hive-accent"
                      aria-hidden="true"
                    />
                    <span className="font-mono text-[11px] uppercase tracking-wider text-hive-muted">
                      {ev.kind}
                    </span>
                    <span className="ml-auto text-xs text-hive-muted">
                      {formatRelativeTimestamp(ev.ts)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-hive-text">
                    <span className="truncate font-medium">{toolLabel}</span>
                    {ev.agent && (
                      <>
                        <span className="text-hive-muted">·</span>
                        <span className="truncate text-hive-muted">
                          {ev.agent}
                        </span>
                      </>
                    )}
                  </div>
                  {ev.filePath && (
                    <span
                      className="truncate font-mono text-xs text-hive-muted"
                      title={fullPath}
                    >
                      {shortPath}
                    </span>
                  )}
                  {ev.command && (
                    <span
                      className="truncate font-mono text-xs text-hive-accent"
                      title={ev.command}
                    >
                      $ {ev.command}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
