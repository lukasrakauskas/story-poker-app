import { expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { EventsGateway } from './events.gateway.js';
import type { Client } from './client.entity.js';

it('initializes a plain WebSocket when the runtime skips the Client constructor', () => {
  const client = { send: vi.fn() } as unknown as Client;
  const gateway = new EventsGateway(new ConfigService());

  gateway.handleConnection(client);
  const id = client.id;
  expect(id).toEqual(expect.any(String));
  expect(id.length).toBeGreaterThan(0);
  expect(client.isAlive).toBe(true);
  expect(client.send).toHaveBeenCalledWith(
    JSON.stringify({ event: 'is-alive' }),
  );
  gateway.handleConnection(client);
  expect(client.id).toBe(id);
});
