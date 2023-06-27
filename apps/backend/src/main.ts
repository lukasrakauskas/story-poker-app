import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';
import { TrpcRouter } from './trpc-router/trpc.router';
import cookieParser from 'cookie-parser';

const port = parseInt(process.env.PORT ?? '4000', 10);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: 'http://localhost:3000', credentials: true });

  app.use(cookieParser());

  app.useWebSocketAdapter(new WsAdapter(app));

  const trpc = app.get(TrpcRouter);
  trpc.applyMiddleware(app);
  trpc.createWebSocketServer(app, port);

  await app.listen(port);
}

bootstrap();
