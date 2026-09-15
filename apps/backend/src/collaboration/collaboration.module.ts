import { Module } from '@nestjs/common';
import { ConnectionRegistryService } from './connection-registry.service.js';
import { ParticipantService } from './participant.service.js';
import { RetentionService } from './retention.service.js';
import { RoomAccessService } from './room-access.service.js';
import { RoomRegistryService } from './room-registry.service.js';

@Module({
  providers: [
    ParticipantService,
    RoomAccessService,
    RoomRegistryService,
    RetentionService,
    ConnectionRegistryService,
  ],
  exports: [
    ParticipantService,
    RoomAccessService,
    RoomRegistryService,
    RetentionService,
    ConnectionRegistryService,
  ],
})
export class CollaborationModule {}
