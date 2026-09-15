import { Optional, type OnModuleDestroy } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { WebSocket, type Server } from 'ws';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { RateLimitService } from '../transport/rate-limit.service.js';
import { WebSocketHeartbeatService } from '../transport/websocket-heartbeat.service.js';
import { WebSocketTransportService } from '../transport/websocket-transport.service.js';
import {
  ADMISSION_CLOSE_CODE,
  ADMISSION_CLOSE_REASON,
  sourceKeyFromUpgradeRequest,
  WebSocketAdmissionService,
} from '../transport/websocket-admission.service.js';
import { TransportMetricsService } from '../transport/transport-metrics.service.js';
import { verifyWebSocketClient } from '../transport/websocket-origin-policy.js';
import {
  RETRO_APPLICATION_NAMESPACE,
  RetroApplicationService,
} from './retro-application.service.js';
import { retroCommandSchema } from './retro.schema.js';
import { RetroError } from './retro.service.js';

@WebSocketGateway({
  path: '/retro',
  maxPayload: 16 * 1024,
  verifyClient: verifyWebSocketClient,
})
export class RetroGateway
  implements
    OnGatewayConnection<WebSocket>,
    OnGatewayDisconnect<WebSocket>,
    OnGatewayInit<Server>,
    OnModuleDestroy
{
  private readonly unsubscribeEvents: () => void;
  private readonly admission: WebSocketAdmissionService;

  constructor(
    private readonly application: RetroApplicationService,
    private readonly transport: WebSocketTransportService,
    private readonly heartbeat: WebSocketHeartbeatService,
    private readonly rateLimits: RateLimitService,
    events: ApplicationEventBus,
    @Optional() admission?: WebSocketAdmissionService,
    @Optional() metrics?: TransportMetricsService,
  ) {
    this.admission =
      admission ??
      new WebSocketAdmissionService(
        rateLimits,
        metrics ?? new TransportMetricsService(),
      );
    this.unsubscribeEvents = events.on(RETRO_APPLICATION_NAMESPACE, (event) =>
      this.transport.dispatch(event),
    );
  }

  afterInit(_server: Server) {
    this.heartbeat.start(RETRO_APPLICATION_NAMESPACE, {
      interval: 30_000,
      probe: { type: 'ping' },
      onTimeout: (socket) => this.handleDisconnect(socket),
      onTick: () => this.transport.dispatch(this.application.expireRooms()),
    });
  }

  onModuleDestroy() {
    this.unsubscribeEvents();
    this.heartbeat.stop(RETRO_APPLICATION_NAMESPACE);
    this.rateLimits.clear(RETRO_APPLICATION_NAMESPACE);
    this.admission.clear();
  }

  handleConnection(socket: WebSocket, request?: IncomingMessage) {
    this.ensureConnection(socket, request);
  }

  handleDisconnect(socket: WebSocket) {
    const connectionId = this.transport.id(socket);
    this.heartbeat.unregister(RETRO_APPLICATION_NAMESPACE, socket);
    if (connectionId) {
      this.rateLimits.release(RETRO_APPLICATION_NAMESPACE, connectionId);
      this.admission.release(connectionId);
      this.transport.dispatch(this.application.disconnect(connectionId));
    }
    this.transport.unregister(socket);
  }

  @SubscribeMessage('retro-command')
  onCommand(
    @ConnectedSocket() socket: WebSocket,
    @MessageBody() data: unknown,
  ) {
    const connectionId = this.ensureConnection(socket);
    if (!connectionId) return;
    const requestId =
      typeof data === 'object' &&
      data !== null &&
      'requestId' in data &&
      typeof data.requestId === 'string' &&
      data.requestId.length <= 64
        ? data.requestId
        : undefined;
    if (
      !this.rateLimits.consume(RETRO_APPLICATION_NAMESPACE, connectionId, {
        limit: 30,
        windowMs: 1000,
      })
    ) {
      return this.transport.dispatch(
        this.application.reject(
          connectionId,
          new RetroError(
            'rate-limit',
            'Too many changes. Wait a moment and try again.',
          ),
          requestId,
        ),
      );
    }
    const passwordAttempt = isPasswordAttempt(data);
    if (
      passwordAttempt &&
      !this.admission.consumeOperation(
        RETRO_APPLICATION_NAMESPACE,
        connectionId,
        'password',
      )
    ) {
      return this.transport.dispatch(
        this.application.reject(
          connectionId,
          new RetroError(
            'rate-limit',
            'Too many attempts. Wait a minute before trying again.',
          ),
          requestId,
        ),
      );
    }
    const command = retroCommandSchema.safeParse(data);
    if (!command.success) {
      return this.transport.dispatch(
        this.application.reject(
          connectionId,
          new RetroError(
            'invalid-command',
            'Check your input: name 3–30 characters, title 1–100, password up to 100, note/action 1–1000, owner up to 60.',
          ),
          requestId,
        ),
      );
    }
    const operation = entryOperation(command.data.type);
    if (
      operation &&
      !this.admission.consumeOperation(
        RETRO_APPLICATION_NAMESPACE,
        connectionId,
        operation,
      )
    ) {
      return this.transport.dispatch(
        this.application.reject(
          connectionId,
          new RetroError(
            'rate-limit',
            'Too many attempts. Wait a moment and try again.',
          ),
          requestId,
        ),
      );
    }
    const applicationResult = this.application.execute(
      connectionId,
      command.data,
      requestId,
    );
    if (operation && hasStateFor(applicationResult, connectionId))
      this.admission.authenticate(connectionId);
    return this.transport.dispatch(applicationResult);
  }

  private ensureConnection(
    socket: WebSocket,
    request?: IncomingMessage,
  ): string | undefined {
    const existing = this.transport.id(socket);
    if (existing) return existing;
    const connectionId = this.transport.register(socket);
    const decision = this.admission.open(
      connectionId,
      sourceKeyFromUpgradeRequest(request, socket),
      RETRO_APPLICATION_NAMESPACE,
    );
    if (!decision.allowed) {
      this.transport.unregister(socket);
      try {
        socket.close(ADMISSION_CLOSE_CODE, ADMISSION_CLOSE_REASON);
      } catch {
        socket.terminate();
      }
      return;
    }
    this.heartbeat.register(RETRO_APPLICATION_NAMESPACE, socket, true);
    return connectionId;
  }
}

function entryOperation(
  type: string,
): 'create' | 'join' | 'resume' | undefined {
  if (type === 'create' || type === 'join' || type === 'resume') return type;
  return;
}

// Keep this runtime check compatible with the protected-room command fields
// introduced by #84, while the current base still has no password field.
function isPasswordAttempt(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  if (!('type' in data) || (data.type !== 'create' && data.type !== 'join'))
    return false;
  return 'password' in data;
}

function hasStateFor(
  applicationResult: ReturnType<RetroApplicationService['execute']>,
  connectionId: string,
): boolean {
  return applicationResult.messages.some((message) => {
    if (message.connectionId !== connectionId) return false;
    const event = message.event;
    return (
      typeof event === 'object' &&
      event !== null &&
      'event' in event &&
      event.event === 'retro-state'
    );
  });
}
