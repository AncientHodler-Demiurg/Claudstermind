import {
  CartesianGrid,
  Line,
  LineChart,
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
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { PhaseMetric } from '@/types/snapshot';

// CodeQualityChart — T3.10 panel showing review findings count trend across
// completed phases. Uses the shadcn Chart primitive (ChartContainer wraps
// recharts ResponsiveContainer) rather than raw recharts directly, so the
// theme CSS variables, Tooltip, and Legend follow the hive palette.
//
// Defensive field access for `findings` is LOCKED by T3.10 research because
// Phase 1's phase-metric file shape is still evolving. The chain below
// covers all four known fallbacks (snake_case, camelCase, array length,
// nested review.findings_count) plus an integer default of 0.

interface CodeQualityChartProps {
  phaseMetrics: PhaseMetric[] | null | undefined;
}

interface QualityPoint {
  phaseLabel: string;
  findings: number;
}

const chartConfig = {
  findings: {
    label: 'Review Findings',
    color: 'var(--hive-amber)',
  },
} satisfies ChartConfig;

function toChartData(metrics: PhaseMetric[]): QualityPoint[] {
  return metrics.map((m) => {
    const findings =
      (m.review_findings_count as number | undefined) ??
      (m.reviewFindingsCount as number | undefined) ??
      (m.findings as { length?: number } | undefined)?.length ??
      ((m.review as Record<string, unknown> | undefined)
        ?.findings_count as number | undefined) ??
      0;
    return {
      phaseLabel: `P${m.phase ?? '?'}`,
      findings,
    };
  });
}

export function CodeQualityChart({ phaseMetrics }: CodeQualityChartProps) {
  if (!phaseMetrics || phaseMetrics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Code Quality</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hive-muted">No quality metrics yet</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = toChartData(phaseMetrics);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Code Quality</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-64 w-full">
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--hive-border)"
            />
            <XAxis
              dataKey="phaseLabel"
              stroke="var(--hive-muted)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="var(--hive-muted)"
              fontSize={12}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              type="monotone"
              dataKey="findings"
              stroke="var(--color-findings)"
              strokeWidth={2}
              dot={{ fill: 'var(--color-findings)', r: 4 }}
              activeDot={{ r: 6 }}
              name="Review Findings"
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
