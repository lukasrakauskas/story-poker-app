import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { nanoid } from 'nanoid';

@Injectable()
export class RoomRegistryService implements OnModuleDestroy {
  private readonly namespaces = new Map<string, Map<string, unknown>>();

  register<T extends { code: string }>(
    namespace: string,
    options: { codeLength: number; maxRooms?: number },
    create: (code: string) => T,
  ): T | null {
    const rooms = this.namespace(namespace);
    if (options.maxRooms !== undefined && rooms.size >= options.maxRooms)
      return null;
    let code: string;
    do {
      code = nanoid(options.codeLength);
    } while (rooms.has(code));
    const room = create(code);
    rooms.set(code, room);
    return room;
  }

  get<T>(namespace: string, code: string): T | undefined {
    return this.namespaces.get(namespace)?.get(code) as T | undefined;
  }

  delete(namespace: string, code: string): boolean {
    return this.namespaces.get(namespace)?.delete(code) ?? false;
  }

  entries<T>(namespace: string): IterableIterator<[string, T]> {
    const rooms = this.namespaces.get(namespace);
    return (rooms?.entries() ??
      new Map<string, T>().entries()) as IterableIterator<[string, T]>;
  }

  size(namespace: string): number {
    return this.namespaces.get(namespace)?.size ?? 0;
  }

  sweep<T>(
    namespace: string,
    shouldRemove: (room: T, code: string) => boolean,
  ): string[] {
    const removed: string[] = [];
    for (const [code, room] of this.entries<T>(namespace)) {
      if (!shouldRemove(room, code)) continue;
      this.delete(namespace, code);
      removed.push(code);
    }
    return removed;
  }

  clear(namespace: string) {
    this.namespaces.delete(namespace);
  }

  onModuleDestroy() {
    this.namespaces.clear();
  }

  private namespace(namespace: string): Map<string, unknown> {
    let rooms = this.namespaces.get(namespace);
    if (!rooms) {
      rooms = new Map();
      this.namespaces.set(namespace, rooms);
    }
    return rooms;
  }
}
