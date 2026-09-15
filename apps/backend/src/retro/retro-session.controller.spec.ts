import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RetentionService } from '../collaboration/retention.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { OriginAllowlistService } from '../transport/origin-allowlist.service.js';
import { WebSocketTransportService } from '../transport/websocket-transport.service.js';
import { RetroApplicationService } from './retro-application.service.js';
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
): { headers: Headers } {
  return { headers: { cookie, origin } };
}

let controller: RetroSessionController;
let cookies: RetroSessionCookieService;
beforeEach(() => {
  vi.useFakeTimers();
  const application = new RetroApplicationService(
    new RetroService(
      new ParticipantService(),
      new RoomRegistryService(),
      new RetentionService(),
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
  it('establishes an HttpOnly Secure cookie and never returns its credential', () => {
    const output = response();
    const view = controller.establish(
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

  it('rejects disallowed HTTP origins before reading a session cookie', () => {
    const output = response();
    const view = controller.establish(
      { type: 'create', name: 'Alice', title: 'Origin check' },
      request(),
      output,
    );
    const cookie = cookiePair(output.values.get('Set-Cookie')!);
    expect(() =>
      controller.inspect(
        view.room.code,
        request(cookie, 'https://evil.example'),
      ),
    ).toThrowError(HttpException);
    expect(() =>
      controller.inspect(
        view.room.code,
        request(cookie, ['https://evil.example']),
      ),
    ).toThrowError(HttpException);
  });

  it('rotates on HTTP resume, rejects replay, and binds cookies to their room', () => {
    const establishedOutput = response();
    const established = controller.establish(
      { type: 'create', name: 'Alice', title: 'Secure room' },
      request(),
      establishedOutput,
    );
    const oldCookie = cookiePair(establishedOutput.values.get('Set-Cookie')!);
    const resumedOutput = response();
    const resumed = controller.resume(
      established.room.code,
      request(oldCookie),
      resumedOutput,
    );
    const newCookie = cookiePair(resumedOutput.values.get('Set-Cookie')!);
    expect(newCookie).not.toBe(oldCookie);
    expect(resumed.self).toEqual(established.self);
    expect(() =>
      controller.inspect(established.room.code, request(oldCookie)),
    ).toThrowError(HttpException);
    expect(
      controller.inspect(established.room.code, request(newCookie)).self,
    ).toEqual(established.self);

    const otherOutput = response();
    const other = controller.establish(
      { type: 'create', name: 'Carol', title: 'Other room' },
      request(),
      otherOutput,
    );
    expect(() =>
      controller.inspect(other.room.code, request(newCookie)),
    ).toThrowError(HttpException);
    expect(other.room.code).not.toBe(established.room.code);
  });

  it('forgets and revokes a session, while a failed stale request cannot clear a newer cookie', () => {
    const createdOutput = response();
    const created = controller.establish(
      { type: 'create', name: 'Alice', title: 'Forget me' },
      request(),
      createdOutput,
    );
    const oldCookie = cookiePair(createdOutput.values.get('Set-Cookie')!);
    const rotatedOutput = response();
    controller.resume(created.room.code, request(oldCookie), rotatedOutput);
    const currentCookie = cookiePair(rotatedOutput.values.get('Set-Cookie')!);

    const staleFailure = response();
    expect(() =>
      controller.resume(created.room.code, request(oldCookie), staleFailure),
    ).toThrowError(HttpException);
    expect(staleFailure.values.has('Set-Cookie')).toBe(false);

    const forgotten = response();
    expect(
      controller.forget(created.room.code, request(currentCookie), forgotten),
    ).toEqual({ forgotten: true });
    expect(forgotten.values.get('Set-Cookie')).toContain('Max-Age=0');
    expect(() =>
      controller.inspect(created.room.code, request(currentCookie)),
    ).toThrowError(HttpException);
  });

  it('resumes a remembered join cookie through rotation instead of attaching it directly', () => {
    const createdOutput = response();
    const created = controller.establish(
      { type: 'create', name: 'Alice', title: 'Remembered join' },
      request(),
      createdOutput,
    );
    const oldCookie = cookiePair(createdOutput.values.get('Set-Cookie')!);
    const resumedOutput = response();
    const resumed = controller.establish(
      { type: 'join', code: created.room.code, name: 'Ignored name' },
      request(oldCookie),
      resumedOutput,
    );
    const newCookie = cookiePair(resumedOutput.values.get('Set-Cookie')!);
    expect(resumed.self).toEqual(created.self);
    expect(newCookie).not.toBe(oldCookie);
    expect(() =>
      controller.inspect(created.room.code, request(oldCookie)),
    ).toThrowError(HttpException);
  });

  it('fails closed for malformed or duplicate room cookies', () => {
    const output = response();
    const created = controller.establish(
      { type: 'create', name: 'Alice', title: 'Cookie parsing' },
      request(),
      output,
    );
    const pair = cookiePair(output.values.get('Set-Cookie')!);
    expect(() =>
      controller.inspect(created.room.code, request(`${pair}; ${pair}`)),
    ).toThrowError(HttpException);
    expect(() =>
      controller.inspect(
        created.room.code,
        request(`${pair}; retro-session-${created.room.code}=%broken`),
      ),
    ).toThrowError(HttpException);
  });

  it('reports expiry without emitting a destructive cookie clear', () => {
    const output = response();
    const created = controller.establish(
      { type: 'create', name: 'Alice', title: 'Expires' },
      request(),
      output,
    );
    const cookie = cookiePair(output.values.get('Set-Cookie')!);
    vi.advanceTimersByTime(RETRO_LIFETIME_MS);
    const failed = response();
    expect(() =>
      controller.resume(created.room.code, request(cookie), failed),
    ).toThrowError(HttpException);
    expect(failed.values.has('Set-Cookie')).toBe(false);
  });
});
