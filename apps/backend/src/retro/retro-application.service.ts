import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import type {
  RetroCommand,
  RetroServerEvent,
  RetroSessionView,
} from 'shared/retrospective';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import {
  result,
  type ApplicationResult,
  type OutboundMessage,
} from '../transport/application-result.js';
import {
  RetroError,
  RetroService,
  type RetroSession,
} from './retro.service.js';

export const RETRO_APPLICATION_NAMESPACE = 'retro';

export type RetroSessionOperation = {
  session: RetroSession;
  view: RetroSessionView;
  transport: ApplicationResult;
};

@Injectable()
export class RetroApplicationService implements OnModuleDestroy {
  private readonly unsubscribeMemberExpired: () => void;
  private readonly sessions = new Map<string, RetroSession>();

  constructor(
    private readonly retros: RetroService,
    private readonly connections: ConnectionRegistryService,
    events: ApplicationEventBus,
  ) {
    this.unsubscribeMemberExpired = retros.onMemberExpired((code, id) => {
      this.connections.revoke(RETRO_APPLICATION_NAMESPACE, code, id);
      events.emit(RETRO_APPLICATION_NAMESPACE, this.broadcast(code));
    });
  }

  onModuleDestroy() {
    this.unsubscribeMemberExpired();
    this.sessions.clear();
  }

  execute(
    connectionId: string,
    command: RetroCommand,
    requestId?: string,
    credential?: string,
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
        if (command.type === 'create' || command.type === 'join')
          throw new RetroError(
            'http-required',
            'Create or join through the secure session endpoint.',
          );
        if (!credential)
          throw new RetroError(
            'session-required',
            'Establish this room session before opening the live board.',
          );
        session = this.retros.attach(command.code, credential);
        const existing = this.connections.get<string>(
          RETRO_APPLICATION_NAMESPACE,
          session.code,
          session.id,
        );
        if (existing && existing !== connectionId)
          throw new RetroError(
            'session-in-use',
            'This session is already connected. Resume through the secure session endpoint.',
          );

        const previous = this.connections.replace(
          RETRO_APPLICATION_NAMESPACE,
          session.code,
          session.id,
          connectionId,
        );
        const replaced = previous ? this.replace(previous) : result();
        this.sessions.set(connectionId, session);
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
      const mutation = this.retros.mutate(session, command);
      const removed = mutation?.removedMemberId
        ? this.removeMember(session.code, mutation.removedMemberId)
        : result();
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

  establish(command: Extract<RetroCommand, { type: 'create' | 'join' }>): {
    session: RetroSession;
    view: RetroSessionView;
  } {
    const session =
      command.type === 'create'
        ? this.retros.create(command.name, command.title)
        : this.retros.join(command.code, command.name);
    return { session, view: this.view(session) };
  }

  inspectSession(code: string, token: string): RetroSessionView {
    const session = this.retros.inspect(code, token);
    return this.view(session);
  }

  /** Rotate an HTTP session and invalidate any socket using its old value. */
  resumeSession(code: string, token: string): RetroSessionOperation {
    const expired = this.expireRooms();
    const session = this.retros.resume(code, token);
    const previous = this.connections.revoke<string>(
      RETRO_APPLICATION_NAMESPACE,
      code,
      session.id,
    );
    const replaced = previous ? this.replace(previous) : result();
    return {
      session,
      view: this.view(session),
      transport: this.merge(expired, replaced, this.broadcast(code)),
    };
  }

  /** Revoke an HTTP session and close its current socket, if any. */
  forgetSession(code: string, token: string): ApplicationResult {
    const expired = this.expireRooms();
    const session = this.retros.forget(code, token);
    const previous = this.connections.revoke<string>(
      RETRO_APPLICATION_NAMESPACE,
      code,
      session.id,
    );
    const forgotten = previous ? this.forget(previous) : result();
    return this.merge(expired, forgotten, this.broadcast(code));
  }

  disconnect(connectionId: string): ApplicationResult {
    const session = this.sessions.get(connectionId);
    this.sessions.delete(connectionId);
    if (!session) return result();
    this.connections.release(
      RETRO_APPLICATION_NAMESPACE,
      session.code,
      session.id,
      connectionId,
    );
    this.retros.disconnect(session);
    return this.broadcast(session.code);
  }

  expireRooms(): ApplicationResult {
    this.retros.sweep();
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

  private view(session: RetroSession): RetroSessionView {
    return {
      room: this.retros.snapshot(session),
      self: { id: session.id },
    };
  }

  private forget(previousConnectionId: string): ApplicationResult {
    this.sessions.delete(previousConnectionId);
    return result(
      undefined,
      [
        {
          connectionId: previousConnectionId,
          event: this.errorEvent(
            new RetroError(
              'invalid-session',
              'This browser session was forgotten. Join again to reconnect.',
            ),
          ),
        },
      ],
      [
        {
          connectionId: previousConnectionId,
          code: 4002,
          reason: 'Session forgotten',
        },
      ],
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
  ): ApplicationResult {
    const messages: OutboundMessage[] = [];
    const roomSessions = [...this.sessions].filter(
      ([, session]) => session.code === code,
    );
    const audience = new Set(
      this.connections.audience<string>(
        RETRO_APPLICATION_NAMESPACE,
        code,
        roomSessions.map(([, session]) => session.id),
      ),
    );
    for (const [connectionId, session] of roomSessions) {
      if (!audience.has(connectionId)) continue;
      try {
        const event: RetroServerEvent = {
          event: 'retro-state',
          data: {
            room: this.retros.snapshot(session),
            self: { id: session.id },
            ...(connectionId === requester && requestId ? { requestId } : {}),
          },
        };
        messages.push({ connectionId, event });
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
