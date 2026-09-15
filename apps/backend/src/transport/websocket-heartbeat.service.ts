import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { WebSocket } from 'ws';

type HeartbeatState = {
  sockets: Set<WebSocket>;
  alive: WeakSet<WebSocket>;
  pongListeners: WeakMap<WebSocket, () => void>;
  timer?: ReturnType<typeof setInterval>;
};

@Injectable()
export class WebSocketHeartbeatService implements OnModuleDestroy {
  private readonly states = new Map<string, HeartbeatState>();

  register(namespace: string, socket: WebSocket, listenForPong = false) {
    const state = this.state(namespace);
    state.sockets.add(socket);
    state.alive.add(socket);
    if (listenForPong && !state.pongListeners.has(socket)) {
      const listener = () => this.markAlive(namespace, socket);
      state.pongListeners.set(socket, listener);
      socket.on('pong', listener);
    }
  }

  unregister(namespace: string, socket: WebSocket) {
    const state = this.states.get(namespace);
    state?.sockets.delete(socket);
    const listener = state?.pongListeners.get(socket);
    if (listener) socket.off('pong', listener);
    state?.pongListeners.delete(socket);
  }

  markAlive(namespace: string, socket: WebSocket) {
    this.state(namespace).alive.add(socket);
  }

  start(
    namespace: string,
    options: {
      interval: number;
      probe: { type: 'ping' } | { type: 'message'; event: unknown };
      onTimeout: (socket: WebSocket) => void;
      onTick?: () => void;
    },
  ) {
    const state = this.state(namespace);
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => {
      options.onTick?.();
      for (const socket of state.sockets) {
        if (!state.alive.has(socket)) {
          state.sockets.delete(socket);
          socket.terminate();
          options.onTimeout(socket);
          continue;
        }
        state.alive.delete(socket);
        if (socket.readyState !== WebSocket.OPEN) continue;
        if (options.probe.type === 'ping') socket.ping();
        else socket.send(JSON.stringify(options.probe.event));
      }
    }, options.interval);
  }

  stop(namespace: string, clearSockets = true) {
    const state = this.states.get(namespace);
    if (!state) return;
    if (state.timer) clearInterval(state.timer);
    state.timer = undefined;
    if (clearSockets) {
      for (const socket of state.sockets) {
        const listener = state.pongListeners.get(socket);
        if (listener) socket.off('pong', listener);
      }
      this.states.delete(namespace);
    }
  }

  onModuleDestroy() {
    for (const namespace of this.states.keys()) this.stop(namespace);
  }

  private state(namespace: string) {
    let state = this.states.get(namespace);
    if (!state) {
      state = {
        sockets: new Set(),
        alive: new WeakSet(),
        pongListeners: new WeakMap(),
      };
      this.states.set(namespace, state);
    }
    return state;
  }
}
