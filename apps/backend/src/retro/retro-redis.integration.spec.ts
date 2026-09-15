import { createClient } from 'redis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { RedisRetroRoomRepository } from './retro-room.repository.js';
import {
  RETRO_LIFETIME_MS,
  RETRO_OFFLINE_RETENTION_MS,
  RetroService,
  type RetroSession,
} from './retro.service.js';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { RetroApplicationService } from './retro-application.service.js';

const redisUrl = process.env.RETRO_REDIS_URL;
const redisTests = redisUrl ? describe : describe.skip;
const prefix = `story-poker:retro:test:${nanoid(10)}`;
const repositories: RedisRetroRoomRepository[] = [];
const rooms: string[] = [];

async function settle() {
  for (let i = 0; i < 10; i++)
    await new Promise<void>((resolve) => setImmediate(resolve));
}

function createService() {
  if (!redisUrl) throw new Error('RETRO_REDIS_URL is not configured');
  const repository = new RedisRetroRoomRepository({
    url: redisUrl,
    keyPrefix: prefix,
  });
  repositories.push(repository);
  return new RetroService(new ParticipantService(), repository);
}

redisTests('Redis retrospective repository (opt-in)', () => {
  let ownerService: RetroService;
  let guestService: RetroService;
  let owner: RetroSession;
  let guest: RetroSession;

  beforeEach(async () => {
    ownerService = createService();
    guestService = createService();
    owner = await ownerService.create('Alice', 'Redis room');
    guest = await guestService.join(owner.code, 'Bobby');
    rooms.push(owner.code);
  });

  it('continues an active room across repository instances and applies TTL cleanup', async () => {
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
    expect((await ownerService.snapshot(owner)).notes).toHaveLength(2);

    const restarted = createService();
    const restartedRepository = repositories.at(-1)!;
    const resumed = await restarted.resume(guest.code, guest.token);
    expect((await restarted.snapshot(resumed)).notes).toHaveLength(2);

    await guestService.disconnect(guest);
    await restartedRepository.sweep(Date.now() + RETRO_OFFLINE_RETENTION_MS);
    await expect(restarted.resume(guest.code, guest.token)).rejects.toThrow(
      'no longer available',
    );

    const redis = createClient({ url: redisUrl });
    await redis.connect();
    const ttl = await redis.pTTL(`${prefix}:room:${owner.code}`);
    expect(ttl).toBeGreaterThan(RETRO_LIFETIME_MS - 1000);
    expect(ttl).toBeLessThanOrEqual(RETRO_LIFETIME_MS);
    await redis.quit();
  });

  it('fans committed changes through Redis pub/sub to another application instance', async () => {
    if (!redisUrl) throw new Error('RETRO_REDIS_URL is not configured');
    const ownerRepository = new RedisRetroRoomRepository({
      url: redisUrl,
      keyPrefix: prefix,
    });
    const guestRepository = new RedisRetroRoomRepository({
      url: redisUrl,
      keyPrefix: prefix,
    });
    repositories.push(ownerRepository, guestRepository);
    const ownerEvents = new ApplicationEventBus();
    const guestEvents = new ApplicationEventBus();
    const ownerMessages: unknown[] = [];
    ownerEvents.on('retro', (result) => ownerMessages.push(result));
    const ownerApplication = new RetroApplicationService(
      new RetroService(new ParticipantService(), ownerRepository),
      new ConnectionRegistryService(),
      ownerEvents,
    );
    const guestApplication = new RetroApplicationService(
      new RetroService(new ParticipantService(), guestRepository),
      new ConnectionRegistryService(),
      guestEvents,
    );
    const created = await ownerApplication.execute('owner', {
      type: 'create',
      name: 'Alice',
      title: 'Redis pub/sub',
    });
    const createdState = created.messages[0].event as {
      data: { room: { code: string } };
    };
    const code = createdState.data.room.code;
    rooms.push(code);
    await guestApplication.execute('guest', {
      type: 'join',
      name: 'Bobby',
      code,
    });
    await settle();
    expect(
      ownerMessages.some((message) =>
        JSON.stringify(message).includes('Bobby'),
      ),
    ).toBe(true);
    await guestApplication.execute('guest', { type: 'toggle-ready' });
    await settle();
    expect(
      ownerMessages.some((message) =>
        JSON.stringify(message).includes('"ready":true'),
      ),
    ).toBe(true);
    ownerApplication.onModuleDestroy();
    guestApplication.onModuleDestroy();
  });

  afterAll(async () => {
    const redis = redisUrl ? createClient({ url: redisUrl }) : undefined;
    if (redis) {
      await redis.connect();
      await redis.del([
        `${prefix}:rooms`,
        ...rooms.map((code) => `${prefix}:room:${code}`),
        ...rooms.map((code) => `${prefix}:expired:${code}`),
      ]);
      await redis.quit();
    }
    await Promise.all(
      repositories.map((repository) => repository.onModuleDestroy()),
    );
  });
});
