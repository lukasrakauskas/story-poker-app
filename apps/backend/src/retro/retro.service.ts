import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type {
  RetroCommand,
  RetroActionAssignment,
  RetroActionOwner,
  RetroGroup,
  RetroNote,
  RetroRoom,
} from 'shared/retrospective';
import {
  ParticipantService,
  type CollaborationParticipant,
  type CollaborationRole,
} from '../collaboration/participant.service.js';
import {
  RoomAccessService,
  type RoomAccess,
} from '../collaboration/room-access.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import { RetentionService } from '../collaboration/retention.service.js';

export const RETRO_LIFETIME_MS = 2 * 60 * 60 * 1000;
export const RETRO_OFFLINE_RETENTION_MS = 5 * 60 * 1000;
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
export interface RetroMutationResult {
  removedMemberId?: string;
}
type StoredNote = Omit<RetroNote, 'voteCount' | 'votedBySelf'> & {
  /** Server-only voter identities used for authorization and vote budgets. */
  voterIds: string[];
};
type StoredGroup = Omit<RetroGroup, 'voteCount' | 'votedBySelf'> & {
  /** Server-only voter identities used for authorization and vote budgets. */
  voterIds: string[];
};
type StoredRoom = Omit<
  RetroRoom,
  'members' | 'notes' | 'groups' | 'requiresPassword'
> & {
  access: RoomAccess;
  members: CollaborationParticipant[];
  notes: StoredNote[];
  groups: StoredGroup[];
  /** Internal current-phase readiness, kept separate from participant identity. */
  readyMemberIds: Set<string>;
};
type Mutation = Exclude<
  RetroCommand,
  { type: 'create' | 'join' | 'resume' | 'inspect' }
>;

const ROOM_NAMESPACE = 'retro';

@Injectable()
export class RetroService {
  private readonly memberExpiredListeners = new Set<
    (code: string, id: string) => void
  >();

  onMemberExpired(listener: (code: string, id: string) => void): () => void {
    this.memberExpiredListeners.add(listener);
    return () => {
      this.memberExpiredListeners.delete(listener);
    };
  }

  constructor(
    private readonly participants: ParticipantService,
    private readonly registry: RoomRegistryService,
    private readonly retention: RetentionService,
    private readonly access: RoomAccessService,
  ) {}

  create(name: string, title: string, password?: string): RetroSession {
    const passwordError = this.access.validate(password);
    if (passwordError) throw new RetroError('invalid-command', passwordError);
    this.sweep();
    if (this.registry.size(ROOM_NAMESPACE) >= MAX_ROOMS)
      throw new RetroError(
        'capacity',
        'All retrospective rooms are in use. Try again later.',
      );
    const access = this.access.create(password);
    const member = this.createParticipant(name, 'moderator');
    const room = this.registry.register<StoredRoom>(
      ROOM_NAMESPACE,
      { codeLength: 10, maxRooms: MAX_ROOMS },
      (code) => ({
        code,
        title,
        phase: 'write',
        expiresAt: Date.now() + RETRO_LIFETIME_MS,
        closedAt: null,
        access,
        members: [member],
        notes: [],
        groups: [],
        actions: [],
        readyMemberIds: new Set(),
      }),
    );
    if (!room)
      throw new RetroError(
        'capacity',
        'All retrospective rooms are in use. Try again later.',
      );
    return { code: room.code, id: member.id, token: member.token };
  }

  join(code: string, name: string, password?: string): RetroSession {
    const room = this.room(code);
    if (!this.access.verify(room.access, password))
      throw new RetroError('wrong-room-password', 'Incorrect room password.');
    if (room.phase === 'closed')
      throw new RetroError(
        'room-closed',
        'This retrospective is complete. New participants cannot join; ask a participant for an export.',
      );
    if (room.members.length >= MAX_MEMBERS)
      throw new RetroError('capacity', 'This room is full (30 people).');
    const normalizedName = this.validName(name);
    if (this.participants.isNameTaken(room.members, normalizedName)) {
      throw new RetroError(
        'name-taken',
        'That name is already in use. Choose another name.',
      );
    }
    const member = this.participants.create(normalizedName);
    room.members.push(member);
    return { code, id: member.id, token: member.token };
  }

