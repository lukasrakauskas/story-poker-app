import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RetentionService } from '../collaboration/retention.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { RateLimitService } from '../transport/rate-limit.service.js';
import { TransportMetricsService } from '../transport/transport-metrics.service.js';
import { WebSocketAdmissionService } from '../transport/websocket-admission.service.js';
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
    new RoomRegistryService(),
    new RetentionService(),
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('retrospective admission integration', () => {
  it('rejects room creation when the process circuit is open', () => {
    const { application, metrics } = setup({
      globalCreateLimit: 1,
      globalCreateWindowMs: 1_000,
      createCircuitCooldownMs: 100,
    });
    const created = application.execute('owner', {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    expect(created.messages[0].event).toMatchObject({ event: 'retro-state' });

    const rejected = application.execute('new-connection', {
      type: 'create',
      name: 'Bobby',
      title: 'Another',
    });
    expect(rejected.messages[0].event).toMatchObject({
      event: 'retro-error',
      data: { code: 'capacity' },
    });
    expect(
      metrics.counter('websocket.capacity.exhausted', {
        namespace: 'retro',
        operation: 'create',
      }),
    ).toBe(1);
    expect(metrics.gauge('retro.active_rooms', { namespace: 'retro' })).toBe(1);
  });

  it('backs off a mutation before changing the room when broadcast pressure trips', () => {
    const { application } = setup({
      broadcastBudget: 1,
      broadcastWindowMs: 1_000,
      broadcastCircuitCooldownMs: 100,
    });
    const created = application.execute('owner', {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    expect(created.messages[0].event).toMatchObject({ event: 'retro-state' });

    const rejected = application.execute('owner', {
      type: 'add-note',
      column: 'ideas',
      text: 'Must not be applied while busy',
    });
    expect(rejected.messages[0].event).toMatchObject({
      event: 'retro-error',
      data: { code: 'rate-limit' },
    });

    vi.advanceTimersByTime(100);
    const accepted = application.execute('owner', {
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
});
