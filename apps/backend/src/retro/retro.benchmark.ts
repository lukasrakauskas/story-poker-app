import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import {
  materializeRetroState,
  type RetroStateData,
} from 'shared/retrospective';
import { ParticipantService } from '../collaboration/participant.service.js';
import { WebSocketTransportService } from '../transport/websocket-transport.service.js';
import { result } from '../transport/application-result.js';
import { InMemoryRetroRoomRepository } from './retro-room.repository.js';
import { RetroService } from './retro.service.js';

const ITERATIONS = 20;
const WARMUP = 5;
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    meanMs: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(3),
    p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(3),
  };
}

async function run(size: {
  members: number;
  notes: number;
  votedNotes: number;
  actions: number;
}) {
  const repository = new InMemoryRetroRoomRepository();
  const service = new RetroService(new ParticipantService(), repository);
  const transport = new WebSocketTransportService();
  try {
    const owner = await service.create('Alice', 'Snapshot benchmark');
    const sessions = [owner];
    for (let i = 1; i < size.members; i++)
      sessions.push(await service.join(owner.code, `Member ${i}`));
    // Seed a valid near-limit committed domain record without measuring fixture setup.
    await repository.update(owner.code, (room) => {
      room.phase = 'discuss';
      room.notes = Array.from({ length: size.notes }, (_, i) => ({
        id: `note-${i}`,
        authorId: owner.id,
        authorName: 'Alice',
        column: 'ideas' as const,
        text: 'Useful retrospective feedback '.padEnd(1000, 'x'),
        stackId: null,
        voterIds: i < size.votedNotes ? sessions.map((s) => s.id) : [],
      }));
      room.actions = Array.from({ length: size.actions }, (_, i) => ({
        id: `action-${i}`,
        text: 'Follow up'.padEnd(1000, 'x'),
        owner: { kind: 'unassigned' as const },
        done: false,
      }));
      return { result: undefined };
    });
    const wire = new Map<string, string>();
    for (const session of sessions)
      transport.register(
        {
          readyState: WebSocket.OPEN,
          send: (text: string) => wire.set(session.id, text),
        } as unknown as WebSocket,
        session.id,
      );
    const baselineProjection: number[] = [],
      baselineSerialization: number[] = [];
    const optimizedProjection: number[] = [],
      optimizedSerialization: number[] = [];
    let last: RetroStateData | undefined;
    for (let i = -WARMUP; i < ITERATIONS; i++) {
      await service.mutate(owner, { type: 'toggle-action', id: 'action-0' });
      let start = performance.now();
      const old: unknown[] = [];
      for (const session of sessions)
        old.push({
          event: 'retro-state',
          data: {
            room: await service.snapshot(session),
            self: { id: session.id },
          },
        });
      const oldProjection = performance.now() - start;
      start = performance.now();
      for (const event of old) JSON.stringify(event);
      const oldSerialization = performance.now() - start;
      start = performance.now();
      const projection = await service.prepareBroadcast(owner.code);
      const messages = sessions.map((session) => {
        const data = {
          room: projection.room,
          self: { id: session.id },
          recipient: projection.recipient(session),
          version: projection.version,
        };
        last = data;
        return {
          connectionId: session.id,
          event: { event: 'retro-state', data },
          serialization: {
            type: 'retro-state' as const,
            publicRoom: data.room,
            self: data.self,
            recipient: data.recipient,
            version: data.version,
          },
        };
      });
      const newProjection = performance.now() - start;
      start = performance.now();
      transport.dispatch(result(undefined, messages));
      const newSerialization = performance.now() - start;
      if (i >= 0) {
        baselineProjection.push(oldProjection);
        baselineSerialization.push(oldSerialization);
        optimizedProjection.push(newProjection);
        optimizedSerialization.push(newSerialization);
      }
    }
    return {
      ...size,
      materializedRoomBytes: Buffer.byteLength(
        JSON.stringify(materializeRetroState(last!)),
      ),
      publicRoomBytes: Buffer.byteLength(JSON.stringify(last!.room)),
      perRecipientWireBytes: Buffer.byteLength(wire.get(owner.id)!),
      totalWireBytes: [...wire.values()].reduce(
        (n, text) => n + Buffer.byteLength(text),
        0,
      ),
      baseline: {
        projection: stats(baselineProjection),
        serialization: stats(baselineSerialization),
      },
      optimized: {
        projection: stats(optimizedProjection),
        serialization: stats(optimizedSerialization),
      },
    };
  } finally {
    transport.onModuleDestroy();
    service.onModuleDestroy();
    repository.onModuleDestroy();
  }
}
console.log(
  JSON.stringify(
    {
      storage: 'in-memory (Redis network latency excluded)',
      iterations: ITERATIONS,
      warmup: WARMUP,
      representative: await run({
        members: 15,
        notes: 120,
        votedNotes: 3,
        actions: 30,
      }),
      nearLimit: await run({
        members: 30,
        notes: 300,
        votedNotes: 3,
        actions: 100,
      }),
    },
    null,
    2,
  ),
);
