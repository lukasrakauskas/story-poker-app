"use client";

import { useRef, useState } from "react";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { Button } from "ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "ui/components/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "ui/components/alert-dialog";

export function ItemActions({
  kind,
  text,
  disabled,
  onEdit,
  onDelete,
}: {
  kind: "note" | "action";
  text: string;
  disabled: boolean;
  onEdit?: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const afterMenuClose = useRef<(() => void) | null>(null);

  return (
    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            disabled={disabled}
            aria-label={`Actions for ${kind}: ${text}`}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            // Open the editor/dialog after the menu releases its focus trap.
            if (afterMenuClose.current) {
              event.preventDefault();
              const action = afterMenuClose.current;
              afterMenuClose.current = null;
              action();
            }
          }}
        >
          {onEdit && (
            <>
              <DropdownMenuItem
                disabled={disabled}
                onSelect={() => {
                  afterMenuClose.current = onEdit;
                }}
              >
                <Pencil aria-hidden="true" /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            variant="destructive"
            disabled={disabled}
            onSelect={() => {
              afterMenuClose.current = () => setConfirming(true);
            }}
          >
            <Trash2 aria-hidden="true" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this {kind}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove it for everyone in the room. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-3 text-sm">
          {text}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={disabled || deleting}
            onClick={async (event) => {
              event.preventDefault();
              setDeleting(true);
              try {
                if (await onDelete()) setConfirming(false);
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? "Deleting…" : `Delete ${kind}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
