import { Module } from '@nestjs/common';
import { RetroGateway } from './retro.gateway.js';
import { RetroService } from './retro.service.js';
import { CollaborationModule } from '../collaboration/collaboration.module.js';

@Module({
  imports: [CollaborationModule],
  providers: [RetroGateway, RetroService],
})
export class RetroModule {}
