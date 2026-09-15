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
import { nanoid } from 'nanoid';
import { type Server } from 'ws';
import { type ZodType } from 'zod';
import { Client } from '../events/client.entity.js';
import {
  INVALID_COMMAND_ERROR,
  planningCommandSchemas,
} from '../events/events.schema.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { WebSocketHeartbeatService } from '../transport/websocket-heartbeat.service.js';
import { WebSocketTransportService } from '../transport/websocket-transport.service.js';
import { verifyWebSocketClient } from '../transport/websocket-origin-policy.js';
import {
  POKER_APPLICATION_NAMESPACE,
  PokerApplicationService,
} from './poker-application.service.js';

@WebSocketGateway({
  cors: { origin: '*' },
  verifyClient: verifyWebSocketClient,
  clientTracking: true,
  WebSocket: Client,
})
export class PokerGateway
  implements
    OnGatewayConnection<Client>,
    OnGatewayDisconnect<Client>,
    OnGatewayInit<Server<typeof Client>>,
    OnModuleDestroy
{
  private readonly unsubscribeEvents: () => void;

  constructor(
    private readonly application: PokerApplicationService,
    private readonly transport: WebSocketTransportService,
    private readonly heartbeat: WebSocketHeartbeatService,
    events: ApplicationEventBus,
  ) {
    this.unsubscribeEvents = events.on(POKER_APPLICATION_NAMESPACE, (event) =>
      this.transport.dispatch(event),
    );
  }

  afterInit(_server: Server<typeof Client>) {
    this.heartbeat.start(POKER_APPLICATION_NAMESPACE, {
      interval: 7000,
      probe: { type: 'message', event: { event: 'is-alive' } },
      onTimeout: (client) => this.handleDisconnect(client as Client),
    });
  }

  onModuleDestroy() {
    this.heartbeat.stop(POKER_APPLICATION_NAMESPACE);
    this.unsubscribeEvents();
  }

  handleConnection(client: Client) {
    client.id ??= nanoid();
    this.transport.register(client, client.id);
    this.heartbeat.register(POKER_APPLICATION_NAMESPACE, client);
    this.transport.send(client.id, { event: 'is-alive' });
  }

  handleDisconnect(client: Client) {
    const connectionId = this.connectionId(client);
    this.heartbeat.unregister(POKER_APPLICATION_NAMESPACE, client);
    this.transport.dispatch(this.application.disconnect(connectionId));
    this.transport.unregister(client);
  }

  @SubscribeMessage('keep-alive')
  onKeepAlive(
    @ConnectedSocket() client: Client,
    @MessageBody() data?: unknown,
  ) {
    return this.withCommand(planningCommandSchemas['keep-alive'], data, () => {
      this.heartbeat.markAlive(POKER_APPLICATION_NAMESPACE, client);
    });
  }

  @SubscribeMessage('inspect-room')
  onInspectRoom(@MessageBody() data: unknown) {
    return this.withCommand(
      planningCommandSchemas['inspect-room'],
      data,
      (command) => this.transport.dispatch(this.application.inspect(command)),
    );
  }

  @SubscribeMessage('create-room')
  onCreateRoom(
    @ConnectedSocket() client: Client,
    @MessageBody() data: unknown,
  ) {
    return this.withCommand(
      planningCommandSchemas['create-room'],
      data,
      (command) =>
        this.transport.dispatch(
          this.application.create(this.connectionId(client), command),
        ),
    );
  }

  @SubscribeMessage('join-room')
  onJoinRoom(@ConnectedSocket() client: Client, @MessageBody() data: unknown) {
    return this.withCommand(
      planningCommandSchemas['join-room'],
      data,
      (command) =>
        this.transport.dispatch(
          this.application.join(this.connectionId(client), command),
        ),
    );
  }

  @SubscribeMessage('reconnect')
  onReconnect(@ConnectedSocket() client: Client, @MessageBody() data: unknown) {
    return this.withCommand(planningCommandSchemas.reconnect, data, (command) =>
      this.transport.dispatch(
        this.application.reconnect(this.connectionId(client), command),
      ),
    );
  }

  @SubscribeMessage('reveal-results')
  onRevealResults(
    @ConnectedSocket() client: Client,
    @MessageBody() data?: unknown,
  ) {
    return this.withCommand(
      planningCommandSchemas['reveal-results'],
      data,
      () =>
        this.transport.dispatch(
          this.application.reveal(this.connectionId(client)),
        ),
    );
  }

  @SubscribeMessage('cast-vote')
  onCastVote(@ConnectedSocket() client: Client, @MessageBody() data: unknown) {
    return this.withCommand(
      planningCommandSchemas['cast-vote'],
      data,
      (command) =>
        this.transport.dispatch(
          this.application.castVote(this.connectionId(client), command),
        ),
    );
  }

  @SubscribeMessage('start-voting')
  onStartVoting(
    @ConnectedSocket() client: Client,
    @MessageBody() data?: unknown,
  ) {
    return this.withCommand(planningCommandSchemas['start-voting'], data, () =>
      this.transport.dispatch(
        this.application.startVoting(this.connectionId(client)),
      ),
    );
  }

  @SubscribeMessage('claim-moderator')
  onClaimModerator(
    @ConnectedSocket() client: Client,
    @MessageBody() data?: unknown,
  ) {
    return this.withCommand(
      planningCommandSchemas['claim-moderator'],
      data,
      () =>
        this.transport.dispatch(
          this.application.claimModerator(this.connectionId(client)),
        ),
    );
  }

  @SubscribeMessage('promote-user')
  onPromoteUser(
    @ConnectedSocket() client: Client,
    @MessageBody() data: unknown,
  ) {
    return this.withCommand(
      planningCommandSchemas['promote-user'],
      data,
      (command) =>
        this.transport.dispatch(
          this.application.promote(this.connectionId(client), command),
        ),
    );
  }

  @SubscribeMessage('kick-user')
  onKickUser(@ConnectedSocket() client: Client, @MessageBody() data: unknown) {
    return this.withCommand(
      planningCommandSchemas['kick-user'],
      data,
      (command) =>
        this.transport.dispatch(
          this.application.kick(this.connectionId(client), command),
        ),
    );
  }

  @SubscribeMessage('change-avatar')
  onChangeAvatar(
    @ConnectedSocket() client: Client,
    @MessageBody() data: unknown,
  ) {
    return this.withCommand(
      planningCommandSchemas['change-avatar'],
      data,
      (command) =>
        this.transport.dispatch(
          this.application.changeAvatar(this.connectionId(client), command),
        ),
    );
  }

  @SubscribeMessage('broadcast-message')
  onBroadcastMessage(@MessageBody() data: unknown) {
    return this.withCommand(
      planningCommandSchemas['broadcast-message'],
      data,
      (command) => this.transport.dispatch(this.application.broadcast(command)),
    );
  }

  private connectionId(client: Client) {
    const existing = this.transport.id(client);
    if (existing) return existing;
    const connectionId = this.transport.register(client, client.id);
    this.heartbeat.register(POKER_APPLICATION_NAMESPACE, client);
    return connectionId;
  }

  private withCommand<T, Response>(
    schema: ZodType<T>,
    data: unknown,
    handle: (command: T) => Response,
  ): Response | typeof INVALID_COMMAND_ERROR {
    const command = schema.safeParse(data);
    return command.success ? handle(command.data) : INVALID_COMMAND_ERROR;
  }
}