  inspect(code: string) {
    const room = this.registry.get<StoredRoom>(ROOM_NAMESPACE, code);
    if (!room || room.expiresAt <= Date.now())
      return { code, available: false, requiresPassword: false };
    return {
      code,
      available: true,
      requiresPassword: room.access.requiresPassword,
    };
  }

  resume(code: string, token: string): RetroSession {
    const room = this.room(code);
    const member = this.participants.findByToken(room.members, token);
    if (!member)
      throw new RetroError(
        'invalid-session',
        'This session is no longer available. Join again.',
      );
    this.retention.cancel(ROOM_NAMESPACE, `participant:${code}:${member.id}`);
    if (room.phase !== 'closed') this.participants.reconnect(member);
    return { code, id: member.id, token };
  }

  disconnect(session: RetroSession) {
    const room = this.registry.get<StoredRoom>(ROOM_NAMESPACE, session.code);
    const member = room?.members.find(
      (member) => member.id === session.id && member.token === session.token,
    );
    if (
      !room ||
      room.phase === 'closed' ||
      !member ||
      !this.participants.disconnect(member)
    )
      return;
    this.retention.schedule(
      ROOM_NAMESPACE,
      `participant:${room.code}:${member.id}`,
      RETRO_OFFLINE_RETENTION_MS,
      () => {
        if (
          this.registry.get<StoredRoom>(ROOM_NAMESPACE, room.code) !== room ||
          room.phase === 'closed' ||
          room.expiresAt <= Date.now() ||
          member.connected ||
          !room.members.includes(member)
        )
          return;
        room.members = room.members.filter(
          (candidate) => candidate.id !== member.id,
        );
        room.readyMemberIds.delete(member.id);
        for (const target of [...room.notes, ...room.groups])
          target.voterIds = target.voterIds.filter((id) => id !== member.id);
        for (const listener of this.memberExpiredListeners)
          listener(room.code, member.id);
      },
    );
  }

  snapshot(session: RetroSession): RetroRoom {
    const { room, member } = this.authorize(session);
    const { readyMemberIds, groups } = room;
    // Keep the public shape explicit. Internal access capabilities, participant
    // tokens, readiness sets, and voter identities must never be spread out.
    const publicRoom = {
      code: room.code,
      title: room.title,
      phase: room.phase,
      expiresAt: room.expiresAt,
      closedAt: room.closedAt,
      actions: room.actions,
      requiresPassword: room.access.requiresPassword,
    };
    // Writing is private even for moderators. Advancing to vote changes the
    // phase before one broadcast reveals the complete board to everyone.
    const notes =
      room.phase === 'write'
        ? room.notes.filter((note) => note.authorId === member.id)
        : room.notes;
    // Explicitly exclude credentials and voter identities, and never expose
    // mutable internal state. Open voting contains only the recipient's own
    // selections; aggregate totals become public in discuss/closed.
    return structuredClone({
      ...publicRoom,
      members: room.members.map(({ id, name, role, connected }) => ({
        id,
        name,
        moderator: role === 'moderator',
        connected,
        ready: readyMemberIds.has(id),
      })),
      notes: notes.map(({ voterIds, ...note }) => ({
        ...note,
        voteCount:
          !note.groupId && (room.phase === 'discuss' || room.phase === 'closed')
            ? voterIds.length
            : null,
        votedBySelf:
          !note.groupId &&
          room.phase === 'vote' &&
          voterIds.includes(member.id),
      })),
      groups: groups.map(({ voterIds, ...group }) => ({
        ...group,
        voteCount:
          room.phase === 'discuss' || room.phase === 'closed'
            ? voterIds.length
            : null,
        votedBySelf: room.phase === 'vote' && voterIds.includes(member.id),
      })),
    });
  }

