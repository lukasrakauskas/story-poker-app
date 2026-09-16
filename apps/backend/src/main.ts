import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { WsAdapter } from '@nestjs/platform-ws';
import { OriginAllowlistService } from './transport/origin-allowlist.service.js';

const port = parseInt(process.env.PORT ?? '4000', 10);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origins = app.get(OriginAllowlistService);
  app.enableCors({
    credentials: true,
    origin: (origin, callback) => origins.corsOrigin(origin, callback),
  });
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(port);
}
bootstrap();
