import { type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { WebSocket, type Server } from 'ws';
import type { RetroServerEvent } from 'shared/retrospective';
import {
  RetroError,
  RetroService,
  type RetroSession,
} from './retro.service.js';
import { retroCommandSchema } from './retro.schema.js';

@WebSocketGateway({ path: '/retro', maxPayload: 16 * 1024 })
export class RetroGateway
  implements
    OnGatewayConnection<WebSocket>,
    OnGatewayDisconnect<WebSocket>,
    OnGatewayInit<Server>,
    OnModuleDestroy
{
  private readonly sessions = new Map<WebSocket, RetroSession>();
  private readonly limits = new WeakMap<
    WebSocket,
    { start: number; count: number }
  >();
  private readonly alive = new WeakSet<WebSocket>();
  private cleanup?: ReturnType<typeof setInterval>;

  constructor(private readonly retros: RetroService) {}

  afterInit(server: Server) {
    this.onModuleDestroy();
    this.cleanup = setInterval(() => {
      this.expireRooms();
      for (const socket of server.clients) {
        if (!this.alive.has(socket)) {
          socket.terminate();
          continue;
        }
        this.alive.delete(socket);
        if (socket.readyState === WebSocket.OPEN) socket.ping();
      }
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.cleanup) clearInterval(this.cleanup);
    this.cleanup = undefined;
  }

  handleConnection(socket: WebSocket) {
    this.alive.add(socket);
    socket.on('pong', () => this.alive.add(socket));
  }

  handleDisconnect(socket: WebSocket) {
    const session = this.sessions.get(socket);
    this.sessions.delete(socket);
    if (!session) return;
    this.retros.disconnect(session);
    this.broadcast(session.code);
  }

  @SubscribeMessage('retro-command')
  onCommand(
    @ConnectedSocket() socket: WebSocket,
    @MessageBody() data: unknown,
  ) {
    const requestId =
      typeof data === 'object' &&
      data !== null &&
      'requestId' in data &&
      typeof data.requestId === 'string' &&
      data.requestId.length <= 64
        ? data.requestId
        : undefined;
    try {
      this.rateLimit(socket);
      this.expireRooms();
      const parsed = retroCommandSchema.safeParse(data);
      if (!parsed.success)
        throw new RetroError(
          'invalid-command',
          'Check your input: name 3–30 characters, title 1–100, note/action 1–1000, owner up to 60.',
        );
      const command = parsed.data;
      const current = this.sessions.get(socket);
      let session: RetroSession;
      if (
        command.type === 'create' ||
        command.type === 'join' ||
        command.type === 'resume'
      ) {
        if (current)
          throw new RetroError(
            'already-joined',
            'You are already in a retrospective. Open a new tab to join another.',
          );
        if (command.type === 'create')
          session = this.retros.create(command.name, command.title);
        else if (command.type === 'join')
          session = this.retros.join(command.code, command.name);
        else session = this.retros.resume(command.code, command.token);
        // A resumed identity belongs to one live socket. The old socket cannot
        // mutate state or mark the replacement disconnected when it closes.
        for (const [previous, previousSession] of this.sessions) {
          if (
            previousSession.code === session.code &&
            previousSession.id === session.id
          ) {
            this.sessions.delete(previous);
            this.sendError(
              previous,
              new RetroError(
                'invalid-session',
                'Your session was resumed in another connection.',
              ),
            );
            previous.close(4001, 'Session replaced');
          }
        }
        this.sessions.set(socket, session);
      } else {
        if (!current)
          throw new RetroError(
            'invalid-session',
            'Join a room before making changes.',
          );
        session = current;
        this.retros.mutate(session, command);
      }
      this.broadcast(session.code, socket, requestId);
    } catch (error) {
      if (!(error instanceof RetroError)) throw error;
      this.sendError(socket, error, requestId);
    }
  }

  private expireRooms() {
    this.retros.sweep();
    for (const [socket, session] of this.sessions) {
      if (this.retros.isExpired(session.code)) {
        this.sessions.delete(socket);
        this.sendError(
          socket,
          new RetroError(
            'room-expired',
            'This room has expired. Create a new retrospective.',
          ),
        );
      }
    }
  }

  private broadcast(code: string, requester?: WebSocket, requestId?: string) {
    for (const [socket, session] of this.sessions) {
      if (session.code !== code) continue;
      try {
        this.send(socket, {
          event: 'retro-state',
          data: {
            room: this.retros.snapshot(session),
            self: { id: session.id, token: session.token },
            ...(socket === requester && requestId ? { requestId } : {}),
          },
        });
      } catch (error) {
        if (!(error instanceof RetroError)) throw error;
        this.sessions.delete(socket);
        this.sendError(socket, error);
      }
    }
  }

  private sendError(socket: WebSocket, error: RetroError, requestId?: string) {
    this.send(socket, {
      event: 'retro-error',
      data: {
        code: error.code,
        message: error.message,
        ...(requestId ? { requestId } : {}),
      },
    });
  }

  private send(socket: WebSocket, event: RetroServerEvent) {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(event));
  }

  private rateLimit(socket: WebSocket) {
    let limit = this.limits.get(socket);
    if (!limit || Date.now() - limit.start >= 1000) {
      limit = { start: Date.now(), count: 0 };
      this.limits.set(socket, limit);
    }
    if (++limit.count > 30)
      throw new RetroError(
        'rate-limit',
        'Too many changes. Wait a moment and try again.',
      );
  }
}
