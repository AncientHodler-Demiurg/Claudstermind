// PhaseDetailView — rich per-phase view rendered in the phase tab.
//
// Cross-references three snapshot sources:
//   1. `snapshot.state.phases[n]`   — tabular workflow status (plan, planReview,
//      executed, reviewed, tested, committed) shown as a progress chain.
//   2. `snapshot.phases[n]`          — rich definition (description,
//      deliverables, dependencies).
//   3. `snapshot.roadmap.phaseMapping[n]` — goal, requirements mapping,
//      success criteria.
//
// Missing fields degrade gracefully — any section whose data is null/empty
// is hidden rather than rendering a blank card. This keeps the view useful
// for historical phases that only have partial data.
//
// Layout: single Card with sectioned content. No tabs-within-tabs; the user
// can scroll vertically through all sections.

import {
  Check,
  Circle,
  Link2,
  ListChecks,
  Target,
  Layers,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Snapshot, PhaseEntry, PhaseDefinition } from '@/types/snapshot';

export interface PhaseDetailViewProps {
  phaseNumber: number;
  snapshot: Snapshot | null;
}

interface RoadmapMapping {
  goal: string;
  requirements: string[];
  successCriteria: string[];
}

function findPhaseRow(
  snapshot: Snapshot | null,
  phaseNumber: number,
): PhaseEntry | null {
  return (
    snapshot?.state?.phases?.find((p) => p.number === phaseNumber) ?? null
  );
}

function findPhaseDefinition(
  snapshot: Snapshot | null,
  phaseNumber: number,
): PhaseDefinition | null {
  return snapshot?.phases?.find((p) => p.number === phaseNumber) ?? null;
}

function isRoadmapMapping(value: unknown): value is RoadmapMapping {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.goal === 'string' &&
    Array.isArray(v.requirements) &&
    v.requirements.every((r) => typeof r === 'string') &&
    Array.isArray(v.successCriteria) &&
    v.successCriteria.every((s) => typeof s === 'string')
  );
}

function findRoadmapMapping(
  snapshot: Snapshot | null,
  phaseNumber: number,
): RoadmapMapping | null {
  if (!snapshot?.roadmap?.phaseMapping) return null;
  for (const entry of snapshot.roadmap.phaseMapping) {
    // The roadmap `phase` field can be a number OR a string like "1. Name".
    // Match by number prefix.
    const raw = entry.phase as unknown;
    let matches = false;
    if (typeof raw === 'number' && raw === phaseNumber) {
      matches = true;
    } else if (typeof raw === 'string') {
      const m = raw.match(/^(\d+)/);
      if (m && Number(m[1]) === phaseNumber) {
        matches = true;
      }
    }
    if (!matches) continue;
    // Runtime-validate the full shape before casting — avoids returning a
    // partially-filled mapping that the consumer assumes is complete.
    if (isRoadmapMapping(entry)) {
      return entry;
    }
    // Partial match: synthesize a safe default so the UI still renders the
    // sections that do exist without crashing on missing arrays.
    return {
      goal: typeof (entry as { goal?: unknown }).goal === 'string'
        ? ((entry as { goal: string }).goal)
        : '',
      requirements: Array.isArray((entry as { requirements?: unknown }).requirements)
        ? ((entry as { requirements: unknown[] }).requirements.filter(
            (r): r is string => typeof r === 'string',
          ))
        : [],
      successCriteria: Array.isArray(
        (entry as { successCriteria?: unknown }).successCriteria,
      )
        ? ((entry as { successCriteria: unknown[] }).successCriteria.filter(
            (s): s is string => typeof s === 'string',
          ))
        : [],
    };
  }
  return null;
}

function statusBadgeVariant(
  status: string,
): 'success' | 'warning' | 'default' | 'muted' {
  const s = status.toUpperCase();
  if (
    s === 'COMMITTED' ||
    s === 'TESTED' ||
    s === 'REVIEWED' ||
    s === 'EXECUTED'
  ) {
    return 'success';
  }
  if (s === 'EXECUTING' || s === 'REVIEWING' || s === 'TESTING') {
    return 'warning';
  }
  if (s === 'PLANNED' || s === 'PLAN_REVIEWED') {
    return 'default';
  }
  return 'muted';
}

// ── Workflow progress chain ──
//
// Each stage is a boolean derived from the snapshot state.phases row. A
// stage is "done" when the corresponding column contains a non-empty value
// other than "" or "-".
const STAGES: Array<{
  key: keyof PhaseEntry;
  label: string;
  icon: LucideIcon;
}> = [
  { key: 'plan', label: 'Plan', icon: ListChecks },
  { key: 'planReview', label: 'Plan Review', icon: Check },
  { key: 'executed', label: 'Executed', icon: Layers },
  { key: 'reviewed', label: 'Reviewed', icon: Check },
  { key: 'tested', label: 'Tested', icon: Check },
  { key: 'committed', label: 'Committed', icon: Check },
];

