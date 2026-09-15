import type { RetroNavigationAdapter } from "./retro-session-client";

const RETRO_CODE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Parse a room code without coupling routing to the WebSocket transport. */
export function parseRetroRoomCode(pathname: string): string | null {
  const match = pathname.match(/^\/retro\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    const code = decodeURIComponent(match[1]);
    return RETRO_CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

/** Browser-only route adapter used by the React composition hook. */
export function createBrowserRetroNavigation(): RetroNavigationAdapter {
  return {
    replaceRoom(code) {
      if (typeof window === "undefined") return;
      const path = `/retro/${encodeURIComponent(code)}`;
      if (window.location.pathname !== path)
        window.history.replaceState(null, "", path);
    },
  };
}
