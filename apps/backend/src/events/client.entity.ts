import { nanoid } from 'nanoid';
import { WebSocket } from 'ws';

export class Client extends WebSocket {
  #id: string;
  #roomId?: string;

  constructor(args) {
    super(args);
    this.#id = nanoid();
  }

  get id() {
    return this.#id;
  }

  get roomId() {
    return this.#roomId ?? '';
  }

  set roomId(newRoomId: string) {
    this.#roomId = newRoomId;
  }
}
