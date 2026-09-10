import { Metadata } from "next";
import RoomOrJoin from "./room-or-join";

export const metadata: Metadata = {
  title: "Story Poker",
  description: "Join a planning room",
};

export default async function RoomPage({
  params,
}: {
  params: Promise<{ room: string }>;
}) {
  return <RoomOrJoin room={(await params).room} />;
}
