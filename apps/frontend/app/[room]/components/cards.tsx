"use client";

import { Card } from "ui/components/card";
import { usePlanning } from "../../../lib/planning-context";
import { cn } from "ui/utils";
import PieExample from "./pie";
import ParentSize from "@visx/responsive/lib/components/ParentSize";
import { cardDeck } from "../../../lib/constants";

export function Cards() {
  const { vote, castVote, results, planningState } = usePlanning();

  if (planningState === "results") {
    const displayResults = Object.entries(results)
      .map(([key, value]) => ({
        key,
        value,
      }))
      .filter((it) => it.value !== 0);
    console.log(displayResults);

    return (
      <ParentSize>
        {({ width, height }) => (
          <PieExample width={width} height={height} data={displayResults} />
        )}
      </ParentSize>
    );
  }

  return (
    <div className="grid grid-cols-4 lg:grid-cols-6 gap-2">
      {cardDeck.map((card) => (
        <button key={card} onClick={() => castVote(card)}>
          <Card
            className={cn(
              "flex items-center justify-center aspect-[4/5] text-5xl hover:bg-card-hover",
              vote === card && "border-card-selected"
            )}
          >
            {card}
          </Card>
        </button>
      ))}
    </div>
  );
}
