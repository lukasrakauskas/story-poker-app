import { useCallback, useEffect, useMemo, useState } from "react";
import { useWebsocket } from "./use-websocket";
import z from "zod";
import { createEmitter } from "../lib/event-emitter";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  voted: z.boolean(),
  role: z.enum(["user", "mod"]),
  vote: z.string().nullable().optional(),
  status: z.enum(["connected", "disconnected"]),
  avatar: z.number().int().nonnegative().nullable(),
});

const currentUserSchema = userSchema.extend({ token: z.string() });

export type User = z.infer<typeof userSchema>;

const emptyErrorEvents = [
  "room-not-found",
  "user-not-found",
  "target-user-not-found",
  "user-not-mod",
  "moderator-online",
  "name-taken",
  "wrong-room-password",
  "invalid-card-set",
  "invalid-vote",
  "voting-not-active",
  "cannot-kick-self",
  "invalid-avatar",
  "kicked",
  "wrong-password",
  "message-broadcasted",
] as const;

const serverEventsSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("room-info"),
    data: z.object({
      code: z.string(),
      available: z.boolean(),
      requiresPassword: z.boolean(),
    }),
  }),
  z.object({
    event: z.literal("room-joined"),
    data: z.object({
      code: z.string(),
      users: userSchema.array(),
      user: currentUserSchema,
      state: z.enum(["voting", "results"]),
      cardSet: z.array(z.string()),
      results: z.record(z.string(), z.number()),
      requiresPassword: z.boolean(),
    }),
  }),
  ...["user-joined", "user-left", "user-voted", "user-updated"].map((event) =>
    z.object({
      event: z.literal(event),
      data: z.object({ user: userSchema }),
    })
  ),
  z.object({
    event: z.literal("user-removed"),
    data: z.object({ userId: z.string() }),
  }),
  z.object({ event: z.literal("voting-started"), data: z.null() }),
  z.object({
    event: z.literal("results-revealed"),
    data: z.object({
      results: z.record(z.string(), z.number()),
      users: userSchema.array(),
    }),
  }),
  z.object({ event: z.literal("is-alive"), data: z.null().optional() }),
  z.object({
    event: z.literal("bad-username"),
    data: z.object({ error: z.string() }),
  }),
  z.object({
    event: z.literal("broadcasted-message"),
    data: z.object({ message: z.string() }),
  }),
  ...emptyErrorEvents.map((event) =>
    z.object({ event: z.literal(event), data: z.null().optional() })
  ),
]);

type ServerEvents = z.infer<typeof serverEventsSchema>;
type ServerEventsMap = { [T in ServerEvents as T["event"]]: T["data"] };

type WebsocketEventsMap = {
  connected: undefined;
  disconnected: { code: number };
};

type ClientEvents = {
  "inspect-room": { room: string };
  "create-room": { name: string; cardSet?: string[]; password?: string };
  "join-room": { name: string; room: string; password?: string };
  "cast-vote": { vote: string | null };
  "start-voting": undefined;
  "reveal-results": undefined;
  "keep-alive": undefined;
  reconnect: { token: string; room: string };
  "claim-moderator": undefined;
  "promote-user": { userId: string };
  "kick-user": { userId: string };
  "change-avatar": { avatar: number };
  "broadcast-message": { message: string; password: string; roomId: string };
};

export function useAppEvents() {
  const socket = useWebsocket(process.env.NEXT_PUBLIC_WS_URL ?? "");
  const [emitter] = useState(() =>
    createEmitter<ServerEventsMap & WebsocketEventsMap>()
  );

  useEffect(() => {
    const onOpen = () => emitter.emit("connected", undefined);
    const onClose = (event: CloseEvent) => {
      emitter.emit("disconnected", { code: event.code });
    };
    const onMessage = (socketEvent: MessageEvent) => {
      try {
        const parsedMessage = JSON.parse(String(socketEvent.data ?? ""));
        const parsedEvent = serverEventsSchema.safeParse(parsedMessage);
        if (parsedEvent.success) {
          const { event, data } = parsedEvent.data;
          emitter.emit(event, data as never);
        }
      } catch {
        // Ignore malformed server messages and keep the connection active.
      }
    };

    socket.on("open", onOpen);
    socket.on("message", onMessage);
    socket.on("close", onClose);

    return () => {
      socket.off("open", onOpen);
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
  }, [emitter, socket]);

  const send = useCallback(
    <T extends keyof ClientEvents>(event: T, data?: ClientEvents[T]) => {
      socket.send(JSON.stringify({ event, data }));
    },
    [socket]
  );

  return useMemo(
    () => ({
      send,
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      reconnect: socket.reconnect,
      close: socket.close,
      isOpen: socket.isOpen,
    }),
    [emitter, send, socket]
  );
}
