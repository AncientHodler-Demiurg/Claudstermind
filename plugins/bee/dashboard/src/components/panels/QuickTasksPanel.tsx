// QuickTasksPanel — T3.12 list widget rendering `.bee/quick/*.md`
// entries. Tasks are sorted by date descending so the most recent
// appears first. Each task shows its number + title with a status
// Badge colored per the hive theme variants:
//   completed / done / committed → success
//   in-progress / active         → warning
//   everything else              → muted
//
// Status helper is intentionally inlined in this file (not shared via
// src/lib/status-variant.ts) so T3.12 does not conflict with sibling
// panels in Wave 3 — each panel owns its own mapping.
//
// Empty-state rule: `quickTasks` may be `null | undefined | []`. In
// every case the panel renders a muted "No quick tasks yet" message
// inside the Card rather than crashing.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { QuickTaskEntry } from '@/types/snapshot';

/**
 * Map a quick-task status onto a Badge variant. Comparison is
 * case-insensitive and unknown statuses fall through to `muted`.
 */
function statusToVariant(
  status: string | undefined | null
): 'success' | 'warning' | 'muted' {
  const normalized = (status || '').toLowerCase();
  if (
    normalized === 'completed' ||
    normalized === 'done' ||
    normalized === 'committed'
  ) {
    return 'success';
  }
  if (normalized === 'in-progress' || normalized === 'active') {
    return 'warning';
  }
  return 'muted';
}

export interface QuickTasksPanelProps {
  quickTasks: QuickTaskEntry[] | null | undefined;
  /** Optional: called when a quick-task row is single-clicked (preview)
   *  or double-clicked (pinned). Matches the VS Code preview-tab pattern. */
  onOpenFile?: (
    relativePath: string,
    label: string,
    options?: { preview?: boolean },
  ) => void;
}

export function QuickTasksPanel({ quickTasks, onOpenFile }: QuickTasksPanelProps) {
  if (!quickTasks || quickTasks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Quick Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hive-muted">No quick tasks yet</p>
        </CardContent>
      </Card>
    );
  }

  const sorted = quickTasks
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Tasks</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-80 pr-4">
          <ul className="flex flex-col gap-3">
            {sorted.map((task) => {
              const label = `${String(task.number).padStart(3, '0')} — ${task.title}`;
              return (
                <li
                  key={task.filePath}
                  className="flex items-start justify-between gap-3"
                >
                  <button
                    type="button"
                    disabled={!onOpenFile}
                    onClick={() =>
                      onOpenFile?.(task.filePath, label, { preview: true })
                    }
                    onDoubleClick={() =>
                      onOpenFile?.(task.filePath, label, { preview: false })
                    }
                    className="min-w-0 flex flex-1 flex-col gap-0.5 text-left rounded-none border-l-2 border-transparent px-1 -mx-1 transition-colors hover:border-hive-accent/50 hover:bg-hive-surface/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hive-accent disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
                  >
                    <span className="truncate text-sm font-medium text-hive-text">
                      {String(task.number).padStart(3, '0')} — {task.title}
                    </span>
                    <span className="text-xs text-hive-muted">{task.date}</span>
                  </button>
                  <Badge variant={statusToVariant(task.status)}>
                    {task.status || 'unknown'}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
