export type OutboundMessage = {
  connectionId: string;
  event: unknown;
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
