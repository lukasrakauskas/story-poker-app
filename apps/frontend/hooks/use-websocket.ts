"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    __webSocketClient: WebSocket;
  }
}

function createSocket(url: string) {
  if (!(window.__webSocketClient instanceof WebSocket)) {
    window.__webSocketClient = new WebSocket(url ?? "");
  } else if (
    window.__webSocketClient.readyState === WebSocket.CLOSED ||
    window.__webSocketClient.readyState === WebSocket.CLOSING
  ) {
    window.__webSocketClient = new WebSocket(url ?? "");
  }

  return window.__webSocketClient;
}

export function useWebsocket(url: string) {
  const client = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    client.current = createSocket(url);

    return () => {
      if (client.current?.readyState === WebSocket.OPEN) {
        client.current?.close();
      }
    };
  }, [url]);

  function reconnect() {
    if (
      client.current?.readyState === WebSocket.CLOSED ||
      client.current?.readyState === WebSocket.CLOSING
    ) {
      client.current = createSocket(url);
    }
  }

  function send(data: string) {
    reconnect();
    client.current?.send(data);
  }

  type Off = NonNullable<typeof client.current>["addEventListener"];
  type On = NonNullable<typeof client.current>["removeEventListener"];

  function close() {
    client.current?.close();
  }

  return {
    close,
    reconnect,
    send,
    on: (...args: Parameters<On>) => client.current?.addEventListener(...args),
    off: (...args: Parameters<Off>) =>
      client.current?.removeEventListener(...args),
  };
}
