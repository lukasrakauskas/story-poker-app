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
    title: "Start voting?",
    description:
      "Notes will be locked for everyone. The team cannot return to writing.",
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
  onConfirm,
}: {
  phase: Exclude<RetroPhase, "closed">;
  label: string;
  disabled: boolean;
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
