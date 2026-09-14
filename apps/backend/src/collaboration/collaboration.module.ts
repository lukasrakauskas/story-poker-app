import { Module } from '@nestjs/common';
import { ConnectionRegistryService } from './connection-registry.service.js';
import { ParticipantService } from './participant.service.js';
import { RetentionService } from './retention.service.js';
import { RoomRegistryService } from './room-registry.service.js';

@Module({
  providers: [
    ParticipantService,
    RoomRegistryService,
    RetentionService,
    ConnectionRegistryService,
  ],
  exports: [
    ParticipantService,
    RoomRegistryService,
    RetentionService,
    ConnectionRegistryService,
  ],
})
export class CollaborationModule {}
