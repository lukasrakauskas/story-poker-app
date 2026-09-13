"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

declare global {
  interface Window {
    __webSocketClient?: WebSocket;
  }
}

type SocketListener<K extends keyof WebSocketEventMap> = (
  event: WebSocketEventMap[K]
) => void;
type StoredListener = EventListenerOrEventListenerObject;

export function useWebsocket(url: string) {
  const client = useRef<WebSocket | null>(null);
  const listeners = useRef(
    new Map<keyof WebSocketEventMap, Set<StoredListener>>()
  );

  const attachListeners = useCallback((socket: WebSocket) => {
    for (const [event, eventListeners] of listeners.current) {
      for (const listener of eventListeners) {
        socket.addEventListener(event, listener);
      }
    }
  }, []);

  const detachListeners = useCallback((socket: WebSocket) => {
    for (const [event, eventListeners] of listeners.current) {
      for (const listener of eventListeners) {
        socket.removeEventListener(event, listener);
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (typeof window === "undefined") return null;

    let socket = window.__webSocketClient;
    if (
      !socket ||
      socket.readyState === WebSocket.CLOSED ||
      socket.readyState === WebSocket.CLOSING
    ) {
      socket = new WebSocket(url);
      window.__webSocketClient = socket;
    }

    if (client.current !== socket) {
      if (client.current) detachListeners(client.current);
      client.current = socket;
      attachListeners(socket);
    }

    return socket;
  }, [attachListeners, detachListeners, url]);

  useEffect(() => {
    connect();

    return () => {
      const socket = client.current;
      if (!socket) return;
      detachListeners(socket);
      socket.close();
      if (window.__webSocketClient === socket) {
        window.__webSocketClient = undefined;
      }
      client.current = null;
    };
  }, [connect, detachListeners]);

  const on = useCallback(
    <K extends keyof WebSocketEventMap>(
      event: K,
      listener: SocketListener<K>
    ) => {
      const storedListener = listener as StoredListener;
      const eventListeners = listeners.current.get(event) ?? new Set();
      eventListeners.add(storedListener);
      listeners.current.set(event, eventListeners);
      client.current?.addEventListener(event, storedListener);
    },
    []
  );

  const off = useCallback(
    <K extends keyof WebSocketEventMap>(
      event: K,
      listener: SocketListener<K>
    ) => {
      const storedListener = listener as StoredListener;
      listeners.current.get(event)?.delete(storedListener);
      client.current?.removeEventListener(event, storedListener);
    },
    []
  );

  const reconnect = useCallback(() => {
    connect();
  }, [connect]);

  const send = useCallback(
    (data: string) => {
      const socket = connect();
      if (!socket) return;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
        return;
      }
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket.send(data), {
          once: true,
        });
      }
    },
    [connect]
  );

  const close = useCallback(() => {
    const socket = client.current;
    if (!socket) return;
    detachListeners(socket);
    socket.close();
  }, [detachListeners]);

  const isOpen = useCallback(
    () => client.current?.readyState === WebSocket.OPEN,
    []
  );

  return useMemo(
    () => ({ close, reconnect, send, on, off, isOpen }),
    [close, isOpen, off, on, reconnect, send]
  );
}
