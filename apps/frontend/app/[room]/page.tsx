import RoomOrJoin from "./room-or-join";

export default async function RoomPage({
  params,
}: {
  params: { room: string };
}) {
  return <RoomOrJoin room={params.room} />;
}
