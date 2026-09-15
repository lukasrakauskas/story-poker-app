import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RetentionService } from '../collaboration/retention.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import {
  RETRO_LIFETIME_MS,
  RETRO_OFFLINE_RETENTION_MS,
  RetroService,
  type RetroSession,
} from './retro.service.js';
import { retroCommandSchema } from './retro.schema.js';

function createService() {
  return new RetroService(
    new ParticipantService(),
    new RoomRegistryService(),
    new RetentionService(),
  );
}

let service: RetroService;
let owner: RetroSession;
let guest: RetroSession;
beforeEach(() => {
  vi.useFakeTimers();
  service = createService();
  owner = service.create('Alice', 'Sprint retrospective');
  guest = service.join(owner.code, 'Bobby');
});
afterEach(() => vi.useRealTimers());
function add(text = 'Great teamwork') {
  service.mutate(owner, { type: 'add-note', column: 'went-well', text });
  return service.snapshot(owner).notes.at(-1)!.id;
}

describe('room lifecycle and privacy', () => {
  it('recovers stale capacity and names after five minutes while retaining author and owner display', () => {
    service.mutate(guest, {
      type: 'add-note',
      column: 'ideas',
      text: 'Original author',
    });
    for (let i = 0; i < 28; i++) service.join(owner.code, `Member ${i}`);
    expect(() => service.join(owner.code, 'Carol')).toThrow('full');
    for (let i = 0; i < 3; i++) service.mutate(owner, { type: 'advance' });
    service.mutate(owner, {
      type: 'add-action',
      text: 'Follow up',
      owner: { kind: 'participant', participantId: guest.id },
    });
    const expired = vi.fn();
    service.onMemberExpired(expired);
    service.disconnect(guest);
    vi.advanceTimersByTime(RETRO_OFFLINE_RETENTION_MS - 1);
    expect(() => service.join(owner.code, 'Carol')).toThrow('full');
    service.disconnect(guest); // Repeated disconnect must not extend the window.
    vi.advanceTimersByTime(1);
    expect(expired).toHaveBeenCalledWith(owner.code, guest.id);
    expect(() => service.resume(guest.code, guest.token)).toThrow(
      'no longer available',
    );
    const replacement = service.join(owner.code, 'Bobby');
    expect(replacement.id).not.toBe(guest.id);
    expect(service.snapshot(owner).notes[0]).toMatchObject({
      authorId: guest.id,
      authorName: 'Bobby',
      text: 'Original author',
    });
    expect(service.snapshot(owner).actions[0].owner).toEqual({
      kind: 'participant',
      participantId: guest.id,
      name: 'Bobby',
    });
  });

  it('cancels stale cleanup on resume and coordinates moderator expiry with recovery', () => {
    const noteId = add('Keep identity');
    service.mutate(owner, { type: 'advance' });
    service.mutate(owner, { type: 'advance' });
    service.mutate(owner, { type: 'toggle-vote', id: noteId });
    service.disconnect(owner);
    vi.advanceTimersByTime(RETRO_OFFLINE_RETENTION_MS - 1);
    service.resume(owner.code, owner.token);
    vi.advanceTimersByTime(RETRO_OFFLINE_RETENTION_MS);
    expect(
      service.snapshot(owner).members.find((member) => member.id === owner.id)
        ?.moderator,
    ).toBe(true);
    expect(service.snapshot(owner).notes[0]).toMatchObject({
      authorId: owner.id,
      votedBySelf: true,
    });
    service.disconnect(owner);
    vi.advanceTimersByTime(RETRO_OFFLINE_RETENTION_MS);
    expect(service.snapshot(guest).members).toHaveLength(1);
    service.mutate(guest, { type: 'claim-moderator' });
    expect(service.snapshot(guest).members[0].moderator).toBe(true);
    expect(() => service.resume(owner.code, owner.token)).toThrow(
      'no longer available',
    );
  });
  it('inspects identity without reconnecting, and forgets only that room credential', () => {
    const noteId = add('Owned before forgetting');
    const originalToken = owner.token;
    service.disconnect(owner);

    expect(service.inspect(owner.code, originalToken)).toEqual({
      code: owner.code,
      name: 'Alice',
      moderator: true,
    });
    expect(service.snapshot(guest).members[0]).toMatchObject({
      id: owner.id,
      connected: false,
      moderator: true,
    });

    expect(service.forget(owner.code, originalToken)).toEqual({
      code: owner.code,
      id: owner.id,
      wasConnected: false,
    });
    expect(() => service.inspect(owner.code, originalToken)).toThrow(
      'Join as someone else',
    );
    expect(() => service.resume(owner.code, originalToken)).toThrow(
      'Join as someone else',
    );
    service.mutate(guest, { type: 'claim-moderator' });
    service.mutate(guest, { type: 'advance' });
    const replacement = service.join(owner.code, 'Carol');
    expect(replacement.id).not.toBe(owner.id);
    expect(service.snapshot(replacement).members).toContainEqual(
      expect.objectContaining({ id: owner.id, name: 'Alice' }),
    );
    expect(service.snapshot(replacement).notes).toContainEqual(
      expect.objectContaining({
        id: noteId,
        authorId: owner.id,
        authorName: 'Alice',
      }),
    );
  });

  it('does not leave a forgotten connected moderator online', () => {
    const originalToken = owner.token;
    expect(service.forget(owner.code, originalToken)).toEqual({
      code: owner.code,
      id: owner.id,
      wasConnected: true,
    });
    expect(service.snapshot(guest).members[0]).toMatchObject({
      id: owner.id,
      connected: false,
      moderator: true,
    });
    service.mutate(guest, { type: 'claim-moderator' });
    expect(service.snapshot(guest).members[1].moderator).toBe(true);
  });

  it('keeps rooms isolated, credentials private and snapshots detached', () => {
    add();
    const other = service.create('Carol', 'Other room');
    expect(service.snapshot(other).notes).toEqual([]);
    const snapshot = service.snapshot(owner);
    expect(snapshot.members).toHaveLength(2);
    expect(JSON.stringify(snapshot)).not.toContain('token');
    snapshot.notes[0].text = 'tampered';
    snapshot.members.pop();
    expect(service.snapshot(owner).notes[0].text).toBe('Great teamwork');
    expect(service.snapshot(owner).members).toHaveLength(2);
    expect(() => service.snapshot({ ...owner, token: guest.token })).toThrow(
      'Join a room',
    );
    expect(() => service.resume(other.code, owner.token)).toThrow('session');
  });

  it('keeps writing private per participant and reveals every note on advance', () => {
    add('Owner thought');
    service.mutate(guest, {
      type: 'add-note',
      column: 'improve',
      text: 'Guest thought',
    });

    expect(service.snapshot(owner).notes.map((note) => note.text)).toEqual([
      'Owner thought',
    ]);
    expect(service.snapshot(guest).notes.map((note) => note.text)).toEqual([
      'Guest thought',
    ]);

    service.disconnect(guest);
    service.resume(guest.code, guest.token);
    expect(service.snapshot(guest).notes.map((note) => note.text)).toEqual([
      'Guest thought',
    ]);

    service.mutate(owner, { type: 'advance' });
    const revealed = ['Owner thought', 'Guest thought'];
    expect(service.snapshot(owner).notes.map((note) => note.text)).toEqual(
      revealed,
    );
    expect(service.snapshot(guest).notes.map((note) => note.text)).toEqual(
      revealed,
    );
  });

  it('reserves names and resumes disconnected members without extending expiry', () => {
    const expiresAt = service.snapshot(owner).expiresAt;
    service.disconnect(owner);
    expect(service.snapshot(guest).members[0].connected).toBe(false);
    expect(() => service.join(owner.code, 'ALICE')).toThrow('already in use');
    vi.advanceTimersByTime(60_000);
    expect(service.resume(owner.code, owner.token)).toEqual(owner);
    expect(service.snapshot(owner).members[0].connected).toBe(true);
    expect(service.snapshot(owner).expiresAt).toBe(expiresAt);
  });

  it('rejects expired rooms immediately and removes them on sweep', () => {
    vi.advanceTimersByTime(RETRO_LIFETIME_MS);
    expect(() => service.join(owner.code, 'Carol')).toThrow('expired');
    expect(() => service.mutate(owner, { type: 'advance' })).toThrow('expired');
    expect(() => service.resume(owner.code, owner.token)).toThrow('expired');
    expect(service.sweep()).toEqual([owner.code]);
    expect(service.sweep()).toEqual([]);
    expect(service.isExpired(owner.code)).toBe(true);
    expect(createService().isExpired(owner.code)).toBe(true);
  });

  it('bounds room and participant counts', () => {
    for (let i = 2; i < 30; i++) service.join(owner.code, `User ${i}`);
    expect(() => service.join(owner.code, 'Overflow')).toThrow('full');
    for (let i = 1; i < 100; i++) service.create('Alice', `Room ${i}`);
    expect(() => service.create('Alice', 'Overflow')).toThrow('in use');
    vi.advanceTimersByTime(RETRO_LIFETIME_MS);
    expect(service.create('Alice', 'Fresh').code).toEqual(expect.any(String));
  });
});

