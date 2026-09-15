import { nanoid } from 'nanoid';
import { WebSocket } from 'ws';

/** Transport connection identity only; room sessions live in application services. */
export class Client extends WebSocket {
  #id = nanoid();

  get id() {
    return this.#id;
  }

  set id(newId: string) {
    this.#id = newId;
  }
}
