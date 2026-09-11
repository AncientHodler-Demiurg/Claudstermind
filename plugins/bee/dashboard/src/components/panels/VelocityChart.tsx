import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { PhaseEntry, PhaseMetric } from '@/types/snapshot';

// VelocityChart — Phase 3 T3.9.
//
// Renders a bar chart of per-phase execution duration (in minutes). Each bar
// represents one phase from the `.bee/metrics/` phase metric records. The
// chart is wrapped in a shadcn Card and uses the shadcn ChartContainer
// primitive so the bar color flows through the --color-duration CSS variable
// declared by chartConfig below.
//
// Field access is deliberately defensive: the Phase 1 metric JSON schema is
// still evolving (see PhaseMetric index-signature comment in
// src/types/snapshot.ts), so we probe several likely field names in priority
// order and fall back to 0 when none are present:
//   1. m.execution_duration_ms     (canonical snake_case ms)
//   2. m.executionDurationMs       (camelCase variant)
//   3. m.duration_ms               (legacy flat field)
//   4. m.execution.duration_seconds (nested seconds — multiplied by 1000)
//
// Empty state: when phaseMetrics is null, undefined, or an empty array a
// muted "No phase metrics recorded yet" message renders inside the Card.

interface VelocityChartProps {
  phaseMetrics: PhaseMetric[] | null | undefined;
  phases?: PhaseEntry[] | null | undefined;
}

// chartConfig — a single `duration` series keyed against the bar's dataKey.
// The hive-gold token flows into the chart via --color-duration after
// ChartContainer emits its <style> block.
const chartConfig = {
  duration: {
    label: 'Duration (min)',
    color: 'var(--hive-gold)',
  },
} satisfies ChartConfig;

interface VelocityDatum {
  phaseLabel: string;
  durationMinutes: number;
}

function resolveDurationMs(m: PhaseMetric): number {
  // Defensive index-signature access — each probe is cast explicitly so the
  // strict TS checker accepts the `unknown` index signature values. We probe
  // several candidate field names in priority order and fall back to a
  // nested `execution.duration_seconds` (multiplied into ms) before
  // finally defaulting to 0.
  const nestedSeconds =
    ((m.execution as Record<string, unknown> | undefined)
      ?.duration_seconds as number | undefined) ?? 0;
  const durationMs =
    (m.execution_duration_ms as number | undefined) ??
    (m.executionDurationMs as number | undefined) ??
    (m.duration_ms as number | undefined) ??
    nestedSeconds * 1000 ??
    0;
  return Number.isFinite(durationMs) ? durationMs : 0;
}

function resolvePhaseLabel(
  m: PhaseMetric,
  phases: PhaseEntry[] | null | undefined
): string {
  const phaseNum = m.phase;
  if (phases && phaseNum !== undefined) {
    const match = phases.find((p) => p.number === phaseNum);
    if (match) {
      return `P${match.number}`;
    }
  }
  return `P${m.phase ?? '?'}`;
}

function buildChartData(
  phaseMetrics: PhaseMetric[] | null | undefined,
  phases: PhaseEntry[] | null | undefined
): VelocityDatum[] {
  if (!phaseMetrics || phaseMetrics.length === 0) {
    return [];
  }
  return phaseMetrics.map((m) => {
    const durationMs = resolveDurationMs(m);
    const durationMinutes = Math.round((durationMs / 60000) * 100) / 100;
    return {
      phaseLabel: resolvePhaseLabel(m, phases),
      durationMinutes,
    };
  });
}

export function VelocityChart({ phaseMetrics, phases }: VelocityChartProps) {
  const data = buildChartData(phaseMetrics, phases);
  const isEmpty = data.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Velocity</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-[240px] items-center justify-center text-sm text-hive-muted">
            No phase metrics recorded yet
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="h-[240px] w-full aspect-auto"
          >
            <BarChart
              data={data}
              margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="phaseLabel"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                allowDecimals
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="durationMinutes"
                name="duration"
                fill="var(--color-duration)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