describe('retrospective workflow', () => {
  it('bounds note and action storage', () => {
    for (let i = 0; i < 300; i++)
      service.mutate(owner, {
        type: 'add-note',
        column: 'ideas',
        text: `Note ${i}`,
      });
    expect(() => add()).toThrow('300-note limit');
    service.mutate(owner, { type: 'advance' });
    service.mutate(owner, { type: 'advance' });
    service.mutate(owner, { type: 'advance' });
    for (let i = 0; i < 100; i++)
      service.mutate(owner, {
        type: 'add-action',
        text: `Action ${i}`,
        owner: { kind: 'unassigned' },
      });
    expect(() =>
      service.mutate(owner, {
        type: 'add-action',
        text: 'Overflow',
        owner: { kind: 'unassigned' },
      }),
    ).toThrow('100-action limit');
    const id = service.snapshot(owner).actions[0].id;
    expect(() => service.mutate(guest, { type: 'toggle-action', id })).toThrow(
      'moderator',
    );
    expect(() => service.mutate(guest, { type: 'delete-action', id })).toThrow(
      'moderator',
    );
    expect(() =>
      service.mutate(owner, { type: 'toggle-action', id: 'missing' }),
    ).toThrow('no longer exists');
  });
  it('enforces note authorship, phase permissions and moderator controls', () => {
    const id = add();
    expect(() =>
      service.mutate(guest, { type: 'edit-note', id, text: 'Stolen' }),
    ).toThrow('own notes');
    expect(() => service.mutate(guest, { type: 'delete-note', id })).toThrow(
      'its author',
    );
    service.mutate(owner, { type: 'edit-note', id, text: 'Updated' });
    expect(service.snapshot(owner).notes[0].text).toBe('Updated');
    expect(() => service.mutate(guest, { type: 'advance' })).toThrow(
      'moderator',
    );
    expect(() => service.mutate(owner, { type: 'toggle-vote', id })).toThrow(
      'vote phase',
    );
    service.mutate(owner, { type: 'delete-note', id });
    expect(service.snapshot(owner).notes).toEqual([]);
    service.mutate(owner, { type: 'advance' });
    expect(() => add()).toThrow('write phase');
    expect(() =>
      service.mutate(owner, { type: 'edit-note', id, text: 'Late' }),
    ).toThrow('write phase');
  });

  it('authorizes moderation, revokes removed sessions, and preserves attribution', () => {
    const ownerNote = add('Owner note');
    service.mutate(guest, {
      type: 'add-note',
      column: 'ideas',
      text: 'Delete after reveal',
    });
    service.mutate(guest, {
      type: 'add-note',
      column: 'improve',
      text: 'Retain after removal',
    });
    const guestNoteIds = service.snapshot(guest).notes.map((note) => note.id);
    expect(() =>
      service.mutate(guest, { type: 'delete-note', id: ownerNote }),
    ).toThrow('its author');
    expect(() =>
      service.mutate(guest, {
        type: 'remove-member',
        memberId: owner.id,
      }),
    ).toThrow('moderator');
    expect(() =>
      service.mutate(owner, {
        type: 'remove-member',
        memberId: owner.id,
      }),
    ).toThrow('Transfer moderation');

    service.mutate(owner, { type: 'advance' });
    expect(() =>
      service.mutate(guest, { type: 'delete-note', id: ownerNote }),
    ).toThrow('moderator');
    service.mutate(owner, { type: 'advance' });
    service.mutate(guest, { type: 'toggle-vote', id: ownerNote });
    service.mutate(guest, { type: 'toggle-vote', id: guestNoteIds[0] });
    service.mutate(owner, { type: 'delete-note', id: guestNoteIds[0] });
    expect(service.snapshot(owner).notes.map((note) => note.id)).not.toContain(
      guestNoteIds[0],
    );
    expect(
      service.snapshot(guest).notes.filter((note) => note.votedBySelf),
    ).toHaveLength(1);

    expect(
      service.mutate(owner, {
        type: 'remove-member',
        memberId: guest.id,
      }),
    ).toEqual({ removedMemberId: guest.id });
    const afterRemoval = service.snapshot(owner);
    expect(afterRemoval.members.map((member) => member.id)).toEqual([owner.id]);
    expect(
      afterRemoval.notes.find((note) => note.id === guestNoteIds[1]),
    ).toMatchObject({ authorId: guest.id, authorName: 'Bobby' });
    expect(() => service.resume(guest.code, guest.token)).toThrow('session');
    service.mutate(owner, { type: 'advance' });
    expect(
      service.snapshot(owner).notes.find((note) => note.id === ownerNote)
        ?.voteCount,
    ).toBe(0);
  });

  it('transfers moderation and recovers it only while no moderator is connected', () => {
    const third = service.join(owner.code, 'Carol');
    service.mutate(owner, {
      type: 'transfer-moderator',
      memberId: guest.id,
    });
    expect(
      service.snapshot(owner).members.map(({ id, moderator }) => ({
        id,
        moderator,
      })),
    ).toEqual([
      { id: owner.id, moderator: false },
      { id: guest.id, moderator: true },
      { id: third.id, moderator: false },
    ]);
    expect(() => service.mutate(owner, { type: 'advance' })).toThrow(
      'moderator',
    );
    expect(() => service.mutate(owner, { type: 'claim-moderator' })).toThrow(
      'already connected',
    );

    service.disconnect(guest);
    service.mutate(owner, { type: 'claim-moderator' });
    expect(
      service.snapshot(owner).members.filter((item) => item.moderator),
    ).toEqual([expect.objectContaining({ id: owner.id })]);
    expect(() => service.mutate(third, { type: 'claim-moderator' })).toThrow(
      'already connected',
    );
    expect(() =>
      service.mutate(owner, {
        type: 'transfer-moderator',
        memberId: guest.id,
      }),
    ).toThrow('currently connected');
    expect(() =>
      service.mutate(owner, {
        type: 'transfer-moderator',
        memberId: 'missing',
      }),
    ).toThrow('no longer exists');

    service.disconnect(owner);
    service.mutate(third, { type: 'claim-moderator' });
    service.resume(owner.code, owner.token);
    expect(
      service.snapshot(owner).members.filter((item) => item.moderator),
    ).toEqual([expect.objectContaining({ id: third.id })]);
  });

  it('tracks current-phase readiness across joins, disconnects, and resumes', () => {
    expect(
      service.snapshot(owner).members.map((member) => member.ready),
    ).toEqual([false, false]);
    service.mutate(owner, { type: 'toggle-ready' });
    service.mutate(guest, { type: 'toggle-ready' });
    expect(
      service.snapshot(owner).members.map((member) => member.ready),
    ).toEqual([true, true]);

    service.disconnect(guest);
    expect(service.snapshot(owner).members[1]).toMatchObject({
      connected: false,
      ready: true,
    });
    const late = service.join(owner.code, 'Carol');
    expect(service.snapshot(late).members[2]).toMatchObject({
      connected: true,
      ready: false,
    });
    service.resume(guest.code, guest.token);
    expect(service.snapshot(guest).members[1]).toMatchObject({
      connected: true,
      ready: true,
    });

    service.mutate(owner, { type: 'advance' });
    expect(
      service.snapshot(owner).members.every((member) => !member.ready),
    ).toBe(true);
    expect(() => service.mutate(guest, { type: 'toggle-ready' })).toThrow(
      'writing or voting',
    );
    service.mutate(owner, { type: 'advance' });
    service.mutate(guest, { type: 'toggle-ready' });
    expect(service.snapshot(owner).members[1].ready).toBe(true);
    service.mutate(guest, { type: 'toggle-ready' });
    expect(service.snapshot(owner).members[1].ready).toBe(false);
    service.mutate(owner, { type: 'advance' });
    expect(() => service.mutate(guest, { type: 'toggle-ready' })).toThrow(
      'writing or voting',
    );
  });

  it('preserves server note creation order through grouping, deletion and resume', () => {
    const ids = [add('First'), add('Second'), add('Third'), add('Fourth')];
    service.mutate(owner, { type: 'advance' });
    service.mutate(owner, {
      type: 'group-notes',
      title: 'Theme',
      noteIds: [ids[2], ids[0]],
    });
    expect(service.snapshot(guest).notes.map((note) => note.id)).toEqual(ids);
    service.mutate(owner, { type: 'delete-note', id: ids[1] });
    service.mutate(owner, { type: 'advance' });
    service.mutate(owner, { type: 'advance' });
    service.disconnect(guest);
    service.resume(guest.code, guest.token);
    expect(service.snapshot(guest).notes.map((note) => note.id)).toEqual([
      ids[0],
      ids[2],
      ids[3],
    ]);
  });

  it('groups revealed notes into stable theme voting targets', () => {
    const first = add('Slow reviews');
    const second = add('Long feedback loops');
    service.mutate(guest, {
      type: 'add-note',
      column: 'ideas',
      text: 'Pair earlier',
    });
    const ungrouped = service.snapshot(guest).notes[0].id;
    service.mutate(owner, { type: 'advance' });

    expect(() =>
      service.mutate(guest, {
        type: 'group-notes',
        title: 'Review flow',
        noteIds: [first, second],
      }),
    ).toThrow('moderator');
    service.mutate(owner, {
      type: 'group-notes',
      title: 'Review flow',
      noteIds: [first, second],
    });
    let grouped = service.snapshot(owner);
    expect(grouped.phase).toBe('group');
    expect(grouped.groups).toEqual([
      expect.objectContaining({
        title: 'Review flow',
        voteCount: null,
        votedBySelf: false,
      }),
    ]);
    expect(
      grouped.notes.filter((note) => note.groupId === grouped.groups[0].id),
    ).toHaveLength(2);

    service.mutate(owner, { type: 'ungroup-note', id: first });
    expect(service.snapshot(owner).groups).toEqual([]);
    expect(service.snapshot(owner).notes.every((note) => !note.groupId)).toBe(
      true,
    );
    service.mutate(owner, {
      type: 'group-notes',
      title: 'Review flow',
      noteIds: [first, second],
    });
    grouped = service.snapshot(owner);
    const groupId = grouped.groups[0].id;
    service.mutate(owner, { type: 'advance' });
    expect(() =>
      service.mutate(guest, { type: 'toggle-vote', id: first }),
    ).toThrow('theme');
    service.mutate(guest, { type: 'toggle-vote', id: groupId });
    service.mutate(guest, { type: 'toggle-vote', id: ungrouped });
    expect(service.snapshot(owner).groups[0]).toMatchObject({
      voteCount: null,
      votedBySelf: false,
    });
    expect(service.snapshot(guest).groups[0].votedBySelf).toBe(true);
    expect(
      service.snapshot(guest).notes.find((note) => note.id === ungrouped)
        ?.votedBySelf,
    ).toBe(true);

    service.disconnect(guest);
    service.resume(guest.code, guest.token);
    expect(service.snapshot(guest).groups[0].votedBySelf).toBe(true);
    service.mutate(owner, { type: 'advance' });
    const discussed = service.snapshot(owner);
    expect(discussed.groups[0].voteCount).toBe(1);
    expect(
      discussed.notes.find((note) => note.id === ungrouped)?.voteCount,
    ).toBe(1);
    expect(() =>
      service.mutate(owner, {
        type: 'group-notes',
        title: 'Late',
        noteIds: [first, second],
      }),
    ).toThrow('group phase');
  });

  it('moves notes between stacks without replacing the target theme or attribution', () => {
    const ids = [add('One'), add('Two'), add('Three'), add('Four')];
    service.mutate(owner, { type: 'advance' });
    service.mutate(owner, {
      type: 'group-notes',
      title: 'First',
      noteIds: ids.slice(0, 2),
    });
    service.mutate(owner, {
      type: 'group-notes',
      title: 'Second',
      noteIds: ids.slice(2),
    });
    const before = service.snapshot(owner);
    const target = before.groups[1];
    const command = {
      type: 'move-note' as const,
      id: ids[0],
      groupId: target.id,
    };
    expect(() => service.mutate(guest, command)).toThrow('moderator');
    expect(() =>
      service.mutate(owner, { ...command, groupId: 'missing' }),
    ).toThrow('no longer exists');
    expect(service.snapshot(owner)).toEqual(before);
    service.mutate(owner, command);
    const moved = service.snapshot(guest);
    expect(moved.groups).toEqual([target]);
    expect(moved.notes.find((note) => note.id === ids[0])).toEqual({
      ...before.notes[0],
      groupId: target.id,
    });
    expect(moved.notes.find((note) => note.id === ids[1])?.groupId).toBeNull();
    service.mutate(owner, command); // Idempotent drop onto the same stack.
    service.disconnect(guest);
    service.resume(guest.code, guest.token);
    expect(service.snapshot(guest).groups).toEqual([target]);
    service.mutate(owner, { type: 'advance' });
    expect(() => service.mutate(owner, command)).toThrow('group phase');
  });

  it('keeps open voting blind and anonymous while preserving own selections', () => {
    const ids = [add('One'), add('Two'), add('Three'), add('Four')];
    service.mutate(owner, { type: 'advance' });
    service.mutate(owner, { type: 'advance' });
    ids
      .slice(0, 3)
      .forEach((id) => service.mutate(guest, { type: 'toggle-vote', id }));
    expect(() =>
      service.mutate(guest, { type: 'toggle-vote', id: ids[3] }),
    ).toThrow('three votes');
    service.mutate(guest, { type: 'toggle-vote', id: ids[0] });
    service.mutate(guest, { type: 'toggle-vote', id: ids[3] });
    service.mutate(owner, { type: 'toggle-vote', id: ids[3] });

    const ownerVoting = service.snapshot(owner);
    const guestVoting = service.snapshot(guest);
    expect(ownerVoting.notes.every((note) => note.voteCount === null)).toBe(
      true,
    );
    expect(guestVoting.notes.every((note) => note.voteCount === null)).toBe(
      true,
    );
    expect(ownerVoting.notes.map((note) => note.votedBySelf)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(guestVoting.notes.map((note) => note.votedBySelf)).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(JSON.stringify(ownerVoting)).not.toContain('voterIds');
    expect(JSON.stringify(guestVoting)).not.toContain('voterIds');

    service.disconnect(guest);
    service.resume(guest.code, guest.token);
    expect(
      service.snapshot(guest).notes.map((note) => note.votedBySelf),
    ).toEqual([false, true, true, true]);

    service.mutate(owner, { type: 'advance' });
    const discussed = service.snapshot(owner);
    expect(discussed.notes.map((note) => note.voteCount)).toEqual([0, 1, 1, 2]);
    expect(discussed.notes.every((note) => !note.votedBySelf)).toBe(true);
    expect(JSON.stringify(discussed)).not.toContain('voterIds');
    expect(() =>
      service.mutate(guest, { type: 'toggle-vote', id: 'missing' }),
    ).toThrow('vote phase');
  });

  it('edits structured assignments in place and retains removed-owner snapshots', () => {
    const assignment = {
      kind: 'participant' as const,
      participantId: guest.id,
    };
    expect(() =>
      service.mutate(owner, {
        type: 'edit-action',
        id: 'missing',
        text: 'New',
        owner: assignment,
      }),
    ).toThrow('discuss phase');
    for (let i = 0; i < 3; i++) service.mutate(owner, { type: 'advance' });
    service.mutate(owner, {
      type: 'add-action',
      text: 'Original',
      owner: assignment,
    });
    const id = service.snapshot(owner).actions[0].id;
    service.mutate(owner, { type: 'toggle-action', id });
    const edit = {
      type: 'edit-action' as const,
      id,
      text: 'Corrected',
      owner: assignment,
    };
    expect(() => service.mutate(guest, edit)).toThrow('moderator');
    expect(() => service.mutate(owner, { ...edit, id: 'missing' })).toThrow(
      'no longer exists',
    );
    expect(() =>
      service.mutate(owner, {
        ...edit,
        owner: { kind: 'participant', participantId: 'missing' },
      }),
    ).toThrow('owner');
    expect(service.snapshot(owner).actions[0].text).toBe('Original');
    service.mutate(owner, edit);
    expect(service.snapshot(guest).actions[0]).toEqual({
      id,
      text: 'Corrected',
      done: true,
      owner: { ...assignment, name: 'Bobby' },
    });
    service.mutate(owner, { type: 'remove-member', memberId: guest.id });
    service.mutate(owner, { ...edit, text: 'Still assigned' });
    service.disconnect(owner);
    service.resume(owner.code, owner.token);
    expect(service.snapshot(owner).actions[0]).toEqual({
      id,
      text: 'Still assigned',
      done: true,
      owner: { ...assignment, name: 'Bobby' },
    });
    expect(() =>
      service.mutate(owner, {
        type: 'add-action',
        text: 'Invalid',
        owner: assignment,
      }),
    ).toThrow('owner');
    service.mutate(owner, {
      ...edit,
      owner: { kind: 'participant', participantId: owner.id },
    });
    expect(service.snapshot(owner).actions[0].owner).toEqual({
      kind: 'participant',
      participantId: owner.id,
      name: 'Alice',
    });
    service.mutate(owner, { ...edit, owner: { kind: 'unassigned' } });
    expect(service.snapshot(owner).actions[0]).toMatchObject({
      id,
      done: true,
      owner: { kind: 'unassigned' },
    });
    expect(() => service.mutate(owner, edit)).toThrow('owner');
    service.mutate(owner, {
      ...edit,
      owner: { kind: 'external', name: 'Platform team' },
    });
    service.mutate(owner, { type: 'advance' });
    expect(() => service.mutate(owner, edit)).toThrow('read-only');
  });

  it('freezes completion time and membership across disconnect, resume and offline cleanup', () => {
    add('Final note');
    for (let i = 0; i < 3; i++) service.mutate(owner, { type: 'advance' });
    service.mutate(owner, {
      type: 'add-action',
      text: 'Final action',
      owner: { kind: 'participant', participantId: guest.id },
    });
    service.disconnect(guest);
    service.mutate(owner, { type: 'advance' });
    const final = service.snapshot(owner);
    expect(final.closedAt).toBe(Date.now());
    expect(final.members[1].connected).toBe(false);
    service.disconnect(owner);
    service.resume(guest.code, guest.token);
    vi.advanceTimersByTime(RETRO_OFFLINE_RETENTION_MS + 1);
    service.resume(owner.code, owner.token);
    expect(service.snapshot(owner)).toEqual(final);
    expect(service.snapshot(guest)).toEqual(final);
    expect(() => service.join(owner.code, 'Carol')).toThrow('complete');
    expect(service.snapshot(owner)).toEqual(final);
  });

  it('captures moderator-owned actions and closes read-only', () => {
    expect(() =>
      service.mutate(owner, {
        type: 'add-action',
        text: 'Do it',
        owner: { kind: 'participant', participantId: owner.id },
      }),
    ).toThrow('discuss phase');
    service.mutate(owner, { type: 'advance' });
    service.mutate(owner, { type: 'advance' });
    service.mutate(owner, { type: 'advance' });
    expect(() =>
      service.mutate(guest, {
        type: 'add-action',
        text: 'Do it',
        owner: { kind: 'unassigned' },
      }),
    ).toThrow('moderator');
    service.mutate(owner, {
      type: 'add-action',
      text: 'Follow up',
      owner: { kind: 'participant', participantId: guest.id },
    });
    const id = service.snapshot(owner).actions[0].id;
    service.mutate(owner, { type: 'toggle-action', id });
    expect(service.snapshot(owner).actions[0]).toMatchObject({
      text: 'Follow up',
      owner: { kind: 'participant', participantId: guest.id, name: 'Bobby' },
      done: true,
    });
    service.mutate(owner, { type: 'delete-action', id });
    expect(service.snapshot(owner).actions).toEqual([]);
    service.mutate(owner, { type: 'advance' });
    expect(service.snapshot(owner).phase).toBe('closed');
    expect(() => service.mutate(owner, { type: 'advance' })).toThrow(
      'read-only',
    );
    expect(() =>
      service.mutate(owner, {
        type: 'add-note',
        column: 'ideas',
        text: 'Late',
      }),
    ).toThrow('read-only');
    expect(() => service.join(owner.code, 'Carol')).toThrow(
      'New participants cannot join',
    );
  });
});

it.each([
  null,
  {},
  { type: 'create', name: 'ab', title: 'Room' },
  { type: 'create', name: 'Alice', title: ' ' },
  { type: 'add-note', column: 'wrong', text: 'Hello' },
  { type: 'add-note', column: 'ideas', text: ' ' },
  { type: 'edit-note', id: 'note', text: 'x'.repeat(1001) },
  { type: 'group-notes', title: 'Theme', noteIds: ['only-one'] },
  { type: 'group-notes', title: ' ', noteIds: ['one', 'two'] },
  { type: 'add-action', text: 'Hello', owner: 'x'.repeat(61) },
  {
    type: 'edit-action',
    id: 'action',
    text: ' ',
    owner: { kind: 'unassigned' },
  },
  { type: 'edit-action', id: '', text: 'Hello', owner: { kind: 'unassigned' } },
  {
    type: 'edit-action',
    id: 'action',
    text: 'Hello',
    owner: { kind: 'participant', participantId: '' },
  },
  {
    type: 'edit-action',
    id: 'action',
    text: 'Hello',
    owner: { kind: 'external', name: ' ' },
  },
  {
    type: 'edit-action',
    id: 'action',
    text: 'Hello',
    owner: { kind: 'external', name: 'x'.repeat(61) },
  },
  { type: 'resume', code: 'room', token: '' },
  { type: 'inspect', code: 'room', token: '' },
  { type: 'forget', code: 'room', token: '' },
])('rejects malformed and oversized commands: %j', (command) => {
  expect(retroCommandSchema.safeParse(command).success).toBe(false);
});

it('trims input and ignores untrusted identity fields', () => {
  expect(
    retroCommandSchema.parse({
      type: 'join',
      name: ' Alice ',
      code: 'room',
      moderator: true,
    }),
  ).toEqual({ type: 'join', name: 'Alice', code: 'room' });
});
