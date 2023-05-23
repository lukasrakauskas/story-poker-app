import path from "path";
import fs from "fs/promises";
import RoomOrJoin from "./room-or-join";

export default async function RoomPage({
  params,
}: {
  params: { room: string };
}) {
  const publicDir = path.join(process.cwd(), "public", "avatars");
  const avatars = await fs.readdir(publicDir);

  return <RoomOrJoin room={params.room} avatars={avatars} />;
}
