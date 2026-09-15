"use client";

import { useSyncExternalStore } from "react";
import type { RetroRoom } from "shared/retrospective";
import type { RetroSession } from "../../../hooks/use-retro-socket";
import { Button } from "ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "ui/components/sheet";
import { ActionItems } from "./action-items";

const query = "(max-width: 1279px)";
function subscribe(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
export function useCompactDiscussion() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}

export function MobileActions({
  room,
  moderator,
  disabled,
  send,
}: {
  room: RetroRoom;
  moderator: boolean;
  disabled: boolean;
  send: RetroSession["send"];
}) {
  return (
    <div className="sticky top-2 z-20 rounded-lg border bg-background p-2 shadow-sm">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="secondary" className="w-full">
            Action items · {room.actions.length} (
            {room.actions.filter((action) => action.done).length} done)
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="pr-12">
            <SheetTitle>Discussion actions</SheetTitle>
            <SheetDescription>
              Review next steps without losing your place in the discussion.
              Close to return to the same note.
            </SheetDescription>
          </SheetHeader>
          <div className="min-w-0 px-4">
            <ActionItems
              room={room}
              moderator={moderator}
              disabled={disabled}
              send={send}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
