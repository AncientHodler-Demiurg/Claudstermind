// ActivityFeed — T4.2 presentation component for the Bee Board activity
// stream. Accepts a pre-computed `ActivityEvent[]` (the diff-producer in
// T4.3 owns the computation) and renders a scrollable, reverse-chronological
// feed inside a fixed-height Card.
//
// Responsibilities:
//   - Sort events reverse-chronological (newest first) via lexicographic
//     `localeCompare` on ISO-8601 `timestamp` strings. This avoids a Date
//     allocation per comparison and is stable across renders.
//   - Map each event's `type` to a hive-themed Badge variant so users can
//     skim the feed by colour alone:
//       'file-added'    → success
//       'file-removed'  → muted
//       'status-change' → warning
//       'metric-change' → default
//   - Render a muted "No recent activity" message inside the Card when
//     `events` is empty, matching the empty-state contract shared by the
//     Phase 3 list panels.
//   - Render each event with a relative timestamp (e.g. "2m ago") next to
//     the description so users see recency at a glance without a full
//     datetime stamp stealing space.
//
// React 19 ref-as-prop: this is a plain function component (no legacy ref forwarding helper).

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTimestamp } from '@/lib/format-relative-time';
import type { ActivityEvent, ActivityEventType } from '@/types/activity';

export interface ActivityFeedProps {
  events: ActivityEvent[];
}

type BadgeVariant = 'success' | 'muted' | 'warning' | 'default';

const TYPE_TO_VARIANT: Record<ActivityEventType, BadgeVariant> = {
  'file-added': 'success',
  'file-removed': 'muted',
  'status-change': 'warning',
  'metric-change': 'default',
};

export function ActivityFeed({ events }: ActivityFeedProps) {
  if (!events || events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activity Feed</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hive-muted">No recent activity</p>
        </CardContent>
      </Card>
    );
  }

  const sorted = events
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Feed</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-96 pr-4">
          <ul className="flex flex-col gap-3">
            {sorted.map((event) => (
              <li
                key={event.id}
                className="flex flex-col gap-1 border-b border-hive-surface/60 pb-2 last:border-b-0 last:pb-0"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={TYPE_TO_VARIANT[event.type]}>
                    {event.type}
                  </Badge>
                  <span className="text-xs text-hive-muted">
                    {formatRelativeTimestamp(event.timestamp)}
                  </span>
                </div>
                <span className="truncate text-sm text-hive-text">
                  {event.description}
                </span>
                <span className="truncate text-xs text-hive-muted">
                  {event.source}
                </span>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
