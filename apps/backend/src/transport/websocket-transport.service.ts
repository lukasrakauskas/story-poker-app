import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { WebSocket } from 'ws';
import type { ApplicationResult } from './application-result.js';

export interface TransportPublisher {
  send(connectionId: string, event: unknown): void;
  close(connectionId: string, code: number, reason: string): void;
}

@Injectable()
export class WebSocketTransportService
  implements TransportPublisher, OnModuleDestroy
{
  private readonly connectionIds = new WeakMap<WebSocket, string>();
  private readonly sockets = new Map<string, WebSocket>();

  register(socket: WebSocket, preferredId?: string): string {
    const existing = this.connectionIds.get(socket);
    if (existing) return existing;
    const connectionId = preferredId || nanoid();
    this.connectionIds.set(socket, connectionId);
    this.sockets.set(connectionId, socket);
    return connectionId;
  }

  id(socket: WebSocket): string | undefined {
    return this.connectionIds.get(socket);
  }

  unregister(socket: WebSocket): string | undefined {
    const connectionId = this.connectionIds.get(socket);
    if (!connectionId) return;
    this.connectionIds.delete(socket);
    if (this.sockets.get(connectionId) === socket)
      this.sockets.delete(connectionId);
    return connectionId;
  }

  send(connectionId: string, event: unknown) {
    const socket = this.sockets.get(connectionId);
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(event));
  }

  close(connectionId: string, code: number, reason: string) {
    this.sockets.get(connectionId)?.close(code, reason);
  }

  dispatch<Response>(applicationResult: ApplicationResult<Response>): Response {
    for (const message of applicationResult.messages ?? [])
      this.send(message.connectionId, message.event);
    for (const close of applicationResult.closes ?? [])
      this.close(close.connectionId, close.code, close.reason);
    return applicationResult.response;
  }

  onModuleDestroy() {
    this.sockets.clear();
  }
}
