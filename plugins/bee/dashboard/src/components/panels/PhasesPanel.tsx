// PhasesPanel — T3.7 widget that renders each phase row from
// `Snapshot.state.phases` with a status Badge and a lifecycle progress
// bar. Wrapped in the shadcn Card composition so it snaps into the
// MissionControlLayout grid.
//
// Variant mapping rule (critical): the status-to-variant lookup uses an
// EXACT lowercase string match via a canonical record, NEVER a
// substring scan. A substring approach would incorrectly flip
// "Plan reviewed" into the success variant (because the string contains
// the "reviewed" token), even though a plan review is a muted
// pre-execution state. Keeping the mapping exact protects against that
// class of bug.
//
// React 19 convention: this is a plain function component using the
// ref-as-prop rules — the underlying shadcn primitives follow the same
// pattern.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { PhaseEntry } from '@/types/snapshot';

/**
 * Canonical status string -> Badge variant mapping.
 *
 * Keys are the exact (lowercased) status labels observed in
 * STATE.md phase rows. Values map to the hive-themed Badge variants
 * defined in @/components/ui/badge.
 *
 * IMPORTANT: this is an exact-match map, not a substring scan. See the
 * file header note about the "Plan reviewed" / "reviewed" collision.
 */
const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'muted'> = {
  'committed': 'success',
  'completed': 'success',
  'reviewed': 'success',
  'tested': 'success',
  'in-progress': 'warning',
  'executing': 'warning',
  'executed': 'warning',
  'active': 'warning',
  'plan pending': 'muted',
  'planned': 'muted',
  'plan reviewed': 'muted',
  'plan_reviewed': 'muted',
  'pending': 'muted',
};

function statusToVariant(status: string): 'success' | 'warning' | 'muted' {
  return STATUS_VARIANTS[status.toLowerCase()] ?? 'muted';
}

/**
 * Count the lifecycle columns on a phase row that have been
 * "completed" -- a column counts iff it's present, non-empty, and not
 * a dash placeholder. Returns a 0-100 percentage for <Progress value>.
 */
function computeProgress(phase: PhaseEntry): number {
  const lifecycleColumns = [
    phase.plan,
    phase.planReview,
    phase.executed,
    phase.reviewed,
    phase.tested,
    phase.committed,
  ];
  const completed = lifecycleColumns.filter(
    (col) => col && col.trim() !== '' && col.trim() !== '-'
  ).length;
  return (completed / 6) * 100;
}

export interface PhasesPanelProps {
  phases: PhaseEntry[] | null | undefined;
}

export function PhasesPanel({ phases }: PhasesPanelProps) {
  if (!phases || phases.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Phases</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hive-muted">No phases yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phases</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-4">
          {phases.map((phase) => {
            const progress = computeProgress(phase);
            return (
              <li
                key={phase.number}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-mono text-hive-muted">
                      {String(phase.number).padStart(2, '0')}
                    </span>
                    <span className="truncate text-sm font-medium text-hive-text">
                      {phase.name}
                    </span>
                  </div>
                  <Badge variant={statusToVariant(phase.status)}>
                    {phase.status}
                  </Badge>
                </div>
                <Progress value={progress} />
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
