import type { RetroRoom } from "shared/retrospective";
import {
  saveRetroHistory,
  retroHistoryKey,
  type RetroHistoryScheduler,
} from "./retro-history";

export function createRetroHistoryWriter(
  options: {
    debounceMs?: number;
    save?: (room: RetroRoom, viewerId?: string | null) => boolean;
    onSaved?: (success: boolean) => void;
    scheduler?: RetroHistoryScheduler;
  } = {}
) {
  const save = options.save ?? saveRetroHistory;
  const scheduler = options.scheduler ?? {
    setTimeout: (callback: () => void, delay: number) =>
      globalThis.setTimeout(callback, delay),
    clearTimeout: (handle: unknown) => globalThis.clearTimeout(handle as never),
  };
  let pending: { room: RetroRoom; viewerId?: string | null } | null = null;
  let timer: unknown;
  let finalKey: string | null = null;
  const cancel = () => {
    if (timer !== undefined) scheduler.clearTimeout(timer);
    timer = undefined;
    pending = null;
  };
  const flush = (): boolean | null => {
    if (!pending) return null;
    const current = pending;
    cancel();
    let success = false;
    try {
      success = save(current.room, current.viewerId);
    } catch {
      /* Collaboration is independent of storage. */
    }
    if (success && current.room.phase === "closed")
      finalKey = retroHistoryKey(current.room);
    options.onSaved?.(success);
    return success;
  };
  return {
    enqueue(room: RetroRoom, viewerId?: string | null) {
      if (room.phase === "closed" && finalKey === retroHistoryKey(room)) return;
      pending = { room, viewerId };
      if (room.phase === "closed") {
        flush();
        return;
      }
      if (timer === undefined)
        timer = scheduler.setTimeout(() => {
          timer = undefined;
          flush();
        }, options.debounceMs ?? 250);
    },
    flush,
    cancel,
    reset() {
      cancel();
      finalKey = null;
    },
  };
}
