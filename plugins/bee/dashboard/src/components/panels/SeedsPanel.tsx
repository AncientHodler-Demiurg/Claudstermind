// SeedsPanel — T3.12 list widget rendering `.bee/seeds/seed-*.md`
// entries. Each seed shows its id + title with a truncated idea
// snippet so long ideas don't blow up the Card. The panel is wrapped
// in a Card with a fixed-height ScrollArea so long lists scroll
// internally instead of stretching the dashboard grid row.
//
// Empty-state rule: `seeds` may be `null | undefined | []`. In every
// case the panel renders a muted "No seeds yet" message inside the
// Card rather than crashing.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { SeedEntry } from '@/types/snapshot';

/** Truncate long idea blurbs so they fit on a single line. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + '…';
}

export interface SeedsPanelProps {
  seeds: SeedEntry[] | null | undefined;
  /** Optional: called when a seed row is single-clicked (preview) or
   *  double-clicked (pinned). Matches the VS Code preview-tab pattern —
   *  single-click opens into the reusable preview slot, double-click
   *  opens directly as a permanent tab. If omitted, rows are inert. */
  onOpenFile?: (
    relativePath: string,
    label: string,
    options?: { preview?: boolean },
  ) => void;
}

export function SeedsPanel({ seeds, onOpenFile }: SeedsPanelProps) {
  if (!seeds || seeds.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Seeds</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hive-muted">No seeds yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seeds</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-80 pr-4">
          <ul className="flex flex-col gap-3">
            {seeds.map((seed) => {
              const label = seed.title || seed.id || 'Untitled';
              return (
                <li key={seed.filePath}>
                  <button
                    type="button"
                    disabled={!onOpenFile}
                    onClick={() =>
                      onOpenFile?.(seed.filePath, label, { preview: true })
                    }
                    onDoubleClick={() =>
                      onOpenFile?.(seed.filePath, label, { preview: false })
                    }
                    className="flex w-full flex-col gap-0.5 text-left rounded-none border-l-2 border-transparent px-1 -mx-1 transition-colors hover:border-hive-accent/50 hover:bg-hive-surface/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hive-accent disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
                  >
                    <span className="truncate text-sm font-medium text-hive-text">
                      {seed.id ? `${seed.id} — ` : ''}{seed.title || 'Untitled'}
                    </span>
                    <span className="text-xs text-hive-muted">
                      {truncate(seed.idea || '', 80)}
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
