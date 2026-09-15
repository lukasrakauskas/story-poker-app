"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  WebSocketTransport,
  type WebSocketTransportEvent,
  type WebSocketTransportEventMap,
} from "../lib/websocket-transport";

type SocketListener<K extends WebSocketTransportEvent> = (
  event: WebSocketTransportEventMap[K]
) => void;

/** Planning Poker's protocol adapter over the shared WebSocket transport. */
export function useWebsocket(url: string) {
  const transport = useMemo(
    () => new WebSocketTransport({ url, queueWhileConnecting: true }),
    [url]
  );

  useEffect(() => {
    transport.connect();
    if (typeof window !== "undefined")
      window.__webSocketClient = transport.getSocket() as WebSocket | undefined;
    return () => {
      if (
        typeof window !== "undefined" &&
        window.__webSocketClient === transport.getSocket()
      )
        window.__webSocketClient = undefined;
      transport.dispose();
    };
  }, [transport]);

  const on = useCallback(
    <K extends WebSocketTransportEvent>(
      event: K,
      listener: SocketListener<K>
    ) => transport.on(event, listener),
    [transport]
  );

  const off = useCallback(
    <K extends WebSocketTransportEvent>(
      event: K,
      listener: SocketListener<K>
    ) => transport.off(event, listener),
    [transport]
  );

  const reconnect = useCallback(() => {
    transport.reconnect();
    if (typeof window !== "undefined")
      window.__webSocketClient = transport.getSocket() as WebSocket | undefined;
  }, [transport]);

  const send = useCallback(
    (data: string) => {
      transport.send(data, { queue: true });
    },
    [transport]
  );

  const close = useCallback(() => transport.close(), [transport]);
  const isOpen = useCallback(() => transport.isOpen(), [transport]);

  return useMemo(
    () => ({ close, reconnect, send, on, off, isOpen }),
    [close, isOpen, off, on, reconnect, send]
  );
}
