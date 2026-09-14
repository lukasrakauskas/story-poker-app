import { Injectable, type OnModuleDestroy } from '@nestjs/common';

type Retention = {
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
};

@Injectable()
export class RetentionService implements OnModuleDestroy {
  private readonly scheduled = new Map<string, Retention>();

  schedule(namespace: string, key: string, delay: number, expire: () => void) {
    const scopedKey = this.key(namespace, key);
    this.cancel(namespace, key);
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      const current = this.scheduled.get(scopedKey);
      if (current?.startedAt !== startedAt) return;
      this.scheduled.delete(scopedKey);
      expire();
    }, delay);
    timer.unref?.();
    this.scheduled.set(scopedKey, { startedAt, timer });
  }

  cancel(namespace: string, key: string): boolean {
    const scopedKey = this.key(namespace, key);
    const retention = this.scheduled.get(scopedKey);
    if (!retention) return false;
    clearTimeout(retention.timer);
    this.scheduled.delete(scopedKey);
    return true;
  }

  clear(namespace: string) {
    const prefix = `${namespace}\0`;
    for (const [key, retention] of this.scheduled) {
      if (!key.startsWith(prefix)) continue;
      clearTimeout(retention.timer);
      this.scheduled.delete(key);
    }
  }

  onModuleDestroy() {
    for (const retention of this.scheduled.values())
      clearTimeout(retention.timer);
    this.scheduled.clear();
  }

  private key(namespace: string, key: string) {
    return `${namespace}\0${key}`;
  }
}
