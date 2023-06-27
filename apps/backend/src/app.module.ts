import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EventsModule } from './events/events.module';
import { TrpcModule } from './trpc/trpc.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TrpcRouterModule } from './trpc-router/trpc-router.module';

@Module({
  imports: [
    // EventsModule,
    TrpcModule,
    TrpcRouterModule,
    EventEmitterModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
