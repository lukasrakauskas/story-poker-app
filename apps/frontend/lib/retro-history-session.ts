import type { RetroRoom } from "shared/retrospective";
import {
  createRetroHistoryPersistence,
  DEFAULT_RETRO_HISTORY_RETENTION,
  retroHistoryKey,
  type RetroHistoryPersistence,
  type RetroHistoryPolicy,
  type RetroHistoryPreference,
} from "./retro-history";

/** Room-scoped consent adapter; the protocol client never reads browser storage. */
export class RetroHistorySession {
  private room: RetroRoom | null = null;
  private viewerId = "";
  private memoryChoice: RetroHistoryPreference | null = null;
  private listeners = new Set<() => void>();
  private state: {
    preference: RetroHistoryPreference | null;
    preferenceSaved: boolean | null;
    disabled: boolean;
    saved: boolean | null;
  } = { preference: null, preferenceSaved: null, disabled: false, saved: null };

  constructor(
    private readonly persistence: RetroHistoryPersistence = createRetroHistoryPersistence()
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private notify() {
    for (const listener of this.listeners) listener();
  }

  sync = () => {
    if (!this.room) return;
    const stored = this.persistence.readRetroHistoryPreference(this.room);
    const disabled = this.persistence.isRetroHistorySuppressed(this.room);
    const preference =
      !disabled && this.state.preferenceSaved === false
        ? (this.memoryChoice ?? stored)
        : stored;
    this.state = {
      ...this.state,
      preference,
      disabled: disabled || preference?.mode === "none",
    };
    if (this.state.disabled) this.state.saved = null;
    this.notify();
  };

  save = (room: RetroRoom, viewerId: string): boolean | null => {
    if (!this.room || retroHistoryKey(this.room) !== retroHistoryKey(room)) {
      this.memoryChoice = null;
      this.state = {
        preference: null,
        preferenceSaved: null,
        disabled: false,
        saved: null,
      };
    }
    this.room = room;
    this.viewerId = viewerId;
    this.sync();
    const preference = this.state.preference;
    if (
      !preference ||
      this.state.disabled ||
      (preference.mode === "final-only" && room.phase !== "closed")
    )
      return null;
    const saved = this.persistence.saveRetroHistory(room, viewerId, preference);
    this.state = { ...this.state, saved };
    this.notify();
    return saved;
  };

  choose = (policy: RetroHistoryPolicy) => {
    if (!this.room) return;
    this.memoryChoice = {
      mode: policy.mode,
      retention: policy.retention ?? DEFAULT_RETRO_HISTORY_RETENTION,
    };
    const preferenceSaved = this.persistence.saveRetroHistoryPreference(
      this.room,
      this.memoryChoice
    );
    this.state = { ...this.state, preferenceSaved, saved: null };
    this.save(this.room, this.viewerId);
  };

  dispose = () => this.persistence.dispose();
}
