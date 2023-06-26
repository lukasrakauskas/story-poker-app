import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';
import { TrpcRouter } from './trpc/trpc.router';

const port = parseInt(process.env.PORT ?? '4000', 10);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const trpc = app.get(TrpcRouter);
  app.useWebSocketAdapter(new WsAdapter(app));
  trpc.applyMiddleware(app);
  trpc.createWebSocketServer(app, port);
  await app.listen(port);
}

bootstrap();
