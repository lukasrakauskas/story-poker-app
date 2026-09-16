"use client";

import { useState } from "react";
import type {
  RetroHistoryMode,
  RetroHistoryPolicy,
  RetroHistoryPreference,
  RetroHistoryRetention,
} from "../../../lib/retro-history";
import { Button } from "ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/components/card";
import { Label } from "ui/components/label";

const retentionOptions: {
  value: RetroHistoryRetention;
  label: string;
}[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days (recommended)" },
  { value: "90d", label: "90 days" },
  { value: "forever", label: "Until I delete it" },
];

const modes: {
  value: RetroHistoryMode;
  label: string;
  description: string;
}[] = [
  {
    value: "final-only",
    label: "Save completed takeaways only (recommended)",
    description:
      "Nothing from writing, arranging, voting, or discussion is saved. The completed, read-only outcome is saved when the moderator closes the room.",
  },
  {
    value: "recovery",
    label: "Save recovery snapshots and completed takeaways",
    description:
      "Save the private snapshot visible to you while the team works, followed by revealed updates and the final outcome. Other participants’ private writing is never included before reveal.",
  },
  {
    value: "none",
    label: "Do not save browser history",
    description:
      "No snapshot from this room is saved here. You can still export a copy from the room after closure.",
  },
];

export function RetroHistoryChoice({
  previous,
  disabledAfterDelete = false,
  onChoose,
}: {
  previous: RetroHistoryPreference | null;
  disabledAfterDelete?: boolean;
  onChoose: (policy: RetroHistoryPolicy) => void;
}) {
  const [mode, setMode] = useState<RetroHistoryMode>(
    previous?.mode ?? "final-only"
  );
  const [retention, setRetention] = useState<RetroHistoryRetention>(
    previous?.retention ?? "30d"
  );

  return (
    <section aria-labelledby="retro-history-choice-title">
      <Card className="border-primary/50 bg-primary/5">
        <CardHeader>
          <CardTitle id="retro-history-choice-title">
            Choose browser history for this room
          </CardTitle>
          <CardDescription>
            Nothing from this retrospective is stored in browser history until
            you choose an option. This choice applies only to this room
            lifetime.
            {disabledAfterDelete &&
              " A previous saved copy was deleted, so saving is paused until you choose again."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Save preference</legend>
            {modes.map((item) => {
              const id = `retro-history-mode-${item.value}`;
              return (
                <div
                  key={item.value}
                  className="flex items-start gap-3 rounded-md border p-3 has-checked:border-primary has-checked:bg-background"
                >
                  <input
                    id={id}
                    type="radio"
                    name="retro-history-mode"
                    value={item.value}
                    aria-label={item.label}
                    checked={mode === item.value}
                    onChange={() => setMode(item.value)}
                    className="mt-0.5"
                  />
                  <Label htmlFor={id} className="cursor-pointer items-start">
                    <span className="space-y-1">
                      <span className="block text-sm font-medium">
                        {item.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </Label>
                </div>
              );
            })}
          </fieldset>
          <div className="max-w-sm space-y-2">
            <Label htmlFor="retro-history-retention">
              Keep saved copies for
            </Label>
            <select
              id="retro-history-retention"
              value={retention}
              onChange={(event) =>
                setRetention(event.target.value as RetroHistoryRetention)
              }
              disabled={mode === "none"}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {retentionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Expired entries are cleaned up automatically when history is
              opened or the persistence scheduler runs.
            </p>
          </div>
          <div className="space-y-2 rounded-md border bg-background p-3 text-xs text-muted-foreground">
            <p>
              Local history contains notes, names, vote totals after discussion,
              and action items. Anyone with access to this browser profile can
              read it; it is not an account, server backup, or cross-device
              sync.
            </p>
            <p>
              An exported Markdown, text, or JSON file is a separate backup that
              you choose where to keep. Deleting local history does not delete
              an exported file, and an export is never written automatically.
            </p>
          </div>
          <Button type="button" onClick={() => onChoose({ mode, retention })}>
            Save history preference
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
