import { Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import {
  retroPublicRoomSchema,
  retroRecipientEnvelopeSchema,
  type RetroCommand,
  type RetroActionAssignment,
  type RetroActionOwner,
  type RetroRememberedIdentity,
  type RetroRoom,
} from 'shared/retrospective';
import {
  createStoredRoomAccess,
  validateRoomPassword,
  verifyStoredRoomAccess,
} from '../collaboration/room-access.service.js';
import {
  ParticipantService,
  type CollaborationRole,
} from '../collaboration/participant.service.js';
import {
  RetroRepositoryError,
  type RetroConnectionOwner,
  type RetroRepositoryContext,
  type RetroRoomChange,
  type RetroRoomOperation,
  type RetroRoomRepository,
  type StoredRetroGroup,
  type StoredRetroNote,
  type StoredRetroParticipant,
  type StoredRetroRoom,
  RETRO_ROOM_REPOSITORY,
} from './retro-room.repository.js';

export const RETRO_LIFETIME_MS = 2 * 60 * 60 * 1000;
export const RETRO_OFFLINE_RETENTION_MS = 5 * 60 * 1000;
const MAX_ROOMS = 100;
const MAX_MEMBERS = 30;
const MAX_NOTES = 300;
const MAX_ACTIONS = 100;
const VOTES_PER_MEMBER = 3;
const RETRO_CODE = /^[a-zA-Z0-9_-]{1,64}$/;

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

export interface RetroSessionRotation {
  session: RetroSession;
  previousConnection?: RetroConnection;
}

export type RetroConnection = RetroConnectionOwner;

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function tokenMatches(token: string, tokenHash: string): boolean {
  const actual = Buffer.from(hashSessionToken(token), 'hex');
  const expected = Buffer.from(tokenHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

type PasswordOrContext = string | RetroRepositoryContext | undefined;

function splitPasswordAndContext(
  passwordOrContext: PasswordOrContext,
  context?: RetroRepositoryContext,
): {
  password: string | undefined;
  context: RetroRepositoryContext | undefined;
} {
  if (typeof passwordOrContext === 'object' && passwordOrContext !== null)
    return { password: undefined, context: passwordOrContext };
  return { password: passwordOrContext, context };
}

@Injectable()
export class RetroService {
  private readonly memberExpiredListeners = new Set<
    (code: string, id: string) => void
  >();
  private readonly unsubscribeMemberChanges: () => void;
  private readonly projections = new Map<
    string,
    { version: number; expiresAt: number; room: RetroRoom }
  >();

  constructor(
    private readonly participants: ParticipantService,
    @Inject(RETRO_ROOM_REPOSITORY)
    private readonly repository: RetroRoomRepository,
  ) {
    this.unsubscribeMemberChanges = repository.onChange((change) => {
      if (change.kind !== 'member-expired') return;
      for (const id of change.memberIds ?? [])
        for (const listener of this.memberExpiredListeners)
          listener(change.code, id);
    });
  }

  onMemberExpired(listener: (code: string, id: string) => void): () => void {
    this.memberExpiredListeners.add(listener);
    return () => this.memberExpiredListeners.delete(listener);
  }

  onRoomChanged(listener: (change: RetroRoomChange) => void): () => void {
    return this.repository.onChange(listener);
  }

  async create(
    name: string,
    title: string,
    passwordOrContext?: PasswordOrContext,
    context?: RetroRepositoryContext,
  ): Promise<RetroSession> {
    const resolved = splitPasswordAndContext(passwordOrContext, context);
    const passwordError = validateRoomPassword(resolved.password);
    if (passwordError) throw new RetroError('invalid-command', passwordError);
    await this.sweep(resolved.context);
    const created = this.createParticipant(name, 'moderator');
    if (resolved.context?.connection)
      created.member.connection = resolved.context.connection;
    const room = await this.repository.create(
      {
        title,
        phase: 'write',
        expiresAt: Date.now() + RETRO_LIFETIME_MS,
        closedAt: null,
        access: createStoredRoomAccess(resolved.password),
        members: [created.member],
        notes: [],
        groups: [],
        actions: [],
        readyMemberIds: [],
      },
      { codeLength: 10, maxRooms: MAX_ROOMS },
      resolved.context,
    );
    if (!room)
      throw new RetroError(
        'capacity',
        'All retrospective rooms are in use. Try again later.',
      );
    return { code: room.code, id: created.member.id, token: created.token };
  }

  async join(
    code: string,
    name: string,
    passwordOrContext?: PasswordOrContext,
    context?: RetroRepositoryContext,
  ): Promise<RetroSession> {
    const resolved = splitPasswordAndContext(passwordOrContext, context);
    return this.transact(
      code,
      (room) => {
        // Password verification is inside the repository transaction. Redis
        // therefore admits a join only against the same room revision that is
        // subsequently updated, and no verifier state is process-local.
        if (!verifyStoredRoomAccess(room.access, resolved.password))
          throw new RetroError(
            'wrong-room-password',
            'Incorrect room password.',
          );
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
        const created = this.createParticipant(normalizedName, 'participant');
        if (resolved.context?.connection)
          created.member.connection = resolved.context.connection;
        room.members.push(created.member);
        return {
          result: { code, id: created.member.id, token: created.token },
        };
      },
      resolved.context,
    );
  }

  async inspect(code: string, context?: RetroRepositoryContext) {
    if (!RETRO_CODE.test(code))
      return { code, available: false, requiresPassword: false };
    const room = await this.repository.get(code, context);
    if (
      !room ||
      room.expiresAt <= Date.now() ||
      room.phase === 'closed' ||
      room.members.length >= MAX_MEMBERS
    )
      return { code, available: false, requiresPassword: false };
    return {
      code,
      available: true,
      requiresPassword: room.access?.requiresPassword ?? false,
    };
  }

  async resume(
    code: string,
    token: string,
    context?: RetroRepositoryContext,
  ): Promise<RetroSession> {
    return this.transact(
      code,
      (room) => {
        const member = this.memberByToken(room, token);
        if (!member)
          throw new RetroError(
            'invalid-session',
            'This session is no longer available. Join again.',
          );
        if (room.phase !== 'closed') {
          member.connected = true;
          member.offlineExpiresAt = null;
        }
        return { result: { code, id: member.id, token } };
      },
      context,
    );
  }

  /**
   * Rotate a bearer credential before a browser reconnects. The old socket is
   * detached in the same repository transaction, so a delayed request cannot
   * restore a stale token after a newer rotation.
   */
  async rotateSession(
    code: string,
    token: string,
    context?: RetroRepositoryContext,
  ): Promise<RetroSessionRotation> {
    return this.transact(
      code,
      (room) => {
        const member = this.memberByToken(room, token);
        if (!member)
          throw new RetroError(
            'invalid-session',
            'This session is no longer available. Join again.',
          );
        const previousConnection = member.connection ?? undefined;
        const nextToken = nanoid(32);
        member.tokenHash = hashSessionToken(nextToken);
        member.connection = null;
        if (room.phase !== 'closed') {
          member.connected = false;
          member.offlineExpiresAt = Date.now() + RETRO_OFFLINE_RETENTION_MS;
        }
        return {
          result: {
            session: { code, id: member.id, token: nextToken },
            ...(previousConnection ? { previousConnection } : {}),
          },
          ...(previousConnection
            ? {
                change: {
                  kind: 'session-replaced' as const,
                  memberId: member.id,
                  previousConnection,
                },
              }
            : {}),
        };
      },
      context,
    );
  }

  /** Rotate and revoke a remembered browser session without deleting content. */
  async forgetSession(
    code: string,
    token: string,
    context?: RetroRepositoryContext,
  ): Promise<{ previousConnection?: RetroConnection }> {
    return this.transact(
      code,
      (room) => {
        const member = this.memberByToken(room, token);
        if (!member)
          throw new RetroError(
            'invalid-session',
            'This session is no longer available. Join again.',
          );
        const previousConnection = member.connection ?? undefined;
        member.tokenHash = hashSessionToken(nanoid(32));
        member.connection = null;
        if (room.phase !== 'closed') {
          member.connected = false;
          member.offlineExpiresAt = Date.now() + RETRO_OFFLINE_RETENTION_MS;
        }
        return {
          result: previousConnection ? { previousConnection } : {},
          ...(previousConnection
            ? {
                change: {
                  kind: 'session-forgotten' as const,
                  memberId: member.id,
                  previousConnection,
                },
              }
            : {}),
        };
      },
      context,
    );
  }

  /** Inspect identity metadata without changing presence or room content. */
  async inspectSession(
    code: string,
    token: string,
    context?: RetroRepositoryContext,
  ): Promise<RetroRememberedIdentity> {
    const room = await this.room(code, context);
    const member = this.memberByToken(room, token);
    if (!member)
      throw new RetroError(
        'invalid-session',
        'This session is no longer available. Join as someone else.',
      );
    return {
      code,
      name: member.name,
      moderator: member.role === 'moderator',
    };
  }

  /** Resume and claim the connection in the same optimistic transaction. */
  async resumeWithConnection(
    code: string,
    token: string,
    connection: RetroConnection,
    context?: RetroRepositoryContext,
  ): Promise<{ session: RetroSession; previousConnection?: RetroConnection }> {
    return this.transact(
      code,
      (room) => {
        const member = this.memberByToken(room, token);
        if (!member)
          throw new RetroError(
            'invalid-session',
            'This session is no longer available. Join again.',
          );
        const previousConnection = member.connection ?? undefined;
        if (room.phase !== 'closed') {
          member.connected = true;
          member.offlineExpiresAt = null;
        }
        member.connection = connection;
        const replaced =
          previousConnection &&
          (previousConnection.instanceId !== connection.instanceId ||
            previousConnection.connectionId !== connection.connectionId);
        return {
          result: {
            session: { code, id: member.id, token },
            ...(previousConnection ? { previousConnection } : {}),
          },
          ...(replaced
            ? {
                change: {
                  kind: 'session-replaced' as const,
                  memberId: member.id,
                  replacement: { participantId: member.id, owner: connection },
                },
              }
            : {}),
        };
      },
      context,
    );
  }

  /** Claim a connection after create/join, without exposing it in room state. */
  async connect(
    session: RetroSession,
    connection: RetroConnection,
    context?: RetroRepositoryContext,
  ): Promise<RetroConnection | undefined> {
    return this.transact(
      session.code,
      (room) => {
        const member = this.authorizeInRoom(room, session);
        const previousConnection = member.connection ?? undefined;
        if (room.phase !== 'closed') {
          member.connected = true;
          member.offlineExpiresAt = null;
        }
        member.connection = connection;
        const replaced =
          previousConnection &&
          (previousConnection.instanceId !== connection.instanceId ||
            previousConnection.connectionId !== connection.connectionId);
        return {
          result: previousConnection,
          ...(replaced
            ? {
                change: {
                  kind: 'session-replaced' as const,
                  memberId: member.id,
                  replacement: { participantId: member.id, owner: connection },
                },
              }
            : {}),
        };
      },
      context,
    );
  }

  async disconnect(
    session: RetroSession,
    connection?: RetroConnection,
    context?: RetroRepositoryContext,
  ): Promise<boolean> {
    try {
      return await this.transact(
        session.code,
        (room) => {
          const member = room.members.find(
            (candidate) =>
              candidate.id === session.id &&
              tokenMatches(session.token, candidate.tokenHash),
          );
          if (!member) return { result: false };
          if (
            connection &&
            (!member.connection ||
              member.connection.instanceId !== connection.instanceId ||
              member.connection.connectionId !== connection.connectionId)
          )
            return { result: false };

          const hadConnection = member.connection !== null;
          member.connection = null;
          if (room.phase === 'closed' || !member.connected)
            return { result: hadConnection };
          member.connected = false;
          member.offlineExpiresAt = Date.now() + RETRO_OFFLINE_RETENTION_MS;
          return { result: true };
        },
        context,
      );
    } catch (error) {
      if (error instanceof RetroRepositoryError) return false;
      throw error;
    }
  }

  async snapshot(
    session: RetroSession,
    context?: RetroRepositoryContext,
  ): Promise<RetroRoom> {
    const room = await this.room(session.code, context);
    const member = this.authorizeInRoom(room, session);
    return this.projectRoom(room, member.id);
  }

  /** Read a committed room once; authorize each recipient against that same version. */
  async prepareBroadcast(code: string, context?: RetroRepositoryContext) {
    const stored = await this.room(code, context);
    let cached = this.projections.get(code);
    if (
      !cached ||
      cached.version !== stored.version ||
      cached.expiresAt !== stored.expiresAt
    ) {
      cached = {
        version: stored.version,
        expiresAt: stored.expiresAt,
        room: this.projectRoom(stored, ''),
      };
      // Bounded independently of room expiry, including code reuse.
      if (this.projections.size >= MAX_ROOMS)
        this.projections.delete(this.projections.keys().next().value!);
      this.projections.set(code, cached);
    }
    return {
      version: stored.version,
      room: cached.room,
      recipient: (session: RetroSession) => {
        const member = this.authorizeInRoom(stored, session);
        return retroRecipientEnvelopeSchema.parse({
          notes:
            stored.phase === 'write'
              ? stored.notes
                  .filter((note) => note.authorId === member.id)
                  .map(({ voterIds: _votes, ...note }) => ({
                    ...note,
                    voteCount: null,
                    votedBySelf: false,
                  }))
              : [],
          votedNoteIds:
            stored.phase === 'vote'
              ? stored.notes
                  .filter(
                    (note) =>
                      !note.groupId && note.voterIds.includes(member.id),
                  )
                  .map((note) => note.id)
              : [],
          votedGroupIds:
            stored.phase === 'vote'
              ? stored.groups
                  .filter((group) => group.voterIds.includes(member.id))
                  .map((group) => group.id)
              : [],
        });
      },
    };
  }

  private projectRoom(room: StoredRetroRoom, memberId: string): RetroRoom {
    const { readyMemberIds, groups } = room;
    // Writing is private even for moderators. Advancing to vote changes the
    // phase before one broadcast reveals the complete board to everyone.
    const notes =
      room.phase === 'write'
        ? room.notes.filter((note) => note.authorId === memberId)
        : room.notes;
    // Keep the public shape explicit. Internal access verifiers, participant
    // token digests, connection ownership, readiness storage, and voter
    // identities must never be spread into a network snapshot.
    return retroPublicRoomSchema.parse(
      structuredClone({
        code: room.code,
        title: room.title,
        phase: room.phase,
        expiresAt: room.expiresAt,
        closedAt: room.closedAt,
        actions: room.actions,
        requiresPassword: room.access?.requiresPassword ?? false,
        members: room.members.map(({ id, name, role, connected }) => ({
          id,
          name,
          moderator: role === 'moderator',
          connected,
          ready: readyMemberIds.includes(id),
        })),
        notes: notes.map(({ voterIds, ...note }) => ({
          ...note,
          voteCount:
            !note.groupId &&
            (room.phase === 'discuss' || room.phase === 'closed')
              ? voterIds.length
              : null,
          votedBySelf:
            !note.groupId &&
            room.phase === 'vote' &&
            voterIds.includes(memberId),
        })),
        groups: groups.map(({ voterIds, ...group }) => ({
          ...group,
          voteCount:
            room.phase === 'discuss' || room.phase === 'closed'
              ? voterIds.length
              : null,
          votedBySelf: room.phase === 'vote' && voterIds.includes(memberId),
        })),
      }),
    );
  }

  async mutate(
    session: RetroSession,
    command: Exclude<
      RetroCommand,
      { type: 'create' | 'join' | 'resume' | 'inspect' | 'refresh' }
    >,
    context?: RetroRepositoryContext,
  ): Promise<RetroMutationResult | undefined> {
    return this.transact(
      session.code,
      (room) => {
        const member = this.authorizeInRoom(room, session);
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
            room.members = room.members.filter(
              (candidate) => candidate.id !== removed.id,
            );
            room.readyMemberIds = room.readyMemberIds.filter(
              (id) => id !== removed.id,
            );
            for (const target of [...room.notes, ...room.groups])
              target.voterIds = target.voterIds.filter(
                (id) => id !== removed.id,
              );
            return {
              result: { removedMemberId: removed.id },
              change: { kind: 'member-removed' as const, memberId: removed.id },
            };
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
            return { result: undefined };
          }
          case 'claim-moderator':
            if (
              !this.canClaimModerator(room, member) ||
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
            return { result: undefined };
          case 'advance': {
            this.requireModerator(member);
            const next = {
              write: 'group',
              group: 'vote',
              vote: 'discuss',
              discuss: 'closed',
            } as const;
            room.phase = next[room.phase];
            if (room.phase === 'closed') room.closedAt = Date.now();
            room.readyMemberIds = [];
            return {
              result: undefined,
              change: {
                kind: room.phase === 'closed' ? ('closed' as const) : undefined,
              },
            };
          }
          case 'toggle-ready':
            if (room.phase !== 'write' && room.phase !== 'vote')
              throw new RetroError(
                'wrong-phase',
                'Readiness is only available while writing or voting.',
              );
            if (room.readyMemberIds.includes(member.id))
              room.readyMemberIds = room.readyMemberIds.filter(
                (id) => id !== member.id,
              );
            else room.readyMemberIds.push(member.id);
            return { result: undefined };
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
            return { result: undefined };
          case 'edit-note': {
            this.requirePhase(room, 'write');
            const note = this.note(room, command.id);
            if (note.authorId !== member.id)
              throw new RetroError(
                'forbidden',
                'You can only change your own notes.',
              );
            note.text = command.text;
            return { result: undefined };
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
            room.notes = room.notes.filter(
              (candidate) => candidate.id !== note.id,
            );
            this.cleanupGroups(room);
            return { result: undefined };
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
            const group: StoredRetroGroup = {
              id: nanoid(),
              title: command.title,
              voterIds: [],
            };
            room.groups.push(group);
            for (const note of notes) note.groupId = group.id;
            return { result: undefined };
          }
          case 'move-note': {
            this.requireModerator(member);
            this.requirePhase(room, 'group');
            const note = this.note(room, command.id);
            const group = room.groups.find(
              (item) => item.id === command.groupId,
            );
            if (!group)
              throw new RetroError('not-found', 'That theme no longer exists.');
            note.groupId = group.id;
            this.cleanupGroups(room);
            return { result: undefined };
          }
          case 'ungroup-note': {
            this.requireModerator(member);
            this.requirePhase(room, 'group');
            const note = this.note(room, command.id);
            if (!note.groupId)
              throw new RetroError('not-found', 'That note is not in a theme.');
            note.groupId = null;
            this.cleanupGroups(room);
            return { result: undefined };
          }
          case 'toggle-vote': {
            this.requirePhase(room, 'vote');
            const target = this.voteTarget(room, command.id);
            if (target.voterIds.includes(member.id)) {
              target.voterIds = target.voterIds.filter(
                (id) => id !== member.id,
              );
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
            return { result: undefined };
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
            return { result: undefined };
          case 'edit-action': {
            this.requireModerator(member);
            this.requirePhase(room, 'discuss');
            const action = room.actions.find((item) => item.id === command.id);
            if (!action)
              throw new RetroError(
                'not-found',
                'That action no longer exists.',
              );
            const owner = this.actionOwner(room, command.owner, action.owner);
            action.text = command.text;
            action.owner = owner;
            return { result: undefined };
          }
          case 'toggle-action':
          case 'delete-action': {
            this.requireModerator(member);
            this.requirePhase(room, 'discuss');
            const action = room.actions.find((item) => item.id === command.id);
            if (!action)
              throw new RetroError(
                'not-found',
                'That action no longer exists.',
              );
            if (command.type === 'toggle-action') action.done = !action.done;
            else
              room.actions = room.actions.filter(
                (action) => action.id !== command.id,
              );
            return { result: undefined };
          }
        }
        throw new RetroError(
          'invalid-command',
          'Unsupported retrospective command.',
        );
      },
      context,
    );
  }

  async connectionOwner(
    code: string,
    memberId: string,
    context?: RetroRepositoryContext,
  ): Promise<RetroConnection | undefined> {
    const room = await this.repository.get(code, context);
    return (
      room?.members.find((member) => member.id === memberId)?.connection ??
      undefined
    );
  }

  async isExpired(code: string): Promise<boolean> {
    return this.repository.isExpired(code, Date.now());
  }

  async sweep(context?: RetroRepositoryContext): Promise<string[]> {
    return this.repository.sweep(Date.now(), context);
  }

  onModuleDestroy() {
    this.unsubscribeMemberChanges();
    this.memberExpiredListeners.clear();
  }

  private async room(
    code: string,
    context?: RetroRepositoryContext,
  ): Promise<StoredRetroRoom> {
    const room = await this.repository.get(code, context);
    if (!room || room.expiresAt <= Date.now()) {
      // The periodic sweep owns deletion so it can notify all attached sockets.
      throw new RetroError(
        'room-expired',
        'This room expired or does not exist. Create a new retrospective.',
      );
    }
    return room;
  }

  private authorizeInRoom(room: StoredRetroRoom, session: RetroSession) {
    const member = room.members.find(
      (candidate) =>
        candidate.id === session.id &&
        tokenMatches(session.token, candidate.tokenHash),
    );
    if (!member)
      throw new RetroError(
        'invalid-session',
        'Join a room before making changes.',
      );
    return member;
  }

  private async transact<T>(
    code: string,
    operation: RetroRoomOperation<T>,
    context?: RetroRepositoryContext,
  ): Promise<T> {
    try {
      return await this.repository.update(code, operation, context);
    } catch (error) {
      if (error instanceof RetroRepositoryError)
        throw new RetroError(
          'room-expired',
          'This room expired or does not exist. Create a new retrospective.',
        );
      throw error;
    }
  }

  private createParticipant(name: string, role: CollaborationRole) {
    const participant = this.participants.create(this.validName(name), role);
    const { token, ...withoutToken } = participant;
    const member: StoredRetroParticipant = {
      ...withoutToken,
      tokenHash: hashSessionToken(token),
      offlineExpiresAt: null,
      connection: null,
    };
    return { token, member };
  }

  private validName(name: string) {
    const normalized = this.participants.normalizeName(name);
    const error = this.participants.validateName(normalized);
    if (error) throw new RetroError('invalid-command', error);
    return normalized;
  }

  private requireModerator(member: StoredRetroParticipant) {
    if (member.role !== 'moderator')
      throw new RetroError('forbidden', 'Only the moderator can do that.');
  }

  private canClaimModerator(
    room: StoredRetroRoom,
    member: StoredRetroParticipant,
  ) {
    return (
      member.role === 'moderator' ||
      !room.members.some(
        (candidate) => candidate.role === 'moderator' && candidate.connected,
      )
    );
  }

  private setModerator(
    room: StoredRetroRoom,
    moderator: StoredRetroParticipant,
  ) {
    for (const member of room.members) member.role = 'participant';
    moderator.role = 'moderator';
  }

  private member(room: StoredRetroRoom, id: string) {
    const member = room.members.find((candidate) => candidate.id === id);
    if (!member)
      throw new RetroError('not-found', 'That participant no longer exists.');
    return member;
  }

  private memberByToken(room: StoredRetroRoom, token: string) {
    return room.members.find((member) => tokenMatches(token, member.tokenHash));
  }

  private actionOwner(
    room: StoredRetroRoom,
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

  private requirePhase(room: StoredRetroRoom, phase: RetroRoom['phase']) {
    if (room.phase !== phase)
      throw new RetroError(
        'wrong-phase',
        `This action is only available during the ${phase} phase.`,
      );
  }

  private cleanupGroups(room: StoredRetroRoom) {
    const retained = new Set<string>();
    for (const group of room.groups) {
      const notes = room.notes.filter((note) => note.groupId === group.id);
      if (notes.length >= 2) retained.add(group.id);
      else for (const note of notes) note.groupId = null;
    }
    room.groups = room.groups.filter((group) => retained.has(group.id));
  }

  private voteTarget(
    room: StoredRetroRoom,
    id: string,
  ): StoredRetroNote | StoredRetroGroup {
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

  private note(room: StoredRetroRoom, id: string) {
    const note = room.notes.find((note) => note.id === id);
    if (!note) throw new RetroError('not-found', 'That note no longer exists.');
    return note;
  }
}
