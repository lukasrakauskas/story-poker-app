import { RetroWorkspace } from "../components/retro-workspace";

export default async function RetroRoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return <RetroWorkspace initialCode={(await params).code} />;
}
