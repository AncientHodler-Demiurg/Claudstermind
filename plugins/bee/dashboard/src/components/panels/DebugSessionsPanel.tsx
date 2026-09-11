// DebugSessionsPanel — T3.12 list widget rendering
// `.bee/debug/sessions/*/state.json` entries. Each session shows the
// slug, current focus, and a status Badge colored per the hive theme
// variants:
//   active   → warning  (in-progress work)
//   resolved → success  (fix landed)
//   archived → muted    (stale / abandoned)
// Unknown statuses fall back to `muted` so the panel stays legible on
// partial/legacy scanner output.
//
// Status helper is intentionally inlined in this file (not shared via
// src/lib/status-variant.ts) so T3.12 does not conflict with sibling
// panels in Wave 3 — each panel owns its own mapping.
//
// Empty-state rule: `debugSessions` may be `null | undefined | []`.
// In every case the panel renders a muted "No debug sessions yet"
// message inside the Card rather than crashing.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { DebugSessionEntry } from '@/types/snapshot';

/**
 * Map a debug session status onto a Badge variant. Comparison is
 * case-insensitive and unknown statuses fall through to `muted`.
 */
function statusToVariant(
  status: string | undefined | null
): 'warning' | 'success' | 'muted' {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'active') return 'warning';
  if (normalized === 'resolved') return 'success';
  if (normalized === 'archived') return 'muted';
  return 'muted';
}

export interface DebugSessionsPanelProps {
  debugSessions: DebugSessionEntry[] | null | undefined;
}

export function DebugSessionsPanel({
  debugSessions,
}: DebugSessionsPanelProps) {
  if (!debugSessions || debugSessions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Debug Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hive-muted">No debug sessions yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Debug Sessions</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-80 pr-4">
          <ul className="flex flex-col gap-3">
            {debugSessions.map((session) => (
              <li
                key={session.filePath}
                className="flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-hive-text">
                    {session.slug}
                  </span>
                  {session.current_focus && (
                    <span className="truncate text-xs text-hive-muted">
                      {session.current_focus}
                    </span>
                  )}
                </div>
                <Badge variant={statusToVariant(session.status)}>
                  {session.status || 'unknown'}
                </Badge>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
