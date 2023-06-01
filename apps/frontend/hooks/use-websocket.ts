"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    __webSocketClient: WebSocket;
  }
}

export function useWebsocket(url: string) {
  const client = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!(window.__webSocketClient instanceof WebSocket)) {
      window.__webSocketClient = new WebSocket(url ?? "");
    } else if (
      window.__webSocketClient.readyState === WebSocket.CLOSED ||
      window.__webSocketClient.readyState === WebSocket.CLOSING
    ) {
      window.__webSocketClient = new WebSocket(url ?? "");
    }

    client.current = window.__webSocketClient;

    return () => {
      if (client.current?.readyState === WebSocket.OPEN) {
        client.current?.close();
      }
    };
  }, [url]);

  function send(data: string) {
    client.current?.send(data);
  }

  type Off = NonNullable<typeof client.current>["addEventListener"];
  type On = NonNullable<typeof client.current>["removeEventListener"];

  return {
    send,
    on: (...args: Parameters<On>) => client.current?.addEventListener(...args),
    off: (...args: Parameters<Off>) =>
      client.current?.removeEventListener(...args),
  };
}
