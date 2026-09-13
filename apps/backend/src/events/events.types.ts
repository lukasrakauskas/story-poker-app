export type User = {
  id: string;
  name: string;
  vote: string | null;
  role: 'user' | 'mod';
  token: string;
  status: 'connected' | 'disconnected';
  avatar: number | null;
};

export interface Room {
  code: string;
  users: User[];
  state: 'voting' | 'results';
  cardSet: string[];
  results: Record<string, number>;
  password: string | null;
}

export type ClientUser = Omit<User, 'vote' | 'token'> & {
  voted: boolean;
  vote?: string | null;
};

export type RoomError = {
  event:
    | 'room-not-found'
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
