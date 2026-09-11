import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { UserService } from './user.service.js';
import type { Room, RoomResult, User, ClientUser } from './events.types.js';

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
type Membership = { room: Room; user: User };

@Injectable()
export class RoomService {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly users: UserService) {}

  get(code: string) {
    return this.rooms.get(code);
  }

  create(id: string, name: string, cardSet?: string[]): RoomResult<Membership> {
    const error = this.users.validateName(name);
    if (error) return { error: { event: 'bad-username', data: { error } } };
    const user = this.users.create(id, name, 'mod');
    const room: Room = {
      code: nanoid(7),
      users: [user],
      state: 'voting',
      cardSet: [...(cardSet?.length ? cardSet : DEFAULT_CARD_SET)],
    };
    this.rooms.set(room.code, room);
    return { room, user };
  }

  join(code: string, id: string, name: string): RoomResult<Membership> {
    const room = this.get(code);
    if (!room) return { error: { event: 'room-not-found', data: null } };
    if (room.users.some((user) => user.name === name)) {
      return { error: { event: 'name-taken', data: null } };
    }
    const error = this.users.validateName(name);
    if (error) return { error: { event: 'bad-username', data: { error } } };
    const user = this.users.create(id, name);
    room.users.push(user);
    return { room, user };
  }

  reconnect(token: string): RoomResult<Membership> {
    for (const room of this.rooms.values()) {
      const user = room.users.find((user) => user.token === token);
      if (user) {
        user.status = 'connected';
        return { room, user };
      }
    }
    return { error: { event: 'room-not-found', data: null } };
  }

  disconnect(code: string, id: string): Membership | undefined {
    const membership = this.findMember(code, id);
    if ('error' in membership) return;
    membership.user.status = 'disconnected';
    return membership;
  }

  castVote(code: string, id: string, vote: string): RoomResult<Membership> {
    const membership = this.findMember(code, id);
    if ('error' in membership) return membership;
    membership.user.vote = vote;
    return membership;
  }

  revealResults(
    code: string,
    id: string,
  ): RoomResult<{
    room: Room;
    results: Record<string, number>;
    users: ClientUser[];
  }> {
    const membership = this.findMember(code, id);
    if ('error' in membership) return membership;
    const { room, user } = membership;
    if (user.role !== 'mod')
      return { error: { event: 'user-not-mod', data: null } };
    const counts = new Map<string, number>();
    for (const participant of room.users) {
      if (participant.vote !== null) {
        counts.set(participant.vote, (counts.get(participant.vote) ?? 0) + 1);
      }
    }
    const users = room.users.map((user) => this.users.toPublic(user, true));
    this.resetVotes(room);
    room.state = 'results';
    return { room, results: Object.fromEntries(counts), users };
  }

  startVoting(code: string, id: string): RoomResult<Membership> {
    const membership = this.findMember(code, id);
    if ('error' in membership) return membership;
    this.resetVotes(membership.room);
    membership.room.state = 'voting';
    return membership;
  }

  toJoinedRoom(room: Room, user: User) {
    return {
      ...room,
      users: room.users.map((user) => this.users.toPublic(user)),
      user: this.users.toSelf(user),
    };
  }

  private findMember(code: string, id: string): RoomResult<Membership> {
    const room = this.get(code);
    if (!room) return { error: { event: 'room-not-found', data: null } };
    const user = room.users.find((user) => user.id === id);
    if (!user) return { error: { event: 'user-not-found', data: null } };
    return { room, user };
  }

  private resetVotes(room: Room) {
    for (const user of room.users) user.vote = null;
  }
}
