import { Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { WebSocketAdmissionService } from '../transport/websocket-admission.service.js';
import { TransportMetricsService } from '../transport/transport-metrics.service.js';
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
export class RetroApplicationService implements OnModuleDestroy {
  private readonly unsubscribeMemberExpired: () => void;
  private readonly sessions = new Map<string, RetroSession>();

  constructor(
    private readonly retros: RetroService,
    private readonly connections: ConnectionRegistryService,
    events: ApplicationEventBus,
    @Optional() private readonly admission?: WebSocketAdmissionService,
    @Optional() private readonly metrics?: TransportMetricsService,
  ) {
    this.unsubscribeMemberExpired = retros.onMemberExpired((code, id) => {
      const connectionId = this.connections.revoke<string>(
        RETRO_APPLICATION_NAMESPACE,
        code,
        id,
      );
      if (connectionId) {
        this.sessions.delete(connectionId);
        this.admission?.release(connectionId);
      }
      this.refreshMetrics();
      const broadcast = this.broadcast(code);
      events.emit(
        RETRO_APPLICATION_NAMESPACE,
        connectionId
          ? this.merge(
              broadcast,
              result(
                undefined,
                [],
                [
                  {
                    connectionId,
                    code: 4003,
                    reason: 'Membership expired',
                  },
                ],
              ),
            )
          : broadcast,
      );
    });
    this.refreshMetrics();
  }

  onModuleDestroy() {
    this.unsubscribeMemberExpired();
    this.sessions.clear();
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
        if (command.type === 'create') {
          if (
            this.admission &&
            !this.admission.allowRoomCreation(RETRO_APPLICATION_NAMESPACE)
          )
            throw new RetroError(
              'capacity',
              'Room creation is temporarily unavailable. Try again later.',
            );
          this.requireBroadcastCapacity('', 1);
          session = this.retros.create(command.name, command.title);
        } else if (command.type === 'join') {
          this.requireBroadcastCapacity(
            command.code,
            this.roomAudienceSize(command.code) > 0 ? 1 : 0,
          );
          session = this.retros.join(command.code, command.name);
        } else {
          this.requireBroadcastCapacity(command.code);
          session = this.retros.resume(command.code, command.token);
        }

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
          this.broadcast(session.code, connectionId, requestId, true),
        );
      }

      if (!current)
        throw new RetroError(
          'invalid-session',
          'Join a room before making changes.',
        );
      session = current;
      this.requireBroadcastCapacity(session.code);
      const mutation = this.retros.mutate(session, command);
      const removed = mutation?.removedMemberId
        ? this.removeMember(session.code, mutation.removedMemberId)
        : result();
      return this.merge(
        expired,
        removed,
        this.broadcast(session.code, connectionId, requestId, true),
      );
    } catch (error) {
      if (!(error instanceof RetroError)) throw error;
      if (error.code === 'capacity')
        this.metrics?.recordCapacityExhausted(
          RETRO_APPLICATION_NAMESPACE,
          command.type,
        );
      return this.merge(expired, this.reject(connectionId, error, requestId));
    } finally {
      this.refreshMetrics();
    }
  }

  disconnect(connectionId: string): ApplicationResult {
    const session = this.sessions.get(connectionId);
    this.sessions.delete(connectionId);
    this.admission?.release(connectionId);
    if (!session) return result();
    this.connections.release(
      RETRO_APPLICATION_NAMESPACE,
      session.code,
      session.id,
      connectionId,
    );
    const broadcastAllowed = this.reserveBroadcast(session.code);
    this.retros.disconnect(session);
    if (!broadcastAllowed) {
      this.refreshMetrics();
      return result();
    }
    const disconnected = this.broadcast(
      session.code,
      undefined,
      undefined,
      true,
    );
    this.refreshMetrics();
    return disconnected;
  }

  expireRooms(): ApplicationResult {
    this.retros.sweep();
    const messages: OutboundMessage[] = [];
    const closes: { connectionId: string; code: number; reason: string }[] = [];
    for (const [connectionId, session] of this.sessions) {
      if (!this.retros.isExpired(session.code)) continue;
      this.sessions.delete(connectionId);
      this.admission?.release(connectionId);
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
      closes.push({
        connectionId,
        code: 4004,
        reason: 'Room expired',
      });
    }
    this.refreshMetrics();
    return result(undefined, messages, closes);
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
    this.admission?.release(connectionId);
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
    this.admission?.release(previousConnectionId);
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
    admissionReserved = false,
  ): ApplicationResult {
    if (!admissionReserved && !this.reserveBroadcast(code)) return result();
    const messages: OutboundMessage[] = [];
    const closes: { connectionId: string; code: number; reason: string }[] = [];
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
        this.admission?.release(connectionId);
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
        closes.push({
          connectionId,
          code: error.code === 'room-expired' ? 4004 : 4002,
          reason:
            error.code === 'room-expired' ? 'Room expired' : 'Session invalid',
        });
      }
    }
    return result(undefined, messages, closes);
  }

  private requireBroadcastCapacity(code: string, additional = 0) {
    if (this.reserveBroadcast(code, additional)) return;
    throw new RetroError(
      'rate-limit',
      'This retrospective is busy. Try again in a moment.',
    );
  }

  private reserveBroadcast(code: string, additional = 0): boolean {
    return (
      !this.admission ||
      this.admission.allowBroadcast(
        RETRO_APPLICATION_NAMESPACE,
        Math.max(1, this.roomAudienceSize(code) + additional),
      )
    );
  }

  private roomAudienceSize(code: string): number {
    let size = 0;
    for (const [, session] of this.sessions) if (session.code === code) size++;
    return size;
  }

  private refreshMetrics() {
    this.metrics?.setGauge('retro.active_rooms', this.retros.roomCount(), {
      namespace: RETRO_APPLICATION_NAMESPACE,
    });
    this.metrics?.setGauge('retro.active_sessions', this.sessions.size, {
      namespace: RETRO_APPLICATION_NAMESPACE,
    });
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
