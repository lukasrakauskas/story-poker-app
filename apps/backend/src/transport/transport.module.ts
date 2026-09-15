import { Module } from '@nestjs/common';
import { ApplicationEventBus } from './application-event-bus.service.js';
import { OriginAllowlistService } from './origin-allowlist.service.js';
import { RATE_LIMIT_OPTIONS, RateLimitService } from './rate-limit.service.js';
import {
  loadWebSocketAdmissionPolicy,
  WebSocketAdmissionService,
  WEBSOCKET_ADMISSION_POLICY,
} from './websocket-admission.service.js';
import { WebSocketHeartbeatService } from './websocket-heartbeat.service.js';
import { WebSocketTransportService } from './websocket-transport.service.js';
import { TransportMetricsService } from './transport-metrics.service.js';

@Module({
  providers: [
    ApplicationEventBus,
    OriginAllowlistService,
    {
      provide: RATE_LIMIT_OPTIONS,
      useValue: {},
    },
    RateLimitService,
    {
      provide: WEBSOCKET_ADMISSION_POLICY,
      useFactory: () => loadWebSocketAdmissionPolicy(),
    },
    WebSocketAdmissionService,
    TransportMetricsService,
    WebSocketHeartbeatService,
    WebSocketTransportService,
  ],
  exports: [
    ApplicationEventBus,
    OriginAllowlistService,
    RateLimitService,
    WebSocketAdmissionService,
    TransportMetricsService,
    WebSocketHeartbeatService,
    WebSocketTransportService,
  ],
})
export class TransportModule {}
