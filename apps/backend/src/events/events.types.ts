import type { CollaborationParticipant } from '../collaboration/participant.service.js';

export type User = CollaborationParticipant & {
  vote: string | null;
  avatar: number | null;
};

export type ClientUser = {
  id: string;
  name: string;
  role: 'user' | 'mod';
  status: 'connected' | 'disconnected';
  avatar: number | null;
  voted: boolean;
  vote?: string | null;
};

export type SelfUser = ClientUser & {
  token: string;
  vote: string | null;
};

export interface Room {
  code: string;
  users: User[];
  state: 'voting' | 'results';
  cardSet: string[];
  results: Record<string, number>;
  password: string | null;
}

export type RoomError = {
  event:
    | 'room-not-found'
    | 'invalid-command'
    | 'user-not-found'
    | 'target-user-not-found'
    | 'user-not-mod'
    | 'moderator-online'
    | 'name-taken'
    | 'bad-username'
    | 'wrong-room-password'
    | 'invalid-card-set'
    | 'invalid-vote'
    | 'voting-not-active'
    | 'cannot-kick-self'
    | 'invalid-avatar';
  data: { error: string } | null;
};

export type RoomResult<T> = T | { error: RoomError };
