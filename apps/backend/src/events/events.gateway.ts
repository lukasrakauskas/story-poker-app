import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
  OnGatewayDisconnect,
  OnGatewayInit,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { type OnModuleDestroy } from '@nestjs/common';
import { type Server, WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import { Client } from './client.entity.js';
import { ConfigService } from '@nestjs/config';
import { RoomService } from './room.service.js';
import { UserService } from './user.service.js';
import type { Room, User } from './events.types.js';

@WebSocketGateway({
  cors: { origin: '*' },
  clientTracking: true,
  WebSocket: Client,
})
export class EventsGateway
  implements
    OnGatewayConnection<Client>,
    OnGatewayDisconnect<Client>,
    OnGatewayInit<Server<typeof Client>>,
    OnModuleDestroy
{
  @WebSocketServer()
  server: Server<typeof Client>;
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(
    private readonly configService: ConfigService,
    private readonly rooms: RoomService,
    private readonly users: UserService,
  ) {}

  afterInit(server: Server<typeof Client>) {
    this.onModuleDestroy();
    this.heartbeat = setInterval(() => {
      for (const client of server.clients) {
        if (client.isAlive === false) {
          client.terminate();
          this.handleDisconnect(client);
          continue;
        }
        client.isAlive = false;
        client.send(JSON.stringify({ event: 'is-alive' }));
      }
    }, 7000);
  }

  onModuleDestroy() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  handleConnection(client: Client) {
    // Bun's ws implementation may not construct the configured Client subclass.
    client.id ??= nanoid();
    client.isAlive = true;
    client.send(JSON.stringify({ event: 'is-alive' }));
  }

  @SubscribeMessage('keep-alive')
  onKeepAlive(@ConnectedSocket() client: Client) {
    client.isAlive = true;
  }

  @SubscribeMessage('create-room')
  onCreateRoom(
    @ConnectedSocket() client: Client,
    @MessageBody() data: { name: string; cardSet?: string[] },
  ) {
    const result = this.rooms.create(client.id, data.name, data.cardSet);
    if ('error' in result) return result.error;
    client.roomId = result.room.code;
    return this.roomJoined(result.room, result.user);
  }

  @SubscribeMessage('join-room')
  onJoinRoom(
    @ConnectedSocket() client: Client,
    @MessageBody() data: { name: string; room: string },
  ) {
    // Capture existing recipients: the joining user receives room-joined instead.
    const recipients =
      this.rooms.get(data.room)?.users.map((user) => user.id) ?? [];
    const result = this.rooms.join(data.room, client.id, data.name);
    if ('error' in result) return result.error;
    client.roomId = result.room.code;
    this.notifyUsers(recipients, {
      event: 'user-joined',
      data: { user: this.users.toPublic(result.user) },
    });
    return this.roomJoined(result.room, result.user);
  }

  @SubscribeMessage('reconnect')
  onReconnect(
    @ConnectedSocket() client: Client,
    @MessageBody() data: { token: string },
  ) {
    const result = this.rooms.reconnect(data.token);
    if ('error' in result) return result.error;
    const { room, user } = result;
    client.roomId = room.code;
    client.id = user.id;
    this.notifyRoom(room, {
      event: 'user-joined',
      data: { user: this.users.toPublic(user) },
    });
    return this.roomJoined(room, user);
  }

  handleDisconnect(client: Client) {
    const membership = this.rooms.disconnect(client.roomId ?? '', client.id);
    if (!membership) return;
    this.notifyRoom(membership.room, {
      event: 'user-left',
      data: { user: this.users.toPublic(membership.user) },
    });
  }

  @SubscribeMessage('reveal-results')
  onRevealResults(@ConnectedSocket() client: Client) {
    const result = this.rooms.revealResults(client.roomId ?? '', client.id);
    if ('error' in result) return result.error;
    this.notifyRoom(result.room, {
      event: 'results-revealed',
      data: { results: result.results, users: result.users },
    });
  }

  @SubscribeMessage('cast-vote')
  onCastVote(
    @ConnectedSocket() client: Client,
    @MessageBody() data: { vote: string },
  ) {
    const result = this.rooms.castVote(
      client.roomId ?? '',
      client.id,
      data.vote,
    );
    if ('error' in result) return result.error;
    this.notifyRoom(result.room, {
      event: 'user-voted',
      data: { user: this.users.toPublic(result.user) },
    });
  }

  @SubscribeMessage('start-voting')
  onStartVoting(@ConnectedSocket() client: Client) {
    const result = this.rooms.startVoting(client.roomId ?? '', client.id);
    if ('error' in result) return result.error;
    this.notifyRoom(result.room, { event: 'voting-started', data: null });
  }

  @SubscribeMessage('broadcast-message')
  onBroadcastMessage(
    @MessageBody() data: { roomId: string; message: string; password: string },
  ) {
    const password = this.configService.get('PASSWORD');
    if (!password) return { event: 'message-broadcasted', data: null };
    if (password !== data.password)
      return { event: 'wrong-password', data: null };
    const room = this.rooms.get(data.roomId);
    if (!room) return { event: 'room-not-found', data: null };
    this.notifyRoom(room, {
      event: 'broadcasted-message',
      data: { message: data.message },
    });
    return { event: 'message-broadcasted', data: null };
  }

  private roomJoined(room: Room, user: User) {
    return { event: 'room-joined', data: this.rooms.toJoinedRoom(room, user) };
  }

  private notifyRoom(room: Room, message: { event: string; data: unknown }) {
    this.notifyUsers(
      room.users.map((user) => user.id),
      message,
    );
  }

  private notifyUsers(
    userIds: string[],
    message: { event: string; data: unknown },
  ) {
    const recipients = new Set(userIds);
    const payload = JSON.stringify(message);
    for (const client of this.server.clients) {
      if (recipients.has(client.id) && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}
