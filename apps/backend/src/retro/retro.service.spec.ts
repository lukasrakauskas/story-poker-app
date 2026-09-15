import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParticipantService } from '../collaboration/participant.service.js';
import { InMemoryRetroRoomRepository } from './retro-room.repository.js';
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
    new InMemoryRetroRoomRepository(),
  );
}

let service: RetroService;
let owner: RetroSession;
let guest: RetroSession;
beforeEach(async () => {
  vi.useFakeTimers();
  service = createService();
  owner = await service.create('Alice', 'Sprint retrospective');
  guest = await service.join(owner.code, 'Bobby');
});
afterEach(() => vi.useRealTimers());
async function add(text = 'Great teamwork') {
  await service.mutate(owner, { type: 'add-note', column: 'went-well', text });
  return (await service.snapshot(owner)).notes.at(-1)!.id;
}

describe('room lifecycle and privacy', () => {
  it('recovers stale capacity and names after five minutes while retaining author and owner display', async () => {
    await service.mutate(guest, {
      type: 'add-note',
      column: 'ideas',
      text: 'Original author',
    });
    for (let i = 0; i < 28; i++) await service.join(owner.code, `Member ${i}`);
    await expect(service.join(owner.code, 'Carol')).rejects.toThrow('full');
    for (let i = 0; i < 3; i++)
      await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, {
      type: 'add-action',
      text: 'Follow up',
      owner: { kind: 'participant', participantId: guest.id },
    });
    const expired = vi.fn();
    service.onMemberExpired(expired);
    await service.disconnect(guest);
    vi.advanceTimersByTime(RETRO_OFFLINE_RETENTION_MS - 1);
    await expect(service.join(owner.code, 'Carol')).rejects.toThrow('full');
    await service.disconnect(guest); // Repeated disconnect must not extend the window.
    vi.advanceTimersByTime(1);
    await service.snapshot(owner);
    expect(expired).toHaveBeenCalledWith(owner.code, guest.id);
    await expect(service.resume(guest.code, guest.token)).rejects.toThrow(
      'no longer available',
    );
    const replacement = await service.join(owner.code, 'Bobby');
    expect(replacement.id).not.toBe(guest.id);
    expect((await service.snapshot(owner)).notes[0]).toMatchObject({
      authorId: guest.id,
      authorName: 'Bobby',
      text: 'Original author',
    });
    expect((await service.snapshot(owner)).actions[0].owner).toEqual({
      kind: 'participant',
      participantId: guest.id,
      name: 'Bobby',
    });
  });

  it('cancels stale cleanup on resume and coordinates moderator expiry with recovery', async () => {
    const noteId = await add('Keep identity');
    await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, { type: 'toggle-vote', id: noteId });
    await service.disconnect(owner);
    vi.advanceTimersByTime(RETRO_OFFLINE_RETENTION_MS - 1);
    await service.resume(owner.code, owner.token);
    vi.advanceTimersByTime(RETRO_OFFLINE_RETENTION_MS);
    expect(
      (await service.snapshot(owner)).members.find(
        (member) => member.id === owner.id,
      )?.moderator,
    ).toBe(true);
    expect((await service.snapshot(owner)).notes[0]).toMatchObject({
      authorId: owner.id,
      votedBySelf: true,
    });
    await service.disconnect(owner);
    vi.advanceTimersByTime(RETRO_OFFLINE_RETENTION_MS);
    expect((await service.snapshot(guest)).members).toHaveLength(1);
    await service.mutate(guest, { type: 'claim-moderator' });
    expect((await service.snapshot(guest)).members[0].moderator).toBe(true);
    await expect(service.resume(owner.code, owner.token)).rejects.toThrow(
      'no longer available',
    );
  });
  it('keeps rooms isolated, credentials private and snapshots detached', async () => {
    await add();
    const other = await service.create('Carol', 'Other room');
    expect((await service.snapshot(other)).notes).toEqual([]);
    const snapshot = await service.snapshot(owner);
    expect(snapshot.members).toHaveLength(2);
    expect(JSON.stringify(snapshot)).not.toContain('token');
    snapshot.notes[0].text = 'tampered';
    snapshot.members.pop();
    expect((await service.snapshot(owner)).notes[0].text).toBe(
      'Great teamwork',
    );
    expect((await service.snapshot(owner)).members).toHaveLength(2);
    await expect(
      service.snapshot({ ...owner, token: guest.token }),
    ).rejects.toThrow('Join a room');
    await expect(service.resume(other.code, owner.token)).rejects.toThrow(
      'session',
    );
  });

  it('keeps writing private per participant and reveals every note on advance', async () => {
    await add('Owner thought');
    await service.mutate(guest, {
      type: 'add-note',
      column: 'improve',
      text: 'Guest thought',
    });

    expect(
      (await service.snapshot(owner)).notes.map((note) => note.text),
    ).toEqual(['Owner thought']);
    expect(
      (await service.snapshot(guest)).notes.map((note) => note.text),
    ).toEqual(['Guest thought']);

    await service.disconnect(guest);
    await service.resume(guest.code, guest.token);
    expect(
      (await service.snapshot(guest)).notes.map((note) => note.text),
    ).toEqual(['Guest thought']);

    await service.mutate(owner, { type: 'advance' });
    const revealed = ['Owner thought', 'Guest thought'];
    expect(
      (await service.snapshot(owner)).notes.map((note) => note.text),
    ).toEqual(revealed);
    expect(
      (await service.snapshot(guest)).notes.map((note) => note.text),
    ).toEqual(revealed);
  });

  it('reserves names and resumes disconnected members without extending expiry', async () => {
    const expiresAt = (await service.snapshot(owner)).expiresAt;
    await service.disconnect(owner);
    expect((await service.snapshot(guest)).members[0].connected).toBe(false);
    await expect(service.join(owner.code, 'ALICE')).rejects.toThrow(
      'already in use',
    );
    vi.advanceTimersByTime(60_000);
    expect(await service.resume(owner.code, owner.token)).toEqual(owner);
    expect((await service.snapshot(owner)).members[0].connected).toBe(true);
    expect((await service.snapshot(owner)).expiresAt).toBe(expiresAt);
  });

  it('rejects expired rooms immediately and removes them on sweep', async () => {
    vi.advanceTimersByTime(RETRO_LIFETIME_MS);
    await expect(service.join(owner.code, 'Carol')).rejects.toThrow('expired');
    await expect(service.mutate(owner, { type: 'advance' })).rejects.toThrow(
      'expired',
    );
    await expect(service.resume(owner.code, owner.token)).rejects.toThrow(
      'expired',
    );
    expect(await service.sweep()).toEqual([]);
    expect(await service.sweep()).toEqual([]);
    expect(await service.isExpired(owner.code)).toBe(true);
    expect(await createService().isExpired(owner.code)).toBe(true);
  });

  it('bounds room and participant counts', async () => {
    for (let i = 2; i < 30; i++) await service.join(owner.code, `User ${i}`);
    await expect(service.join(owner.code, 'Overflow')).rejects.toThrow('full');
    for (let i = 1; i < 100; i++) await service.create('Alice', `Room ${i}`);
    await expect(service.create('Alice', 'Overflow')).rejects.toThrow('in use');
    vi.advanceTimersByTime(RETRO_LIFETIME_MS);
    expect((await service.create('Alice', 'Fresh')).code).toEqual(
      expect.any(String),
    );
  });
});

