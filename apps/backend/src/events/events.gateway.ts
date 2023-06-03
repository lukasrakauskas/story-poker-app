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

type User = {
  id: string;
  name: string;
  vote: string | null;
  role: 'user' | 'mod';
};

interface Room {
  code: string;
  users: User[];
  state: 'voting' | 'results';
}

type ClientUser = Omit<User, 'vote'> & { voted: boolean; vote?: string | null };

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
          return client.terminate();
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
    @MessageBody() data: { name: string },
  ) {
    const user = this.createUser(client.id, data.name, 'mod');

    const room: Room = {
      code: nanoid(7),
      users: [user],
      state: 'voting',
    };

    this.rooms.set(room.code, room);

    client.roomId = room.code;

    const roomData = this.mapRoomUsers(room, this.hideUserVote);

    return {
      event: 'room-joined',
      data: { ...roomData, user: this.hideUserVote(user) },
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

    const user = this.createUser(client.id, data.name);
    client.roomId = room.code;

    const userIds = room.users.map((it) => it.id);

    for (const client of this.server.clients) {
      if (userIds.includes(client.id) && client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            event: 'user-joined',
            data: { user: this.hideUserVote(user) },
          }),
        );
      }
    }

    room.users.push(user);

    const roomData = this.mapRoomUsers(room, this.hideUserVote);

    return {
      event: 'room-joined',
      data: { ...roomData, user: this.hideUserVote(user) },
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

    room.users = room.users.filter((it) => it.id !== leftUser.id);

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
    };
  }

  private hideUserVote(user: User): ClientUser {
    const { vote, ...userData } = user;
    return {
      ...userData,
      voted: !!vote,
    };
  }

  private mapUser(user: User): ClientUser {
    const { vote, ...userData } = user;
    return {
      ...userData,
      voted: !!vote,
      vote,
    };
  }

  private mapRoomUsers<T>(room: Room, convert: (user: User) => T) {
    const users = room.users.map(convert);

    return {
      ...room,
      users,
    };
  }
}
