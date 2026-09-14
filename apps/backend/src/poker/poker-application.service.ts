import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import type { Room, User } from '../events/events.types.js';
import { RoomService } from '../events/room.service.js';
import { UserService } from '../events/user.service.js';
import {
  result,
  type ApplicationResult,
  type OutboundMessage,
} from '../transport/application-result.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';

export const POKER_APPLICATION_NAMESPACE = 'poker';

type PokerEvent = { event: string; data: unknown };
type Session = { roomCode: string; participantId: string };

@Injectable()
export class PokerApplicationService implements OnModuleDestroy {
  private readonly sessions = new Map<string, Session>();
  private readonly unsubscribeUserExpired: () => void;

  constructor(
    private readonly config: ConfigService,
    private readonly rooms: RoomService,
    private readonly users: UserService,
    private readonly connections: ConnectionRegistryService,
    private readonly events: ApplicationEventBus,
  ) {
    this.unsubscribeUserExpired = this.rooms.onUserExpired((room, user) => {
      this.connections.revoke(POKER_APPLICATION_NAMESPACE, room.code, user.id);
      this.events.emit(
        POKER_APPLICATION_NAMESPACE,
        result(
          undefined,
          this.roomMessages(room, {
            event: 'user-removed',
            data: { userId: user.id },
          }),
        ),
      );
    });
  }

  onModuleDestroy() {
    this.unsubscribeUserExpired();
    this.sessions.clear();
  }

  inspect(command: { room: string }) {
    const room = this.rooms.get(command.room);
    return result({
      event: 'room-info',
      data: {
        code: command.room,
        available: room !== undefined,
        requiresPassword: room ? room.password !== null : false,
      },
    });
  }

  create(
    connectionId: string,
    command: { name: string; cardSet?: string[]; password?: string },
  ) {
    const created = this.rooms.create(
      connectionId,
      command.name,
      command.cardSet,
      command.password,
    );
    if ('error' in created) return result(created.error);
    this.attach(connectionId, created.room, created.user);
    return result(this.roomJoined(created.room, created.user));
  }

  join(
    connectionId: string,
    command: {
      room: string;
      name: string;
      password?: string;
    },
  ) {
    const existing = this.rooms.get(command.room);
    const recipients = existing ? this.audience(existing) : [];
    const joined = this.rooms.join(
      command.room,
      connectionId,
      command.name,
      command.password,
    );
    if ('error' in joined) return result(joined.error);
    this.attach(connectionId, joined.room, joined.user);
    return result(
      this.roomJoined(joined.room, joined.user),
      recipients.map((recipient) => ({
        connectionId: recipient,
        event: {
          event: 'user-joined',
          data: {
            user: this.users.toPublic(
              joined.user,
              joined.room.state === 'results',
            ),
          },
        },
      })),
    );
  }

  reconnect(connectionId: string, command: { token: string; room: string }) {
    const reconnected = this.rooms.reconnect(command.token, command.room);
    if ('error' in reconnected) return result(reconnected.error);
    const { room, user } = reconnected;
    const previous = this.connections.replace(
      POKER_APPLICATION_NAMESPACE,
      room.code,
      user.id,
      connectionId,
    );
    if (previous) this.sessions.delete(previous);
    this.sessions.set(connectionId, {
      roomCode: room.code,
      participantId: user.id,
    });
    return result(
      this.roomJoined(room, user),
      this.roomMessages(room, {
        event: 'user-joined',
        data: { user: this.users.toPublic(user, room.state === 'results') },
      }),
      previous
        ? [
            {
              connectionId: previous,
              code: 4000,
              reason: 'Reconnected elsewhere',
            },
          ]
        : [],
    );
  }

  disconnect(connectionId: string): ApplicationResult {
    const session = this.sessions.get(connectionId);
    this.sessions.delete(connectionId);
    if (!session) return result();
    const membership = this.rooms.disconnect(
      session.roomCode,
      session.participantId,
    );
    if (!membership) return result();
    return result(
      undefined,
      this.roomMessages(membership.room, {
        event: 'user-left',
        data: {
          user: this.users.toPublic(
            membership.user,
            membership.room.state === 'results',
          ),
        },
      }),
    );
  }

  reveal(connectionId: string) {
    const session = this.session(connectionId);
    const revealed = this.rooms.revealResults(
      session?.roomCode ?? '',
      session?.participantId ?? connectionId,
    );
    if ('error' in revealed) return result(revealed.error);
    return result(
      undefined,
      this.roomMessages(revealed.room, {
        event: 'results-revealed',
        data: { results: revealed.results, users: revealed.users },
      }),
    );
  }

