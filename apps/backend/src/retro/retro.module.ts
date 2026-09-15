import { Module } from '@nestjs/common';
import { RetroGateway } from './retro.gateway.js';
import { RetroApplicationService } from './retro-application.service.js';
import { RetroSessionController } from './retro-session.controller.js';
import { RetroSessionCookieService } from './retro-session-cookie.service.js';
import { RetroService } from './retro.service.js';
import { CollaborationModule } from '../collaboration/collaboration.module.js';
import { TransportModule } from '../transport/transport.module.js';

@Module({
  imports: [CollaborationModule, TransportModule],
  controllers: [RetroSessionController],
  providers: [
    RetroGateway,
    RetroApplicationService,
    RetroSessionCookieService,
    RetroService,
  ],
})
export class RetroModule {}
