import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { omit } from 'radash';
import { z } from 'zod';
import type { ClientUser, User } from './events.types.js';

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Name must be at least 3 characters after trimming spaces')
  .max(30, 'Name must be at most 30 characters after trimming spaces');

@Injectable()
export class UserService {
  normalizeName(name: string) {
    return typeof name === 'string' ? name.trim() : '';
  }

  validateName(name: string): string | null {
    const parsed = usernameSchema.safeParse(name);
    return parsed.success ? null : parsed.error.format()._errors.join(', ');
  }

  create(id: string, name: string, role: User['role'] = 'user'): User {
    return {
      id,
      name: this.normalizeName(name),
      role,
      vote: null,
      token: nanoid(32),
      status: 'connected',
      avatar: null,
    };
  }

  toPublic(user: User, revealVote = false): ClientUser {
    return {
      ...omit(user, ['token', 'vote']),
      ...(revealVote ? { vote: user.vote } : {}),
      voted: user.vote !== null,
    };
  }

  toSelf(user: User) {
    return { ...user, voted: user.vote !== null };
  }
}
