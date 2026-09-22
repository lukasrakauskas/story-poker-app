import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { createClient, WatchError } from 'redis';
import type {
  RetroAction,
  RetroColumn,
  RetroPhase,
} from 'shared/retrospective';
import type { StoredRoomAccess } from '../collaboration/room-access.service.js';

export interface RetroConnectionOwner {
  instanceId: string;
  connectionId: string;
}

/**
 * The persisted participant deliberately contains a digest instead of the
 * reconnect credential. The clear-text token only exists in the response
 * returned when a participant is created or resumes a session.
 */
export interface StoredRetroParticipant {
  id: string;
  name: string;
  role: 'participant' | 'moderator';
  tokenHash: string;
  connected: boolean;
  offlineExpiresAt: number | null;
  connection: RetroConnectionOwner | null;
}

export interface StoredRetroNote {
  id: string;
  authorId: string;
  authorName: string;
  column: RetroColumn;
  text: string;
  stackId: string | null;
  voterIds: string[];
}

export interface StoredRetroRoom {
  code: string;
  title: string;
  phase: RetroPhase;
  expiresAt: number;
  closedAt: number | null;
  /** Salted password verifier; clear-text credentials are never persisted. */
  access: StoredRoomAccess;
  members: StoredRetroParticipant[];
  notes: StoredRetroNote[];
  actions: RetroAction[];
  readyMemberIds: string[];
  /** Monotonically increasing optimistic-concurrency version. */
  version: number;
}

export type NewStoredRetroRoom = Omit<StoredRetroRoom, 'code' | 'version'>;

export type RetroRoomChangeKind =
  | 'created'
  | 'updated'
  | 'closed'
  | 'member-expired'
  | 'member-removed'
  | 'session-replaced'
  | 'session-forgotten'
  | 'room-expired';

export interface RetroRoomChangeDetails {
  kind?: RetroRoomChangeKind;
  memberId?: string;
  memberIds?: string[];
  replacement?: {
    participantId: string;
    owner: RetroConnectionOwner;
  };
  /** Connection displaced by an HTTP rotation/forget operation. */
  previousConnection?: RetroConnectionOwner;
}

export interface RetroRoomChange extends RetroRoomChangeDetails {
  code: string;
  version: number;
  source?: string;
}

export interface RetroRepositoryContext {
  source?: string;
  /** Ephemeral connection ownership used to make create/join atomic. */
  connection?: RetroConnectionOwner;
}

export interface RetroRepositoryTransaction<T> {
  result: T;
  change?: RetroRoomChangeDetails;
}

export type RetroRoomOperation<T> = (
  room: StoredRetroRoom,
) => RetroRepositoryTransaction<T>;

export const RETRO_ROOM_REPOSITORY = Symbol('RETRO_ROOM_REPOSITORY');

export interface RetroRoomRepository {
  create(
    room: NewStoredRetroRoom,
    options: { codeLength: number; maxRooms: number },
    context?: RetroRepositoryContext,
  ): Promise<StoredRetroRoom | null>;
  get(
    code: string,
    context?: RetroRepositoryContext,
  ): Promise<StoredRetroRoom | undefined>;
  update<T>(
    code: string,
    operation: RetroRoomOperation<T>,
    context?: RetroRepositoryContext,
  ): Promise<T>;
  sweep(now: number, context?: RetroRepositoryContext): Promise<string[]>;
  isExpired(code: string, now: number): Promise<boolean>;
  onChange(listener: (change: RetroRoomChange) => void): () => void;
  onModuleDestroy?(): void | Promise<void>;
}

export class RetroRepositoryError extends Error {
  constructor(public readonly code: 'not-found' | 'expired') {
    super(code);
  }
}

const RETRO_ROOM_TOMBSTONE_TTL_SECONDS = 60 * 60;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function expiredMembers(room: StoredRetroRoom, now: number): string[] {
  // Closure is immutable: offline retention must never rewrite a final
  // participant/presence record after the moderator has closed the room.
  if (room.phase === 'closed') return [];
  return room.members
    .filter(
      (member) =>
        !member.connected &&
        member.offlineExpiresAt !== null &&
        member.offlineExpiresAt <= now,
    )
    .map((member) => member.id);
}

function removeMembers(room: StoredRetroRoom, memberIds: string[]) {
  if (memberIds.length === 0) return;
  const removed = new Set(memberIds);
  room.members = room.members.filter((member) => !removed.has(member.id));
  room.readyMemberIds = room.readyMemberIds.filter((id) => !removed.has(id));
  for (const note of room.notes)
    note.voterIds = note.voterIds.filter((id) => !removed.has(id));
}

