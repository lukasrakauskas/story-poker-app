import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import {
  RETRO_PROTOCOL_ERROR_CODE,
  RETRO_PROTOCOL_ERROR_MESSAGE,
  retroServerEventSchema,
  type RetroCommand,
  type RetroServerEvent,
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
  type RetroConnection,
  type RetroSession,
} from './retro.service.js';
import type { RetroRoomChange } from './retro-room.repository.js';

export const RETRO_APPLICATION_NAMESPACE = 'retro';

@Injectable()
export class RetroApplicationService implements OnModuleDestroy {
  private readonly unsubscribeRoomChanged: () => void;
  private readonly sessions = new Map<string, RetroSession>();
  private readonly instanceId = nanoid();

  constructor(
    private readonly retros: RetroService,
    private readonly connections: ConnectionRegistryService,
    private readonly events: ApplicationEventBus,
  ) {
    this.unsubscribeRoomChanged = retros.onRoomChanged((change) => {
      void this.handleRoomChange(change).catch(() => undefined);
    });
  }

  onModuleDestroy() {
    this.unsubscribeRoomChanged();
    this.sessions.clear();
  }

  async execute(
    connectionId: string,
    command: RetroCommand,
    requestId?: string,
  ): Promise<ApplicationResult> {
    const context = this.context();
    let expired: ApplicationResult = result();
    try {
      expired = await this.expireRooms();
      const current = this.sessions.get(connectionId);
      let session: RetroSession;
      if (command.type === 'inspect') {
        const inspection = await this.retros.inspect(command.code, context);
        const event: RetroServerEvent = {
          event: 'retro-room-info',
          data: { ...inspection, ...(requestId ? { requestId } : {}) },
        };
        const validated = retroServerEventSchema.safeParse(event);
        return this.merge(
          expired,
          result(undefined, [
            {
              connectionId,
              event: validated.success
                ? validated.data
                : this.errorEvent(
                    new RetroError(
                      RETRO_PROTOCOL_ERROR_CODE,
                      RETRO_PROTOCOL_ERROR_MESSAGE,
                    ),
                    requestId,
                  ),
            },
          ]),
        );
      }
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

        let previousConnection: RetroConnection | undefined;
        const connectionContext = this.context(connectionId);
        if (command.type === 'create') {
          session = await this.retros.create(
            command.name,
            command.title,
            command.password,
            connectionContext,
          );
        } else if (command.type === 'join') {
          session = await this.retros.join(
            command.code,
            command.name,
            command.password,
            connectionContext,
          );
        } else {
          const resumed = await this.retros.resumeWithConnection(
            command.code,
            command.token,
            this.connection(connectionId),
            context,
          );
          session = resumed.session;
          previousConnection = resumed.previousConnection;
        }

        const localPrevious = this.connections.replace(
          RETRO_APPLICATION_NAMESPACE,
          session.code,
          session.id,
          connectionId,
        );
        this.sessions.set(connectionId, session);
        const replaced = localPrevious
          ? this.replace(localPrevious)
          : previousConnection
            ? this.replaceIfLocal(previousConnection)
            : result();
        return this.merge(
          expired,
          replaced,
          await this.broadcast(session.code, connectionId, requestId),
        );
      }

      if (!current)
        throw new RetroError(
          'invalid-session',
          'Join a room before making changes.',
        );
      session = current;
      const mutation = await this.retros.mutate(session, command, context);
      const removed = mutation?.removedMemberId
        ? this.removeMember(session.code, mutation.removedMemberId)
        : result();
      return this.merge(
        expired,
        removed,
        await this.broadcast(session.code, connectionId, requestId),
      );
    } catch (error) {
      if (!(error instanceof RetroError))
        return this.merge(
          expired,
          this.reject(connectionId, this.storageError(), requestId),
        );
      // A command can observe the expiry between the heartbeat sweep and its
      // repository transaction. Ensure every local socket gets the same
      // terminal notification rather than only the requester.
      if (error.code === 'room-expired') {
        const terminal = await this.expireRooms();
        const requesterNotified = terminal.messages?.some(
          (message) => message.connectionId === connectionId,
        );
        return this.merge(
          expired,
          terminal,
          requesterNotified
            ? result()
            : this.reject(connectionId, error, requestId),
        );
      }
      return this.merge(expired, this.reject(connectionId, error, requestId));
    }
  }

  async disconnect(connectionId: string): Promise<ApplicationResult> {
    const session = this.sessions.get(connectionId);
    this.sessions.delete(connectionId);
    if (!session) return result();
    this.connections.release(
      RETRO_APPLICATION_NAMESPACE,
      session.code,
      session.id,
      connectionId,
    );
    await this.retros.disconnect(
      session,
      this.connection(connectionId),
      this.context(),
    );
    return this.broadcast(session.code);
  }

  async expireRooms(): Promise<ApplicationResult> {
    const expiredCodes = new Set(await this.retros.sweep(this.context()));
    const messages: OutboundMessage[] = [];
    for (const [connectionId, session] of this.sessions) {
      if (!expiredCodes.has(session.code)) continue;
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

  private async handleRoomChange(change: RetroRoomChange) {
    // The originating command returns its own committed broadcast. Redis
    // delivers the same pub/sub message back to its publisher, so only remote
    // changes are fanned out here.
    if (
      change.source === this.instanceId &&
      change.kind !== 'member-expired' &&
      change.kind !== 'room-expired'
    )
      return;

    if (change.kind === 'room-expired') {
      const expired = await this.expireLocalRoom(change.code);
      this.emitRemote(expired);
      return;
    }

    let effects = result();
    const memberIds = [
      ...(change.memberIds ?? []),
      ...(change.memberId && change.kind === 'member-removed'
        ? [change.memberId]
        : []),
    ];
    for (const memberId of new Set(memberIds)) {
      effects = this.merge(effects, this.removeMember(change.code, memberId));
    }

    if (change.kind === 'session-replaced' && change.replacement) {
      const local = this.connections.get<string>(
        RETRO_APPLICATION_NAMESPACE,
        change.code,
        change.replacement.participantId,
      );
      if (local) {
        const owner = await this.retros.connectionOwner(
          change.code,
          change.replacement.participantId,
        );
        const isCurrentLocalOwner =
          owner !== undefined &&
          owner.instanceId === this.instanceId &&
          owner.connectionId === local;
        if (!isCurrentLocalOwner)
          effects = this.merge(effects, this.replace(local));
      }
    }

    effects = this.merge(effects, await this.broadcast(change.code));
    this.emitRemote(effects);
  }

  private emitRemote(applicationResult: ApplicationResult) {
    // ApplicationEventBus is the local transport fan-out boundary. A Redis
    // repository only carries the small change envelope, never public state or
    // reconnect credentials.
    const events = this.events;
    events.emit(RETRO_APPLICATION_NAMESPACE, applicationResult);
  }

  private async expireLocalRoom(code: string): Promise<ApplicationResult> {
    const messages: OutboundMessage[] = [];
    for (const [connectionId, session] of this.sessions) {
      if (session.code !== code) continue;
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

  private replaceIfLocal(previous: RetroConnection): ApplicationResult {
    if (previous.instanceId !== this.instanceId) return result();
    return this.replace(previous.connectionId);
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

  private async broadcast(
    code: string,
    requester?: string,
    requestId?: string,
  ): Promise<ApplicationResult> {
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
            room: await this.retros.snapshot(session, this.context()),
            self: { id: session.id, token: session.token },
            ...(connectionId === requester && requestId ? { requestId } : {}),
          },
        };
        const validated = retroServerEventSchema.safeParse(event);
        messages.push({
          connectionId,
          event: validated.success
            ? validated.data
            : this.errorEvent(
                new RetroError(
                  RETRO_PROTOCOL_ERROR_CODE,
                  RETRO_PROTOCOL_ERROR_MESSAGE,
                ),
                connectionId === requester ? requestId : undefined,
              ),
        });
      } catch (error) {
        if (!(error instanceof RetroError)) {
          messages.push({
            connectionId,
            event: this.errorEvent(
              this.storageError(),
              connectionId === requester ? requestId : undefined,
            ),
          });
          continue;
        }
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
            error,
            connectionId === requester ? requestId : undefined,
          ),
        });
      }
    }
    return result(undefined, messages);
  }

  private storageError() {
    return new RetroError(
      'storage-unavailable',
      'The retrospective is temporarily unavailable. Try again shortly.',
    );
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

  private context(connectionId?: string) {
    return {
      source: this.instanceId,
      ...(connectionId ? { connection: this.connection(connectionId) } : {}),
    };
  }

  private connection(connectionId: string): RetroConnection {
    return { instanceId: this.instanceId, connectionId };
  }

  private merge(...results: ApplicationResult[]): ApplicationResult {
    return result(
      undefined,
      results.flatMap((item) => item.messages ?? []),
      results.flatMap((item) => item.closes ?? []),
    );
  }
}
