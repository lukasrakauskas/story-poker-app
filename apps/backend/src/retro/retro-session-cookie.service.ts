import { Injectable } from '@nestjs/common';

export const RETRO_SESSION_COOKIE_PREFIX = 'retro-session-';
const RETRO_CODE = /^[a-zA-Z0-9_-]{1,64}$/;
const RETRO_TOKEN = /^[a-zA-Z0-9_-]{1,64}$/;
const RETRO_COOKIE_PATH = '/retro';

export interface CookieResponse {
  setHeader(name: string, value: string): unknown;
}

/**
 * The cookie is deliberately owned by the backend origin. Frontend code can
 * establish, inspect, resume, and forget a session through HTTP, but cannot
 * read or write this credential from JavaScript.
 */
@Injectable()
export class RetroSessionCookieService {
  name(code: string): string | null {
    return RETRO_CODE.test(code)
      ? `${RETRO_SESSION_COOKIE_PREFIX}${code}`
      : null;
  }

  read(
    request: { headers?: { cookie?: string } },
    code: string,
  ): string | null {
    return this.readHeader(request.headers?.cookie, code);
  }

  readHeader(header: string | undefined, code: string): string | null {
    const name = this.name(code);
    if (!name || !header) return null;
    let matches = 0;
    const values = header.split(';').flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator < 0 || part.slice(0, separator).trim() !== name) return [];
      matches++;
      const encoded = part.slice(separator + 1).trim();
      try {
        const value = decodeURIComponent(encoded);
        return RETRO_TOKEN.test(value) ? [value] : [];
      } catch {
        return [];
      }
    });
    // Duplicate or malformed cookie names are ambiguous. Fail closed instead
    // of choosing a value an intermediary or attacker may have injected.
    return matches === 1 && values.length === 1 ? values[0] : null;
  }

  set(
    response: CookieResponse,
    code: string,
    token: string,
    expiresAt: number,
  ): void {
    const name = this.name(code);
    if (!name || !RETRO_TOKEN.test(token)) return;
    const maxAge = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    response.setHeader(
      'Set-Cookie',
      `${name}=${encodeURIComponent(token)}; Path=${RETRO_COOKIE_PATH}; Max-Age=${maxAge}; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; Secure; SameSite=None`,
    );
  }

  clear(response: CookieResponse, code: string): void {
    const name = this.name(code);
    if (!name) return;
    response.setHeader(
      'Set-Cookie',
      `${name}=; Path=${RETRO_COOKIE_PATH}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None`,
    );
  }
}

export function isRetroRoomCode(code: string): boolean {
  return RETRO_CODE.test(code);
}
