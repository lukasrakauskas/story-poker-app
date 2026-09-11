import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type {
  RetroCommand,
  RetroMember,
  RetroRoom,
} from 'shared/retrospective';

export const RETRO_LIFETIME_MS = 2 * 60 * 60 * 1000;
const MAX_ROOMS = 100;
const MAX_MEMBERS = 30;
const MAX_NOTES = 300;
const MAX_ACTIONS = 100;
const VOTES_PER_MEMBER = 3;

export class RetroError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface RetroSession {
  code: string;
  id: string;
  token: string;
}
type StoredRoom = Omit<RetroRoom, 'members'> & {
  members: (RetroMember & { token: string })[];
};
type Mutation = Exclude<RetroCommand, { type: 'create' | 'join' | 'resume' }>;

@Injectable()
export class RetroService {
  private readonly rooms = new Map<string, StoredRoom>();

  create(name: string, title: string): RetroSession {
    this.sweep();
    if (this.rooms.size >= MAX_ROOMS)
      throw new RetroError(
        'capacity',
        'All retrospective rooms are in use. Try again later.',
      );
    const member = this.member(name, true);
    let code: string;
    do {
      code = nanoid(10);
    } while (this.rooms.has(code));
    this.rooms.set(code, {
      code,
      title,
      phase: 'write',
      expiresAt: Date.now() + RETRO_LIFETIME_MS,
      members: [member],
      notes: [],
      actions: [],
    });
    return { code, id: member.id, token: member.token };
  }

  join(code: string, name: string): RetroSession {
    const room = this.room(code);
    if (room.members.length >= MAX_MEMBERS)
      throw new RetroError('capacity', 'This room is full (30 people).');
    if (
      room.members.some(
        (member) => member.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new RetroError(
        'name-taken',
        'That name is already in use. Choose another name.',
      );
    }
    const member = this.member(name, false);
    room.members.push(member);
    return { code, id: member.id, token: member.token };
  }

  resume(code: string, token: string): RetroSession {
    const room = this.room(code);
    const member = room.members.find((member) => member.token === token);
    if (!member)
      throw new RetroError(
        'invalid-session',
        'This session is no longer available. Join again.',
      );
    member.connected = true;
    return { code, id: member.id, token };
  }

  disconnect(session: RetroSession) {
    const room = this.rooms.get(session.code);
    const member = room?.members.find(
      (member) => member.id === session.id && member.token === session.token,
    );
    if (member) member.connected = false;
  }

  snapshot(session: RetroSession): RetroRoom {
    const { room } = this.authorize(session);
    // Explicitly exclude credentials, and never expose mutable internal state.
    return structuredClone({
      ...room,
      members: room.members.map(({ id, name, moderator, connected }) => ({
        id,
        name,
        moderator,
        connected,
      })),
    });
  }

  mutate(session: RetroSession, command: Mutation) {
    const { room, member } = this.authorize(session);
    if (room.phase === 'closed')
      throw new RetroError(
        'room-closed',
        'This retrospective is closed and read-only.',
      );
    switch (command.type) {
      case 'advance': {
        this.requireModerator(member);
        const next = {
          write: 'vote',
          vote: 'discuss',
          discuss: 'closed',
        } as const;
        room.phase = next[room.phase];
        return;
      }
      case 'add-note':
        this.requirePhase(room, 'write');
        if (room.notes.length >= MAX_NOTES)
          throw new RetroError(
            'capacity',
            'This room has reached its 300-note limit.',
          );
        room.notes.push({
          id: nanoid(),
          authorId: member.id,
          column: command.column,
          text: command.text,
          voterIds: [],
        });
        return;
      case 'edit-note':
      case 'delete-note': {
        this.requirePhase(room, 'write');
        const note = this.note(room, command.id);
        if (note.authorId !== member.id)
          throw new RetroError(
            'forbidden',
            'You can only change your own notes.',
          );
        if (command.type === 'edit-note') note.text = command.text;
        else room.notes = room.notes.filter((note) => note.id !== command.id);
        return;
      }
      case 'toggle-vote': {
        this.requirePhase(room, 'vote');
        const note = this.note(room, command.id);
        if (note.voterIds.includes(member.id)) {
          note.voterIds = note.voterIds.filter((id) => id !== member.id);
        } else {
          const used = room.notes.filter((note) =>
            note.voterIds.includes(member.id),
          ).length;
          if (used >= VOTES_PER_MEMBER)
            throw new RetroError(
              'vote-limit',
              'You have used all three votes. Remove a vote to move it.',
            );
          note.voterIds.push(member.id);
        }
        return;
      }
      case 'add-action':
        this.requireModerator(member);
        this.requirePhase(room, 'discuss');
        if (room.actions.length >= MAX_ACTIONS)
          throw new RetroError(
            'capacity',
            'This room has reached its 100-action limit.',
          );
        room.actions.push({
          id: nanoid(),
          text: command.text,
          owner: command.owner,
          done: false,
        });
        return;
      case 'toggle-action':
      case 'delete-action': {
        this.requireModerator(member);
        this.requirePhase(room, 'discuss');
        const action = room.actions.find((action) => action.id === command.id);
        if (!action)
          throw new RetroError('not-found', 'That action no longer exists.');
        if (command.type === 'toggle-action') action.done = !action.done;
        else
          room.actions = room.actions.filter(
            (action) => action.id !== command.id,
          );
      }
    }
  }

  isExpired(code: string): boolean {
    return (this.rooms.get(code)?.expiresAt ?? 0) <= Date.now();
  }

  sweep(): string[] {
    const expired: string[] = [];
    for (const [code, room] of this.rooms) {
      if (room.expiresAt <= Date.now()) {
        this.rooms.delete(code);
        expired.push(code);
      }
    }
    return expired;
  }

  private room(code: string): StoredRoom {
    const room = this.rooms.get(code);
    if (!room || room.expiresAt <= Date.now()) {
      // The periodic sweep owns deletion so it can notify all attached sockets.
      throw new RetroError(
        'room-expired',
        'This room expired or does not exist. Create a new retrospective.',
      );
    }
    return room;
  }

  private authorize(session: RetroSession) {
    const room = this.room(session.code);
    const member = room.members.find(
      (member) => member.id === session.id && member.token === session.token,
    );
    if (!member)
      throw new RetroError(
        'invalid-session',
        'Join a room before making changes.',
      );
    return { room, member };
  }

  private member(name: string, moderator: boolean) {
    return {
      id: nanoid(),
      token: nanoid(32),
      name,
      moderator,
      connected: true,
    };
  }

  private requireModerator(member: RetroMember) {
    if (!member.moderator)
      throw new RetroError('forbidden', 'Only the moderator can do that.');
  }

  private requirePhase(room: StoredRoom, phase: RetroRoom['phase']) {
    if (room.phase !== phase)
      throw new RetroError(
        'wrong-phase',
        `This action is only available during the ${phase} phase.`,
      );
  }

  private note(room: StoredRoom, id: string) {
    const note = room.notes.find((note) => note.id === id);
    if (!note) throw new RetroError('not-found', 'That note no longer exists.');
    return note;
  }
}
