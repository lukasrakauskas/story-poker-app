import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { nanoid } from 'nanoid';

type User = {
  id: string;
  name: string;
  vote: string | null;
  role: 'user' | 'mod';
};

interface Room {
  id: string;
  code: string;
  users: User[];
  state: 'voting' | 'results';
}

enum RoomState {
  Voting = 'voting',
  Results = 'results',
}

const DEFAULT_STATE = RoomState.Voting;

@Injectable()
export class RoomService {
  rooms: Map<string, Room>;

  constructor(private readonly emitter: EventEmitter2) {
    this.rooms = new Map();
  }

  public create(): Room {
    const newRoom = {
      id: nanoid(7),
      code: nanoid(7),
      users: [],
      state: DEFAULT_STATE,
    };

    this.rooms.set(newRoom.id, newRoom);

    return newRoom;
  }

  public getRoomById(roomId: string) {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new Error('room not found'); // todo: create new class
    }

    return room;
  }

  public addUser(roomId: string, user: User) {
    const room = this.getRoomById(roomId);

    const userAlreadyAdded = room.users.some((it) => it.id === user.id);

    if (userAlreadyAdded) {
      throw new Error('User is already in the room');
    }

    room.users.push(user);
    this.emitter.emit('');
  }

  public removeUser(roomId: string, user: User) {
    const room = this.getRoomById(roomId);

    const userToBeRemoved = room.users.find((it) => it.id === user.id);

    if (!userToBeRemoved) {
      return;
    }

    room.users = room.users.filter((it) => it.id !== user.id);
  }
}
