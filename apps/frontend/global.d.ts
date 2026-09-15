declare global {
  interface Window {
    /** Legacy Planning Poker test/integration access; one hook owns this socket. */
    __webSocketClient?: WebSocket;
  }
}

export {};
