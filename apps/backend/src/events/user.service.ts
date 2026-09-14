import { Injectable } from '@nestjs/common';
import { ParticipantService } from '../collaboration/participant.service.js';
import type { ClientUser, SelfUser, User } from './events.types.js';

@Injectable()
export class UserService {
  constructor(private readonly participants: ParticipantService) {}

  normalizeName(name: string) {
    return this.participants.normalizeName(name);
  }

  validateName(name: string): string | null {
    return this.participants.validateName(name);
  }

  create(id: string, name: string, role: 'user' | 'mod' = 'user'): User {
    return {
      ...this.participants.create(
        name,
        role === 'mod' ? 'moderator' : 'participant',
        id,
      ),
      vote: null,
      avatar: null,
    };
  }

  toPublic(user: User, revealVote = false): ClientUser {
    return {
      id: user.id,
      name: user.name,
      role: user.role === 'moderator' ? 'mod' : 'user',
      status: user.connected ? 'connected' : 'disconnected',
      avatar: user.avatar,
      voted: user.vote !== null,
      ...(revealVote ? { vote: user.vote } : {}),
    };
  }

  toSelf(user: User): SelfUser {
    return {
      ...this.toPublic(user, true),
      token: user.token,
      vote: user.vote,
    };
  }
}
