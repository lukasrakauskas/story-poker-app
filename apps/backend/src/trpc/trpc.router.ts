import { INestApplication, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { TrpcService } from './trpc.service';
import * as trpcExpress from '@trpc/server/adapters/express';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import ws from 'ws';

@Injectable()
export class TrpcRouter {
  constructor(private readonly trpc: TrpcService) {}

  appRouter = this.trpc.router({
    hello: this.trpc.procedure
      .input(
        z.object({
          name: z.string().optional(),
        }),
      )
      .query(({ input }) => {
        const { name } = input;
        return {
          greeting: `Hello ${name ? name : `Bilbo`}`,
        };
      }),
  });

  async applyMiddleware(app: INestApplication) {
    app.use(
      `/trpc`,
      trpcExpress.createExpressMiddleware({
        router: this.appRouter,
      }),
    );
  }

  createWebSocketServer(app: INestApplication, port: string | number) {
    const wss = new ws.Server({
      server: app.getHttpServer(),
    });
    const handler = applyWSSHandler({ wss, router: this.appRouter });

    wss.on('connection', (ws) => {
      Logger.log(`➕➕ Connection (${wss.clients.size})`);
      ws.once('close', () => {
        Logger.log(`➖➖ Connection (${wss.clients.size})`);
      });
    });

    process.on('SIGTERM', () => {
      Logger.log('SIGTERM');
      handler.broadcastReconnectNotification();
      wss.close();
      app.close();
    });

    Logger.log(`✅ WebSocket Server listening on ws://localhost:${port}`);
  }
}

export type AppRouter = TrpcRouter[`appRouter`];
