import { Injectable } from '@nestjs/common';
import type { ApplicationResult } from './application-result.js';

type Listener = (result: ApplicationResult<unknown>) => void;

@Injectable()
export class ApplicationEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  on(namespace: string, listener: Listener): () => void {
    let listeners = this.listeners.get(namespace);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(namespace, listeners);
    }
    listeners.add(listener);
    return () => listeners?.delete(listener);
  }

  emit(namespace: string, result: ApplicationResult<unknown>) {
    for (const listener of this.listeners.get(namespace) ?? [])
      listener(result);
  }
}
