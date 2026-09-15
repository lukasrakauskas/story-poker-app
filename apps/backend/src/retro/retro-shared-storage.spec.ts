import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { RetroApplicationService } from './retro-application.service.js';
import {
  InMemoryRetroRoomRepository,
  type RetroRoomChange,
} from './retro-room.repository.js';
import {
  RETRO_LIFETIME_MS,
  RETRO_OFFLINE_RETENTION_MS,
  RetroService,
  type RetroSession,
} from './retro.service.js';

function service(repository: InMemoryRetroRoomRepository) {
  return new RetroService(new ParticipantService(), repository);
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

let repository: InMemoryRetroRoomRepository;
let ownerService: RetroService;
let guestService: RetroService;
let owner: RetroSession;
let guest: RetroSession;

beforeEach(async () => {
  vi.useFakeTimers();
  repository = new InMemoryRetroRoomRepository();
  ownerService = service(repository);
  guestService = service(repository);
  owner = await ownerService.create('Alice', 'Shared room');
  guest = await guestService.join(owner.code, 'Bobby');
});

afterEach(() => {
  ownerService.onModuleDestroy();
  guestService.onModuleDestroy();
  repository.onModuleDestroy();
  vi.useRealTimers();
});

describe('shared retrospective room repository', () => {
  it('serializes simultaneous commands without losing either participant note', async () => {
    await Promise.all([
      ownerService.mutate(owner, {
        type: 'add-note',
        column: 'went-well',
        text: 'Owner note',
      }),
      guestService.mutate(guest, {
        type: 'add-note',
        column: 'ideas',
        text: 'Guest note',
      }),
    ]);

    await ownerService.mutate(owner, { type: 'advance' });
    const room = await ownerService.snapshot(owner);
    expect(room.notes.map((note) => note.text)).toEqual([
      'Owner note',
      'Guest note',
    ]);
  });

  it('allows a replacement service to resume persisted state with hashed credentials', async () => {
    await guestService.mutate(guest, {
      type: 'add-note',
      column: 'improve',
      text: 'Survives restart',
    });
    const restarted = service(repository);
    const resumed = await restarted.resume(guest.code, guest.token);

    expect(resumed).toEqual(guest);
    expect((await restarted.snapshot(resumed)).notes).toEqual([
      expect.objectContaining({
        text: 'Survives restart',
        authorId: guest.id,
      }),
    ]);
    const stored = await repository.get(owner.code);
    expect(stored?.members[1]).not.toHaveProperty('token');
    expect(stored?.members[1].tokenHash).not.toBe(guest.token);
    restarted.onModuleDestroy();
  });

  it('expires offline membership in shared storage and keeps room TTL separate', async () => {
    const changes: RetroRoomChange[] = [];
    repository.onChange((change) => changes.push(change));
    const expiresAt = (await ownerService.snapshot(owner)).expiresAt;

    await guestService.disconnect(guest);
    vi.advanceTimersByTime(RETRO_OFFLINE_RETENTION_MS);
    await ownerService.sweep({ source: 'replica-a' });

    expect(changes).toContainEqual(
      expect.objectContaining({
        code: owner.code,
        kind: 'member-expired',
        memberIds: [guest.id],
      }),
    );
    expect((await ownerService.snapshot(owner)).members).toHaveLength(1);
    await expect(guestService.resume(guest.code, guest.token)).rejects.toThrow(
      'no longer available',
    );
    expect((await ownerService.snapshot(owner)).expiresAt).toBe(expiresAt);

    vi.advanceTimersByTime(RETRO_LIFETIME_MS - RETRO_OFFLINE_RETENTION_MS);
    expect(await ownerService.sweep()).toEqual([owner.code]);
    expect(
      changes.filter((change) => change.kind === 'room-expired'),
    ).toHaveLength(1);
  });

  it('publishes cross-instance state, replacement, revocation, and presence updates', async () => {
    const ownerEvents = new ApplicationEventBus();
    const guestEvents = new ApplicationEventBus();
    const ownerApplication = new RetroApplicationService(
      new RetroService(new ParticipantService(), repository),
      new ConnectionRegistryService(),
      ownerEvents,
    );
    const guestApplication = new RetroApplicationService(
      new RetroService(new ParticipantService(), repository),
      new ConnectionRegistryService(),
      guestEvents,
    );
    const ownerMessages: unknown[] = [];
    const guestMessages: unknown[] = [];
    ownerEvents.on('retro', (result) => ownerMessages.push(result));
    guestEvents.on('retro', (result) => guestMessages.push(result));

    const createdOperation = await ownerApplication.establish({
      type: 'create',
      name: 'Carol',
      title: 'Replica room',
    });
    const code = createdOperation.session.code;
    await ownerApplication.execute(
      'owner-a',
      { type: 'resume', code },
      undefined,
      createdOperation.session.token,
    );
    const joinedOperation = await ownerApplication.establish({
      type: 'join',
      name: 'Drew',
      code,
    });
    const joined = await ownerApplication.execute(
      'guest-a',
      { type: 'resume', code },
      undefined,
      joinedOperation.session.token,
    );
    const guestState = joined.messages.find(
      (message) => message.connectionId === 'guest-a',
    )!.event as { event: 'retro-state'; data: { self: { id: string } } };
    await settle();

    const resumed = await guestApplication.execute(
      'guest-b',
      { type: 'resume', code },
      undefined,
      joinedOperation.session.token,
    );
    expect(
      resumed.messages.some((message) => message.connectionId === 'guest-b'),
    ).toBe(true);
    await settle();
    expect(
      ownerMessages.some((result) =>
        JSON.stringify(result).includes('session-replaced'),
      ),
    ).toBe(false);
    expect(
      ownerMessages.some((result) =>
        JSON.stringify(result).includes('Session replaced'),
      ),
    ).toBe(true);

    await guestApplication.execute('guest-b', { type: 'toggle-ready' });
    await settle();
    expect(
      ownerMessages.some((result) =>
        JSON.stringify(result).includes('"ready":true'),
      ),
    ).toBe(true);

    const removed = await ownerApplication.execute('owner-a', {
      type: 'remove-member',
      memberId: guestState.data.self.id,
    });
    expect(
      removed.messages.some((message) => message.connectionId === 'owner-a'),
    ).toBe(true);
    await settle();
    expect(
      guestMessages.some((result) =>
        JSON.stringify(result).includes('removed'),
      ),
    ).toBe(true);
    expect(
      guestMessages.some((result) =>
        JSON.stringify(result).includes('Removed by moderator'),
      ),
    ).toBe(true);

    const lateOperation = await guestApplication.establish({
      type: 'join',
      name: 'Erin',
      code,
    });
    await guestApplication.execute(
      'guest-c',
      { type: 'resume', code },
      undefined,
      lateOperation.session.token,
    );
    await settle();
    await guestApplication.disconnect('guest-c');
    await settle();
    expect(
      ownerMessages.some((result) =>
        JSON.stringify(result).includes('"connected":false'),
      ),
    ).toBe(true);

    ownerApplication.onModuleDestroy();
    guestApplication.onModuleDestroy();
  });
});
