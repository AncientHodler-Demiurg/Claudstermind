import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { RequirementsCoverage } from '@/types/snapshot';

// RequirementsCoveragePanel — T3.11
// Renders the overall and per-section coverage of checkbox items parsed out
// of the spec's REQUIREMENTS.md file (T1.5 readRequirementsCoverage). When no
// requirements file is present, the panel renders an empty state so users
// still see the slot exists but nothing is wired up yet.
//
// Props are typed to accept `null` and `undefined` so consumers can pass the
// snapshot field directly without pre-guarding it: the Phase 1 contract
// returns `requirements: RequirementsCoverage | null` and consumers may also
// hold an in-flight undefined value during the initial fetch.

interface RequirementsCoveragePanelProps {
  requirements: RequirementsCoverage | null | undefined;
}

export function RequirementsCoveragePanel({
  requirements,
}: RequirementsCoveragePanelProps) {
  // Empty state: no file detected OR file parsed to zero checkbox items. We
  // treat both cases as "nothing to display" so the panel never renders a
  // misleading 0/0 with a full progress bar.
  if (!requirements || requirements.total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Requirements Coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-hive-muted">No requirements file detected</p>
        </CardContent>
      </Card>
    );
  }

  const percentage =
    requirements && requirements.total > 0
      ? Math.round((requirements.checked / requirements.total) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Requirements Coverage</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-5xl font-bold text-hive-gold">
          {requirements.checked}
          <span className="text-hive-muted"> / {requirements.total}</span>
        </div>
        <div className="text-lg text-hive-muted mt-1">
          {percentage}% complete
        </div>
        <Progress value={percentage} className="mt-4" />

        <div className="mt-6 flex flex-col gap-3">
          {requirements.sections.map((section) => {
            const sectionPct =
              section.total > 0
                ? Math.round((section.checked / section.total) * 100)
                : 0;
            return (
              <div key={section.name} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-hive-text">{section.name}</span>
                  <span className="text-hive-muted">
                    {section.checked} / {section.total}
                  </span>
                </div>
                <Progress value={sectionPct} className="h-1" />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
