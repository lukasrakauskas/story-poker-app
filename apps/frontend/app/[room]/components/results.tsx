"use client";

import { Pie, PieChart } from "recharts";
import { BarChart3 } from "lucide-react";
import { Badge } from "ui/components/badge";
import { ChartContainer, type ChartConfig } from "ui/components/chart";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "ui/components/empty";

export function Results({
  results,
  cardSet,
}: {
  results: Record<string, number>;
  cardSet: string[];
}) {
  const data = Object.entries(results)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort(([a], [b]) => cardSet.indexOf(a) - cardSet.indexOf(b))
    .map(([estimate, count], index) => ({
      estimate,
      count,
      fill: `var(--chart-${(index % 5) + 1})`,
    }));
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const highest = Math.max(0, ...data.map((item) => item.count));
  const leaders = data.filter((item) => item.count === highest);
  const config = { count: { label: "Votes" } } satisfies ChartConfig;

  if (!total) {
    return (
      <Empty className="my-auto">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BarChart3 />
          </EmptyMedia>
          <EmptyTitle>No estimates this round</EmptyTitle>
          <EmptyDescription>
            Start a new round when everyone is ready to vote.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section aria-label="Vote results" className="my-auto space-y-6">
      <div className="flex flex-wrap justify-center gap-2">
        <Badge variant="secondary">
          {total} {total === 1 ? "vote" : "votes"} cast
        </Badge>
        <Badge variant="outline">
          {data.length === 1
            ? "All votes match"
            : leaders.length === 1
              ? `Most picked: ${leaders[0].estimate}`
              : "Split vote"}
        </Badge>
      </div>
      <div className="grid items-center gap-6 sm:grid-cols-2">
        {/* Fixed chart bounds avoid resize feedback loops and SVG baseline overflow. */}
        <div
          aria-hidden="true"
          className="relative mx-auto h-52 w-full max-w-xs sm:h-60"
        >
          <ChartContainer config={config} className="aspect-auto h-full w-full">
            <PieChart accessibilityLayer={false}>
              <Pie
                data={data}
                dataKey="count"
                nameKey="estimate"
                innerRadius="65%"
                outerRadius="90%"
                strokeWidth={3}
                isAnimationActive={false}
              />
            </PieChart>
          </ChartContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-4xl font-semibold tabular-nums">{total}</span>
            <span className="text-sm text-muted-foreground">
              {total === 1 ? "estimate" : "estimates"}
            </span>
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <h2 className="text-sm font-medium">Estimate breakdown</h2>
          <ul aria-label="Estimates and vote counts" className="space-y-3">
            {data.map((item) => (
              <li key={item.estimate} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words font-semibold">
                    {item.estimate}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {item.count} {item.count === 1 ? "vote" : "votes"} ·{" "}
                    {Math.round((item.count / total) * 100)}%
                  </span>
                </div>
                <div
                  aria-hidden="true"
                  className="h-2 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(item.count / total) * 100}%`,
                      backgroundColor: item.fill,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
