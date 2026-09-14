"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "ui/components/button";
import { usePlanning } from "../../lib/planning-context";
import { NameSelect } from "../components/name-select";
import { Room } from "./components/room";

export default function RoomOrJoin({ room }: { room: string }) {
  const { currentUser, roomCode, roomAvailability, setRoomCode } =
    usePlanning();

  useEffect(() => {
    setRoomCode(room);
  }, [room, setRoomCode]);

  if (currentUser && roomCode === room) return <Room />;

  if (
    roomCode !== room ||
    roomAvailability === "idle" ||
    roomAvailability === "checking"
  ) {
    return (
      <main className="flex min-h-full items-center justify-center p-4 text-center">
        <output className="block space-y-2">
          <span className="block text-2xl font-semibold tracking-tight">
            Checking planning room…
          </span>
          <span className="block text-sm text-muted-foreground">
            Confirming that this room is still available.
          </span>
        </output>
      </main>
    );
  }

  if (roomAvailability === "unavailable") {
    return (
      <main className="flex min-h-full items-center justify-center p-4 text-center">
        <div className="max-w-md space-y-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Planning room unavailable
            </h1>
            <p className="text-sm text-muted-foreground">
              This room link is invalid or the room has expired.
            </p>
          </div>
          <Button asChild>
            <Link href="/">Create a planning room</Link>
          </Button>
        </div>
      </main>
    );
  }

  return <NameSelect title="Join a planning room" action="Join room" />;
}
