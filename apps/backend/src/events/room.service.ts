import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RetentionService } from '../collaboration/retention.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
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

// Empty rooms remain available briefly so participants can recover from a
// transient network outage.
export const EMPTY_ROOM_RETENTION_MS = 15 * 60 * 1000;
// Offline participants remain visible and can reconnect for five minutes.
export const OFFLINE_USER_RETENTION_MS = 5 * 60 * 1000;

type Membership = { room: Room; user: User };
type UserExpiredListener = (room: Room, user: User) => void;

const ROOM_NAMESPACE = 'poker';

@Injectable()
export class RoomService implements OnModuleDestroy {
  private readonly userExpiredListeners = new Set<UserExpiredListener>();

  constructor(
    private readonly users: UserService,
    private readonly participants: ParticipantService,
    private readonly registry: RoomRegistryService,
    private readonly retention: RetentionService,
  ) {}

  get(code: string) {
    return this.registry.get<Room>(ROOM_NAMESPACE, code);
  }

  onUserExpired(listener: UserExpiredListener) {
    this.userExpiredListeners.add(listener);
    return () => this.userExpiredListeners.delete(listener);
  }

  onModuleDestroy() {
    this.retention.clear(ROOM_NAMESPACE);
    this.userExpiredListeners.clear();
  }

  create(
    id: string,
    name: string,
    cardSet?: string[],
    password?: string,
  ): RoomResult<Membership> {
    const normalizedName = this.users.normalizeName(name);
    const nameError = this.users.validateName(normalizedName);
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

    const user = this.users.create(id, normalizedName, 'mod');
    const room = this.registry.register<Room>(
      ROOM_NAMESPACE,
      { codeLength: 7 },
      (code) => ({
        code,
        users: [user],
        state: 'voting',
        cardSet: normalizedCards,
        results: {},
        password: password || null,
      }),
    );
    if (!room) throw new Error('Poker room registry rejected creation');
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
    const normalizedName = this.users.normalizeName(name);
    const nameError = this.users.validateName(normalizedName);
    if (nameError) {
      return { error: { event: 'bad-username', data: { error: nameError } } };
    }
    if (this.participants.isNameTaken(room.users, normalizedName)) {
      return { error: { event: 'name-taken', data: null } };
    }

    const user = this.users.create(id, normalizedName);
    room.users.push(user);
    this.cancelExpiration(room.code);
    return { room, user };
  }

  reconnect(token: string, code?: string): RoomResult<Membership> {
    const requestedRoom = code ? this.get(code) : undefined;
    const candidateRooms: Iterable<Room> = code
      ? requestedRoom
        ? [requestedRoom]
        : []
      : Array.from(
          this.registry.entries<Room>(ROOM_NAMESPACE),
          ([, room]) => room,
        );
    for (const room of candidateRooms) {
      const user = this.participants.findByToken(room.users, token);
      if (user) {
        this.participants.reconnect(user);
        this.cancelUserExpiration(user);
        this.cancelExpiration(room.code);
        return { room, user };
      }
    }
    return { error: { event: 'room-not-found', data: null } };
  }

  disconnect(code: string, id: string): Membership | undefined {
    const membership = this.findMember(code, id);
    if (
      'error' in membership ||
      !this.participants.disconnect(membership.user)
    ) {
      return;
    }
    this.scheduleUserExpiration(membership.room, membership.user);
    if (membership.room.users.every((user) => !user.connected)) {
      this.scheduleExpiration(membership.room);
    }
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
    if (user.role !== 'moderator') {
      return { error: { event: 'user-not-mod', data: null } };
    }

    const counts = new Map<string, number>();
    // Readiness and progress use connected participants, so result aggregation
    // uses that same set. An offline vote remains on the user for reconnects,
    // but is included only if that participant reconnects before reveal.
    for (const participant of room.users) {
      if (participant.connected && participant.vote !== null) {
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
    if (membership.user.role !== 'moderator') {
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
    if (
      !this.participants.canClaimModerator(
        membership.room.users,
        membership.user,
      )
    ) {
      return { error: { event: 'moderator-online', data: null } };
    }

    this.participants.promote(membership.user);
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

    this.participants.promote(user);
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
    this.cancelUserExpiration(user);
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
    if (membership.user.role !== 'moderator') {
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

  private scheduleUserExpiration(room: Room, user: User) {
    this.retention.schedule(
      ROOM_NAMESPACE,
      this.userRetentionKey(room.code, user.id),
      OFFLINE_USER_RETENTION_MS,
      () => {
        const current = this.get(room.code);
        if (
          current !== room ||
          user.connected ||
          !current.users.includes(user)
        ) {
          return;
        }
        current.users = current.users.filter(
          (participant) => participant !== user,
        );
        for (const listener of this.userExpiredListeners)
          listener(current, user);
      },
    );
  }

  private cancelUserExpiration(user: User) {
    for (const [code, room] of this.registry.entries<Room>(ROOM_NAMESPACE)) {
      if (!room.users.includes(user)) continue;
      this.retention.cancel(
        ROOM_NAMESPACE,
        this.userRetentionKey(code, user.id),
      );
      return;
    }
  }

  private scheduleExpiration(room: Room) {
    this.retention.schedule(
      ROOM_NAMESPACE,
      this.roomRetentionKey(room.code),
      EMPTY_ROOM_RETENTION_MS,
      () => {
        const current = this.get(room.code);
        if (current === room && current.users.every((user) => !user.connected))
          this.registry.delete(ROOM_NAMESPACE, room.code);
      },
    );
  }

  private cancelExpiration(code: string) {
    this.retention.cancel(ROOM_NAMESPACE, this.roomRetentionKey(code));
  }

  private roomRetentionKey(code: string) {
    return `room:${code}`;
  }

  private userRetentionKey(code: string, userId: string) {
    return `participant:${code}:${userId}`;
  }
}
