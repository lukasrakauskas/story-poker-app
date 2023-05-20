import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsResponse,
  MessageBody,
  ConnectedSocket,
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

// export interface ServerToClientEvents {
//   'room-created': (data: { code: string; users: User[] }) => void; | done
//   'room-joined': (data: { code: string; users: User[] }) => void; | done
//   'user-joined': (data: { user: User }) => void; | done
//   'results-revealed': (data: { value: string; count: number }[]) => void; | done
//   'voting-started': () => void | done
// }

// // Interface for when clients emit events to the server.
// export interface ClientToServerEvents {
//   'create-room': (data: { name: string }) => void;
//   'join-room': (data: { name: string; room: string }) => void;
//   'choose-vote': (data: { value: string }) => void;
//   'reveal-results': () => void;
//   'start-voting': () => void
// }

// type Client = WebSocket & { id?: string; roomId?: string };

interface Room<T = User> {
  code: string;
  users: User[];
  state: 'voting' | 'results';
}

type ClientUser = Omit<User, 'vote'> & { voted: boolean };

@WebSocketGateway(8080, {
  cors: { origin: '*' },
  clientTracking: true,
  WebSocket: Client,
})
export class EventsGateway {
  @WebSocketServer()
  server: Server<Client>;
  rooms: Map<string, Room> = new Map();
  clients: Client[] = [];

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
  ): WsResponse<null | (Room & { user: User })> {
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
        client.send(JSON.stringify({ event: 'user-joined', data: { user } }));
      }
    }

    room.users.push(user);

    return { event: 'room-joined', data: { ...room, user } };
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

    const data = room.users.reduce((it, current) => {
      if (current.vote == null) {
        return it;
      }

      return {
        ...it,
        [current.vote]: (it?.[current.vote] ?? 0) + 1,
      };
    });

    const userIds = room.users.map((it) => it.id);
    for (const client of this.server.clients) {
      if (userIds.includes(client.id) && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ event: 'results-revealed', data }));
      }
    }

    room.state = 'results';

    return { event: 'ok', data: null };
  }

  @SubscribeMessage('reveal-results')
  onStartVoting(
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

    if (user.role !== 'mod') {
      return { event: 'user-not-mod', data: null };
    }

    user.vote = data.vote;

    return { event: 'ok', data: null };
  }

  @SubscribeMessage('choose-vote')
  onChooseVote(@ConnectedSocket() client: Client) {
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

    const userIds = room.users.map((it) => it.id);
    for (const client of this.server.clients) {
      if (userIds.includes(client.id) && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ event: 'voting-started', data: null }));
      }
    }

    room.state = 'voting';

    return { event: 'ok', data: null };
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

  private mapRoomUsers<T>(room: Room, convert: (user: User) => T) {
    const users = room.users.map(convert);

    return {
      ...room,
      users,
    };
  }
}
