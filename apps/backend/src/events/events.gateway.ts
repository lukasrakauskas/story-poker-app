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
import { Server, WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import { Client } from './client.entity';
import { omit } from 'radash';
import { z } from 'zod';

const usernameSchema = z
  .string()
  .min(3, 'It must be at least 3 characters')
  .max(30, 'That is a long username, might want to trim that!');

const DEFAULT_CARD_SET = [
  '0',
  '1/2',
  '1',
  '2',
  '3',
  '5',
  '8',
  '13',
  '20',
  '40',
  '100',
  '?',
];

type User = {
  id: string;
  name: string;
  vote: string | null;
  role: 'user' | 'mod';
  token: string;
  status: 'connected' | 'disconnected';
};

interface Room {
  code: string;
  users: User[];
  state: 'voting' | 'results';
  cardSet: string[];
}

type ClientUser = Omit<User, 'vote' | 'token'> & {
  voted: boolean;
  vote?: string | null;
};

@WebSocketGateway({
  cors: { origin: '*' },
  clientTracking: true,
  WebSocket: Client,
})
export class EventsGateway
  implements
    OnGatewayConnection<Client>,
    OnGatewayDisconnect<Client>,
    OnGatewayInit<Server<Client>>
{
  @WebSocketServer()
  server: Server<Client>;
  rooms: Map<string, Room> = new Map();

  afterInit(server: Server<Client>) {
    setInterval(() => {
      for (const client of server.clients) {
        if (client.isAlive === false) {
          client.terminate();
          this.handleDisconnect(client);
          return;
        }

        client.isAlive = false;
        client.send(JSON.stringify({ event: 'is-alive' }));
      }
    }, 7000);
  }

  handleConnection(client: Client) {
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
    const parsedUsername = usernameSchema.safeParse(data.name);

    const customCardSet = data?.cardSet ?? [];
    const cardSet = customCardSet.length > 0 ? customCardSet : DEFAULT_CARD_SET;

    if (!parsedUsername.success) {
      return {
        event: 'bad-username',
        data: { error: parsedUsername.error.format()._errors.join(', ') },
      };
    }

    const user = this.createUser(client.id, data.name, 'mod');

    const room: Room = {
      code: nanoid(7),
      users: [user],
      state: 'voting',
      cardSet,
    };

    this.rooms.set(room.code, room);

    client.roomId = room.code;

    const roomData = this.mapRoomUsers(room, this.hideUserVote);

    return {
      event: 'room-joined',
      data: { ...roomData, user: { ...user, voted: !!user.vote } },
    };
  }

  @SubscribeMessage('join-room')
  onJoinRoom(
    @ConnectedSocket() client: Client,
    @MessageBody() data: { name: string; room: string },
  ) {
    const room = this.rooms.get(data.room);

    if (!room) {
      return { event: 'room-not-found', data: null };
    }

    if (room.users.find((it) => it.name === data.name)) {
      return { event: 'name-taken', data: null };
    }

    const parsedUsername = usernameSchema.safeParse(data.name);

    if (!parsedUsername.success) {
      return {
        event: 'bad-username',
        data: { error: parsedUsername.error.format()._errors.join(', ') },
      };
    }

    const user = this.createUser(client.id, data.name);
    client.roomId = room.code;

    this.notifyRoom(room, {
      event: 'user-joined',
      data: { user: this.hideUserVote(user) },
    });

    room.users.push(user);

    const roomData = this.mapRoomUsers(room, this.hideUserVote);

    return {
      event: 'room-joined',
      data: { ...roomData, user: { ...user, voted: !!user.vote } },
    };
  }

  @SubscribeMessage('reconnect')
  onReconnect(
    @ConnectedSocket() client: Client,
    @MessageBody() data: { token: string },
  ) {
    const { room, user } = this.findRoomAndUserByToken(data.token);

    if (!room) {
      return { event: 'room-not-found', data: null };
    }

    if (!user) {
      return { event: 'user-not-found', data: null };
    }

    client.roomId = room.code;
    client.id = user.id;
    user.status = 'connected';

    this.notifyRoom(room, {
      event: 'user-joined',
      data: { user: this.hideUserVote(user) },
    });

    room.users = room.users.map((it) =>
      it.id === user.id ? { ...it, status: 'connected' } : it,
    );
    const roomData = this.mapRoomUsers(room, this.hideUserVote);

    return {
      event: 'room-joined',
      data: { ...roomData, user: { ...user, voted: !!user.vote } },
    };
  }

  handleDisconnect(leftUser: Client) {
    if (!leftUser.roomId) {
      return;
    }

    const room = this.rooms.get(leftUser.roomId);

    if (!room) {
      return;
    }

    const user = room.users.find((it) => it.id === leftUser.id);

    if (!user) {
      return;
    }

    user.status = 'disconnected';

    room.users = room.users.map((it) =>
      it.id === leftUser.id ? { ...it, status: 'disconnected' } : it,
    );

    this.notifyRoom(room, {
      event: 'user-left',
      data: { user: this.hideUserVote(user) },
    });
  }

  @SubscribeMessage('reveal-results')
  onRevealResults(@ConnectedSocket() client: Client) {
    const room = this.rooms.get(client.roomId ?? '');

    if (!room) {
      return { event: 'room-not-found', data: null };
    }

    const user = room.users.find((it) => it.id === client.id);

    if (!user) {
      return { event: 'user-not-found', data: null };
    }

    if (user.role !== 'mod') {
      return { event: 'user-not-mod', data: null };
    }

    const results = room.users.reduce((it, current) => {
      if (current.vote == null) {
        return it;
      }

      return {
        ...it,
        [current.vote]: (it?.[current.vote] ?? 0) + 1,
      };
    }, {});

    const users = room.users.map(this.mapUser);

    room.users = room.users.map((it) => ({ ...it, vote: null }));
    room.state = 'results';
    this.notifyRoom(room, {
      event: 'results-revealed',
      data: { results, users },
    });
  }

  @SubscribeMessage('cast-vote')
  onCastVote(
    @ConnectedSocket() client: Client,
    @MessageBody() data: { vote: string },
  ) {
    const room = this.rooms.get(client.roomId ?? '');

    if (!room) {
      return { event: 'room-not-found', data: null };
    }

    const user = room.users.find((it) => it.id === client.id);

    if (!user) {
      return { event: 'user-not-found', data: null };
    }

    user.vote = data.vote;

    this.notifyRoom(room, {
      event: 'user-voted',
      data: { user: this.hideUserVote(user) },
    });
  }

  @SubscribeMessage('start-voting')
  onStartVoting(@ConnectedSocket() client: Client) {
    const room = this.rooms.get(client.roomId ?? '');

    if (!room) {
      return { event: 'room-not-found', data: null };
    }

    const user = room.users.find((it) => it.id === client.id);

    if (!user) {
      return { event: 'user-not-found', data: null };
    }

    for (const participant of room.users) {
      participant.vote = null;
    }

    room.state = 'voting';
    this.notifyRoom(room, { event: 'voting-started', data: null });
  }

  private notifyRoom(room: Room, message: { event: string; data: unknown }) {
    const userIds = room.users.map((it) => it.id);
    for (const client of this.server.clients) {
      if (userIds.includes(client.id) && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    }
  }

  private createUser(id: string, name: string, role?: 'user' | 'mod'): User {
    return {
      id,
      name,
      vote: null,
      role: role ?? 'user',
      token: nanoid(32),
      status: 'connected',
    };
  }

  private hideUserVote(user: User): ClientUser {
    return {
      ...omit(user, ['token', 'vote']),
      voted: !!user.vote,
    };
  }

  private mapUser(user: User): ClientUser {
    return {
      ...omit(user, ['token']),
      voted: !!user.vote,
    };
  }

  private mapRoomUsers<T>(room: Room, convert: (user: User) => T) {
    const users = room.users.map(convert);

    return {
      ...room,
      users,
    };
  }

  private findRoomAndUserByToken(token: string) {
    for (const room of this.rooms.values()) {
      for (const user of room.users) {
        if (user.token === token) {
          return { room, user };
        }
      }
    }

    return { room: null, user: null };
  }
}
