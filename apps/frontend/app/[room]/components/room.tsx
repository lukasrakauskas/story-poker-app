"use client";

import { usePlanning } from "../../../lib/planning-context";
import { Cards } from "./cards";
import { InviteToRoom } from "./invite-to-room";

export function Room() {
  const { state } = usePlanning();
  const recovering = state !== "joined";
  const message =
    state === "offline"
      ? "Offline · reconnects when online"
      : state === "joining"
        ? "Restoring your room session…"
        : "Reconnecting to planning room…";

  return (
    <main
      aria-label="Planning room"
      aria-busy={recovering}
      className="relative grid min-h-full gap-4 bg-muted/20 p-4 md:h-full md:min-h-0 md:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] lg:gap-6 lg:p-6"
    >
      {recovering && (
        <output
          data-testid="planning-connection-status"
          className="absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-sm"
        >
          {message}
        </output>
      )}
      <div className="contents" inert={recovering}>
        <InviteToRoom />
        <Cards />
      </div>
    </main>
  );
}
