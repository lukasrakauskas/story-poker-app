export type User = {
  id: string;
  name: string;
  vote: string | null;
  role: 'user' | 'mod';
  token: string;
  status: 'connected' | 'disconnected';
};

export interface Room {
  code: string;
  users: User[];
  state: 'voting' | 'results';
  cardSet: string[];
}

export type ClientUser = Omit<User, 'vote' | 'token'> & {
  voted: boolean;
  vote?: string | null;
};

export type RoomError = {
  event:
    | 'room-not-found'
    | 'user-not-found'
    | 'user-not-mod'
    | 'name-taken'
    | 'bad-username';
  data: { error: string } | null;
};

export type RoomResult<T> = T | { error: RoomError };