describe('retrospective workflow', () => {
  it('bounds note and action storage', async () => {
    for (let i = 0; i < 300; i++)
      await service.mutate(owner, {
        type: 'add-note',
        column: 'ideas',
        text: `Note ${i}`,
      });
    await expect(add()).rejects.toThrow('300-note limit');
    await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, { type: 'advance' });
    for (let i = 0; i < 100; i++)
      await service.mutate(owner, {
        type: 'add-action',
        text: `Action ${i}`,
        owner: { kind: 'unassigned' },
      });
    await expect(
      service.mutate(owner, {
        type: 'add-action',
        text: 'Overflow',
        owner: { kind: 'unassigned' },
      }),
    ).rejects.toThrow('100-action limit');
    const id = (await service.snapshot(owner)).actions[0].id;
    await expect(
      service.mutate(guest, { type: 'toggle-action', id }),
    ).rejects.toThrow('moderator');
    await expect(
      service.mutate(guest, { type: 'delete-action', id }),
    ).rejects.toThrow('moderator');
    await expect(
      service.mutate(owner, { type: 'toggle-action', id: 'missing' }),
    ).rejects.toThrow('no longer exists');
  });
  it('enforces note authorship, phase permissions and moderator controls', async () => {
    const id = await add();
    await expect(
      service.mutate(guest, { type: 'edit-note', id, text: 'Stolen' }),
    ).rejects.toThrow('own notes');
    await expect(
      service.mutate(guest, { type: 'delete-note', id }),
    ).rejects.toThrow('its author');
    await service.mutate(owner, { type: 'edit-note', id, text: 'Updated' });
    expect((await service.snapshot(owner)).notes[0].text).toBe('Updated');
    await expect(service.mutate(guest, { type: 'advance' })).rejects.toThrow(
      'moderator',
    );
    await expect(
      service.mutate(owner, { type: 'toggle-vote', id }),
    ).rejects.toThrow('vote phase');
    await service.mutate(owner, { type: 'delete-note', id });
    expect((await service.snapshot(owner)).notes).toEqual([]);
    await service.mutate(owner, { type: 'advance' });
    await expect(add()).rejects.toThrow('write phase');
    await expect(
      service.mutate(owner, { type: 'edit-note', id, text: 'Late' }),
    ).rejects.toThrow('write phase');
  });

  it('authorizes moderation, revokes removed sessions, and preserves attribution', async () => {
    const ownerNote = await add('Owner note');
    await service.mutate(guest, {
      type: 'add-note',
      column: 'ideas',
      text: 'Delete after reveal',
    });
    await service.mutate(guest, {
      type: 'add-note',
      column: 'improve',
      text: 'Retain after removal',
    });
    const guestNoteIds = (await service.snapshot(guest)).notes.map(
      (note) => note.id,
    );
    await expect(
      service.mutate(guest, { type: 'delete-note', id: ownerNote }),
    ).rejects.toThrow('its author');
    await expect(
      service.mutate(guest, {
        type: 'remove-member',
        memberId: owner.id,
      }),
    ).rejects.toThrow('moderator');
    await expect(
      service.mutate(owner, {
        type: 'remove-member',
        memberId: owner.id,
      }),
    ).rejects.toThrow('Transfer moderation');

    await service.mutate(owner, { type: 'advance' });
    await expect(
      service.mutate(guest, { type: 'delete-note', id: ownerNote }),
    ).rejects.toThrow('moderator');
    await service.mutate(owner, { type: 'advance' });
    await service.mutate(guest, { type: 'toggle-vote', id: ownerNote });
    await service.mutate(guest, { type: 'toggle-vote', id: guestNoteIds[0] });
    await service.mutate(owner, { type: 'delete-note', id: guestNoteIds[0] });
    expect(
      (await service.snapshot(owner)).notes.map((note) => note.id),
    ).not.toContain(guestNoteIds[0]);
    expect(
      (await service.snapshot(guest)).notes.filter((note) => note.votedBySelf),
    ).toHaveLength(1);

    expect(
      await service.mutate(owner, {
        type: 'remove-member',
        memberId: guest.id,
      }),
    ).toEqual({ removedMemberId: guest.id });
    const afterRemoval = await service.snapshot(owner);
    expect(afterRemoval.members.map((member) => member.id)).toEqual([owner.id]);
    expect(
      afterRemoval.notes.find((note) => note.id === guestNoteIds[1]),
    ).toMatchObject({ authorId: guest.id, authorName: 'Bobby' });
    await expect(service.resume(guest.code, guest.token)).rejects.toThrow(
      'session',
    );
    await service.mutate(owner, { type: 'advance' });
    expect(
      (await service.snapshot(owner)).notes.find(
        (note) => note.id === ownerNote,
      )?.voteCount,
    ).toBe(0);
  });

  it('transfers moderation and recovers it only while no moderator is connected', async () => {
    const third = await service.join(owner.code, 'Carol');
    await service.mutate(owner, {
      type: 'transfer-moderator',
      memberId: guest.id,
    });
    expect(
      (await service.snapshot(owner)).members.map(({ id, moderator }) => ({
        id,
        moderator,
      })),
    ).toEqual([
      { id: owner.id, moderator: false },
      { id: guest.id, moderator: true },
      { id: third.id, moderator: false },
    ]);
    await expect(service.mutate(owner, { type: 'advance' })).rejects.toThrow(
      'moderator',
    );
    await expect(
      service.mutate(owner, { type: 'claim-moderator' }),
    ).rejects.toThrow('already connected');

    await service.disconnect(guest);
    await service.mutate(owner, { type: 'claim-moderator' });
    expect(
      (await service.snapshot(owner)).members.filter((item) => item.moderator),
    ).toEqual([expect.objectContaining({ id: owner.id })]);
    await expect(
      service.mutate(third, { type: 'claim-moderator' }),
    ).rejects.toThrow('already connected');
    await expect(
      service.mutate(owner, {
        type: 'transfer-moderator',
        memberId: guest.id,
      }),
    ).rejects.toThrow('currently connected');
    await expect(
      service.mutate(owner, {
        type: 'transfer-moderator',
        memberId: 'missing',
      }),
    ).rejects.toThrow('no longer exists');

    await service.disconnect(owner);
    await service.mutate(third, { type: 'claim-moderator' });
    await service.resume(owner.code, owner.token);
    expect(
      (await service.snapshot(owner)).members.filter((item) => item.moderator),
    ).toEqual([expect.objectContaining({ id: third.id })]);
  });

  it('tracks current-phase readiness across joins, disconnects, and resumes', async () => {
    expect(
      (await service.snapshot(owner)).members.map((member) => member.ready),
    ).toEqual([false, false]);
    await service.mutate(owner, { type: 'toggle-ready' });
    await service.mutate(guest, { type: 'toggle-ready' });
    expect(
      (await service.snapshot(owner)).members.map((member) => member.ready),
    ).toEqual([true, true]);

    await service.disconnect(guest);
    expect((await service.snapshot(owner)).members[1]).toMatchObject({
      connected: false,
      ready: true,
    });
    const late = await service.join(owner.code, 'Carol');
    expect((await service.snapshot(late)).members[2]).toMatchObject({
      connected: true,
      ready: false,
    });
    await service.resume(guest.code, guest.token);
    expect((await service.snapshot(guest)).members[1]).toMatchObject({
      connected: true,
      ready: true,
    });

    await service.mutate(owner, { type: 'advance' });
    expect(
      (await service.snapshot(owner)).members.every((member) => !member.ready),
    ).toBe(true);
    await expect(
      service.mutate(guest, { type: 'toggle-ready' }),
    ).rejects.toThrow('writing or voting');
    await service.mutate(owner, { type: 'advance' });
    await service.mutate(guest, { type: 'toggle-ready' });
    expect((await service.snapshot(owner)).members[1].ready).toBe(true);
    await service.mutate(guest, { type: 'toggle-ready' });
    expect((await service.snapshot(owner)).members[1].ready).toBe(false);
    await service.mutate(owner, { type: 'advance' });
    await expect(
      service.mutate(guest, { type: 'toggle-ready' }),
    ).rejects.toThrow('writing or voting');
  });

  it('preserves server note creation order through grouping, deletion and resume', async () => {
    const ids = [
      await add('First'),
      await add('Second'),
      await add('Third'),
      await add('Fourth'),
    ];
    await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, {
      type: 'group-notes',
      title: 'Theme',
      noteIds: [ids[2], ids[0]],
    });
    expect(
      (await service.snapshot(guest)).notes.map((note) => note.id),
    ).toEqual(ids);
    await service.mutate(owner, { type: 'delete-note', id: ids[1] });
    await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, { type: 'advance' });
    await service.disconnect(guest);
    await service.resume(guest.code, guest.token);
    expect(
      (await service.snapshot(guest)).notes.map((note) => note.id),
    ).toEqual([ids[0], ids[2], ids[3]]);
  });

  it('groups revealed notes into stable theme voting targets', async () => {
    const first = await add('Slow reviews');
    const second = await add('Long feedback loops');
    await service.mutate(guest, {
      type: 'add-note',
      column: 'ideas',
      text: 'Pair earlier',
    });
    const ungrouped = (await service.snapshot(guest)).notes[0].id;
    await service.mutate(owner, { type: 'advance' });

    await expect(
      service.mutate(guest, {
        type: 'group-notes',
        title: 'Review flow',
        noteIds: [first, second],
      }),
    ).rejects.toThrow('moderator');
    await service.mutate(owner, {
      type: 'group-notes',
      title: 'Review flow',
      noteIds: [first, second],
    });
    let grouped = await service.snapshot(owner);
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

    await service.mutate(owner, { type: 'ungroup-note', id: first });
    expect((await service.snapshot(owner)).groups).toEqual([]);
    expect(
      (await service.snapshot(owner)).notes.every((note) => !note.groupId),
    ).toBe(true);
    await service.mutate(owner, {
      type: 'group-notes',
      title: 'Review flow',
      noteIds: [first, second],
    });
    grouped = await service.snapshot(owner);
    const groupId = grouped.groups[0].id;
    await service.mutate(owner, { type: 'advance' });
    await expect(
      service.mutate(guest, { type: 'toggle-vote', id: first }),
    ).rejects.toThrow('theme');
    await service.mutate(guest, { type: 'toggle-vote', id: groupId });
    await service.mutate(guest, { type: 'toggle-vote', id: ungrouped });
    expect((await service.snapshot(owner)).groups[0]).toMatchObject({
      voteCount: null,
      votedBySelf: false,
    });
    expect((await service.snapshot(guest)).groups[0].votedBySelf).toBe(true);
    expect(
      (await service.snapshot(guest)).notes.find(
        (note) => note.id === ungrouped,
      )?.votedBySelf,
    ).toBe(true);

    await service.disconnect(guest);
    await service.resume(guest.code, guest.token);
    expect((await service.snapshot(guest)).groups[0].votedBySelf).toBe(true);
    await service.mutate(owner, { type: 'advance' });
    const discussed = await service.snapshot(owner);
    expect(discussed.groups[0].voteCount).toBe(1);
    expect(
      discussed.notes.find((note) => note.id === ungrouped)?.voteCount,
    ).toBe(1);
    await expect(
      service.mutate(owner, {
        type: 'group-notes',
        title: 'Late',
        noteIds: [first, second],
      }),
    ).rejects.toThrow('group phase');
  });

  it('moves notes between stacks without replacing the target theme or attribution', async () => {
    const ids = [
      await add('One'),
      await add('Two'),
      await add('Three'),
      await add('Four'),
    ];
    await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, {
      type: 'group-notes',
      title: 'First',
      noteIds: ids.slice(0, 2),
    });
    await service.mutate(owner, {
      type: 'group-notes',
      title: 'Second',
      noteIds: ids.slice(2),
    });
    const before = await service.snapshot(owner);
    const target = before.groups[1];
    const command = {
      type: 'move-note' as const,
      id: ids[0],
      groupId: target.id,
    };
    await expect(service.mutate(guest, command)).rejects.toThrow('moderator');
    await expect(
      service.mutate(owner, { ...command, groupId: 'missing' }),
    ).rejects.toThrow('no longer exists');
    expect(await service.snapshot(owner)).toEqual(before);
    await service.mutate(owner, command);
    const moved = await service.snapshot(guest);
    expect(moved.groups).toEqual([target]);
    expect(moved.notes.find((note) => note.id === ids[0])).toEqual({
      ...before.notes[0],
      groupId: target.id,
    });
    expect(moved.notes.find((note) => note.id === ids[1])?.groupId).toBeNull();
    await service.mutate(owner, command); // Idempotent drop onto the same stack.
    await service.disconnect(guest);
    await service.resume(guest.code, guest.token);
    expect((await service.snapshot(guest)).groups).toEqual([target]);
    await service.mutate(owner, { type: 'advance' });
    await expect(service.mutate(owner, command)).rejects.toThrow('group phase');
  });

  it('keeps open voting blind and anonymous while preserving own selections', async () => {
    const ids = [
      await add('One'),
      await add('Two'),
      await add('Three'),
      await add('Four'),
    ];
    await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, { type: 'advance' });
    for (const id of ids.slice(0, 3))
      await service.mutate(guest, { type: 'toggle-vote', id });
    await expect(
      service.mutate(guest, { type: 'toggle-vote', id: ids[3] }),
    ).rejects.toThrow('three votes');
    await service.mutate(guest, { type: 'toggle-vote', id: ids[0] });
    await service.mutate(guest, { type: 'toggle-vote', id: ids[3] });
    await service.mutate(owner, { type: 'toggle-vote', id: ids[3] });

    const ownerVoting = await service.snapshot(owner);
    const guestVoting = await service.snapshot(guest);
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

    await service.disconnect(guest);
    await service.resume(guest.code, guest.token);
    expect(
      (await service.snapshot(guest)).notes.map((note) => note.votedBySelf),
    ).toEqual([false, true, true, true]);

    await service.mutate(owner, { type: 'advance' });
    const discussed = await service.snapshot(owner);
    expect(discussed.notes.map((note) => note.voteCount)).toEqual([0, 1, 1, 2]);
    expect(discussed.notes.every((note) => !note.votedBySelf)).toBe(true);
    expect(JSON.stringify(discussed)).not.toContain('voterIds');
    await expect(
      service.mutate(guest, { type: 'toggle-vote', id: 'missing' }),
    ).rejects.toThrow('vote phase');
  });

  it('edits structured assignments in place and retains removed-owner snapshots', async () => {
    const assignment = {
      kind: 'participant' as const,
      participantId: guest.id,
    };
    await expect(
      service.mutate(owner, {
        type: 'edit-action',
        id: 'missing',
        text: 'New',
        owner: assignment,
      }),
    ).rejects.toThrow('discuss phase');
    for (let i = 0; i < 3; i++)
      await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, {
      type: 'add-action',
      text: 'Original',
      owner: assignment,
    });
    const id = (await service.snapshot(owner)).actions[0].id;
    await service.mutate(owner, { type: 'toggle-action', id });
    const edit = {
      type: 'edit-action' as const,
      id,
      text: 'Corrected',
      owner: assignment,
    };
    await expect(service.mutate(guest, edit)).rejects.toThrow('moderator');
    await expect(
      service.mutate(owner, { ...edit, id: 'missing' }),
    ).rejects.toThrow('no longer exists');
    await expect(
      service.mutate(owner, {
        ...edit,
        owner: { kind: 'participant', participantId: 'missing' },
      }),
    ).rejects.toThrow('owner');
    expect((await service.snapshot(owner)).actions[0].text).toBe('Original');
    await service.mutate(owner, edit);
    expect((await service.snapshot(guest)).actions[0]).toEqual({
      id,
      text: 'Corrected',
      done: true,
      owner: { ...assignment, name: 'Bobby' },
    });
    await service.mutate(owner, { type: 'remove-member', memberId: guest.id });
    await service.mutate(owner, { ...edit, text: 'Still assigned' });
    await service.disconnect(owner);
    await service.resume(owner.code, owner.token);
    expect((await service.snapshot(owner)).actions[0]).toEqual({
      id,
      text: 'Still assigned',
      done: true,
      owner: { ...assignment, name: 'Bobby' },
    });
    await expect(
      service.mutate(owner, {
        type: 'add-action',
        text: 'Invalid',
        owner: assignment,
      }),
    ).rejects.toThrow('owner');
    await service.mutate(owner, {
      ...edit,
      owner: { kind: 'participant', participantId: owner.id },
    });
    expect((await service.snapshot(owner)).actions[0].owner).toEqual({
      kind: 'participant',
      participantId: owner.id,
      name: 'Alice',
    });
    await service.mutate(owner, { ...edit, owner: { kind: 'unassigned' } });
    expect((await service.snapshot(owner)).actions[0]).toMatchObject({
      id,
      done: true,
      owner: { kind: 'unassigned' },
    });
    await expect(service.mutate(owner, edit)).rejects.toThrow('owner');
    await service.mutate(owner, {
      ...edit,
      owner: { kind: 'external', name: 'Platform team' },
    });
    await service.mutate(owner, { type: 'advance' });
    await expect(service.mutate(owner, edit)).rejects.toThrow('read-only');
  });

  it('freezes completion time and membership across disconnect, resume and offline cleanup', async () => {
    await add('Final note');
    for (let i = 0; i < 3; i++)
      await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, {
      type: 'add-action',
      text: 'Final action',
      owner: { kind: 'participant', participantId: guest.id },
    });
    await service.disconnect(guest);
    await service.mutate(owner, { type: 'advance' });
    const final = await service.snapshot(owner);
    expect(final.closedAt).toBe(Date.now());
    expect(final.members[1].connected).toBe(false);
    await service.disconnect(owner);
    await service.resume(guest.code, guest.token);
    vi.advanceTimersByTime(RETRO_OFFLINE_RETENTION_MS + 1);
    await service.resume(owner.code, owner.token);
    expect(await service.snapshot(owner)).toEqual(final);
    expect(await service.snapshot(guest)).toEqual(final);
    await expect(service.join(owner.code, 'Carol')).rejects.toThrow('complete');
    expect(await service.snapshot(owner)).toEqual(final);
  });

  it('captures moderator-owned actions and closes read-only', async () => {
    await expect(
      service.mutate(owner, {
        type: 'add-action',
        text: 'Do it',
        owner: { kind: 'participant', participantId: owner.id },
      }),
    ).rejects.toThrow('discuss phase');
    await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, { type: 'advance' });
    await service.mutate(owner, { type: 'advance' });
    await expect(
      service.mutate(guest, {
        type: 'add-action',
        text: 'Do it',
        owner: { kind: 'unassigned' },
      }),
    ).rejects.toThrow('moderator');
    await service.mutate(owner, {
      type: 'add-action',
      text: 'Follow up',
      owner: { kind: 'participant', participantId: guest.id },
    });
    const id = (await service.snapshot(owner)).actions[0].id;
    await service.mutate(owner, { type: 'toggle-action', id });
    expect((await service.snapshot(owner)).actions[0]).toMatchObject({
      text: 'Follow up',
      owner: { kind: 'participant', participantId: guest.id, name: 'Bobby' },
      done: true,
    });
    await service.mutate(owner, { type: 'delete-action', id });
    expect((await service.snapshot(owner)).actions).toEqual([]);
    await service.mutate(owner, { type: 'advance' });
    expect((await service.snapshot(owner)).phase).toBe('closed');
    await expect(service.mutate(owner, { type: 'advance' })).rejects.toThrow(
      'read-only',
    );
    await expect(
      service.mutate(owner, {
        type: 'add-note',
        column: 'ideas',
        text: 'Late',
      }),
    ).rejects.toThrow('read-only');
    await expect(service.join(owner.code, 'Carol')).rejects.toThrow(
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
])('rejects malformed and oversized commands: %j', (command) => {
  expect(retroCommandSchema.safeParse(command).success).toBe(false);
});

it('trims input and ignores untrusted identity fields', async () => {
  expect(
    retroCommandSchema.parse({
      type: 'join',
      name: ' Alice ',
      code: 'room',
      moderator: true,
    }),
  ).toEqual({ type: 'join', name: 'Alice', code: 'room' });
});
