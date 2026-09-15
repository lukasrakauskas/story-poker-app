import { type OnModuleDestroy } from '@nestjs/common';
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
  RETRO_APPLICATION_NAMESPACE,
  RetroApplicationService,
} from './retro-application.service.js';
import { retroCommandMessageSchema } from './retro.schema.js';
import { RetroError } from './retro.service.js';

@WebSocketGateway({ path: '/retro', maxPayload: 16 * 1024 })
export class RetroGateway
  implements
    OnGatewayConnection<WebSocket>,
    OnGatewayDisconnect<WebSocket>,
    OnGatewayInit<Server>,
    OnModuleDestroy
{
  private readonly unsubscribeEvents: () => void;

  constructor(
    private readonly application: RetroApplicationService,
    private readonly transport: WebSocketTransportService,
    private readonly heartbeat: WebSocketHeartbeatService,
    private readonly rateLimits: RateLimitService,
    events: ApplicationEventBus,
  ) {
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
  }

  handleConnection(socket: WebSocket) {
    this.transport.register(socket);
    this.heartbeat.register(RETRO_APPLICATION_NAMESPACE, socket, true);
  }

  handleDisconnect(socket: WebSocket) {
    const connectionId = this.transport.id(socket);
    this.heartbeat.unregister(RETRO_APPLICATION_NAMESPACE, socket);
    if (connectionId) {
      this.rateLimits.release(RETRO_APPLICATION_NAMESPACE, connectionId);
      this.transport.dispatch(this.application.disconnect(connectionId));
    }
    this.transport.unregister(socket);
  }

  @SubscribeMessage('retro-command')
  onCommand(
    @ConnectedSocket() socket: WebSocket,
    @MessageBody() data: unknown,
  ) {
    const connectionId =
      this.transport.id(socket) ?? this.transport.register(socket);
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
    const command = retroCommandMessageSchema.safeParse(data);
    if (!command.success) {
      return this.transport.dispatch(
        this.application.reject(
          connectionId,
          new RetroError(
            'invalid-command',
            'Check your input: name 3–30 characters, title 1–100, note/action 1–1000, owner up to 60.',
          ),
          requestId,
        ),
      );
    }
    const { requestId: parsedRequestId, ...commandData } = command.data;
    return this.transport.dispatch(
      this.application.execute(
        connectionId,
        commandData,
        parsedRequestId ?? requestId,
      ),
    );
  }
}
