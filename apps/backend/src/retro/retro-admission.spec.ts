import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { RateLimitService } from '../transport/rate-limit.service.js';
import { TransportMetricsService } from '../transport/transport-metrics.service.js';
import { WebSocketAdmissionService } from '../transport/websocket-admission.service.js';
import { InMemoryRetroRoomRepository } from './retro-room.repository.js';
import { RetroApplicationService } from './retro-application.service.js';
import { RetroService } from './retro.service.js';

type Setup = {
  application: RetroApplicationService;
  admission: WebSocketAdmissionService;
  metrics: TransportMetricsService;
};

function setup(
  overrides: ConstructorParameters<typeof WebSocketAdmissionService>[2] = {},
): Setup {
  const metrics = new TransportMetricsService();
  const admission = new WebSocketAdmissionService(
    new RateLimitService(),
    metrics,
    overrides,
  );
  const retros = new RetroService(
    new ParticipantService(),
    new InMemoryRetroRoomRepository(),
  );
  return {
    application: new RetroApplicationService(
      retros,
      new ConnectionRegistryService(),
      new ApplicationEventBus(),
      admission,
      metrics,
    ),
    admission,
    metrics,
  };
}

async function establish(
  application: RetroApplicationService,
  connectionId: string,
  command: Extract<
    Parameters<RetroApplicationService['establish']>[0],
    { type: 'create' | 'join' }
  >,
) {
  const operation = await application.establish(command, 'ip:127.0.0.1');
  const result = await application.execute(
    connectionId,
    { type: 'resume', code: operation.session.code },
    undefined,
    operation.session.token,
  );
  return { operation, result };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('retrospective admission integration', () => {
  it('rejects HTTP room creation when the process circuit is open', async () => {
    const { application, metrics } = setup({
      globalCreateLimit: 1,
      globalCreateWindowMs: 1_000,
      createCircuitCooldownMs: 100,
    });
    await establish(application, 'owner', {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });

    await expect(
      application.establish(
        { type: 'create', name: 'Bobby', title: 'Another' },
        'ip:127.0.0.1',
      ),
    ).rejects.toMatchObject({ code: 'capacity' });
    expect(
      metrics.counter('websocket.operations.throttled', {
        namespace: 'retro',
        operation: 'create',
      }),
    ).toBe(1);
    expect(metrics.gauge('retro.active_rooms', { namespace: 'retro' })).toBe(1);
  });

  it('backs off a mutation before changing the room when broadcast pressure trips', async () => {
    const { application } = setup({
      broadcastBudget: 2,
      broadcastWindowMs: 1_000,
      broadcastCircuitCooldownMs: 100,
    });
    await establish(application, 'owner', {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });

    const rejected = await application.execute('owner', {
      type: 'add-note',
      column: 'ideas',
      text: 'Must not be applied while busy',
    });
    expect(rejected.messages[0].event).toMatchObject({
      event: 'retro-error',
      data: { code: 'rate-limit' },
    });

    await vi.advanceTimersByTimeAsync(100);
    const accepted = await application.execute('owner', {
      type: 'add-note',
      column: 'ideas',
      text: 'Accepted after backoff',
    });
    const event = accepted.messages.find(
      (message) => message.connectionId === 'owner',
    )?.event;
    expect(event).toMatchObject({
      event: 'retro-state',
      data: {
        room: {
          notes: [expect.objectContaining({ text: 'Accepted after backoff' })],
        },
      },
    });
  });

  it('shares source admission windows across HTTP session operations', async () => {
    const { application } = setup({ maxJoinAttemptsPerSource: 1 });
    await expect(
      application.establish(
        { type: 'join', name: 'Alice', code: 'missing-room' },
        'ip:10.0.0.1',
      ),
    ).rejects.toMatchObject({ code: 'room-expired' });
    await expect(
      application.establish(
        { type: 'join', name: 'Bobby', code: 'missing-room' },
        'ip:10.0.0.1',
      ),
    ).rejects.toMatchObject({ code: 'rate-limit' });
  });
});
