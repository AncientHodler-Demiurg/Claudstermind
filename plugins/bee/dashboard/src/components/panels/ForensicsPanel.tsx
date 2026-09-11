// ForensicsPanel — T3.12 alert-style widget rendering
// `.bee/forensics/*-report.md` entries. Each report shows its title,
// date, and a severity Badge colored per the hive theme variants:
//   HIGH   → danger   (red)
//   MEDIUM → warning  (amber)
//   LOW    → muted    (grey)
// Unknown or missing severities fall back to `muted` so the panel is
// still legible on partial/legacy scanner output.
//
// Severity helper is intentionally inlined in this file (not shared
// via src/lib/status-variant.ts) so T3.12 does not conflict with the
// sibling panels in Wave 3 — each panel owns its own mapping.
//
// Empty-state rule: `forensics` may be `null | undefined | []`. In
// every case the panel renders a muted "No forensics yet" message
// inside the Card rather than crashing.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { ForensicsEntry } from '@/types/snapshot';

/**
 * Map a severity label from the forensics scanner onto a Badge variant.
 * The comparison is case-insensitive and falls through to `muted` for
 * unknown or missing severities.
 */
function severityToVariant(
  severity: string | null | undefined
): 'danger' | 'warning' | 'muted' {
  const normalized = (severity || '').toUpperCase();
  if (normalized === 'CRITICAL') return 'danger';
  if (normalized === 'HIGH') return 'danger';
  if (normalized === 'MEDIUM') return 'warning';
  if (normalized === 'LOW') return 'muted';
  return 'muted';
}

export interface ForensicsPanelProps {
  forensics: ForensicsEntry[] | null | undefined;
}

export function ForensicsPanel({ forensics }: ForensicsPanelProps) {
  if (!forensics || forensics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Forensics</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hive-muted">No forensics yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forensics</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-80 pr-4">
          <ul className="flex flex-col gap-3">
            {forensics.map((report) => (
              <li
                key={report.filePath}
                className="flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-hive-text">
                    {report.title}
                  </span>
                  <span className="text-xs text-hive-muted">{report.date}</span>
                </div>
                <Badge variant={severityToVariant(report.severity)}>
                  {(report.severity || 'UNKNOWN').toUpperCase()}
                </Badge>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
