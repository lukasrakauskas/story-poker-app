import { describe, expect, it } from 'vitest';
import { ParticipantService } from '../collaboration/participant.service.js';
import { UserService } from './user.service.js';

const users = new UserService(new ParticipantService());

describe('UserService', () => {
  it.each([3, 30])('accepts a name of length %i', (length) => {
    expect(users.validateName('a'.repeat(length))).toBeNull();
  });

  it.each(['', '   ', ' ab ', ` ${'a'.repeat(31)} `])(
    'rejects invalid normalized name %j',
    (name) => {
      expect(users.validateName(name)).toEqual(expect.any(String));
    },
  );

  it('normalizes surrounding whitespace before storing a valid name', () => {
    expect(users.validateName('  Alice  ')).toBeNull();
    expect(users.create('one', '  Alice  ').name).toBe('Alice');
  });

  it('creates unique credentials and defaults to a connected non-moderator', () => {
    const user = users.create('one', 'Alice');
    expect(user).toMatchObject({
      id: 'one',
      name: 'Alice',
      role: 'participant',
      connected: true,
      vote: null,
    });
    expect(user.token).toHaveLength(32);
    expect(users.create('two', 'Bob', 'mod').token).not.toBe(user.token);
  });

  it('exposes credentials only to self and votes only when requested', () => {
    const user = users.create('one', 'Alice');
    user.vote = '0';
    const hidden = users.toPublic(user);
    expect(hidden.voted).toBe(true);
    expect(hidden).not.toHaveProperty('vote');
    expect(hidden).not.toHaveProperty('token');
    expect(users.toPublic(user, true)).toEqual({ ...hidden, vote: '0' });
    expect(users.toSelf(user)).toEqual({
      id: 'one',
      name: 'Alice',
      role: 'user',
      status: 'connected',
      avatar: null,
      voted: true,
      vote: '0',
      token: user.token,
    });
    expect(user.vote).toBe('0');
    expect(user.token).toHaveLength(32);
  });
});
