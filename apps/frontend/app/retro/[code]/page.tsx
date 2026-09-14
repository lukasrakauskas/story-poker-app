import { createRetrospectiveMetadata } from "../../../lib/site-metadata";
import { RetroWorkspace } from "../components/retro-workspace";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return createRetrospectiveMetadata(`/retro/${encodeURIComponent(code)}`);
}

export default async function RetroRoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return <RetroWorkspace initialCode={(await params).code} />;
}
