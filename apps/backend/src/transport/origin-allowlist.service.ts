import { Injectable } from '@nestjs/common';

const DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];

/** One origin policy is shared by HTTP CORS and the retrospective WebSocket. */
@Injectable()
export class OriginAllowlistService {
  private readonly origins: Set<string>;

  constructor() {
    const configured = (process.env.RETRO_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    const fallback =
      process.env.NODE_ENV === 'production' ? [] : DEVELOPMENT_ORIGINS;
    this.origins = new Set(configured.length > 0 ? configured : fallback);
  }

  isAllowed(origin: string | undefined): boolean {
    // Non-browser clients do not send Origin. Browser requests must match an
    // explicitly configured frontend origin (or the documented dev defaults).
    return origin === undefined || this.origins.has(origin);
  }

  corsOrigin(
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ) {
    callback(null, this.isAllowed(origin));
  }
}