function changeFor(
  code: string,
  version: number,
  context: RetroRepositoryContext | undefined,
  details?: RetroRoomChangeDetails,
): RetroRoomChange {
  return {
    code,
    version,
    source: context?.source,
    kind: details?.kind ?? 'updated',
    ...(details?.memberId ? { memberId: details.memberId } : {}),
    ...(details?.memberIds ? { memberIds: details.memberIds } : {}),
    ...(details?.replacement ? { replacement: details.replacement } : {}),
    ...(details?.previousConnection
      ? { previousConnection: details.previousConnection }
      : {}),
  };
}

/**
 * Shared in-process storage used by tests and local development. It keeps the
 * same atomic repository contract as Redis; no domain service mutates an
 * object returned by this class.
 */
@Injectable()
export class InMemoryRetroRoomRepository implements RetroRoomRepository {
  private readonly rooms = new Map<string, StoredRetroRoom>();
  private readonly expiredCodes = new Set<string>();
  private readonly listeners = new Set<(change: RetroRoomChange) => void>();

  async create(
    room: NewStoredRetroRoom,
    options: { codeLength: number; maxRooms: number },
    context?: RetroRepositoryContext,
  ): Promise<StoredRetroRoom | null> {
    await this.sweep(Date.now(), context);
    if (this.rooms.size >= options.maxRooms) return null;

    let code: string;
    do {
      code = nanoid(options.codeLength);
    } while (this.rooms.has(code));

    const stored = {
      ...clone(room),
      code,
      version: 1,
    } satisfies StoredRetroRoom;
    this.rooms.set(code, stored);
    this.expiredCodes.delete(code);
    this.emit(changeFor(code, stored.version, context, { kind: 'created' }));
    return clone(stored);
  }

  async get(
    code: string,
    context?: RetroRepositoryContext,
  ): Promise<StoredRetroRoom | undefined> {
    const room = this.rooms.get(code);
    if (!room) return undefined;
    if (room.expiresAt <= Date.now()) {
      this.expire(code, context);
      return undefined;
    }

    const current = clone(room);
    const memberIds = expiredMembers(current, Date.now());
    if (memberIds.length > 0) {
      removeMembers(current, memberIds);
      current.version = room.version + 1;
      this.rooms.set(code, current);
      this.emit(
        changeFor(code, current.version, context, {
          kind: 'member-expired',
          memberIds,
        }),
      );
    }
    return clone(current);
  }

  async update<T>(
    code: string,
    operation: RetroRoomOperation<T>,
    context?: RetroRepositoryContext,
  ): Promise<T> {
    const room = this.rooms.get(code);
    if (!room) throw new RetroRepositoryError('not-found');
    if (room.expiresAt <= Date.now()) {
      this.expire(code, context);
      throw new RetroRepositoryError('expired');
    }

    const next = clone(room);
    const memberIds = expiredMembers(next, Date.now());
    removeMembers(next, memberIds);
    const transaction = operation(next);
    next.version = room.version + 1;
    this.rooms.set(code, next);
    this.emit(
      changeFor(code, next.version, context, {
        ...(memberIds.length > 0 ? { kind: 'member-expired', memberIds } : {}),
        ...transaction.change,
      }),
    );
    return transaction.result;
  }

  async sweep(
    now: number,
    context?: RetroRepositoryContext,
  ): Promise<string[]> {
    const expired: string[] = [];
    for (const [code, room] of this.rooms) {
      if (room.expiresAt <= now) {
        if (this.expire(code, context)) expired.push(code);
        continue;
      }
      const next = clone(room);
      const memberIds = expiredMembers(next, now);
      if (memberIds.length === 0) continue;
      removeMembers(next, memberIds);
      next.version = room.version + 1;
      this.rooms.set(code, next);
      this.emit(
        changeFor(code, next.version, context, {
          kind: 'member-expired',
          memberIds,
        }),
      );
    }
    return expired;
  }

  async isExpired(code: string, now: number): Promise<boolean> {
    const room = this.rooms.get(code);
    return !room || room.expiresAt <= now;
  }

