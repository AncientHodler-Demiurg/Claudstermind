import {
  Area,
  AreaChart,
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
import type { HealthHistoryEntry } from '@/types/snapshot';

// HealthTrendChart — Phase 3 T3.8.
//
// Renders a stacked area chart of the last N `.bee/metrics/health-history.json`
// entries aggregated by day. Each entry contributes three series: passed,
// warnings, and failures. The chart is wrapped in a shadcn Card and uses the
// shadcn ChartContainer primitive so colors wire through the --color-<key>
// CSS variable system from a single source of truth (chartConfig).
//
// Empty state: when healthHistory is null or empty, a muted "No health
// history yet" message renders inside the Card.

interface HealthTrendChartProps {
  healthHistory: HealthHistoryEntry[] | null | undefined;
}

// chartConfig — series metadata consumed by ChartContainer. Keys match the
// dataKey attributes on each <Area /> and become --color-passed,
// --color-warnings, --color-failures CSS variables on the chart root.
const chartConfig = {
  passed: {
    label: 'Passed',
    color: 'var(--hive-gold)',
  },
  warnings: {
    label: 'Warnings',
    color: 'var(--hive-amber)',
  },
  failures: {
    label: 'Failures',
    color: 'var(--hive-danger)',
  },
} satisfies ChartConfig;

interface ChartDatum {
  date: string;
  passed: number;
  warnings: number;
  failures: number;
}

function buildChartData(
  healthHistory: HealthHistoryEntry[] | null | undefined
): ChartDatum[] {
  if (!healthHistory || healthHistory.length === 0) {
    return [];
  }
  return healthHistory.map((entry) => ({
    date: entry.timestamp.slice(0, 10),
    passed: entry.summary?.passed ?? 0,
    warnings: entry.summary?.warnings ?? 0,
    failures: entry.summary?.failures ?? 0,
  }));
}

export function HealthTrendChart({ healthHistory }: HealthTrendChartProps) {
  const data = buildChartData(healthHistory);
  const isEmpty = data.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Health Trend</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-[240px] items-center justify-center text-sm text-hive-muted">
            No health history yet
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="h-[240px] w-full aspect-auto"
          >
            <AreaChart
              data={data}
              margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                allowDecimals={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                dataKey="passed"
                type="monotone"
                fill="var(--color-passed)"
                stroke="var(--color-passed)"
                fillOpacity={0.3}
                stackId="health"
              />
              <Area
                dataKey="warnings"
                type="monotone"
                fill="var(--color-warnings)"
                stroke="var(--color-warnings)"
                fillOpacity={0.3}
                stackId="health"
              />
              <Area
                dataKey="failures"
                type="monotone"
                fill="var(--color-failures)"
                stroke="var(--color-failures)"
                fillOpacity={0.3}
                stackId="health"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
