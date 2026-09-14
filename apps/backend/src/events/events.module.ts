import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway.js';
import { ConfigModule } from '@nestjs/config';
import { RoomService } from './room.service.js';
import { UserService } from './user.service.js';
import { CollaborationModule } from '../collaboration/collaboration.module.js';

@Module({
  imports: [ConfigModule, CollaborationModule],
  providers: [EventsGateway, RoomService, UserService],
})
export class EventsModule {}
