import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ActiveSpec } from '@/types/snapshot';

export interface ActiveSpecsPanelProps {
  activeSpecs: ActiveSpec[] | null | undefined;
  currentSpecName?: string | null;
}

/** Humanize an ISO timestamp into a short relative label (e.g. "3h ago"). */
function humanizeDate(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return iso;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ActiveSpecsPanel({ activeSpecs, currentSpecName }: ActiveSpecsPanelProps) {
  if (!activeSpecs || activeSpecs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Specs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-hive-muted font-mono">No active specs</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Specs</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-60 pr-3">
          <ul className="space-y-2.5">
            {activeSpecs.map((spec) => {
              const isCurrent =
                currentSpecName &&
                (spec.slug === currentSpecName || spec.title === currentSpecName);
              return (
                <li
                  key={spec.slug}
                  className={`flex flex-col gap-1 rounded-sm px-3 py-2 border ${
                    isCurrent
                      ? 'border-hive-accent/30 bg-hive-accent-dim'
                      : 'border-hive-border/50 bg-hive-elevated/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-hive-text truncate">
                      {spec.title || spec.slug}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {spec.stage && (
                        <Badge variant="default">{spec.stage}</Badge>
                      )}
                      {spec.inWorktree ? (
                        <Badge variant="success">⊞ worktree</Badge>
                      ) : (
                        <Badge variant="muted">in-place</Badge>
                      )}
                    </div>
                  </div>
                  {spec.slug !== spec.title && spec.slug && (
                    <p className="text-[11px] text-hive-text-secondary leading-tight truncate">
                      {spec.slug}
                    </p>
                  )}
                  {spec.last_touched && (
                    <span className="font-mono text-[10px] text-hive-muted">
                      {humanizeDate(spec.last_touched)}
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
