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
import { type ZodType } from 'zod';
import { nanoid } from 'nanoid';
import { Client } from './client.entity.js';
import { ConfigService } from '@nestjs/config';
import { RoomService } from './room.service.js';
import { UserService } from './user.service.js';
import type { Room, User } from './events.types.js';
import {
  INVALID_COMMAND_ERROR,
  planningCommandSchemas,
} from './events.schema.js';

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
  private readonly unsubscribeUserExpired: () => void;

  constructor(
    private readonly configService: ConfigService,
    private readonly rooms: RoomService,
    private readonly users: UserService,
  ) {
    this.unsubscribeUserExpired = this.rooms.onUserExpired((room, user) => {
      this.notifyRoom(room, {
        event: 'user-removed',
        data: { userId: user.id },
      });
    });
  }

  afterInit(server: Server<typeof Client>) {
    this.stopHeartbeat();
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
    this.stopHeartbeat();
    this.unsubscribeUserExpired();
  }

  handleConnection(client: Client) {
    // Bun's ws implementation may not construct the configured Client subclass.
    client.id ??= nanoid();
    client.isAlive = true;
    client.send(JSON.stringify({ event: 'is-alive' }));
  }

  @SubscribeMessage('keep-alive')
  onKeepAlive(
    @ConnectedSocket() client: Client,
    @MessageBody() data?: unknown,
  ) {
    return this.withCommand(planningCommandSchemas['keep-alive'], data, () => {
      client.isAlive = true;
    });
  }

  @SubscribeMessage('inspect-room')
  onInspectRoom(@MessageBody() data: unknown) {
    return this.withCommand(
      planningCommandSchemas['inspect-room'],
      data,
      (command) => {
        const room = this.rooms.get(command.room);
        return {
          event: 'room-info',
          data: {
            code: command.room,
            available: room !== undefined,
            requiresPassword: room ? room.password !== null : false,
          },
        };
      },
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
      (command) => {
        const result = this.rooms.create(
          client.id,
          command.name,
          command.cardSet,
          command.password,
        );
        if ('error' in result) return result.error;
        client.roomId = result.room.code;
        return this.roomJoined(result.room, result.user);
      },
    );
  }

  @SubscribeMessage('join-room')
  onJoinRoom(@ConnectedSocket() client: Client, @MessageBody() data: unknown) {
    return this.withCommand(
      planningCommandSchemas['join-room'],
      data,
      (command) => {
        // Capture existing recipients: the joining user receives room-joined instead.
        const recipients =
          this.rooms.get(command.room)?.users.map((user) => user.id) ?? [];
        const result = this.rooms.join(
          command.room,
          client.id,
          command.name,
          command.password,
        );
        if ('error' in result) return result.error;
        client.roomId = result.room.code;
        this.notifyUsers(recipients, {
          event: 'user-joined',
          data: {
            user: this.users.toPublic(
              result.user,
              result.room.state === 'results',
            ),
          },
        });
        return this.roomJoined(result.room, result.user);
      },
    );
  }

  @SubscribeMessage('reconnect')
  onReconnect(@ConnectedSocket() client: Client, @MessageBody() data: unknown) {
    return this.withCommand(
      planningCommandSchemas.reconnect,
      data,
      (command) => {
        const result = this.rooms.reconnect(command.token, command.room);
        if ('error' in result) return result.error;
        const { room, user } = result;
        this.replaceConnection(client, user.id);
        client.roomId = room.code;
        client.id = user.id;
        this.notifyRoom(room, {
          event: 'user-joined',
          data: { user: this.users.toPublic(user, room.state === 'results') },
        });
        return this.roomJoined(room, user);
      },
    );
  }

  handleDisconnect(client: Client) {
    const membership = this.rooms.disconnect(client.roomId ?? '', client.id);
    if (!membership) return;
    this.notifyRoom(membership.room, {
      event: 'user-left',
      data: {
        user: this.users.toPublic(
          membership.user,
          membership.room.state === 'results',
        ),
      },
    });
  }

  @SubscribeMessage('reveal-results')
  onRevealResults(
    @ConnectedSocket() client: Client,
    @MessageBody() data?: unknown,
  ) {
    return this.withCommand(
      planningCommandSchemas['reveal-results'],
      data,
      () => {
        const result = this.rooms.revealResults(client.roomId ?? '', client.id);
        if ('error' in result) return result.error;
        this.notifyRoom(result.room, {
          event: 'results-revealed',
          data: { results: result.results, users: result.users },
        });
      },
    );
  }

  @SubscribeMessage('cast-vote')
  onCastVote(@ConnectedSocket() client: Client, @MessageBody() data: unknown) {
    return this.withCommand(
      planningCommandSchemas['cast-vote'],
      data,
      (command) => {
        const result = this.rooms.castVote(
          client.roomId ?? '',
          client.id,
          command.vote,
        );
        if ('error' in result) return result.error;
        this.notifyRoom(result.room, {
          event: 'user-voted',
          data: { user: this.users.toPublic(result.user) },
        });
      },
    );
  }

  @SubscribeMessage('start-voting')
  onStartVoting(
    @ConnectedSocket() client: Client,
    @MessageBody() data?: unknown,
  ) {
    return this.withCommand(
      planningCommandSchemas['start-voting'],
      data,
      () => {
        const result = this.rooms.startVoting(client.roomId ?? '', client.id);
        if ('error' in result) return result.error;
        this.notifyRoom(result.room, { event: 'voting-started', data: null });
      },
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
      () => {
        const result = this.rooms.claimModerator(
          client.roomId ?? '',
          client.id,
        );
        if ('error' in result) return result.error;
        this.notifyRoom(result.room, {
          event: 'user-updated',
          data: {
            user: this.users.toPublic(
              result.user,
              result.room.state === 'results',
            ),
          },
        });
      },
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
      (command) => {
        const result = this.rooms.promoteUser(
          client.roomId ?? '',
          client.id,
          command.userId,
        );
        if ('error' in result) return result.error;
        this.notifyRoom(result.room, {
          event: 'user-updated',
          data: {
            user: this.users.toPublic(
              result.user,
              result.room.state === 'results',
            ),
          },
        });
      },
    );
  }

  @SubscribeMessage('kick-user')
  onKickUser(@ConnectedSocket() client: Client, @MessageBody() data: unknown) {
    return this.withCommand(
      planningCommandSchemas['kick-user'],
      data,
      (command) => {
        const result = this.rooms.kickUser(
          client.roomId ?? '',
          client.id,
          command.userId,
        );
        if ('error' in result) return result.error;

        this.notifyUsers([result.user.id], { event: 'kicked', data: null });
        for (const target of this.server.clients) {
          if (target.id === result.user.id) {
            target.roomId = '';
            target.id = nanoid();
            target.close(4001, 'Removed from room');
          }
        }
        this.notifyRoom(result.room, {
          event: 'user-removed',
          data: { userId: result.user.id },
        });
      },
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
      (command) => {
        const result = this.rooms.changeAvatar(
          client.roomId ?? '',
          client.id,
          command.avatar,
        );
        if ('error' in result) return result.error;
        this.notifyRoom(result.room, {
          event: 'user-updated',
          data: {
            user: this.users.toPublic(
              result.user,
              result.room.state === 'results',
            ),
          },
        });
      },
    );
  }

  @SubscribeMessage('broadcast-message')
  onBroadcastMessage(@MessageBody() data: unknown) {
    return this.withCommand(
      planningCommandSchemas['broadcast-message'],
      data,
      (command) => {
        const password = this.configService.get('PASSWORD');
        if (!password) return { event: 'message-broadcasted', data: null };
        if (password !== command.password)
          return { event: 'wrong-password', data: null };
        const room = this.rooms.get(command.roomId);
        if (!room) return { event: 'room-not-found', data: null };
        this.notifyRoom(room, {
          event: 'broadcasted-message',
          data: { message: command.message },
        });
        return { event: 'message-broadcasted', data: null };
      },
    );
  }

  private withCommand<T, Result>(
    schema: ZodType<T>,
    data: unknown,
    handle: (command: T) => Result,
  ): Result | typeof INVALID_COMMAND_ERROR {
    const command = schema.safeParse(data);
    return command.success ? handle(command.data) : INVALID_COMMAND_ERROR;
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private replaceConnection(client: Client, userId: string) {
    for (const existing of this.server.clients) {
      if (existing !== client && existing.id === userId) {
        existing.roomId = '';
        existing.id = nanoid();
        existing.close(4000, 'Reconnected elsewhere');
      }
    }
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
