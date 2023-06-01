import { nanoid } from 'nanoid';
import { WebSocket } from 'ws';

export class Client extends WebSocket {
  #id: string;
  #roomId?: string;
  #isAlive: boolean;

  constructor(args) {
    super(args);
    this.#id = nanoid();
    this.#isAlive = true;
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

  get isAlive() {
    return this.#isAlive;
  }

  set isAlive(value: boolean) {
    this.#isAlive = value;
  }
}
