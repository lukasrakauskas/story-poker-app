"use client";

import { usePlanning } from "../../lib/planning-context";
import { NameSelect } from "../components/name-select";
import { useEffect } from "react";
import { Room } from "./components/room";

export default function RoomOrJoin({ room }: { room: string }) {
  const { currentUser, setRoomCode } = usePlanning();

  useEffect(() => {
    setRoomCode(room);
  }, [room, setRoomCode]);

  if (currentUser == null) {
    return <NameSelect title="Join a planning room" action="Join room" />;
  }

  return <Room />;
}
