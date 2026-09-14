import { Injectable } from '@nestjs/common';
import type { RetroCommand, RetroServerEvent } from 'shared/retrospective';
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

@Injectable()
export class RetroApplicationService {
  private readonly sessions = new Map<string, RetroSession>();

  constructor(
    private readonly retros: RetroService,
    private readonly connections: ConnectionRegistryService,
  ) {}

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
      this.retros.mutate(session, command);
      return this.merge(
        expired,
        this.broadcast(session.code, connectionId, requestId),
      );
    } catch (error) {
      if (!(error instanceof RetroError)) throw error;
      return this.merge(expired, this.reject(connectionId, error, requestId));
    }
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
            self: { id: session.id, token: session.token },
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
