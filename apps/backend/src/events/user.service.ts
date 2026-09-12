import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { omit } from 'radash';
import { z } from 'zod';
import type { ClientUser, User } from './events.types.js';

const usernameSchema = z
  .string()
  .min(3, 'It must be at least 3 characters')
  .max(30, 'That is a long username, might want to trim that!');

@Injectable()
export class UserService {
  validateName(name: string): string | null {
    const parsed = usernameSchema.safeParse(name);
    return parsed.success ? null : parsed.error.format()._errors.join(', ');
  }

  create(id: string, name: string, role: User['role'] = 'user'): User {
    return {
      id,
      name,
      role,
      vote: null,
      token: nanoid(32),
      status: 'connected',
    };
  }

  toPublic(user: User, revealVote = false): ClientUser {
    return {
      ...omit(user, ['token', 'vote']),
      ...(revealVote ? { vote: user.vote } : {}),
      voted: !!user.vote,
    };
  }

  toSelf(user: User) {
    return { ...user, voted: !!user.vote };
  }
}
