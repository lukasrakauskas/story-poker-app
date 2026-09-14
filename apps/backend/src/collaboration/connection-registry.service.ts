import { Injectable, type OnModuleDestroy } from '@nestjs/common';

@Injectable()
export class ConnectionRegistryService implements OnModuleDestroy {
  private readonly connections = new Map<string, unknown>();

  replace<T>(
    namespace: string,
    roomCode: string,
    participantId: string,
    connection: T,
  ): T | undefined {
    const key = this.key(namespace, roomCode, participantId);
    const previous = this.connections.get(key) as T | undefined;
    this.connections.set(key, connection);
    return previous === connection ? undefined : previous;
  }

  release(
    namespace: string,
    roomCode: string,
    participantId: string,
    connection: unknown,
  ): boolean {
    const key = this.key(namespace, roomCode, participantId);
    if (this.connections.get(key) !== connection) return false;
    return this.connections.delete(key);
  }

  revoke<T>(
    namespace: string,
    roomCode: string,
    participantId: string,
  ): T | undefined {
    const key = this.key(namespace, roomCode, participantId);
    const connection = this.connections.get(key) as T | undefined;
    this.connections.delete(key);
    return connection;
  }

  clear(namespace: string) {
    const prefix = `${namespace}\0`;
    for (const key of this.connections.keys()) {
      if (key.startsWith(prefix)) this.connections.delete(key);
    }
  }

  onModuleDestroy() {
    this.connections.clear();
  }

  private key(namespace: string, roomCode: string, participantId: string) {
    return `${namespace}\0${roomCode}\0${participantId}`;
  }
}
