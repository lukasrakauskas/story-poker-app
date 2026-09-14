import { Module } from '@nestjs/common';
import { ApplicationEventBus } from './application-event-bus.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { WebSocketHeartbeatService } from './websocket-heartbeat.service.js';
import { WebSocketTransportService } from './websocket-transport.service.js';

@Module({
  providers: [
    ApplicationEventBus,
    RateLimitService,
    WebSocketHeartbeatService,
    WebSocketTransportService,
  ],
  exports: [
    ApplicationEventBus,
    RateLimitService,
    WebSocketHeartbeatService,
    WebSocketTransportService,
  ],
})
export class TransportModule {}
