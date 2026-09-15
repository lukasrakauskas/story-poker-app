import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import type { RetroRoom, RetroServerEvent } from 'shared/retrospective';
import { materializeRetroState, type RetroCommand } from 'shared/retrospective';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import { RetentionService } from '../collaboration/retention.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { WebSocketTransportService } from '../transport/websocket-transport.service.js';
import { RetroApplicationService } from './retro-application.service.js';
import { RetroService, type RetroSession } from './retro.service.js';

type Fixture = {
  members: number;
  notes: number;
  groups: number;
  actions: number;
};

type BuiltFixture = {
  application: RetroApplicationService;
  retro: RetroService;
  transport: WebSocketTransportService;
  code: string;
  sessions: RetroSession[];
  sockets: FakeSocket[];
  room: RetroRoom;
};

type FakeSocket = {
  readyState: number;
  sent: string[];
  send(value: string): void;
};

const WARMUP = 10;
const ITERATIONS = 50;
const LONG_NOTE = 'A representative near-limit note '.padEnd(1000, 'x');
const LONG_ACTION = 'A representative action '.padEnd(1000, 'a');

function state(
  result: ReturnType<RetroApplicationService['execute']>,
  id: string,
) {
  const event = result.messages.find((message) => message.connectionId === id)
    ?.event as RetroServerEvent | undefined;
  if (!event || event.event !== 'retro-state')
    throw new Error(`Expected a state for ${id}`);
  return event.data;
}

function command(
  application: RetroApplicationService,
  connectionId: string,
  value: RetroCommand,
) {
  return application.execute(connectionId, value);
}

function buildFixture(size: Fixture): BuiltFixture {
  const retro = new RetroService(
    new ParticipantService(),
    new RoomRegistryService(),
    new RetentionService(),
  );
  const application = new RetroApplicationService(
    retro,
    new ConnectionRegistryService(),
    new ApplicationEventBus(),
  );
  const transport = new WebSocketTransportService();
  const sockets: FakeSocket[] = [];
  const sessions: RetroSession[] = [];
  const owner = state(
    command(application, 'connection-0', {
      type: 'create',
      name: 'Alice',
      title: 'Benchmark room',
    }),
    'connection-0',
  );
  const code = owner.room.code;
  sessions.push({ code, ...owner.self });
  sockets.push(registerSocket('connection-0'));

  for (let index = 1; index < size.members; index++) {
    const connectionId = `connection-${index}`;
    const joined = state(
      command(application, connectionId, {
        type: 'join',
        code,
        name: `Member ${String(index).padStart(2, '0')}`,
      }),
      connectionId,
    );
    sessions.push({ code, ...joined.self });
    sockets.push(registerSocket(connectionId));
  }

  for (let index = 0; index < size.notes; index++)
    command(application, 'connection-0', {
      type: 'add-note',
      column:
        index % 3 === 0 ? 'went-well' : index % 3 === 1 ? 'improve' : 'ideas',
      text: `${LONG_NOTE.slice(0, 995)}${String(index).padStart(5, '0')}`,
    });

  const revealed = state(
    command(application, 'connection-0', { type: 'advance' }),
    'connection-0',
  );
  const noteIds = revealed.room.notes.map((note) => note.id);
  for (let index = 0; index < size.groups; index++)
    command(application, 'connection-0', {
      type: 'group-notes',
      title: `${'Theme '.padEnd(100, 't').slice(0, 97)}${String(index).padStart(3, '0')}`,
      noteIds: [noteIds[index * 2], noteIds[index * 2 + 1]],
    });

  command(application, 'connection-0', { type: 'advance' });
  const voteTargets = state(
    command(application, 'connection-0', { type: 'refresh' }),
    'connection-0',
  ).room;
  const targetIds = [
    ...voteTargets.groups.slice(0, 3).map((group) => group.id),
    ...voteTargets.notes
      .filter((note) => !note.groupId)
      .slice(0, 3)
      .map((note) => note.id),
  ].slice(0, 3);
  for (const session of sessions)
    for (const id of targetIds)
      command(application, `connection-${sessions.indexOf(session)}`, {
        type: 'toggle-vote',
        id,
      });

  command(application, 'connection-0', { type: 'advance' });
  for (let index = 0; index < size.actions; index++)
    command(application, 'connection-0', {
      type: 'add-action',
      text: `${LONG_ACTION.slice(0, 995)}${String(index).padStart(5, '0')}`,
      owner: { kind: 'unassigned' },
    });

  const final = state(
    command(application, 'connection-0', { type: 'refresh' }),
    'connection-0',
  );
  return {
    application,
    retro,
    transport,
    code,
    sessions,
    sockets,
    room: materializeRetroState(final),
  };

  function registerSocket(connectionId: string) {
    const fake: FakeSocket = {
      readyState: WebSocket.OPEN,
      sent: [],
      send(value) {
        this.sent.push(value);
      },
    };
    // The benchmark uses the same opaque IDs as the application result.
    transport.register(fake as unknown as WebSocket, connectionId);
    return fake;
  }
}

