import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import type {
  RetroCommand,
  RetroRecipientEnvelope,
  RetroRoom,
  RetroServerEvent,
} from 'shared/retrospective';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import {
  result,
  type ApplicationResult,
  type OutboundMessage,
  type OutboundSerialization,
} from '../transport/application-result.js';
import {
  RetroError,
  RetroService,
  type RetroSession,
} from './retro.service.js';

export const RETRO_APPLICATION_NAMESPACE = 'retro';

type CachedProjection = {
  version: number;
  room: RetroRoom;
};

@Injectable()
export class RetroApplicationService implements OnModuleDestroy {
  private readonly unsubscribeMemberExpired: () => void;
  private readonly sessions = new Map<string, RetroSession>();
  /** Monotonic versions are scoped to this in-memory application instance. */
  private readonly versions = new Map<string, number>();
  private readonly projections = new Map<string, CachedProjection>();

  constructor(
    private readonly retros: RetroService,
    private readonly connections: ConnectionRegistryService,
    events: ApplicationEventBus,
  ) {
    this.unsubscribeMemberExpired = retros.onMemberExpired((code, id) => {
      const connectionId = this.connections.revoke<string>(
        RETRO_APPLICATION_NAMESPACE,
        code,
        id,
      );
      if (connectionId) this.sessions.delete(connectionId);
      this.commit(code);
      events.emit(RETRO_APPLICATION_NAMESPACE, this.broadcast(code));
    });
  }

  onModuleDestroy() {
    this.unsubscribeMemberExpired();
    this.sessions.clear();
    this.versions.clear();
    this.projections.clear();
  }

  execute(
    connectionId: string,
    command: RetroCommand,
    requestId?: string,
  ): ApplicationResult {
    const expired = this.expireRooms();
    try {
      const current = this.sessions.get(connectionId);
      let session: RetroSession;
      if (
        command.type === 'create' ||
        command.type === 'join' ||
        command.type === 'resume'
      ) {
        if (current)
          throw new RetroError(
            'already-joined',
            'You are already in a retrospective. Open a new tab to join another.',
          );
        if (command.type === 'create')
          session = this.retros.create(command.name, command.title);
        else if (command.type === 'join')
          session = this.retros.join(command.code, command.name);
        else session = this.retros.resume(command.code, command.token);

        const previous = this.connections.replace(
          RETRO_APPLICATION_NAMESPACE,
          session.code,
          session.id,
          connectionId,
        );
        const replaced = previous ? this.replace(previous) : result();
        this.sessions.set(connectionId, session);
        this.commit(session.code);
        return this.merge(
          expired,
          replaced,
          this.broadcast(session.code, connectionId, requestId),
        );
      }

      if (!current)
        throw new RetroError(
          'invalid-session',
          'Join a room before making changes.',
        );
      session = current;
      if (command.type === 'refresh')
        return this.merge(
          expired,
          this.targetedSnapshot(connectionId, session, requestId),
        );
      const mutation = this.retros.mutate(session, command);
      const removed = mutation?.removedMemberId
        ? this.removeMember(session.code, mutation.removedMemberId)
        : result();
      this.commit(session.code);
      return this.merge(
        expired,
        removed,
        this.broadcast(session.code, connectionId, requestId),
      );
    } catch (error) {
      if (!(error instanceof RetroError)) throw error;
      return this.merge(expired, this.reject(connectionId, error, requestId));
    }
  }

  disconnect(connectionId: string): ApplicationResult {
    const expired = this.expireRooms();
    const session = this.sessions.get(connectionId);
    this.sessions.delete(connectionId);
    if (!session) return expired;
    this.connections.release(
      RETRO_APPLICATION_NAMESPACE,
      session.code,
      session.id,
      connectionId,
    );
    if (!this.retros.disconnect(session)) return expired;
    this.commit(session.code);
    return this.merge(expired, this.broadcast(session.code));
  }

  expireRooms(): ApplicationResult {
    for (const code of this.retros.sweep()) {
      this.versions.delete(code);
      this.projections.delete(code);
    }
    const messages: OutboundMessage[] = [];
    for (const [connectionId, session] of this.sessions) {
      if (!this.retros.isExpired(session.code)) continue;
      this.sessions.delete(connectionId);
      this.connections.release(
        RETRO_APPLICATION_NAMESPACE,
        session.code,
        session.id,
        connectionId,
      );
      messages.push({
        connectionId,
        event: this.errorEvent(
          new RetroError(
            'room-expired',
            'This room has expired. Create a new retrospective.',
          ),
        ),
      });
    }
    return result(undefined, messages);
  }

