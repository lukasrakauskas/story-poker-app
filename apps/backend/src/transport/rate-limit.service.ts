import { Injectable } from '@nestjs/common';

type Window = { startedAt: number; count: number };

@Injectable()
export class RateLimitService {
  private readonly windows = new Map<string, Window>();

  consume(
    namespace: string,
    key: string,
    options: { limit: number; windowMs: number },
  ): boolean {
    const scopedKey = `${namespace}\0${key}`;
    let window = this.windows.get(scopedKey);
    if (!window || Date.now() - window.startedAt >= options.windowMs) {
      window = { startedAt: Date.now(), count: 0 };
      this.windows.set(scopedKey, window);
    }
    return ++window.count <= options.limit;
  }

  release(namespace: string, key: string) {
    this.windows.delete(`${namespace}\0${key}`);
  }

  clear(namespace: string) {
    const prefix = `${namespace}\0`;
    for (const key of this.windows.keys()) {
      if (key.startsWith(prefix)) this.windows.delete(key);
    }
  }
}
