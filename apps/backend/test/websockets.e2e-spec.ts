import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { WsAdapter } from '@nestjs/platform-ws';
import WebSocket from 'ws';

function waitForSocketState(socket: WebSocket, state: WebSocket['readyState']) {
  return new Promise<void>(function (resolve) {
    setTimeout(function () {
      if (socket.readyState === state) {
        resolve();
      } else {
        waitForSocketState(socket, state).then(resolve);
      }
    }, 5);
  });
}

describe('Websockets (e2e)', () => {
  let app: INestApplication;

  function createSocket() {
    const address = app.getHttpServer().listen().address();
    const baseAddress = `ws://[${address.address}]:${address.port}`;
    return new WebSocket(baseAddress);
  }

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
  });

  afterAll(async () => {
    app.close();
  });

  it('should connect successfully', (done) => {
    const socket = createSocket();

    socket.on('open', () => {
      done();
      socket.close();
    });
  });

  it('should create room', async () => {
    const socket = createSocket();

    let data;

    await waitForSocketState(socket, WebSocket.OPEN);

    socket.send(
      JSON.stringify({ event: 'create-room', data: { name: 'example2' } }),
    );

    socket.on('message', (newData) => {
      data = JSON.parse(newData.toString());
      socket.close();
    });

    await waitForSocketState(socket, WebSocket.CLOSED);
    expect(data.event).toEqual('room-joined');
  });
});
