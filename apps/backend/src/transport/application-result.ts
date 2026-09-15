/**
 * Optional wire hint for events with a large recipient-independent payload.
 * The transport owns encoding it; application services still return ordinary
 * event objects for tests and non-WebSocket consumers.
 */
export type OutboundSerialization = {
  type: 'retro-state';
  publicRoom: object;
  self: { id: string; token: string };
  recipient: object;
  version: number;
  requestId?: string;
};

export type OutboundMessage = {
  connectionId: string;
  event: unknown;
  serialization?: OutboundSerialization;
};

export type ConnectionClose = {
  connectionId: string;
  code: number;
  reason: string;
};

export type ApplicationResult<Response = undefined> = {
  response: Response;
  messages: OutboundMessage[];
  closes: ConnectionClose[];
};

export function result<Response = undefined>(
  response?: Response,
  messages: OutboundMessage[] = [],
  closes: ConnectionClose[] = [],
): ApplicationResult<Response> {
  return { response: response as Response, messages, closes };
}
