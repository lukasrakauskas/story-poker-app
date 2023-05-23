"use client";

import { usePlanning } from "../../lib/planning-context";
import { NameSelect } from "../components/name-select";
import { useEffect } from "react";
import { Room } from "./components/room";

export default function RoomOrJoin({
  room,
  avatars,
}: {
  room: string;
  avatars: string[];
}) {
  const { currentUser, setRoomCode, setAvatars } = usePlanning();

  useEffect(() => {
    setRoomCode(room);
  }, [room]);

  useEffect(() => {
    setAvatars(avatars);
  }, [avatars]);

  if (currentUser == null) {
    return <NameSelect title="Join a planning room" action="Join room" />;
  }

  return <Room />;
}
