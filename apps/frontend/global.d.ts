declare global {
  interface Window {
    __webSocketClient: WebSocket;
  }
}