  reject(
    connectionId: string,
    error: RetroError,
    requestId?: string,
  ): ApplicationResult {
    return result(undefined, [
      { connectionId, event: this.errorEvent(error, requestId) },
    ]);
  }

  private removeMember(code: string, memberId: string): ApplicationResult {
    const connectionId = this.connections.revoke<string>(
      RETRO_APPLICATION_NAMESPACE,
      code,
      memberId,
    );
    if (!connectionId) return result();
    this.sessions.delete(connectionId);
    return result(
      undefined,
      [
        {
          connectionId,
          event: this.errorEvent(
            new RetroError(
              'removed',
              'A moderator removed you from this retrospective.',
            ),
          ),
        },
      ],
      [{ connectionId, code: 4003, reason: 'Removed by moderator' }],
    );
  }

  private replace(previousConnectionId: string): ApplicationResult {
    this.sessions.delete(previousConnectionId);
    return result(
      undefined,
      [
        {
          connectionId: previousConnectionId,
          event: this.errorEvent(
            new RetroError(
              'invalid-session',
              'Your session was resumed in another connection.',
            ),
          ),
        },
      ],
      [
        {
          connectionId: previousConnectionId,
          code: 4001,
          reason: 'Session replaced',
        },
      ],
    );
  }

  private broadcast(
    code: string,
    requester?: string,
    requestId?: string,
    targetConnectionId?: string,
  ): ApplicationResult {
    const messages: OutboundMessage[] = [];
    const roomSessions = [...this.sessions].filter(
      ([connectionId, session]) =>
        session.code === code &&
        (targetConnectionId === undefined ||
          connectionId === targetConnectionId),
    );
    const audience = new Set(
      this.connections.audience<string>(
        RETRO_APPLICATION_NAMESPACE,
        code,
        roomSessions.map(([, session]) => session.id),
      ),
    );
    const recipients = roomSessions.filter(([connectionId]) =>
      audience.has(connectionId),
    );
    if (!recipients.length) return result(undefined, messages);

    // The public projection is room/version scoped, not recipient scoped. All
    // messages below retain the same object so the transport can encode it once.
    const projection = this.projection(code, recipients[0][1]);
    for (const [connectionId, session] of recipients) {
      try {
        messages.push(
          this.stateMessage(
            connectionId,
            session,
            projection,
            connectionId === requester && requestId ? requestId : undefined,
          ),
        );
      } catch (error) {
        if (!(error instanceof RetroError)) throw error;
        this.sessions.delete(connectionId);
        this.connections.release(
          RETRO_APPLICATION_NAMESPACE,
          session.code,
          session.id,
          connectionId,
        );
        messages.push({
          connectionId,
          event: this.errorEvent(error),
        });
      }
    }
    return result(undefined, messages);
  }

  private targetedSnapshot(
    connectionId: string,
    session: RetroSession,
    requestId?: string,
  ): ApplicationResult {
    return this.broadcast(session.code, connectionId, requestId, connectionId);
  }

  private projection(code: string, session: RetroSession): CachedProjection {
    const version = this.version(code);
    const cached = this.projections.get(code);
    if (cached?.version === version) return cached;
    const projection = { version, room: this.retros.publicSnapshot(session) };
    this.projections.set(code, projection);
    return projection;
  }

  private stateMessage(
    connectionId: string,
    session: RetroSession,
    projection: CachedProjection,
    requestId?: string,
  ): OutboundMessage {
    const recipient: RetroRecipientEnvelope =
      this.retros.recipientEnvelope(session);
    const self = { id: session.id, token: session.token };
    const data = {
      room: projection.room,
      self,
      recipient,
      version: projection.version,
      ...(requestId ? { requestId } : {}),
    };
    const event: RetroServerEvent = { event: 'retro-state', data };
    const serialization: OutboundSerialization = {
      type: 'retro-state',
      publicRoom: projection.room,
      self,
      recipient,
      version: projection.version,
      ...(requestId ? { requestId } : {}),
    };
    return { connectionId, event, serialization };
  }

  private commit(code: string) {
    const current = this.versions.get(code) ?? 0;
    this.versions.set(code, current + 1);
    this.projections.delete(code);
  }

  private version(code: string) {
    const current = this.versions.get(code);
    if (current !== undefined) return current;
    this.versions.set(code, 1);
    return 1;
  }

  private errorEvent(error: RetroError, requestId?: string): RetroServerEvent {
    return {
      event: 'retro-error',
      data: {
        code: error.code,
        message: error.message,
        ...(requestId ? { requestId } : {}),
      },
    };
  }

  private merge(...results: ApplicationResult[]): ApplicationResult {
    return result(
      undefined,
      results.flatMap((item) => item.messages ?? []),
      results.flatMap((item) => item.closes ?? []),
    );
  }
}
