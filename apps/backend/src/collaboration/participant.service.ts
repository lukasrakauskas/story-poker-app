import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import {
  normalizeParticipantName,
  validateParticipantName,
} from 'shared/participant';

export type CollaborationRole = 'participant' | 'moderator';

export interface CollaborationParticipant {
  id: string;
  name: string;
  role: CollaborationRole;
  token: string;
  connected: boolean;
}

@Injectable()
export class ParticipantService {
  normalizeName(name: unknown): string {
    return normalizeParticipantName(name);
  }

  validateName(name: unknown): string | null {
    return validateParticipantName(name);
  }

  create(
    name: string,
    role: CollaborationRole = 'participant',
    id = nanoid(),
  ): CollaborationParticipant {
    const normalizedName = this.normalizeName(name);
    const error = this.validateName(normalizedName);
    if (error) throw new Error(error);
    return {
      id,
      name: normalizedName,
      role,
      token: nanoid(32),
      connected: true,
    };
  }

  isNameTaken(
    participants: Pick<CollaborationParticipant, 'name'>[],
    name: string,
  ): boolean {
    const key = this.nameKey(name);
    return participants.some(
      (participant) => this.nameKey(participant.name) === key,
    );
  }

  findByToken<T extends CollaborationParticipant>(
    participants: T[],
    token: string,
  ): T | undefined {
    return participants.find((participant) => participant.token === token);
  }

  reconnect<T extends CollaborationParticipant>(participant: T): T {
    participant.connected = true;
    return participant;
  }

  disconnect<T extends CollaborationParticipant>(participant: T): boolean {
    if (!participant.connected) return false;
    participant.connected = false;
    return true;
  }

  canClaimModerator<T extends CollaborationParticipant>(
    participants: T[],
    participant: T,
  ): boolean {
    return (
      participant.role === 'moderator' ||
      !participants.some(
        (candidate) => candidate.role === 'moderator' && candidate.connected,
      )
    );
  }

  promote<T extends CollaborationParticipant>(participant: T): T {
    participant.role = 'moderator';
    return participant;
  }

  private nameKey(name: string): string {
    return this.normalizeName(name).toLocaleLowerCase();
  }
}
