"use client";

import { Card } from "ui/components/card";
import { usePlanning } from "../../../lib/planning-context";
import { cn } from "ui/utils";

const cardDeck = [
  "0",
  "1/2",
  "1",
  "2",
  "3",
  "5",
  "8",
  "13",
  "20",
  "40",
  "100",
  "?",
];

export function Cards() {
  const { vote, castVote } = usePlanning();

  return (
    <div className="grid grid-cols-4 lg:grid-cols-6 gap-2">
      {cardDeck.map((card) => (
        <button key={card} onClick={() => castVote(card)}>
          <Card
            className={cn(
              "flex items-center justify-center aspect-[4/5] text-5xl hover:bg-gray-100",
              vote === card && "border-gray-400"
            )}
          >
            {card}
          </Card>
        </button>
      ))}
    </div>
  );
}
