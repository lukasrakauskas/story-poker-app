"use client";

import { Check, Layers } from "lucide-react";
import { Badge } from "ui/components/badge";
import { Button } from "ui/components/button";
import {
  Card,
  CardHeader,
  CardDescription,
  CardContent,
} from "ui/components/card";
import { usePlanning } from "../../../lib/planning-context";
import { cn } from "ui/utils";
import { Results } from "./results";

export function Cards() {
  const { vote, castVote, results, planningState, cardSet } = usePlanning();
  const revealed = planningState === "results";

  return (
    <Card className="min-h-0 min-w-0 gap-0 overflow-hidden py-0">
      <CardHeader className="shrink-0 gap-3 border-b p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Layers
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            {revealed ? "Round results" : "Choose your estimate"}
          </h1>
          <Badge variant={revealed ? "secondary" : "outline"}>
            {revealed ? "Revealed" : "Private voting"}
          </Badge>
        </div>
        <CardDescription>
          {revealed
            ? "Compare estimates and discuss the differences before your next round."
            : "Pick a card. Your estimate stays hidden until the moderator reveals the results."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
        {revealed ? (
          <Results results={results} cardSet={cardSet} />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <fieldset
                aria-label="Estimate cards"
                className="grid min-h-full min-w-0 auto-rows-[minmax(5rem,1fr)] grid-cols-4 gap-3 xl:grid-cols-6"
              >
                {cardSet.map((card) => (
                  <Button
                    key={card}
                    variant="outline"
                    aria-label={`Estimate ${card}`}
                    aria-pressed={vote === card}
                    onClick={() => castVote(card)}
                    className={cn(
                      "relative aspect-[4/5] h-auto min-h-20 md:aspect-auto min-w-0 whitespace-normal break-all rounded-xl px-2 text-2xl font-semibold shadow-sm transition-colors sm:text-3xl",
                      vote === card &&
                        "border-primary bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:text-primary-foreground dark:bg-primary dark:hover:bg-primary/90"
                    )}
                  >
                    {card}
                    {vote === card && (
                      <Check
                        aria-hidden="true"
                        className="absolute right-2 top-2 size-3.5!"
                      />
                    )}
                  </Button>
                ))}
              </fieldset>
            </div>
            <output className="mt-5 shrink-0 text-center text-sm text-muted-foreground">
              {vote === null
                ? "No estimate selected yet."
                : `Your estimate: ${vote}. You can change it until results are revealed.`}
            </output>
          </>
        )}
      </CardContent>
    </Card>
  );
}
