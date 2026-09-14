import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CollaborationModule } from '../collaboration/collaboration.module.js';
import { RoomService } from '../events/room.service.js';
import { UserService } from '../events/user.service.js';
import { TransportModule } from '../transport/transport.module.js';
import { PokerApplicationService } from './poker-application.service.js';
import { PokerGateway } from './poker.gateway.js';

@Module({
  imports: [ConfigModule, CollaborationModule, TransportModule],
  providers: [PokerGateway, PokerApplicationService, RoomService, UserService],
})
export class PokerModule {}
