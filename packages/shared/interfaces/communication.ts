// https://www.delightfulengineering.com/blog/nest-websockets/basics

export interface User {
  id: string;
  name: string;
  isModerator: boolean;
}

export interface ServerToClientEvents {
  "room-created": (data: { code: string; users: User[] }) => void;
  "room-joined": (data: { code: string; users: User[] }) => void;
  "user-created": (data: { user: User }) => void;
  "user-joined": (data: { user: User }) => void;
  "reveal-results": (data: { value: string; count: number }[]) => void;
}

// Interface for when clients emit events to the server.
export interface ClientToServerEvents {
  "create-room": (data: { name: string }) => void;
  "join-room": (data: { name: string; room: string }) => void;
  "select-card": (data: { value: string }) => void;
  "reveal-results": () => void;
}
