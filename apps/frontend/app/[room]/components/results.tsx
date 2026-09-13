"use client";

import { Pie, PieChart, type PieLabelRenderProps } from "recharts";
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

type ResultDatum = {
  estimate: string;
  count: number;
  fill: string;
};

type MiddleGround = {
  estimate: string;
  description: string;
};

export function Results({
  results,
  cardSet,
}: {
  results: Record<string, number>;
  cardSet: string[];
}) {
  const cardPositions = new Map(
    cardSet.map((estimate, index) => [estimate, index])
  );
  const data = Object.entries(results)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort(([a], [b]) => {
      const aPosition = cardPositions.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bPosition = cardPositions.get(b) ?? Number.MAX_SAFE_INTEGER;
      return aPosition - bPosition || a.localeCompare(b);
    })
    .map(([estimate, count], index) => ({
      estimate,
      count,
      fill: `var(--chart-${(index % 5) + 1})`,
    }));
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const highest = Math.max(0, ...data.map((item) => item.count));
  const leaders = data.filter((item) => item.count === highest);
  const leaderLabel = joinEstimates(leaders.map((item) => item.estimate));
  const middleGround = findMiddleGround(data, cardSet, total);
  const config = { count: { label: "Votes" } } satisfies ChartConfig;
  const distributionLabel = `Vote distribution: ${data
    .map(
      (item) =>
        `${item.estimate}: ${item.count} ${item.count === 1 ? "vote" : "votes"} (${Math.round((item.count / total) * 100)}%)`
    )
    .join("; ")}`;

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

  const resultBadge =
    data.length === 1
      ? "All votes match"
      : leaders.length === 1 && highest > total / 2
        ? `Majority: ${leaderLabel}`
        : leaders.length === 1
          ? `Most picked: ${leaderLabel}`
          : "Split vote";

  return (
    <section aria-label="Vote results" className="my-auto">
      <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(12rem,0.7fr)] lg:gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <figure
          aria-label={distributionLabel}
          className="mx-auto h-80 w-full max-w-2xl sm:h-[clamp(20rem,calc(100vh-12.5rem),32rem)]"
        >
          <ChartContainer
            aria-hidden="true"
            config={config}
            className="aspect-auto h-full w-full"
          >
            <PieChart accessibilityLayer={false}>
              <Pie
                data={data}
                dataKey="count"
                nameKey="estimate"
                innerRadius={0}
                outerRadius="98%"
                paddingAngle={0}
                stroke="hsl(var(--background))"
                strokeWidth={3}
                labelLine={false}
                label={renderPieLabel}
                isAnimationActive={false}
              />
            </PieChart>
          </ChartContainer>
        </figure>

        <div className="min-w-0 space-y-5">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium">Estimate breakdown</h2>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">
                  {total} {total === 1 ? "vote" : "votes"} cast
                </Badge>
                <Badge variant="outline">{resultBadge}</Badge>
              </div>
            </div>
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

          <dl aria-label="Result highlights" className="grid grid-cols-2 gap-2">
            <div className="min-w-0 rounded-lg border bg-muted/40 p-3">
              <dt className="text-xs font-medium text-muted-foreground">
                Most voted
              </dt>
              <dd className="mt-1 break-words text-xl font-semibold">
                {leaderLabel}
              </dd>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {highest} {highest === 1 ? "vote" : "votes"}
                {leaders.length > 1 ? " each" : ""} ·{" "}
                {Math.round((highest / total) * 100)}%
              </p>
            </div>
            <div className="min-w-0 rounded-lg border bg-muted/40 p-3">
              <dt className="text-xs font-medium text-muted-foreground">
                Middle ground
              </dt>
              <dd className="mt-1 break-words text-xl font-semibold">
                {middleGround.estimate}
              </dd>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {middleGround.description}
              </p>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function renderPieLabel(props: PieLabelRenderProps) {
  const { cx, cy, midAngle, outerRadius, payload, percent } = props;
  const item = payload as ResultDatum | undefined;
  if (
    typeof cx !== "number" ||
    typeof cy !== "number" ||
    typeof midAngle !== "number" ||
    typeof outerRadius !== "number" ||
    !item ||
    !percent ||
    percent < 0.06
  ) {
    return null;
  }

  const angle = -midAngle * (Math.PI / 180);
  const radius = outerRadius * (percent < 0.14 ? 0.76 : 0.58);
  const x = cx + radius * Math.cos(angle);
  const y = cy + radius * Math.sin(angle);
  const estimate =
    item.estimate.length > 9 ? `${item.estimate.slice(0, 8)}…` : item.estimate;
  const estimateSize = percent >= 0.2 ? 26 : percent >= 0.1 ? 18 : 14;

  return (
    <text
      x={x}
      y={y}
      fill="white"
      stroke="rgb(0 0 0 / 55%)"
      strokeWidth={3}
      strokeLinejoin="round"
      paintOrder="stroke"
      textAnchor="middle"
      dominantBaseline="central"
      pointerEvents="none"
    >
      <tspan
        x={x}
        dy={percent >= 0.12 ? "-0.35em" : "0"}
        fontSize={estimateSize}
        fontWeight={700}
      >
        {estimate}
      </tspan>
      {percent >= 0.12 && (
        <tspan x={x} dy="1.45em" fontSize={12} fontWeight={600}>
          {`${item.count} ${item.count === 1 ? "vote" : "votes"}`}
        </tspan>
      )}
    </text>
  );
}

function findMiddleGround(
  data: ResultDatum[],
  cardSet: string[],
  total: number
): MiddleGround {
  const numericVotes = data
    .map((item) => ({ ...item, value: parseEstimate(item.estimate) }))
    .filter(
      (item): item is ResultDatum & { value: number } => item.value !== null
    );
  const numericVoteCount = numericVotes.reduce(
    (sum, item) => sum + item.count,
    0
  );
  const numericCards = cardSet
    .map((estimate) => ({
      estimate,
      value: parseEstimate(estimate),
    }))
    .filter(
      (item): item is { estimate: string; value: number } => item.value !== null
    );

  if (numericVoteCount > 0 && numericCards.length > 0) {
    const average =
      numericVotes.reduce((sum, item) => sum + item.value * item.count, 0) /
      numericVoteCount;
    const closestCard = numericCards.reduce((closest, candidate) => {
      const closestDistance = Math.abs(closest.value - average);
      const candidateDistance = Math.abs(candidate.value - average);
      if (candidateDistance < closestDistance) return candidate;
      if (
        candidateDistance === closestDistance &&
        candidate.value > closest.value
      ) {
        return candidate;
      }
      return closest;
    });
    const formattedAverage = Number(average.toFixed(2)).toString();

    return {
      estimate: closestCard.estimate,
      description:
        numericVoteCount === total
          ? `Closest card to the average (${formattedAverage})`
          : `Closest card to the numeric-vote average (${formattedAverage})`,
    };
  }

  const lowerPosition = Math.floor((total - 1) / 2);
  const upperPosition = Math.ceil((total - 1) / 2);
  const estimateAt = (position: number) => {
    let seen = 0;
    for (const item of data) {
      seen += item.count;
      if (position < seen) return item.estimate;
    }
    return data[data.length - 1]?.estimate ?? "—";
  };
  const lower = estimateAt(lowerPosition);
  const upper = estimateAt(upperPosition);
  const lowerIndex = cardSet.indexOf(lower);
  const upperIndex = cardSet.indexOf(upper);
  const hasOrderedRange = lowerIndex >= 0 && upperIndex >= 0;
  const estimate = hasOrderedRange
    ? (cardSet[Math.round((lowerIndex + upperIndex) / 2)] ?? upper)
    : upper;

  return {
    estimate,
    description:
      lower === upper
        ? "Median team estimate"
        : `Middle card from ${lower} to ${upper}`,
  };
}

function parseEstimate(estimate: string): number | null {
  const normalized = estimate.trim();
  if (!normalized) return null;

  const value = Number(normalized);
  if (Number.isFinite(value)) return value;

  const fraction = normalized.match(
    /^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/
  );
  if (!fraction) return null;

  const numerator = Number(fraction[1]);
  const denominator = Number(fraction[2]);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return numerator / denominator;
}

function joinEstimates(estimates: string[]) {
  if (estimates.length < 2) return estimates[0] ?? "—";
  if (estimates.length === 2) return `${estimates[0]} & ${estimates[1]}`;
  return `${estimates.slice(0, -1).join(", ")} & ${estimates.at(-1)}`;
}