function measureBaseline(fixture: BuiltFixture) {
  const snapshotTimes: number[] = [];
  const serializationTimes: number[] = [];
  const events = () =>
    fixture.sessions.map((session) => ({
      event: 'retro-state',
      data: {
        room: fixture.retro.snapshot(session),
        self: { id: session.id, token: session.token },
        recipient: { notes: [], votedNoteIds: [], votedGroupIds: [] },
        version: 1,
      },
    }));
  for (let index = 0; index < WARMUP; index++) events();
  for (let index = 0; index < ITERATIONS; index++) {
    const started = performance.now();
    events();
    snapshotTimes.push(performance.now() - started);
  }
  for (let index = 0; index < WARMUP; index++) JSON.stringify(events());
  for (let index = 0; index < ITERATIONS; index++) {
    const values = events();
    const started = performance.now();
    for (const event of values) JSON.stringify(event);
    serializationTimes.push(performance.now() - started);
  }
  return {
    snapshotMs: statistics(snapshotTimes),
    serializationMs: statistics(serializationTimes),
  };
}

function measureOptimized(fixture: BuiltFixture) {
  const applicationTimes: number[] = [];
  const transportTimes: number[] = [];
  let lastResult: ReturnType<RetroApplicationService['execute']> | undefined;
  const actionId = fixture.room.actions[0]?.id;
  if (!actionId) throw new Error('Benchmark fixture did not create an action');
  for (let index = 0; index < WARMUP; index++) {
    lastResult = command(fixture.application, 'connection-0', {
      type: 'toggle-action',
      id: actionId,
    });
    fixture.transport.dispatch(lastResult);
  }
  for (let index = 0; index < ITERATIONS; index++) {
    const applicationStarted = performance.now();
    lastResult = command(fixture.application, 'connection-0', {
      type: 'toggle-action',
      id: actionId,
    });
    applicationTimes.push(performance.now() - applicationStarted);
    const transportStarted = performance.now();
    fixture.transport.dispatch(lastResult);
    transportTimes.push(performance.now() - transportStarted);
  }
  if (!lastResult) throw new Error('Benchmark did not produce an update');
  const sent = fixture.sockets.map((socket) => socket.sent.at(-1) ?? '');
  const lastEvent = lastResult.messages[0].event as RetroServerEvent;
  if (lastEvent.event !== 'retro-state')
    throw new Error('Benchmark did not produce a state event');
  return {
    applicationMs: statistics(applicationTimes),
    transportMs: statistics(transportTimes),
    publicRoomBytes: Buffer.byteLength(JSON.stringify(lastEvent.data.room)),
    wireBytes: Buffer.byteLength(sent[0]),
    totalWireBytes: sent.reduce(
      (total, value) => total + Buffer.byteLength(value),
      0,
    ),
  };
}

function statistics(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    average: round(
      values.reduce((total, value) => total + value, 0) / values.length,
    ),
    p95: round(sorted[Math.floor(sorted.length * 0.95)]),
  };
}

function round(value: number) {
  return Number(value.toFixed(3));
}

function run(size: Fixture) {
  const fixture = buildFixture(size);
  // materializedRoomBytes is the room a browser reconstructs; the optimized
  // wire metrics separately report the shared public payload.
  const result = measureOptimized(fixture);
  const baseline = measureBaseline(fixture);
  fixture.application.onModuleDestroy();
  return {
    ...size,
    materializedRoomBytes: Buffer.byteLength(JSON.stringify(fixture.room)),
    baseline,
    optimized: result,
  };
}

console.log(
  JSON.stringify(
    {
      iterations: ITERATIONS,
      warmup: WARMUP,
      representative: run({ members: 15, notes: 120, groups: 20, actions: 30 }),
      nearLimit: run({ members: 30, notes: 300, groups: 150, actions: 100 }),
    },
    null,
    2,
  ),
);