  mutate(
    session: RetroSession,
    command: Mutation,
  ): RetroMutationResult | undefined {
    const { room, member } = this.authorize(session);
    if (room.phase === 'closed')
      throw new RetroError(
        'room-closed',
        'This retrospective is closed and read-only.',
      );
    switch (command.type) {
      case 'remove-member': {
        this.requireModerator(member);
        if (command.memberId === member.id)
          throw new RetroError(
            'forbidden',
            'Transfer moderation before removing yourself.',
          );
        const removed = this.member(room, command.memberId);
        this.retention.cancel(
          ROOM_NAMESPACE,
          `participant:${room.code}:${removed.id}`,
        );
        room.members = room.members.filter(
          (candidate) => candidate.id !== removed.id,
        );
        room.readyMemberIds.delete(removed.id);
        for (const target of [...room.notes, ...room.groups])
          target.voterIds = target.voterIds.filter((id) => id !== removed.id);
        return { removedMemberId: removed.id };
      }
      case 'transfer-moderator': {
        this.requireModerator(member);
        if (command.memberId === member.id)
          throw new RetroError(
            'invalid-command',
            'Choose another connected participant for the handoff.',
          );
        const successor = this.member(room, command.memberId);
        if (!successor.connected)
          throw new RetroError(
            'not-connected',
            'Choose a participant who is currently connected.',
          );
        this.setModerator(room, successor);
        return;
      }
      case 'claim-moderator':
        if (
          !this.participants.canClaimModerator(room.members, member) ||
          room.members.some(
            (candidate) =>
              candidate.role === 'moderator' && candidate.connected,
          )
        )
          throw new RetroError(
            'moderator-active',
            'A moderator is already connected.',
          );
        this.setModerator(room, member);
        return;
      case 'advance': {
        this.requireModerator(member);
        const next = {
          write: 'group',
          group: 'vote',
          vote: 'discuss',
          discuss: 'closed',
        } as const;
        room.phase = next[room.phase];
        if (room.phase === 'closed') {
          room.closedAt = Date.now();
          for (const participant of room.members)
            this.retention.cancel(
              ROOM_NAMESPACE,
              `participant:${room.code}:${participant.id}`,
            );
        }
        room.readyMemberIds.clear();
        return;
      }
      case 'toggle-ready':
        if (room.phase !== 'write' && room.phase !== 'vote')
          throw new RetroError(
            'wrong-phase',
            'Readiness is only available while writing or voting.',
          );
        if (room.readyMemberIds.has(member.id))
          room.readyMemberIds.delete(member.id);
        else room.readyMemberIds.add(member.id);
        return;
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
          authorName: member.name,
          column: command.column,
          text: command.text,
          groupId: null,
          voterIds: [],
        });
        return;
      case 'edit-note': {
        this.requirePhase(room, 'write');
        const note = this.note(room, command.id);
        if (note.authorId !== member.id)
          throw new RetroError(
            'forbidden',
            'You can only change your own notes.',
          );
        note.text = command.text;
        return;
      }
      case 'delete-note': {
        const note = this.note(room, command.id);
        if (room.phase === 'write') {
          if (note.authorId !== member.id)
            throw new RetroError(
              'forbidden',
              'Private writing can only be deleted by its author.',
            );
        } else {
          this.requireModerator(member);
          if (
            room.phase !== 'group' &&
            room.phase !== 'vote' &&
            room.phase !== 'discuss'
          )
            throw new RetroError(
              'wrong-phase',
              'Notes cannot be moderated in this phase.',
            );
        }
        room.notes = room.notes.filter((candidate) => candidate.id !== note.id);
        this.cleanupGroups(room);
        return;
      }
      case 'group-notes': {
        this.requireModerator(member);
        this.requirePhase(room, 'group');
        const noteIds = new Set(command.noteIds);
        if (noteIds.size < 2)
          throw new RetroError(
            'invalid-command',
            'Choose at least two different notes to create a theme.',
          );
        const notes = [...noteIds].map((id) => this.note(room, id));
        for (const note of notes) note.groupId = null;
        this.cleanupGroups(room);
        const group: StoredGroup = {
          id: nanoid(),
          title: command.title,
          voterIds: [],
        };
        room.groups.push(group);
        for (const note of notes) note.groupId = group.id;
        return;
      }
      case 'move-note': {
        this.requireModerator(member);
        this.requirePhase(room, 'group');
        const note = this.note(room, command.id);
        const group = room.groups.find((item) => item.id === command.groupId);
        if (!group)
          throw new RetroError('not-found', 'That theme no longer exists.');
        note.groupId = group.id;
        this.cleanupGroups(room);
        return;
      }
      case 'ungroup-note': {
        this.requireModerator(member);
        this.requirePhase(room, 'group');
        const note = this.note(room, command.id);
        if (!note.groupId)
          throw new RetroError('not-found', 'That note is not in a theme.');
        note.groupId = null;
        this.cleanupGroups(room);
        return;
      }
      case 'toggle-vote': {
        this.requirePhase(room, 'vote');
        const target = this.voteTarget(room, command.id);
        if (target.voterIds.includes(member.id)) {
          target.voterIds = target.voterIds.filter((id) => id !== member.id);
        } else {
          const targets = [
            ...room.notes.filter((note) => !note.groupId),
            ...room.groups,
          ];
          const used = targets.filter((candidate) =>
            candidate.voterIds.includes(member.id),
          ).length;
          if (used >= VOTES_PER_MEMBER)
            throw new RetroError(
              'vote-limit',
              'You have used all three votes. Remove a vote to move it.',
            );
          target.voterIds.push(member.id);
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
          owner: this.actionOwner(room, command.owner),
          done: false,
        });
        return;
      case 'edit-action': {
        this.requireModerator(member);
        this.requirePhase(room, 'discuss');
        const action = room.actions.find((item) => item.id === command.id);
        if (!action)
          throw new RetroError('not-found', 'That action no longer exists.');
        const owner = this.actionOwner(room, command.owner, action.owner);
        action.text = command.text;
        action.owner = owner;
        return;
      }
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
    return (
      (this.registry.get<StoredRoom>(ROOM_NAMESPACE, code)?.expiresAt ?? 0) <=
      Date.now()
    );
  }

  sweep(): string[] {
    return this.registry.sweep<StoredRoom>(
      ROOM_NAMESPACE,
      (room) => room.expiresAt <= Date.now(),
    );
  }

  private room(code: string): StoredRoom {
    const room = this.registry.get<StoredRoom>(ROOM_NAMESPACE, code);
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

  private createParticipant(name: string, role: CollaborationRole) {
    return this.participants.create(this.validName(name), role);
  }

  private validName(name: string) {
    const normalized = this.participants.normalizeName(name);
    const error = this.participants.validateName(normalized);
    if (error) throw new RetroError('invalid-command', error);
    return normalized;
  }

  private requireModerator(member: CollaborationParticipant) {
    if (member.role !== 'moderator')
      throw new RetroError('forbidden', 'Only the moderator can do that.');
  }

  private setModerator(room: StoredRoom, moderator: CollaborationParticipant) {
    for (const member of room.members) member.role = 'participant';
    this.participants.promote(moderator);
  }

  private member(room: StoredRoom, id: string) {
    const member = room.members.find((candidate) => candidate.id === id);
    if (!member)
      throw new RetroError('not-found', 'That participant no longer exists.');
    return member;
  }

  private actionOwner(
    room: StoredRoom,
    assignment: RetroActionAssignment,
    previous?: RetroActionOwner,
  ): RetroActionOwner {
    if (assignment.kind !== 'participant') return { ...assignment };
    const member = room.members.find(
      (item) => item.id === assignment.participantId,
    );
    if (member)
      return {
        kind: 'participant',
        participantId: member.id,
        name: member.name,
      };
    // Editing text may retain a removed owner; new assignments must be current members.
    if (
      previous?.kind === 'participant' &&
      previous.participantId === assignment.participantId
    )
      return { ...previous };
    throw new RetroError(
      'not-found',
      'That action owner is no longer in the room. Choose another owner.',
    );
  }

  private requirePhase(room: StoredRoom, phase: RetroRoom['phase']) {
    if (room.phase !== phase)
      throw new RetroError(
        'wrong-phase',
        `This action is only available during the ${phase} phase.`,
      );
  }

  private cleanupGroups(room: StoredRoom) {
    const retained = new Set<string>();
    for (const group of room.groups) {
      const notes = room.notes.filter((note) => note.groupId === group.id);
      if (notes.length >= 2) retained.add(group.id);
      else for (const note of notes) note.groupId = null;
    }
    room.groups = room.groups.filter((group) => retained.has(group.id));
  }

  private voteTarget(room: StoredRoom, id: string): StoredNote | StoredGroup {
    const group = room.groups.find((candidate) => candidate.id === id);
    if (group) return group;
    const note = this.note(room, id);
    if (note.groupId)
      throw new RetroError(
        'invalid-command',
        'Vote for the note theme instead of an individual grouped note.',
      );
    return note;
  }

  private note(room: StoredRoom, id: string) {
    const note = room.notes.find((note) => note.id === id);
    if (!note) throw new RetroError('not-found', 'That note no longer exists.');
    return note;
  }
}
