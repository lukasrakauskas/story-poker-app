"use client";

import { Metadata } from "next";
import { usePlanning } from "../../lib/planning-context";
import { NameSelect } from "../components/name-select";
import { useEffect } from "react";
import { Room } from "./components/room";

export default function RoomPage({ params }: { params: { room: string } }) {
  const { currentUser, setRoomCode } = usePlanning();

  useEffect(() => {
    setRoomCode(params.room)
  }, [params.room]);

  if (currentUser == null) {
    return <NameSelect title="Join a planning room" />;
  }

  return <Room />;
}