  onChange(listener: (change: RetroRoomChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onModuleDestroy() {
    this.rooms.clear();
    this.expiredCodes.clear();
    this.listeners.clear();
  }

  private expire(code: string, context?: RetroRepositoryContext): boolean {
    const room = this.rooms.get(code);
    if (!room || this.expiredCodes.has(code)) return false;
    this.rooms.delete(code);
    this.expiredCodes.add(code);
    this.emit(
      changeFor(code, room.version + 1, context, { kind: 'room-expired' }),
    );
    return true;
  }

  private emit(change: RetroRoomChange) {
    for (const listener of this.listeners) listener(clone(change));
  }
}

export interface RedisRetroRoomRepositoryOptions {
  url: string;
  keyPrefix?: string;
}

type RedisClient = ReturnType<typeof createClient>;

/**
 * Redis-backed room storage. Every command uses WATCH/MULTI and retries when
 * another replica commits first. The room key has a Redis TTL as well as the
 * domain expiry timestamp; an index and short-lived tombstones let replicas
 * announce exactly one expiry event even when Redis removes the key itself.
 */
@Injectable()
export class RedisRetroRoomRepository
  implements RetroRoomRepository, OnModuleDestroy
{
  private readonly client: RedisClient;
  private readonly subscriber: RedisClient;
  private readonly prefix: string;
  private readonly indexKey: string;
  private readonly channel: string;
  private readonly listeners = new Set<(change: RetroRoomChange) => void>();
  private connection?: Promise<void>;
  private subscription?: Promise<void>;
  private subscribed = false;
  private queue = Promise.resolve();

  constructor(options: RedisRetroRoomRepositoryOptions) {
    this.prefix = options.keyPrefix ?? 'story-poker:retro';
    this.indexKey = `${this.prefix}:rooms`;
    this.channel = `${this.prefix}:changes`;
    this.client = createClient({ url: options.url });
    this.subscriber = createClient({ url: options.url });
    for (const client of [this.client, this.subscriber])
      client.on('error', () => undefined);
    this.subscriber.on('end', () => {
      this.subscribed = false;
      this.subscription = undefined;
    });
  }

  create(
    room: NewStoredRetroRoom,
    options: { codeLength: number; maxRooms: number },
    context?: RetroRepositoryContext,
  ): Promise<StoredRetroRoom | null> {
    return this.run(async () => {
      await this.startSubscription();
      for (;;) {
        const code = nanoid(options.codeLength);
        const key = this.roomKey(code);
        const tombstone = this.tombstoneKey(code);
        await this.client.watch([this.indexKey, key, tombstone]);
        const indexed = await this.client.sMembers(this.indexKey);
        const stale: string[] = [];
        const activeKeys: string[] = [];
        for (const candidate of indexed) {
          const candidateKey = this.roomKey(candidate);
          if (await this.client.exists(candidateKey))
            activeKeys.push(candidateKey);
          else stale.push(candidate);
        }
        // WATCH replaces the previous watch set, so keep the index watched
        // while validating the room keys and committing the capacity decision.
        await this.client.watch([this.indexKey, ...activeKeys, key, tombstone]);

        if (activeKeys.length >= options.maxRooms) {
          const transaction = this.client.multi();
          if (stale.length > 0) transaction.sRem(this.indexKey, stale);
          const replies = await this.executeTransaction(transaction);
          if (replies === null) continue;
          return null;
        }
        if (
          (await this.client.exists(key)) ||
          (await this.client.exists(tombstone))
        ) {
          await this.client.unwatch();
          continue;
        }

        const stored = {
          ...clone(room),
          code,
          version: 1,
        } satisfies StoredRetroRoom;
        const ttl = this.ttl(stored.expiresAt);
        const change = changeFor(code, stored.version, context, {
          kind: 'created',
        });
        const transaction = this.client.multi();
        if (stale.length > 0) transaction.sRem(this.indexKey, stale);
        transaction.set(key, JSON.stringify(stored), { PX: ttl });
        transaction.sAdd(this.indexKey, code);
        transaction.publish(this.channel, JSON.stringify(change));
        const replies = await this.executeTransaction(transaction);
        if (replies === null) continue;
        return clone(stored);
      }
    });
  }

  get(
    code: string,
    context?: RetroRepositoryContext,
  ): Promise<StoredRetroRoom | undefined> {
    return this.run(async () => {
      await this.startSubscription();
      for (;;) {
        await this.client.watch(this.roomKey(code));
        const raw = await this.client.get(this.roomKey(code));
        if (raw === null) {
          await this.client.unwatch();
          await this.markMissingExpired(code, context);
          return undefined;
        }
        const room = this.parse(raw);
        if (room.expiresAt <= Date.now()) {
          await this.client.unwatch();
          await this.expireLocked(code, context);
          return undefined;
        }
        const memberIds = expiredMembers(room, Date.now());
        if (memberIds.length === 0) {
          await this.client.unwatch();
          return clone(room);
        }

        removeMembers(room, memberIds);
        room.version += 1;
        const change = changeFor(code, room.version, context, {
          kind: 'member-expired',
          memberIds,
        });
        const transaction = this.client
          .multi()
          .set(this.roomKey(code), JSON.stringify(room), {
            PX: this.ttl(room.expiresAt),
          })
          .sAdd(this.indexKey, code)
          .publish(this.channel, JSON.stringify(change));
        const replies = await this.executeTransaction(transaction);
        if (replies === null) continue;
        return clone(room);
      }
    });
  }

  update<T>(
    code: string,
    operation: RetroRoomOperation<T>,
    context?: RetroRepositoryContext,
  ): Promise<T> {
    return this.run(async () => {
      await this.startSubscription();
      for (;;) {
        await this.client.watch(this.roomKey(code));
        const raw = await this.client.get(this.roomKey(code));
        if (raw === null) {
          await this.client.unwatch();
          await this.markMissingExpired(code, context);
          throw new RetroRepositoryError('not-found');
        }
        const current = this.parse(raw);
        if (current.expiresAt <= Date.now()) {
          await this.client.unwatch();
          await this.expireLocked(code, context);
          throw new RetroRepositoryError('expired');
        }

        const room = clone(current);
        const memberIds = expiredMembers(room, Date.now());
        removeMembers(room, memberIds);
        let transactionResult: RetroRepositoryTransaction<T>;
        try {
          transactionResult = operation(room);
        } catch (error) {
          await this.client.unwatch();
          throw error;
        }
        room.version = current.version + 1;
        const change = changeFor(code, room.version, context, {
          ...(memberIds.length > 0
            ? { kind: 'member-expired', memberIds }
            : {}),
          ...transactionResult.change,
        });
        const transaction = this.client
          .multi()
          .set(this.roomKey(code), JSON.stringify(room), {
            PX: this.ttl(room.expiresAt),
          })
          .sAdd(this.indexKey, code)
          .publish(this.channel, JSON.stringify(change));
        const replies = await this.executeTransaction(transaction);
        if (replies === null) continue;
        return transactionResult.result;
      }
    });
  }

  sweep(now: number, context?: RetroRepositoryContext): Promise<string[]> {
    return this.run(async () => {
      await this.startSubscription();
      const codes = await this.client.sMembers(this.indexKey);
      const expired: string[] = [];
      for (const code of codes) {
        const didPublish = await this.expireLocked(code, context, now);
        if (didPublish) {
          expired.push(code);
          continue;
        }
        await this.cleanupMembersLocked(code, context, now);
      }
      return expired;
    });
  }

  isExpired(code: string, now: number): Promise<boolean> {
    return this.run(async () => {
      await this.startSubscription();
      const raw = await this.client.get(this.roomKey(code));
      if (raw === null) return true;
      return this.parse(raw).expiresAt <= now;
    });
  }

  onChange(listener: (change: RetroRoomChange) => void): () => void {
    this.listeners.add(listener);
    void this.startSubscription().catch(() => undefined);
    return () => this.listeners.delete(listener);
  }

  async onModuleDestroy() {
    if (this.connection) {
      await this.connection.catch(() => undefined);
      for (const client of [this.subscriber, this.client]) {
        if (client.isOpen) await client.quit().catch(() => undefined);
      }
    }
    this.listeners.clear();
  }

  private async executeTransaction<T>(transaction: {
    exec: () => Promise<T>;
  }): Promise<T | null> {
    try {
      return await transaction.exec();
    } catch (error) {
      if (error instanceof WatchError) return null;
      throw error;
    }
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async ensureConnected() {
    const connected = this.client.isOpen && this.subscriber.isOpen;
    if (connected) return;
    if (this.connection) {
      await this.connection.catch(() => undefined);
      if (this.client.isOpen && this.subscriber.isOpen) return;
      this.connection = undefined;
    }
    this.connection = Promise.all([
      this.connectClient(this.client),
      this.connectClient(this.subscriber),
    ]).then(() => undefined);
    try {
      await this.connection;
    } catch (error) {
      this.connection = undefined;
      throw error;
    }
  }

  private connectClient(client: RedisClient) {
    return client.isOpen ? Promise.resolve() : client.connect();
  }

  private async startSubscription() {
    if (this.subscribed) return;
    if (this.subscription) {
      try {
        await this.subscription;
      } catch (error) {
        this.subscription = undefined;
        throw error;
      }
      if (this.subscribed) return;
    }
    this.subscription = this.ensureConnected()
      .then(() =>
        this.subscriber.subscribe(this.channel, (payload) => {
          let change: RetroRoomChange;
          try {
            change = JSON.parse(payload) as RetroRoomChange;
          } catch {
            return;
          }
          for (const listener of this.listeners) listener(clone(change));
        }),
      )
      .then(() => {
        this.subscribed = true;
      });
    try {
      await this.subscription;
    } catch (error) {
      this.subscription = undefined;
      throw error;
    }
  }

  private async markMissingExpired(
    code: string,
    context?: RetroRepositoryContext,
  ) {
    for (;;) {
      await this.client.watch([
        this.roomKey(code),
        this.indexKey,
        this.tombstoneKey(code),
      ]);
      if (!(await this.client.sIsMember(this.indexKey, code))) {
        await this.client.unwatch();
        return;
      }
      if (await this.client.exists(this.roomKey(code))) {
        await this.client.unwatch();
        return;
      }
      if (await this.client.exists(this.tombstoneKey(code))) {
        const transaction = this.client.multi().sRem(this.indexKey, code);
        const replies = await this.executeTransaction(transaction);
        if (replies === null) continue;
        return;
      }
      const change = changeFor(code, 0, context, {
        kind: 'room-expired',
      });
      const transaction = this.client
        .multi()
        .sRem(this.indexKey, code)
        .set(this.tombstoneKey(code), '1', {
          NX: true,
          EX: RETRO_ROOM_TOMBSTONE_TTL_SECONDS,
        })
        .publish(this.channel, JSON.stringify(change));
      const replies = await this.executeTransaction(transaction);
      if (replies === null) continue;
      return;
    }
  }

  private async expireLocked(
    code: string,
    context?: RetroRepositoryContext,
    now = Date.now(),
  ): Promise<boolean> {
    for (;;) {
      await this.client.watch([
        this.roomKey(code),
        this.indexKey,
        this.tombstoneKey(code),
      ]);
      const raw = await this.client.get(this.roomKey(code));
      if (raw !== null && this.parse(raw).expiresAt > now) {
        await this.client.unwatch();
        return false;
      }
      if (await this.client.exists(this.tombstoneKey(code))) {
        const transaction = this.client.multi().sRem(this.indexKey, code);
        const replies = await this.executeTransaction(transaction);
        if (replies === null) continue;
        return false;
      }
      const change = changeFor(
        code,
        raw === null ? 0 : this.parse(raw).version + 1,
        context,
        { kind: 'room-expired' },
      );
      const transaction = this.client.multi();
      if (raw !== null) transaction.del(this.roomKey(code));
      transaction.sRem(this.indexKey, code);
      transaction.set(this.tombstoneKey(code), '1', {
        NX: true,
        EX: RETRO_ROOM_TOMBSTONE_TTL_SECONDS,
      });
      transaction.publish(this.channel, JSON.stringify(change));
      const replies = await this.executeTransaction(transaction);
      if (replies === null) continue;
      return true;
    }
  }

  private async cleanupMembersLocked(
    code: string,
    context: RetroRepositoryContext | undefined,
    now: number,
  ): Promise<boolean> {
    for (;;) {
      await this.client.watch(this.roomKey(code));
      const raw = await this.client.get(this.roomKey(code));
      if (raw === null) {
        await this.client.unwatch();
        return false;
      }
      const room = this.parse(raw);
      const memberIds = expiredMembers(room, now);
      if (memberIds.length === 0) {
        await this.client.unwatch();
        return false;
      }
      removeMembers(room, memberIds);
      room.version += 1;
      const change = changeFor(code, room.version, context, {
        kind: 'member-expired',
        memberIds,
      });
      const transaction = this.client
        .multi()
        .set(this.roomKey(code), JSON.stringify(room), {
          PX: this.ttl(room.expiresAt),
        })
        .sAdd(this.indexKey, code)
        .publish(this.channel, JSON.stringify(change));
      const replies = await this.executeTransaction(transaction);
      if (replies === null) continue;
      return true;
    }
  }

  private parse(raw: string): StoredRetroRoom {
    return JSON.parse(raw) as StoredRetroRoom;
  }

  private ttl(expiresAt: number) {
    return Math.max(1, expiresAt - Date.now());
  }

  private roomKey(code: string) {
    return `${this.prefix}:room:${code}`;
  }

  private tombstoneKey(code: string) {
    return `${this.prefix}:expired:${code}`;
  }
}
