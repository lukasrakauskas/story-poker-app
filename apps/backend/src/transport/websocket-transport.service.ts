import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { WebSocket } from 'ws';
import type {
  ApplicationResult,
  OutboundMessage,
  OutboundSerialization,
} from './application-result.js';

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
  /** Weakly keyed by the application-owned public projection/version object. */
  private sharedSerializations = new WeakMap<object, string>();

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
    // Reuse a public-room encoding across all messages for a committed
    // version, including separate refresh requests; each message still gets
    // its own token/private envelope.
    for (const message of applicationResult.messages ?? [])
      this.sendMessage(message, this.sharedSerializations);
    for (const close of applicationResult.closes ?? [])
      this.close(close.connectionId, close.code, close.reason);
    return applicationResult.response;
  }

  private sendMessage(
    message: OutboundMessage,
    shared: WeakMap<object, string>,
  ) {
    const socket = this.sockets.get(message.connectionId);
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(
      message.serialization
        ? this.serializeShared(message.serialization, shared)
        : JSON.stringify(message.event),
    );
  }

  private serializeShared(
    serialization: OutboundSerialization,
    shared: WeakMap<object, string>,
  ): string {
    let publicRoom = shared.get(serialization.publicRoom);
    if (!publicRoom) {
      publicRoom = JSON.stringify(serialization.publicRoom);
      shared.set(serialization.publicRoom, publicRoom);
    }
    const fields = [
      `"room":${publicRoom}`,
      `"self":${JSON.stringify(serialization.self)}`,
      `"recipient":${JSON.stringify(serialization.recipient)}`,
      `"version":${JSON.stringify(serialization.version)}`,
    ];
    if (serialization.requestId !== undefined)
      fields.push(`"requestId":${JSON.stringify(serialization.requestId)}`);
    return `{"event":"retro-state","data":{${fields.join(',')}}}`;
  }

  onModuleDestroy() {
    this.sockets.clear();
    this.sharedSerializations = new WeakMap();
  }
}
