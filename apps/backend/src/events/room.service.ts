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
const MAX_CARD_COUNT = 30;
const MAX_CARD_LENGTH = 20;
const MAX_PASSWORD_LENGTH = 100;

type Membership = { room: Room; user: User };

@Injectable()
export class RoomService {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly users: UserService) {}

  get(code: string) {
    return this.rooms.get(code);
  }

  create(
    id: string,
    name: string,
    cardSet?: string[],
    password?: string,
  ): RoomResult<Membership> {
    const nameError = this.users.validateName(name);
    if (nameError) {
      return { error: { event: 'bad-username', data: { error: nameError } } };
    }

    const normalizedCards = this.normalizeCardSet(cardSet);
    if (!normalizedCards) {
      return { error: { event: 'invalid-card-set', data: null } };
    }
    if (password !== undefined && typeof password !== 'string') {
      return { error: { event: 'wrong-room-password', data: null } };
    }
    if ((password?.length ?? 0) > MAX_PASSWORD_LENGTH) {
      return { error: { event: 'wrong-room-password', data: null } };
    }

    const user = this.users.create(id, name, 'mod');
    const room: Room = {
      code: nanoid(7),
      users: [user],
      state: 'voting',
      cardSet: normalizedCards,
      results: {},
      password: password || null,
    };
    this.rooms.set(room.code, room);
    return { room, user };
  }

  join(
    code: string,
    id: string,
    name: string,
    password?: string,
  ): RoomResult<Membership> {
    const room = this.get(code);
    if (!room) return { error: { event: 'room-not-found', data: null } };
    if (room.password !== null && room.password !== password) {
      return { error: { event: 'wrong-room-password', data: null } };
    }
    if (room.users.some((user) => user.name === name)) {
      return { error: { event: 'name-taken', data: null } };
    }
    const nameError = this.users.validateName(name);
    if (nameError) {
      return { error: { event: 'bad-username', data: { error: nameError } } };
    }

    const user = this.users.create(id, name);
    room.users.push(user);
    return { room, user };
  }

  reconnect(token: string, code?: string): RoomResult<Membership> {
    const requestedRoom = code ? this.get(code) : undefined;
    const candidateRooms: Iterable<Room> = code
      ? requestedRoom
        ? [requestedRoom]
        : []
      : this.rooms.values();
    for (const room of candidateRooms) {
      const user = room.users.find((candidate) => candidate.token === token);
      if (user) {
        user.status = 'connected';
        return { room, user };
      }
    }
    return { error: { event: 'room-not-found', data: null } };
  }

  disconnect(code: string, id: string): Membership | undefined {
    const membership = this.findMember(code, id);
    if ('error' in membership || membership.user.status === 'disconnected') {
      return;
    }
    membership.user.status = 'disconnected';
    return membership;
  }

  castVote(
    code: string,
    id: string,
    vote: string | null,
  ): RoomResult<Membership> {
    const membership = this.findMember(code, id);
    if ('error' in membership) return membership;
    if (membership.room.state !== 'voting') {
      return { error: { event: 'voting-not-active', data: null } };
    }
    if (vote !== null && !membership.room.cardSet.includes(vote)) {
      return { error: { event: 'invalid-vote', data: null } };
    }

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
    if (user.role !== 'mod') {
      return { error: { event: 'user-not-mod', data: null } };
    }

    const counts = new Map<string, number>();
    for (const participant of room.users) {
      if (participant.vote !== null) {
        counts.set(participant.vote, (counts.get(participant.vote) ?? 0) + 1);
      }
    }

    room.results = Object.fromEntries(counts);
    room.state = 'results';
    return {
      room,
      results: room.results,
      users: room.users.map((participant) =>
        this.users.toPublic(participant, true),
      ),
    };
  }

  startVoting(code: string, id: string): RoomResult<Membership> {
    const membership = this.findMember(code, id);
    if ('error' in membership) return membership;
    if (membership.user.role !== 'mod') {
      return { error: { event: 'user-not-mod', data: null } };
    }

    this.resetVotes(membership.room);
    membership.room.results = {};
    membership.room.state = 'voting';
    return membership;
  }

  claimModerator(code: string, id: string): RoomResult<Membership> {
    const membership = this.findMember(code, id);
    if ('error' in membership) return membership;
    if (membership.user.role === 'mod') return membership;
    if (
      membership.room.users.some(
        (user) => user.role === 'mod' && user.status === 'connected',
      )
    ) {
      return { error: { event: 'moderator-online', data: null } };
    }

    membership.user.role = 'mod';
    return membership;
  }

  promoteUser(
    code: string,
    moderatorId: string,
    userId: string,
  ): RoomResult<Membership> {
    const membership = this.findModerator(code, moderatorId);
    if ('error' in membership) return membership;
    const user = membership.room.users.find(
      (candidate) => candidate.id === userId,
    );
    if (!user) {
      return { error: { event: 'target-user-not-found', data: null } };
    }

    user.role = 'mod';
    return { room: membership.room, user };
  }

  kickUser(
    code: string,
    moderatorId: string,
    userId: string,
  ): RoomResult<Membership> {
    const membership = this.findModerator(code, moderatorId);
    if ('error' in membership) return membership;
    if (moderatorId === userId) {
      return { error: { event: 'cannot-kick-self', data: null } };
    }

    const user = membership.room.users.find(
      (candidate) => candidate.id === userId,
    );
    if (!user) {
      return { error: { event: 'target-user-not-found', data: null } };
    }
    membership.room.users = membership.room.users.filter(
      (candidate) => candidate.id !== userId,
    );
    return { room: membership.room, user };
  }

  changeAvatar(
    code: string,
    id: string,
    avatar: number,
  ): RoomResult<Membership> {
    const membership = this.findMember(code, id);
    if ('error' in membership) return membership;
    if (!Number.isSafeInteger(avatar) || avatar < 0) {
      return { error: { event: 'invalid-avatar', data: null } };
    }

    membership.user.avatar = avatar;
    return membership;
  }

  toJoinedRoom(room: Room, user: User) {
    const revealVotes = room.state === 'results';
    return {
      code: room.code,
      users: room.users.map((participant) =>
        this.users.toPublic(participant, revealVotes),
      ),
      user: this.users.toSelf(user),
      state: room.state,
      cardSet: room.cardSet,
      results: room.results,
      requiresPassword: room.password !== null,
    };
  }

  private findMember(code: string, id: string): RoomResult<Membership> {
    const room = this.get(code);
    if (!room) return { error: { event: 'room-not-found', data: null } };
    const user = room.users.find((candidate) => candidate.id === id);
    if (!user) return { error: { event: 'user-not-found', data: null } };
    return { room, user };
  }

  private findModerator(code: string, id: string): RoomResult<Membership> {
    const membership = this.findMember(code, id);
    if ('error' in membership) return membership;
    if (membership.user.role !== 'mod') {
      return { error: { event: 'user-not-mod', data: null } };
    }
    return membership;
  }

  private normalizeCardSet(cardSet?: string[]) {
    if (cardSet !== undefined && !Array.isArray(cardSet)) return null;
    const selected = cardSet?.length ? cardSet : DEFAULT_CARD_SET;
    if (
      selected.length > MAX_CARD_COUNT ||
      selected.some(
        (card) =>
          typeof card !== 'string' ||
          card.length === 0 ||
          card.length > MAX_CARD_LENGTH,
      )
    ) {
      return null;
    }
    return [...new Set(selected)];
  }

  private resetVotes(room: Room) {
    for (const user of room.users) user.vote = null;
  }
}