  castVote(connectionId: string, command: { vote: string | null }) {
    const session = this.session(connectionId);
    const cast = this.rooms.castVote(
      session?.roomCode ?? '',
      session?.participantId ?? connectionId,
      command.vote,
    );
    if ('error' in cast) return result(cast.error);
    return result(
      undefined,
      this.roomMessages(cast.room, {
        event: 'user-voted',
        data: { user: this.users.toPublic(cast.user) },
      }),
    );
  }

  startVoting(connectionId: string) {
    const session = this.session(connectionId);
    const started = this.rooms.startVoting(
      session?.roomCode ?? '',
      session?.participantId ?? connectionId,
    );
    if ('error' in started) return result(started.error);
    return result(
      undefined,
      this.roomMessages(started.room, {
        event: 'voting-started',
        data: null,
      }),
    );
  }

  claimModerator(connectionId: string) {
    const session = this.session(connectionId);
    const claimed = this.rooms.claimModerator(
      session?.roomCode ?? '',
      session?.participantId ?? connectionId,
    );
    if ('error' in claimed) return result(claimed.error);
    return result(
      undefined,
      this.roomMessages(claimed.room, {
        event: 'user-updated',
        data: {
          user: this.users.toPublic(
            claimed.user,
            claimed.room.state === 'results',
          ),
        },
      }),
    );
  }

  promote(connectionId: string, command: { userId: string }) {
    const session = this.session(connectionId);
    const promoted = this.rooms.promoteUser(
      session?.roomCode ?? '',
      session?.participantId ?? connectionId,
      command.userId,
    );
    if ('error' in promoted) return result(promoted.error);
    return result(
      undefined,
      this.roomMessages(promoted.room, {
        event: 'user-updated',
        data: {
          user: this.users.toPublic(
            promoted.user,
            promoted.room.state === 'results',
          ),
        },
      }),
    );
  }

  kick(connectionId: string, command: { userId: string }) {
    const session = this.session(connectionId);
    const kicked = this.rooms.kickUser(
      session?.roomCode ?? '',
      session?.participantId ?? connectionId,
      command.userId,
    );
    if ('error' in kicked) return result(kicked.error);
    const target = this.connections.revoke<string>(
      POKER_APPLICATION_NAMESPACE,
      kicked.room.code,
      kicked.user.id,
    );
    if (target) this.sessions.delete(target);
    const messages: OutboundMessage[] = [
      ...(target
        ? [
            {
              connectionId: target,
              event: { event: 'kicked', data: null },
            },
          ]
        : []),
      ...this.roomMessages(kicked.room, {
        event: 'user-removed',
        data: { userId: kicked.user.id },
      }),
    ];
    return result(
      undefined,
      messages,
      target
        ? [
            {
              connectionId: target,
              code: 4001,
              reason: 'Removed from room',
            },
          ]
        : [],
    );
  }

  changeAvatar(connectionId: string, command: { avatar: number }) {
    const session = this.session(connectionId);
    const changed = this.rooms.changeAvatar(
      session?.roomCode ?? '',
      session?.participantId ?? connectionId,
      command.avatar,
    );
    if ('error' in changed) return result(changed.error);
    return result(
      undefined,
      this.roomMessages(changed.room, {
        event: 'user-updated',
        data: {
          user: this.users.toPublic(
            changed.user,
            changed.room.state === 'results',
          ),
        },
      }),
    );
  }

  broadcast(command: { roomId: string; message: string; password: string }) {
    const password = this.config.get('PASSWORD');
    if (!password) return result({ event: 'message-broadcasted', data: null });
    if (password !== command.password)
      return result({ event: 'wrong-password', data: null });
    const room = this.rooms.get(command.roomId);
    if (!room) return result({ event: 'room-not-found', data: null });
    return result(
      { event: 'message-broadcasted', data: null },
      this.roomMessages(room, {
        event: 'broadcasted-message',
        data: { message: command.message },
      }),
    );
  }

  private attach(connectionId: string, room: Room, user: User) {
    this.sessions.set(connectionId, {
      roomCode: room.code,
      participantId: user.id,
    });
    this.connections.replace(
      POKER_APPLICATION_NAMESPACE,
      room.code,
      user.id,
      connectionId,
    );
  }

  private session(connectionId: string) {
    return this.sessions.get(connectionId);
  }

  private roomJoined(room: Room, user: User): PokerEvent {
    return { event: 'room-joined', data: this.rooms.toJoinedRoom(room, user) };
  }

  private roomMessages(room: Room, event: PokerEvent): OutboundMessage[] {
    return this.audience(room).map((connectionId) => ({ connectionId, event }));
  }

  private audience(room: Room): string[] {
    return this.connections.audience<string>(
      POKER_APPLICATION_NAMESPACE,
      room.code,
      room.users.map((user) => user.id),
    );
  }
}
