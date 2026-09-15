import { type OnModuleDestroy } from '@nestjs/common';
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
import { OriginAllowlistService } from '../transport/origin-allowlist.service.js';
import { RateLimitService } from '../transport/rate-limit.service.js';
import { WebSocketHeartbeatService } from '../transport/websocket-heartbeat.service.js';
import { WebSocketTransportService } from '../transport/websocket-transport.service.js';
import {
  RETRO_APPLICATION_NAMESPACE,
  RetroApplicationService,
} from './retro-application.service.js';
import { retroCommandSchema } from './retro.schema.js';
import { RetroError } from './retro.service.js';
import { RetroSessionCookieService } from './retro-session-cookie.service.js';

@WebSocketGateway({ path: '/retro', maxPayload: 16 * 1024 })
export class RetroGateway
  implements
    OnGatewayConnection<WebSocket>,
    OnGatewayDisconnect<WebSocket>,
    OnGatewayInit<Server>,
    OnModuleDestroy
{
  private readonly unsubscribeEvents: () => void;
  private readonly cookieHeaders = new WeakMap<WebSocket, string | undefined>();

  constructor(
    private readonly application: RetroApplicationService,
    private readonly transport: WebSocketTransportService,
    private readonly heartbeat: WebSocketHeartbeatService,
    private readonly rateLimits: RateLimitService,
    private readonly origins: OriginAllowlistService,
    private readonly cookies: RetroSessionCookieService,
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

  handleConnection(socket: WebSocket, request?: IncomingMessage) {
    const origin =
      typeof request?.headers.origin === 'string'
        ? request.headers.origin
        : undefined;
    if (!this.origins.isAllowed(origin)) {
      socket.close(1008, 'Origin not allowed');
      return;
    }
    this.cookieHeaders.set(socket, request?.headers.cookie);
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
    const command = retroCommandSchema.safeParse(data);
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
    const credential =
      command.data.type === 'resume'
        ? (this.cookies.readHeader(
            this.cookieHeaders.get(socket),
            command.data.code,
          ) ?? undefined)
        : undefined;
    return this.transport.dispatch(
      this.application.execute(
        connectionId,
        command.data,
        requestId,
        credential,
      ),
    );
  }
}
