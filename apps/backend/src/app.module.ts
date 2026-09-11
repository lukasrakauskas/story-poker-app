import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { EventsModule } from './events/events.module.js';
import { RetroModule } from './retro/retro.module.js';

@Module({
  imports: [
    EventsModule,
    RetroModule,
    ConfigModule.forRoot({
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
