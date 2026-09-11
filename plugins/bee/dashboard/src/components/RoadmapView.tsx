// RoadmapView — timeline view of `snapshot.roadmap.phaseMapping`.
//
// Shows each phase as a card in a vertical timeline with:
//   - Phase number + name as the header
//   - Goal as a lead paragraph
//   - Requirements as badges
//   - Success criteria as a checklist
//   - Current status (from state.phases) as a coloured pill in the header
//
// The user can click a phase card to jump to the corresponding phase tab
// (openPhaseTab), which delegates to Quick 5's PhaseDetailView. This
// connects the high-level roadmap to the detail viewer seamlessly.
//
// Degradation: if snapshot.roadmap is null or empty, renders a helpful
// empty state pointing at `.bee/specs/<current>/ROADMAP.md`.

import { Target, ArrowRight, Map as MapIcon } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Snapshot, PhaseEntry } from '@/types/snapshot';

export interface RoadmapViewProps {
  snapshot: Snapshot | null;
  onOpenPhase?: (phaseNumber: number, label: string) => void;
}

interface ParsedPhase {
  phaseNumber: number;
  phaseName: string;
  goal: string;
  requirements: string[];
  successCriteria: string[];
  statusRow: PhaseEntry | null;
}

function parsePhaseField(
  raw: unknown,
): { number: number; name: string } | null {
  if (typeof raw === 'number') {
    return { number: raw, name: `Phase ${raw}` };
  }
  if (typeof raw === 'string') {
    // Accept "1. Server and Data API", "1: Server and Data API", "1 Server",
    // or plain "1". We require a clear boundary after the integer (either
    // `.` / `:` followed by whitespace, OR direct whitespace, OR end of
    // string). This avoids mis-parsing "1.0 Server" as {number:1, name:"0
    // Server"} — Bee uses integer phase numbers but a ROADMAP.md author
    // might type decimals and we want a clean failure instead of a
    // garbled rendering.
    const m = raw.match(/^(\d+)(?:[.:]\s+|\s+|$)(.*)$/);
    if (m) {
      const n = Number(m[1]);
      const name = m[2].trim() || `Phase ${n}`;
      return { number: n, name };
    }
  }
  return null;
}

function statusToneClass(status: string | undefined): string {
  if (!status) return 'bg-hive-elevated text-hive-muted border-hive-border';
  const s = status.toUpperCase();
  if (s === 'COMMITTED') {
    return 'bg-hive-success-dim text-hive-success border-hive-success/40';
  }
  if (s === 'TESTED' || s === 'REVIEWED' || s === 'EXECUTED') {
    return 'bg-hive-accent/20 text-hive-accent border-hive-accent/40';
  }
  if (s === 'EXECUTING' || s === 'REVIEWING' || s === 'TESTING') {
    return 'bg-hive-amber-dim text-hive-amber border-hive-amber/40';
  }
  return 'bg-hive-elevated text-hive-muted border-hive-border';
}