function isStageDone(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const str = String(value).trim();
  if (str === '' || str === '-' || str === 'No') return false;
  return true;
}

export function PhaseDetailView({
  phaseNumber,
  snapshot,
}: PhaseDetailViewProps) {
  const row = findPhaseRow(snapshot, phaseNumber);
  const definition = findPhaseDefinition(snapshot, phaseNumber);
  const mapping = findRoadmapMapping(snapshot, phaseNumber);

  if (!row && !definition && !mapping) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Phase {phaseNumber}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-none border border-hive-amber/40 bg-hive-amber-dim p-4">
            <AlertTriangle
              className="h-4 w-4 flex-shrink-0 text-hive-amber mt-0.5"
              aria-hidden="true"
            />
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-hive-amber">
                No data for phase {phaseNumber}
              </span>
              <span className="text-sm text-hive-text-secondary">
                This phase does not appear in state.phases, snapshot.phases, or
                the roadmap. It may belong to an archived spec or have been
                removed.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const displayName =
    row?.name ?? definition?.name ?? `Phase ${phaseNumber}`;
  const status = row?.status ?? 'UNKNOWN';

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-hive-muted">
              Phase {phaseNumber}
            </span>
            <CardTitle className="truncate">{displayName}</CardTitle>
          </div>
          <Badge variant={statusBadgeVariant(status)}>{status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Workflow progress ── */}
        {row && (
          <section>
            <h4 className="mb-3 font-mono text-[10px] uppercase tracking-wider text-hive-muted">
              Workflow Progress
            </h4>
            <div className="flex flex-wrap items-center gap-2">
              {STAGES.map((stage, idx) => {
                const done = isStageDone(row[stage.key]);
                const StageIcon = done ? Check : Circle;
                return (
                  <div key={stage.key} className="flex items-center gap-2">
                    <div
                      className={`
                        flex items-center gap-1.5 rounded-none border px-2 py-1
                        font-mono text-[10px] uppercase tracking-wider
                        ${done
                          ? 'border-hive-success/50 bg-hive-success-dim text-hive-success'
                          : 'border-hive-border bg-hive-elevated text-hive-muted'}
                      `}
                    >
                      <StageIcon className="h-3 w-3" aria-hidden="true" />
                      <span>{stage.label}</span>
                      {done && typeof row[stage.key] === 'string' && (
                        <span className="text-[9px] opacity-70">
                          {String(row[stage.key])}
                        </span>
                      )}
                    </div>
                    {idx < STAGES.length - 1 && (
                      <div
                        className={`h-px w-3 ${
                          done ? 'bg-hive-success/50' : 'bg-hive-border'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Description ── */}
        {definition?.description && (
          <section>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-hive-muted">
              Description
            </h4>
            <p className="text-sm leading-relaxed text-hive-text-secondary">
              {definition.description}
            </p>
          </section>
        )}

        {/* ── Goal ── */}
        {mapping?.goal && (
          <section>
            <h4 className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-hive-muted">
              <Target className="h-3 w-3" aria-hidden="true" />
              Goal
            </h4>
            <p className="text-sm leading-relaxed text-hive-text">
              {mapping.goal}
            </p>
          </section>
        )}

        {/* ── Deliverables ── */}
        {definition?.deliverables && definition.deliverables.length > 0 && (
          <section>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-hive-muted">
              Deliverables ({definition.deliverables.length})
            </h4>
            <ul className="space-y-1.5">
              {definition.deliverables.map((d, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-hive-text-secondary"
                >
                  <Check
                    className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-hive-accent"
                    aria-hidden="true"
                  />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Success Criteria ── */}
        {mapping?.successCriteria && mapping.successCriteria.length > 0 && (
          <section>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-hive-muted">
              Success Criteria ({mapping.successCriteria.length})
            </h4>
            <ul className="space-y-1.5">
              {mapping.successCriteria.map((sc, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-hive-text-secondary"
                >
                  <Check
                    className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-hive-accent"
                    aria-hidden="true"
                  />
                  <span>{sc}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Requirements ── */}
        {mapping?.requirements && mapping.requirements.length > 0 && (
          <section>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-hive-muted">
              Requirements Covered
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {mapping.requirements.map((r) => (
                <Badge key={r} variant="default">
                  {r}
                </Badge>
              ))}
            </div>
          </section>
        )}

        {/* ── Dependencies ── */}
        {definition?.dependencies && definition.dependencies.length > 0 && (
          <section>
            <h4 className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-hive-muted">
              <Link2 className="h-3 w-3" aria-hidden="true" />
              Dependencies
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {definition.dependencies.map((d) => (
                <Badge key={d} variant="muted">
                  {d}
                </Badge>
              ))}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
