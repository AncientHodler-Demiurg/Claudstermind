import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ArchivedSpec } from '@/types/snapshot';

export interface ArchivedSpecsPanelProps {
  archivedSpecs: ArchivedSpec[] | null | undefined;
  currentSpecName?: string | null;
}

export function ArchivedSpecsPanel({ archivedSpecs, currentSpecName }: ArchivedSpecsPanelProps) {
  if (!archivedSpecs || archivedSpecs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Spec History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-hive-muted font-mono">No specs recorded yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spec History</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-60 pr-3">
          <ul className="space-y-2.5">
            {archivedSpecs.map((spec) => {
              const isCurrent = currentSpecName && spec.name === currentSpecName;
              return (
                <li
                  key={`${spec.source}-${spec.dirName}`}
                  className={`flex flex-col gap-1 rounded-sm px-3 py-2 border ${
                    isCurrent
                      ? 'border-hive-accent/30 bg-hive-accent-dim'
                      : 'border-hive-border/50 bg-hive-elevated/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-hive-text truncate">
                      {spec.name}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isCurrent && (
                        <Badge variant="success">Active</Badge>
                      )}
                      {spec.source === 'archived' && (
                        <Badge variant="muted">Archived</Badge>
                      )}
                      {spec.phaseCount > 0 && (
                        <Badge variant="default">{spec.phaseCount}P</Badge>
                      )}
                    </div>
                  </div>
                  {spec.goal && (
                    <p className="text-[11px] text-hive-text-secondary leading-tight truncate">
                      {spec.goal}
                    </p>
                  )}
                  {spec.date && (
                    <span className="font-mono text-[10px] text-hive-muted">
                      {spec.date}
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