export function RoadmapView({ snapshot, onOpenPhase }: RoadmapViewProps) {
  const mappings = snapshot?.roadmap?.phaseMapping ?? [];
  const stateRows = snapshot?.state?.phases ?? [];

  if (mappings.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapIcon className="h-4 w-4 text-hive-accent" aria-hidden="true" />
            Roadmap
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-none border border-hive-border bg-hive-elevated p-6 text-center">
            <p className="text-sm text-hive-muted">
              No roadmap loaded. The current spec may not have a{' '}
              <code className="rounded-none border border-hive-border bg-hive-bg px-1 font-mono text-xs text-hive-accent">
                ROADMAP.md
              </code>{' '}
              file.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const parsed: ParsedPhase[] = mappings
    .map((m): ParsedPhase | null => {
      const phase = parsePhaseField(m.phase as unknown);
      if (!phase) return null;
      const statusRow = stateRows.find((r) => r.number === phase.number) ?? null;
      return {
        phaseNumber: phase.number,
        phaseName: statusRow?.name ?? phase.name,
        goal: m.goal ?? '',
        requirements: m.requirements ?? [],
        successCriteria: m.successCriteria ?? [],
        statusRow,
      };
    })
    .filter((p): p is ParsedPhase => p !== null)
    .sort((a, b) => a.phaseNumber - b.phaseNumber);

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-hive-muted">
              Current Spec
            </span>
            <CardTitle className="flex items-center gap-2 truncate">
              <MapIcon className="h-4 w-4 flex-shrink-0 text-hive-accent" aria-hidden="true" />
              <span className="truncate">
                {snapshot?.state?.currentSpec?.name ?? 'Roadmap'}
              </span>
            </CardTitle>
          </div>
          <Badge variant="muted">{parsed.length} phases</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Timeline spine — OUTSIDE the <ol> so the list content model
              stays valid (only <li> children allowed inside <ol>). */}
          <div
            className="absolute left-[9px] top-2 bottom-2 w-px bg-hive-border"
            aria-hidden="true"
          />
          <ol className="relative flex flex-col gap-5 pl-6">
          {parsed.map((p, idx) => {
            const status = p.statusRow?.status;
            const statusClass = statusToneClass(status);
            const interactive = !!onOpenPhase;
            return (
              <li key={p.phaseNumber} className="relative">
                {/* Timeline dot */}
                <div
                  className={`
                    absolute -left-6 top-3 flex h-[18px] w-[18px] items-center justify-center
                    rounded-full border-2 border-hive-bg
                    ${status === 'COMMITTED'
                      ? 'bg-hive-success'
                      : status === 'EXECUTING' || status === 'REVIEWING'
                        ? 'bg-hive-amber'
                        : status
                          ? 'bg-hive-accent'
                          : 'bg-hive-border'}
                  `}
                  aria-hidden="true"
                >
                  <span className="font-mono text-[9px] font-semibold text-hive-bg">
                    {p.phaseNumber}
                  </span>
                </div>

                {/* Phase card */}
                <button
                  type="button"
                  disabled={!interactive}
                  onClick={() =>
                    onOpenPhase?.(p.phaseNumber, `Phase ${p.phaseNumber}: ${p.phaseName}`)
                  }
                  className={`
                    group w-full text-left rounded-none border border-hive-border bg-hive-elevated/50 p-4
                    transition-colors
                    ${interactive
                      ? 'cursor-pointer hover:border-hive-accent/50 hover:bg-hive-elevated'
                      : 'cursor-default'}
                  `}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-hive-muted">
                        Phase {p.phaseNumber}
                      </span>
                      <h3 className="font-display text-base font-semibold uppercase tracking-wider text-hive-text truncate">
                        {p.phaseName}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {status && (
                        <span
                          className={`
                            rounded-none border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider
                            ${statusClass}
                          `}
                        >
                          {status}
                        </span>
                      )}
                      {interactive && (
                        <ArrowRight
                          className="h-3.5 w-3.5 text-hive-muted group-hover:text-hive-accent"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </div>

                  {p.goal && (
                    <p className="mb-3 flex items-start gap-2 text-sm text-hive-text-secondary">
                      <Target
                        className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-hive-accent"
                        aria-hidden="true"
                      />
                      <span>{p.goal}</span>
                    </p>
                  )}

                  {p.requirements.length > 0 && (
                    <div className="mb-2">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-hive-muted mr-2">
                        Reqs:
                      </span>
                      <span className="inline-flex flex-wrap gap-1">
                        {p.requirements.map((r) => (
                          <Badge key={r} variant="default">
                            {r}
                          </Badge>
                        ))}
                      </span>
                    </div>
                  )}

                  {p.successCriteria.length > 0 && (
                    <div>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-hive-muted">
                        Success Criteria ({p.successCriteria.length})
                      </span>
                      <ul className="mt-1 space-y-0.5">
                        {p.successCriteria.map((sc, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-1.5 text-[11px] text-hive-text-secondary"
                          >
                            <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-hive-accent" />
                            <span>{sc}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </button>

                {idx < parsed.length - 1 && <div className="h-2" />}
              </li>
            );
          })}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
