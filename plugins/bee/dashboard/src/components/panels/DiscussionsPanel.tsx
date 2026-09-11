// DiscussionsPanel — T3.12 list widget rendering `.bee/discussions/*.md`
// entries. Each discussion shows its title and date. The panel is
// wrapped in a Card with a fixed-height ScrollArea so long lists
// scroll internally instead of stretching the dashboard grid row.
//
// Empty-state rule: `discussions` may be `null | undefined | []`. In
// every case the panel renders a muted "No discussions yet" message
// inside the Card rather than crashing.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { DiscussionEntry } from '@/types/snapshot';

export interface DiscussionsPanelProps {
  discussions: DiscussionEntry[] | null | undefined;
  /** Optional: called when a discussion row is single-clicked (preview)
   *  or double-clicked (pinned). Matches the VS Code preview-tab pattern. */
  onOpenFile?: (
    relativePath: string,
    label: string,
    options?: { preview?: boolean },
  ) => void;
}

export function DiscussionsPanel({ discussions, onOpenFile }: DiscussionsPanelProps) {
  if (!discussions || discussions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Discussions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hive-muted">No discussions yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discussions</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-80 pr-4">
          <ul className="flex flex-col gap-3">
            {discussions.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((discussion) => {
              const label = discussion.title || 'Untitled discussion';
              return (
              <li key={discussion.filePath}>
                <button
                  type="button"
                  disabled={!onOpenFile}
                  onClick={() =>
                    onOpenFile?.(discussion.filePath, label, {
                      preview: true,
                    })
                  }
                  onDoubleClick={() =>
                    onOpenFile?.(discussion.filePath, label, {
                      preview: false,
                    })
                  }
                  className="flex w-full flex-col gap-0.5 text-left rounded-none border-l-2 border-transparent px-1 -mx-1 transition-colors hover:border-hive-accent/50 hover:bg-hive-surface/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hive-accent disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
                >
                  <span className="truncate text-sm font-medium text-hive-text">
                    {label}
                  </span>
                  <span className="text-xs text-hive-muted">
                    {discussion.date}
                  </span>
                </button>
              </li>
              );
            })}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
