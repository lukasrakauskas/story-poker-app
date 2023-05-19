import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsResponse,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { nanoid } from 'nanoid';

type User = {
  id: string;
  name: string;
  voted: boolean;
};

// export interface ServerToClientEvents {
//   'room-created': (data: { code: string; users: User[] }) => void;
//   'room-joined': (data: { code: string; users: User[] }) => void;
//   'user-joined': (data: { user: User }) => void;
//   'results-revealed': (data: { value: string; count: number }[]) => void;
//   'voting-started': () => void
// }

// // Interface for when clients emit events to the server.
// export interface ClientToServerEvents {
//   'create-room': (data: { name: string }) => void;
//   'join-room': (data: { name: string; room: string }) => void;
//   'choose-vote': (data: { value: string }) => void;
//   'reveal-results': () => void;
//   'start-voting': () => void
// }

type Client = WebSocket & { id?: string };

interface Room {
  code: string;
  users: User[];
  state: 'voting' | 'results';
}

@WebSocketGateway(8080, { cors: { origin: '*' }, clientTracking: true })
export class EventsGateway implements OnGatewayConnection<Client> {
  @WebSocketServer()
  server: Server<Client>;
  rooms: Map<string, Room> = new Map();
  clients: Client[] = [];

  handleConnection(client: Client) {
    client.id = nanoid();
  }

  @SubscribeMessage('create-room')
  onCreateRoom(
    @ConnectedSocket() client: Client,
    @MessageBody() data: { name: string },
  ): WsResponse<Room> {
    const user = this.createUser(client.id, data.name);

    const room: Room = {
      code: nanoid(7),
      users: [user],
      state: 'voting',
    };

    this.rooms.set(room.code, room);

    return { event: 'room-joined', data: room };
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

    const userIds = room.users.map((it) => it.id);

    for (const client of this.server.clients) {
      if (userIds.includes(client.id) && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ event: 'user-joined', data: { user } }));
      }
    }

    room.users.push(user);

    return { event: 'room-joined', data: { ...room, user } };
  }

  private createUser(id: string, name: string): User {
    return {
      id,
      name,
      voted: false,
    };
  }
}
