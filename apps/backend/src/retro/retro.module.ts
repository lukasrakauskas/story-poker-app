import { Module } from '@nestjs/common';
import { RetroGateway } from './retro.gateway.js';
import { RetroService } from './retro.service.js';

@Module({ providers: [RetroGateway, RetroService] })
export class RetroModule {}
