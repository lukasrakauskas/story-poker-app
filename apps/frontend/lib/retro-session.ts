import { isValidRetroCode } from "shared/retrospective";

const PREFIX = "retro-session-";
const validCode = isValidRetroCode;

/** Cookies are JS-readable because the WebSocket protocol explicitly sends the token.
 * Host-only, SameSite=Lax, Secure on HTTPS, and never outlive the live room. */
export function readRetroToken(code: string): string | null {
  if (typeof document === "undefined" || !validCode(code)) return null;
  try {
    const value = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith(`${PREFIX}${code}=`));
    if (!value) return null;
    const token = decodeURIComponent(value.slice(value.indexOf("=") + 1));
    if (/^[a-zA-Z0-9_-]{1,64}$/.test(token)) return token;
    clearRetroToken(code);
    return null;
  } catch {
    clearRetroToken(code);
    return null;
  }
}

export function saveRetroToken(
  code: string,
  token: string,
  expiresAt: number
): boolean {
  if (typeof document === "undefined" || !validCode(code)) return false;
  try {
    document.cookie = `${PREFIX}${code}=${encodeURIComponent(token)}; Path=/retro; Expires=${new Date(expiresAt).toUTCString()}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    return readRetroToken(code) === token;
  } catch {
    return false;
  }
}

export function clearRetroToken(code: string) {
  if (typeof document === "undefined" || !validCode(code)) return;
  try {
    document.cookie = `${PREFIX}${code}=; Path=/retro; Max-Age=0; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    // A blocked cookie store must not break the live room.
  }
}
