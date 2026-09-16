import { Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { WebSocketAdmissionService } from '../transport/websocket-admission.service.js';
import { TransportMetricsService } from '../transport/transport-metrics.service.js';
import {
  RETRO_PROTOCOL_ERROR_CODE,
  RETRO_PROTOCOL_ERROR_MESSAGE,
  retroServerEventSchema,
  type RetroCommand,
  type RetroPresenceUpdate,
  type RetroRememberedIdentity,
  type RetroServerEvent,
  type RetroSessionView,
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

export type RetroSessionOperation = {
  session: RetroSession;
  view: RetroSessionView;
  transport: ApplicationResult;
};

@Injectable()
export class RetroApplicationService implements OnModuleDestroy {
  private readonly unsubscribeRoomChanged: () => void;
  private readonly sessions = new Map<string, RetroSession>();
  private readonly instanceId = nanoid();

  constructor(
    private readonly retros: RetroService,
    private readonly connections: ConnectionRegistryService,
    private readonly events: ApplicationEventBus,
    @Optional() private readonly admission?: WebSocketAdmissionService,
    @Optional() private readonly metrics?: TransportMetricsService,
  ) {
    this.unsubscribeRoomChanged = retros.onRoomChanged((change) => {
      void this.handleRoomChange(change).catch(() => undefined);
    });
    this.refreshMetrics();
  }

  onModuleDestroy() {
    this.unsubscribeRoomChanged();
    this.sessions.clear();
    this.refreshMetrics();
  }

  async execute(
    connectionId: string,
    command: RetroCommand,
    requestId?: string,
    credential?: string,
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

        if (command.type !== 'resume')
          throw new RetroError(
            'http-required',
            'Create or join through the secure session endpoint.',
          );
        if (!credential)
          throw new RetroError(
            'session-required',
            'Establish this room session before opening the live board.',
          );
        this.requireBroadcastCapacity(command.code, 1);
        const resumed = await this.retros.resumeWithConnection(
          command.code,
          credential,
          this.connection(connectionId),
          context,
        );
        session = resumed.session;
        const previousConnection = resumed.previousConnection;

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
          await this.broadcast(session.code, connectionId, requestId, true),
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
          await this.broadcast(
            session.code,
            connectionId,
            requestId,
            false,
            connectionId,
          ),
        );
      this.requireBroadcastCapacity(session.code);
      const mutation = await this.retros.mutate(session, command, context);
      const removed = mutation?.removedMemberId
        ? this.removeMember(session.code, mutation.removedMemberId)
        : result();
      return this.merge(
        expired,
        removed,
        await this.broadcast(session.code, connectionId, requestId, true),
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

  presence(
    connectionId: string,
    update: RetroPresenceUpdate,
  ): ApplicationResult {
    const session = this.sessions.get(connectionId);
    if (!session) return result();
    const event: RetroServerEvent = {
      event: 'retro-presence',
      data: { ...update, memberId: session.id },
    };
    return result(
      undefined,
      [...this.sessions.entries()]
        .filter(
          ([targetId, target]) =>
            targetId !== connectionId && target.code === session.code,
        )
        .map(([targetId]) => ({ connectionId: targetId, event })),
    );
  }

  /**
   * Establishment is intentionally HTTP-only. It creates the member and
   * returns a secret-free view; the HTTP controller writes the bearer token to
   * an HttpOnly cookie before the browser opens a WebSocket.
   */
  async establish(
    command: Extract<RetroCommand, { type: 'create' | 'join' }>,
    source = 'unknown',
  ): Promise<RetroSessionOperation> {
    const operation = command.type;
    if (
      this.admission &&
      !this.admission.consumeHttpOperation(
        RETRO_APPLICATION_NAMESPACE,
        source,
        operation,
      )
    )
      throw new RetroError(
        'rate-limit',
        'Too many attempts. Wait a minute before trying again.',
      );
    if (
      command.type === 'create' &&
      this.admission &&
      !this.admission.allowRoomCreation(RETRO_APPLICATION_NAMESPACE)
    )
      throw new RetroError(
        'capacity',
        'Room creation is temporarily unavailable. Try again later.',
      );

    const code = command.type === 'join' ? command.code : '';
    this.requireBroadcastCapacity(
      code,
      command.type === 'join' && this.roomAudienceSize(code) > 0 ? 1 : 0,
    );
    const context = this.context();
    const session =
      command.type === 'create'
        ? await this.retros.create(
            command.name,
            command.title,
            command.password,
            context,
          )
        : await this.retros.join(
            command.code,
            command.name,
            command.password,
            context,
          );
    const view = await this.view(session);
    const transport = await this.broadcast(
      session.code,
      undefined,
      undefined,
      true,
    );
    this.refreshMetrics();
    return { session, view, transport };
  }

  async inspectSession(
    code: string,
    token: string,
    source = 'unknown',
  ): Promise<RetroRememberedIdentity> {
    if (
      this.admission &&
      !this.admission.consumeHttpOperation(
        RETRO_APPLICATION_NAMESPACE,
        source,
        'inspect',
      )
    )
      throw new RetroError(
        'rate-limit',
        'Too many attempts. Wait a minute before trying again.',
      );
    return this.retros.inspectSession(code, token, this.context());
  }

  /** Rotate a cookie and invalidate any socket using its previous value. */
  async resumeSession(
    code: string,
    token: string,
    source = 'unknown',
  ): Promise<RetroSessionOperation> {
    if (
      this.admission &&
      !this.admission.consumeHttpOperation(
        RETRO_APPLICATION_NAMESPACE,
        source,
        'resume',
      )
    )
      throw new RetroError(
        'rate-limit',
        'Too many attempts. Wait a minute before trying again.',
      );
    this.requireBroadcastCapacity(code);
    const rotation = await this.retros.rotateSession(
      code,
      token,
      this.context(),
    );
    const replaced = rotation.previousConnection
      ? this.replaceIfLocal(rotation.previousConnection)
      : result();
    const view = await this.view(rotation.session);
    const transport = this.merge(
      replaced,
      await this.broadcast(code, undefined, undefined, true),
    );
    this.refreshMetrics();
    return { session: rotation.session, view, transport };
  }

  /** Revoke a cookie while retaining the member's notes and attribution. */
  async forgetSession(
    code: string,
    token: string,
    source = 'unknown',
  ): Promise<ApplicationResult> {
    if (
      this.admission &&
      !this.admission.consumeHttpOperation(
        RETRO_APPLICATION_NAMESPACE,
        source,
        'forget',
      )
    )
      throw new RetroError(
        'rate-limit',
        'Too many attempts. Wait a minute before trying again.',
      );
    this.requireBroadcastCapacity(code);
    const forgotten = await this.retros.forgetSession(
      code,
      token,
      this.context(),
    );
    const disconnected = forgotten.previousConnection
      ? this.forgetIfLocal(forgotten.previousConnection)
      : result();
    const broadcast = await this.broadcast(code, undefined, undefined, true);
    this.refreshMetrics();
    return this.merge(disconnected, broadcast);
  }

  async disconnect(connectionId: string): Promise<ApplicationResult> {
    const session = this.sessions.get(connectionId);
    const departed = session
      ? this.presence(connectionId, {
          x: 0,
          y: 0,
          noteId: null,
          active: false,
        })
      : result();
    this.sessions.delete(connectionId);
    this.admission?.release(connectionId);
    if (!session) return departed;
    this.connections.release(
      RETRO_APPLICATION_NAMESPACE,
      session.code,
      session.id,
      connectionId,
    );
    const broadcastAllowed = this.reserveBroadcast(session.code);
    await this.retros.disconnect(
      session,
      this.connection(connectionId),
      this.context(),
    );
    if (!broadcastAllowed) {
      this.refreshMetrics();
      return departed;
    }
    const disconnected = await this.broadcast(
      session.code,
      undefined,
      undefined,
      true,
    );
    this.refreshMetrics();
    return this.merge(departed, disconnected);
  }

  async expireRooms(): Promise<ApplicationResult> {
    const expiredCodes = new Set(await this.retros.sweep(this.context()));
    const messages: OutboundMessage[] = [];
    const closes: { connectionId: string; code: number; reason: string }[] = [];
    for (const [connectionId, session] of this.sessions) {
      if (!expiredCodes.has(session.code)) continue;
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
      effects = this.merge(
        effects,
        this.removeMember(
          change.code,
          memberId,
          change.kind === 'member-expired' ? 'Membership expired' : undefined,
        ),
      );
    }

    if (
      (change.kind === 'session-replaced' ||
        change.kind === 'session-forgotten') &&
      change.previousConnection &&
      change.memberId &&
      change.previousConnection.instanceId === this.instanceId
    ) {
      const local = this.connections.get<string>(
        RETRO_APPLICATION_NAMESPACE,
        change.code,
        change.memberId,
      );
      if (local === change.previousConnection.connectionId)
        effects = this.merge(
          effects,
          change.kind === 'session-forgotten'
            ? this.forget(local)
            : this.replace(local),
        );
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

  private async view(session: RetroSession): Promise<RetroSessionView> {
    return {
      room: await this.retros.snapshot(session, this.context()),
      self: { id: session.id },
    };
  }

  private async expireLocalRoom(code: string): Promise<ApplicationResult> {
    const messages: OutboundMessage[] = [];
    const closes: { connectionId: string; code: number; reason: string }[] = [];
    for (const [connectionId, session] of this.sessions) {
      if (session.code !== code) continue;
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
      closes.push({ connectionId, code: 4004, reason: 'Room expired' });
    }
    return result(undefined, messages, closes);
  }

  private removeMember(
    code: string,
    memberId: string,
    closeReason = 'Removed by moderator',
  ): ApplicationResult {
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
              closeReason === 'Membership expired'
                ? 'Your retrospective membership expired.'
                : 'A moderator removed you from this retrospective.',
            ),
          ),
        },
      ],
      [{ connectionId, code: 4003, reason: closeReason }],
    );
  }

  private replaceIfLocal(previous: RetroConnection): ApplicationResult {
    if (previous.instanceId !== this.instanceId) return result();
    return this.replace(previous.connectionId);
  }

  private forgetIfLocal(previous: RetroConnection): ApplicationResult {
    if (previous.instanceId !== this.instanceId) return result();
    return this.forget(previous.connectionId);
  }

  private forget(previousConnectionId: string): ApplicationResult {
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

  private async broadcast(
    code: string,
    requester?: string,
    requestId?: string,
    admissionReserved = false,
    targetConnectionId?: string,
  ): Promise<ApplicationResult> {
    if (!admissionReserved && !this.reserveBroadcast(code)) return result();
    const messages: OutboundMessage[] = [];
    const closes: { connectionId: string; code: number; reason: string }[] = [];
    const roomSessions = [...this.sessions].filter(
      ([connectionId, session]) =>
        session.code === code &&
        (!targetConnectionId || connectionId === targetConnectionId),
    );
    if (!roomSessions.length) return result();
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
    if (!recipients.length) return result();
    const projectionPromise = this.retros.prepareBroadcast(
      code,
      this.context(),
    );
    for (const [connectionId, session] of recipients) {
      try {
        const projection = await projectionPromise;
        // Public schema validation/projection happens once per committed version;
        // only the small private envelope is validated per authorized recipient.
        const data = {
          room: projection.room,
          self: { id: session.id },
          recipient: projection.recipient(session),
          version: projection.version,
          ...(connectionId === requester && requestId ? { requestId } : {}),
        };
        const event: RetroServerEvent = { event: 'retro-state', data };
        messages.push({
          connectionId,
          event,
          serialization: {
            type: 'retro-state',
            publicRoom: data.room,
            self: data.self,
            recipient: data.recipient,
            version: data.version,
            ...(data.requestId ? { requestId: data.requestId } : {}),
          },
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
            error,
            connectionId === requester ? requestId : undefined,
          ),
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
    this.metrics?.setGauge('retro.active_rooms', this.roomCount(), {
      namespace: RETRO_APPLICATION_NAMESPACE,
    });
    this.metrics?.setGauge('retro.active_sessions', this.sessions.size, {
      namespace: RETRO_APPLICATION_NAMESPACE,
    });
  }

  private roomCount(): number {
    return new Set([...this.sessions.values()].map((session) => session.code))
      .size;
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
