import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway.js';
import { ConfigModule } from '@nestjs/config';
import { RoomService } from './room.service.js';
import { UserService } from './user.service.js';

@Module({
  imports: [ConfigModule],
  providers: [EventsGateway, RoomService, UserService],
})
export class EventsModule {}
