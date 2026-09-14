import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import {
  RETRO_LIFETIME_MS,
  RetroService,
  type RetroSession,
} from './retro.service.js';
import { retroCommandSchema } from './retro.schema.js';

function createService() {
  return new RetroService(new ParticipantService(), new RoomRegistryService());
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
    for (let i = 0; i < 100; i++)
      service.mutate(owner, {
        type: 'add-action',
        text: `Action ${i}`,
        owner: '',
      });
    expect(() =>
      service.mutate(owner, {
        type: 'add-action',
        text: 'Overflow',
        owner: '',
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
      'own notes',
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
    service.mutate(guest, { type: 'toggle-ready' });
    expect(service.snapshot(owner).members[1].ready).toBe(true);
    service.mutate(guest, { type: 'toggle-ready' });
    expect(service.snapshot(owner).members[1].ready).toBe(false);
    service.mutate(owner, { type: 'advance' });
    expect(() => service.mutate(guest, { type: 'toggle-ready' })).toThrow(
      'writing or voting',
    );
  });

  it('keeps open voting blind and anonymous while preserving own selections', () => {
    const ids = [add('One'), add('Two'), add('Three'), add('Four')];
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

  it('captures moderator-owned actions and closes read-only', () => {
    expect(() =>
      service.mutate(owner, {
        type: 'add-action',
        text: 'Do it',
        owner: 'Alice',
      }),
    ).toThrow('discuss phase');
    service.mutate(owner, { type: 'advance' });
    service.mutate(owner, { type: 'advance' });
    expect(() =>
      service.mutate(guest, { type: 'add-action', text: 'Do it', owner: '' }),
    ).toThrow('moderator');
    service.mutate(owner, {
      type: 'add-action',
      text: 'Follow up',
      owner: 'Bobby',
    });
    const id = service.snapshot(owner).actions[0].id;
    service.mutate(owner, { type: 'toggle-action', id });
    expect(service.snapshot(owner).actions[0]).toMatchObject({
      text: 'Follow up',
      owner: 'Bobby',
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
    expect(service.snapshot(service.join(owner.code, 'Carol')).phase).toBe(
      'closed',
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
  { type: 'add-action', text: 'Hello', owner: 'x'.repeat(61) },
  { type: 'resume', code: 'room', token: '' },
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
