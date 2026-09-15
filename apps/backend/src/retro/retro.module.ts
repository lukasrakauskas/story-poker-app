import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CollaborationModule } from '../collaboration/collaboration.module.js';
import { TransportModule } from '../transport/transport.module.js';
import { RetroApplicationService } from './retro-application.service.js';
import { RetroGateway } from './retro.gateway.js';
import {
  InMemoryRetroRoomRepository,
  RedisRetroRoomRepository,
  RETRO_ROOM_REPOSITORY,
  type RetroRoomRepository,
} from './retro-room.repository.js';
import { RetroService } from './retro.service.js';

function createRepository(config: ConfigService): RetroRoomRepository {
  const redisUrl = config.get<string>('RETRO_REDIS_URL');
  const storage =
    config.get<string>('RETRO_STORAGE') ?? (redisUrl ? 'redis' : 'memory');
  if (storage === 'redis') {
    if (!redisUrl)
      throw new Error('RETRO_REDIS_URL is required when RETRO_STORAGE=redis');
    return new RedisRetroRoomRepository({ url: redisUrl });
  }
  return new InMemoryRetroRoomRepository();
}

@Module({
  imports: [ConfigModule, CollaborationModule, TransportModule],
  providers: [
    {
      provide: RETRO_ROOM_REPOSITORY,
      inject: [ConfigService],
      useFactory: createRepository,
    },
    RetroGateway,
    RetroApplicationService,
    RetroService,
  ],
  exports: [RETRO_ROOM_REPOSITORY, RetroApplicationService, RetroService],
})
export class RetroModule {}
