// NotesPanel — T3.12 list widget rendering `.bee/notes/*.md` entries
// from the hive snapshot. Each note is sorted by date descending so the
// most recent appears first. The panel is wrapped in a Card with a
// fixed-height ScrollArea so long lists scroll internally instead of
// stretching the dashboard grid row.
//
// Empty-state rule: `notes` may be `null | undefined | []`. In every
// case the panel renders a muted "No notes yet" message inside the Card
// rather than crashing. This matches the Phase 1 "never errors" contract
// that allows snapshot slices to be null on fresh projects.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { NoteEntry } from '@/types/snapshot';

export interface NotesPanelProps {
  notes: NoteEntry[] | null | undefined;
  /** Optional: called when a note row is single-clicked (preview) or
   *  double-clicked (pinned). Matches the VS Code preview-tab pattern. */
  onOpenFile?: (
    relativePath: string,
    label: string,
    options?: { preview?: boolean },
  ) => void;
}

export function NotesPanel({ notes, onOpenFile }: NotesPanelProps) {
  if (!notes || notes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hive-muted">No notes yet</p>
        </CardContent>
      </Card>
    );
  }

  const sorted = notes
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-80 pr-4">
          <ul className="flex flex-col gap-3">
            {sorted.map((note) => {
              const label = note.title || 'Untitled note';
              return (
              <li key={note.filePath}>
                <button
                  type="button"
                  disabled={!onOpenFile}
                  onClick={() =>
                    onOpenFile?.(note.filePath, label, { preview: true })
                  }
                  onDoubleClick={() =>
                    onOpenFile?.(note.filePath, label, { preview: false })
                  }
                  className="flex w-full flex-col gap-0.5 text-left rounded-none border-l-2 border-transparent px-1 -mx-1 transition-colors hover:border-hive-accent/50 hover:bg-hive-surface/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hive-accent disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
                >
                  <span className="truncate text-sm font-medium text-hive-text">
                    {label}
                  </span>
                  <span className="text-xs text-hive-muted">{note.date}</span>
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
