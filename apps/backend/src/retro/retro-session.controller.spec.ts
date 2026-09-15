import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { OriginAllowlistService } from '../transport/origin-allowlist.service.js';
import { WebSocketTransportService } from '../transport/websocket-transport.service.js';
import { RetroApplicationService } from './retro-application.service.js';
import { InMemoryRetroRoomRepository } from './retro-room.repository.js';
import { RetroSessionController } from './retro-session.controller.js';
import { RetroSessionCookieService } from './retro-session-cookie.service.js';
import { RETRO_LIFETIME_MS, RetroService } from './retro.service.js';

type Headers = { cookie?: string; origin?: string | string[] };

function response() {
  const values = new Map<string, string>();
  return {
    values,
    setHeader(name: string, value: string) {
      values.set(name, value);
    },
  };
}

function cookiePair(value: string): string {
  return value.split(';', 1)[0];
}

function request(
  cookie?: string,
  origin?: string | string[],
): { headers: Headers; socket: { remoteAddress?: string } } {
  return {
    headers: { cookie, origin },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

let controller: RetroSessionController;
let cookies: RetroSessionCookieService;
beforeEach(() => {
  vi.useFakeTimers();
  const application = new RetroApplicationService(
    new RetroService(
      new ParticipantService(),
      new InMemoryRetroRoomRepository(),
    ),
    new ConnectionRegistryService(),
    new ApplicationEventBus(),
  );
  cookies = new RetroSessionCookieService();
  controller = new RetroSessionController(
    application,
    cookies,
    new WebSocketTransportService(),
    new OriginAllowlistService(),
  );
});

describe('RetroSessionController', () => {
  it('establishes an HttpOnly Secure cookie and never returns its credential', async () => {
    const output = response();
    const view = await controller.establish(
      { type: 'create', name: 'Alice', title: 'Secure room' },
      request(),
      output,
    );
    const setCookie = output.values.get('Set-Cookie')!;
    expect(setCookie).toMatch(
      /retro-session-[a-zA-Z0-9_-]+=.+; Path=\/retro; Max-Age=7200;/,
    );
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=None');
    expect(JSON.stringify(view)).not.toContain('token');
    expect(JSON.stringify(view)).not.toContain('secret');
  });

  it('rejects disallowed HTTP origins before reading a session cookie', async () => {
    const output = response();
    const view = await controller.establish(
      { type: 'create', name: 'Alice', title: 'Origin check' },
      request(),
      output,
    );
    const cookie = cookiePair(output.values.get('Set-Cookie')!);
    await expect(
      controller.inspect(
        view.room.code,
        request(cookie, 'https://evil.example'),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    await expect(
      controller.inspect(
        view.room.code,
        request(cookie, ['https://evil.example']),
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rotates on HTTP resume, rejects replay, and binds cookies to their room', async () => {
    const establishedOutput = response();
    const established = await controller.establish(
      { type: 'create', name: 'Alice', title: 'Secure room' },
      request(),
      establishedOutput,
    );
    const oldCookie = cookiePair(establishedOutput.values.get('Set-Cookie')!);
    const resumedOutput = response();
    const resumed = await controller.resume(
      established.room.code,
      request(oldCookie),
      resumedOutput,
    );
    const newCookie = cookiePair(resumedOutput.values.get('Set-Cookie')!);
    expect(newCookie).not.toBe(oldCookie);
    expect(resumed.self).toEqual(established.self);
    await expect(
      controller.inspect(established.room.code, request(oldCookie)),
    ).rejects.toBeInstanceOf(HttpException);
    expect(
      await controller.inspect(established.room.code, request(newCookie)),
    ).toMatchObject({
      code: established.room.code,
      name: 'Alice',
      moderator: true,
    });

    const otherOutput = response();
    const other = await controller.establish(
      { type: 'create', name: 'Carol', title: 'Other room' },
      request(),
      otherOutput,
    );
    await expect(
      controller.inspect(other.room.code, request(newCookie)),
    ).rejects.toBeInstanceOf(HttpException);
    expect(other.room.code).not.toBe(established.room.code);
  });

  it('forgets and revokes a session, while a failed stale request cannot clear a newer cookie', async () => {
    const createdOutput = response();
    const created = await controller.establish(
      { type: 'create', name: 'Alice', title: 'Forget me' },
      request(),
      createdOutput,
    );
    const oldCookie = cookiePair(createdOutput.values.get('Set-Cookie')!);
    const rotatedOutput = response();
    await controller.resume(
      created.room.code,
      request(oldCookie),
      rotatedOutput,
    );
    const currentCookie = cookiePair(rotatedOutput.values.get('Set-Cookie')!);

    const staleFailure = response();
    await expect(
      controller.resume(created.room.code, request(oldCookie), staleFailure),
    ).rejects.toBeInstanceOf(HttpException);
    expect(staleFailure.values.has('Set-Cookie')).toBe(false);

    const forgotten = response();
    await expect(
      controller.forget(created.room.code, request(currentCookie), forgotten),
    ).resolves.toEqual({ forgotten: true });
    expect(forgotten.values.get('Set-Cookie')).toContain('Max-Age=0');
    await expect(
      controller.inspect(created.room.code, request(currentCookie)),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('never silently resumes a remembered identity during an explicit join', async () => {
    const createdOutput = response();
    const created = await controller.establish(
      { type: 'create', name: 'Alice', title: 'Explicit identity' },
      request(),
      createdOutput,
    );
    const oldCookie = cookiePair(createdOutput.values.get('Set-Cookie')!);
    const joinedOutput = response();
    const joined = await controller.establish(
      { type: 'join', code: created.room.code, name: 'Bobby' },
      request(oldCookie),
      joinedOutput,
    );
    const newCookie = cookiePair(joinedOutput.values.get('Set-Cookie')!);
    expect(joined.self).not.toEqual(created.self);
    expect(joined.room.members.map((member) => member.name)).toEqual([
      'Alice',
      'Bobby',
    ]);
    expect(newCookie).not.toBe(oldCookie);
    expect(
      await controller.inspect(created.room.code, request(oldCookie)),
    ).toMatchObject({ name: 'Alice' });
  });

  it('fails closed for malformed or duplicate room cookies', async () => {
    const output = response();
    const created = await controller.establish(
      { type: 'create', name: 'Alice', title: 'Cookie parsing' },
      request(),
      output,
    );
    const pair = cookiePair(output.values.get('Set-Cookie')!);
    await expect(
      controller.inspect(created.room.code, request(`${pair}; ${pair}`)),
    ).rejects.toBeInstanceOf(HttpException);
    await expect(
      controller.inspect(
        created.room.code,
        request(`${pair}; retro-session-${created.room.code}=%broken`),
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('reports expiry without emitting a destructive cookie clear', async () => {
    const output = response();
    const created = await controller.establish(
      { type: 'create', name: 'Alice', title: 'Expires' },
      request(),
      output,
    );
    const cookie = cookiePair(output.values.get('Set-Cookie')!);
    vi.advanceTimersByTime(RETRO_LIFETIME_MS);
    const failed = response();
    await expect(
      controller.resume(created.room.code, request(cookie), failed),
    ).rejects.toBeInstanceOf(HttpException);
    expect(failed.values.has('Set-Cookie')).toBe(false);
  });
});
