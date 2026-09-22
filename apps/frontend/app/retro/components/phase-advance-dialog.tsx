"use client";

import { useState } from "react";
import type { RetroPhase } from "shared/retrospective";
import { Button } from "ui/components/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "ui/components/alert-dialog";

const confirmationCopy: Record<
  Exclude<RetroPhase, "closed">,
  { title: string; description: string }
> = {
  write: {
    title: "Reveal notes for arranging?",
    description:
      "Notes will be locked and revealed to everyone. The team cannot return to private writing.",
  },
  group: {
    title: "Start voting?",
    description:
      "Stacks and lanes will be locked for everyone. The team cannot return to arranging.",
  },
  vote: {
    title: "Start discussion?",
    description:
      "Voting will end for everyone. The team cannot return to voting.",
  },
  discuss: {
    title: "Close this retrospective?",
    description:
      "All notes and actions will become read-only. This cannot be undone.",
  },
};

export function PhaseAdvanceDialog({
  phase,
  label,
  disabled,
  notReadyNames,
  hasUnsentDraft,
  onConfirm,
}: {
  phase: Exclude<RetroPhase, "closed">;
  label: string;
  disabled: boolean;
  notReadyNames: string[];
  hasUnsentDraft: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const copy = confirmationCopy[phase];

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button disabled={disabled}>{label}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
          {phase === "write" && hasUnsentDraft && (
            <p role="alert" className="text-sm font-medium text-destructive">
              You have an unsent note draft. Advancing now will make it
              uneditable and it will not be shared with the room.
            </p>
          )}
          {(phase === "write" || phase === "vote") &&
            notReadyNames.length > 0 && (
              <p role="alert" className="text-sm font-medium">
                Not ready: {notReadyNames.join(", ")}. Advancing now will end
                this phase for them.
              </p>
            )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={disabled || submitting}
            onClick={async (event) => {
              event.preventDefault();
              setSubmitting(true);
              try {
                if (await onConfirm()) setOpen(false);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Confirming…" : `Confirm ${label.toLowerCase()}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
