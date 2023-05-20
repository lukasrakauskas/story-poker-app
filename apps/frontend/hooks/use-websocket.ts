"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    __webSocketClient: WebSocket;
  }
}

interface Params {
  url?: string;
  onOpen?: (event: Event) => void;
  onMessage?: <T extends string>(event: MessageEvent<T>) => void;
  onClose?: (event: Event) => void;
}

export function useWebsocket(params: Params) {
  const {
    url,
    onOpen = () => {},
    onMessage = () => {},
    onClose = () => {},
  } = params;

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

    client.current?.addEventListener("open", onOpen);
    client.current?.addEventListener("message", onMessage);
    client.current?.addEventListener("close", onClose);

    return () => {
      client.current?.removeEventListener("open", onOpen);
      client.current?.removeEventListener("message", onMessage);
      client.current?.removeEventListener("close", onClose);

      if (client.current?.readyState === WebSocket.OPEN) {
        client.current?.close();
      }
    };
  }, []);

  function send<T>(event: string, data: T) {
    client.current?.send(JSON.stringify({ event, data }));
  }

  return { send };
}
