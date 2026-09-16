import { describe, expect, it } from 'vitest';
import {
  ROOM_PASSWORD_MAX_LENGTH,
  RoomAccessService,
} from './room-access.service.js';

describe('RoomAccessService', () => {
  it('keeps verifiers private while projecting only protection metadata', () => {
    const access = new RoomAccessService().create(
      'correct horse battery staple',
    );

    expect(access).toEqual({ requiresPassword: true });
    expect(Object.keys(access)).toEqual(['requiresPassword']);
    expect(JSON.stringify(access)).not.toContain(
      'correct horse battery staple',
    );
  });

  it('verifies protected and unprotected access without retaining plaintext', () => {
    const service = new RoomAccessService();
    const protectedAccess = service.create('secret');
    const publicAccess = service.create();

    expect(service.verify(protectedAccess, 'secret')).toBe(true);
    expect(service.verify(protectedAccess, 'wrong')).toBe(false);
    expect(service.verify(protectedAccess)).toBe(false);
    expect(service.verify(publicAccess)).toBe(true);
    expect(service.verify(publicAccess, 'anything')).toBe(true);
  });

  it('bounds password creation and verification inputs', () => {
    const service = new RoomAccessService();
    const oversized = 'x'.repeat(ROOM_PASSWORD_MAX_LENGTH + 1);

    expect(service.validate(oversized)).toContain('at most 100');
    expect(() => service.create(oversized)).toThrow('at most 100');
    expect(service.verify(service.create('secret'), oversized)).toBe(false);
  });
});
